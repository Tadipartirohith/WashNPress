import { randomUUID } from "node:crypto";
import type { Block } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import { blockKey } from "../domain/assignment";

// Giving the existing data a place in the new hierarchy.
//
// Blocks did not exist until now, but the information did: every resident has always
// recorded which tower they live in, as free text on their own record. So the blocks
// are not invented here, they are read out of what residents already said, and each
// resident is attached to the block their own address named.
//
// Supervision moves down a level at the same time — from the area to the society —
// and an area's existing supervisor is given a society in that area rather than being
// left holding nothing.
//
// Every step is idempotent: this runs on each boot, and a second run finds the work
// already done and changes nothing.

const ACTIVE_ORDER_STATES = new Set([
  "scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold",
  "ready_for_delivery", "out_for_delivery",
]);

export interface BackfillReport {
  blocksCreated: number;
  residentsLinked: number;
  societiesGivenSupervisor: number;
  ordersLinked: number;
}

export async function backfillAssignments(store: DataStore): Promise<BackfillReport> {
  const report: BackfillReport = {
    blocksCreated: 0, residentsLinked: 0, societiesGivenSupervisor: 0, ordersLinked: 0,
  };
  const now = new Date().toISOString();

  // ---- blocks, out of what residents already told us they live in --------------
  const residents = await store.residents.all();
  const blocks = await store.blocks.all();
  // societyId -> normalised block name -> block
  const index = new Map<string, Map<string, Block>>();
  for (const block of blocks) {
    if (!index.has(block.societyId)) index.set(block.societyId, new Map());
    index.get(block.societyId)!.set(blockKey(block.name), block);
  }

  for (const resident of residents) {
    const name = (resident.towerBlock ?? "").trim();
    if (!name || !resident.societyId) continue;
    if (!index.has(resident.societyId)) index.set(resident.societyId, new Map());
    const inSociety = index.get(resident.societyId)!;
    let block = inSociety.get(blockKey(name));
    if (!block) {
      block = {
        id: randomUUID(), societyId: resident.societyId, name,
        flatCount: 0, operatorUserIds: [], status: "active", createdAt: now,
      };
      await store.blocks.put(block);
      inSociety.set(blockKey(name), block);
      report.blocksCreated += 1;
    }
    if (resident.blockId !== block.id) {
      await store.residents.put({ ...resident, blockId: block.id });
      report.residentsLinked += 1;
    }
  }

  // A block with no flat count recorded is at least as big as the number of people
  // living in it, which is a better starting figure than zero for a screen that is
  // meant to show how much work a block is. An admin can correct it; nothing here
  // overwrites a count somebody has already given.
  const grouped = new Map<string, number>();
  for (const resident of await store.residents.all()) {
    if (resident.blockId) grouped.set(resident.blockId, (grouped.get(resident.blockId) ?? 0) + 1);
  }
  for (const block of await store.blocks.all()) {
    const lived = grouped.get(block.id) ?? 0;
    if (block.flatCount === 0 && lived > 0) {
      await store.blocks.put({ ...block, flatCount: lived });
    }
  }

  // ---- supervision, down one level from the area to the society ----------------
  const societies = await store.societies.all();
  const held = new Set(
    societies.map((s) => s.supervisorUserId).filter((id): id is string => Boolean(id)),
  );
  const areas = await store.areas.all();
  for (const area of areas) {
    const supervisorUserId = area.supervisorUserId;
    if (!supervisorUserId || held.has(supervisorUserId)) continue;
    // The first society in their area that nobody else runs. One society each, so a
    // supervisor who used to answer for four of them now answers for one, and the
    // other three are visibly waiting for somebody rather than silently covered.
    const candidate = societies.find((s) => s.areaId === area.id && !s.supervisorUserId);
    if (!candidate) continue;
    await store.societies.put({ ...candidate, supervisorUserId });
    candidate.supervisorUserId = supervisorUserId;
    held.add(supervisorUserId);
    report.societiesGivenSupervisor += 1;

    const user = await store.users.get(supervisorUserId);
    if (user) {
      user.societyIds = [candidate.id];
      user.areaId = candidate.areaId ?? user.areaId;
      user.assignmentUpdatedAt = now;
      await store.users.put(user);
    }
  }

  // ---- the work currently on the floor ----------------------------------------
  // Only orders still being worked. A finished order's block is history nobody
  // queries by, and rewriting every order ever placed on every boot would be a cost
  // paid forever for a fact that stops mattering the moment the order is delivered.
  // Read again rather than reusing the snapshot taken before the linking above,
  // which would still say every resident has no block.
  const byResident = new Map((await store.residents.all()).map((r) => [r.id, r]));
  const live = await store.orders.find((o) => ACTIVE_ORDER_STATES.has(o.state) && !o.blockId);
  for (const order of live) {
    const resident = byResident.get(order.residentId);
    const named = (resident?.towerBlock ?? "").trim();
    const blockId = resident?.blockId
      ?? (named ? index.get(order.societyId)?.get(blockKey(named))?.id : undefined);
    if (!blockId) continue;
    await store.orders.put({ ...order, blockId });
    report.ordersLinked += 1;
  }

  return report;
}
