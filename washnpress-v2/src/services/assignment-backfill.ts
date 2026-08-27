import { randomUUID } from "node:crypto";
import type { Block } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import { blockKey } from "../domain/assignment";
import { backfillOrderOperators } from "./auto-assign";

// Giving the existing data a place in the hierarchy it now lives in.
//
// Blocks were not always a record, but the information was: every resident has
// always said which tower they live in, as free text on their own record. So the
// blocks are not invented here, they are read out of what residents already said,
// and each resident is attached to the block their own address named.
//
// Two rules tightened when areas were removed, and both would strand existing data
// if nothing were done about them:
//
//   A supervisor holds exactly one society. Anybody holding several keeps the first
//   and gives up the rest, so the others are visibly waiting for somebody rather
//   than silently covered by a person who cannot be in five places.
//
//   An operator reaches the blocks they were given and nothing else. That used to
//   mean "no blocks is the whole society", which was the right reading while blocks
//   were a narrowing of an existing assignment. Now that blocks *are* the
//   assignment, an operator with none would reach nothing — so an operator who has
//   never been put on a block is put on every block of the society they already
//   worked, which is exactly what their assignment meant before.
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
  supervisorsNarrowed: number;
  operatorsGivenBlocks: number;
  ordersLinked: number;
  ordersAssigned: number;
}

export async function backfillAssignments(store: DataStore): Promise<BackfillReport> {
  const report: BackfillReport = {
    blocksCreated: 0, residentsLinked: 0, supervisorsNarrowed: 0,
    operatorsGivenBlocks: 0, ordersLinked: 0, ordersAssigned: 0,
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
    let block: Block | undefined = inSociety.get(blockKey(name));
    if (!block) {
      block = {
        id: randomUUID(), societyId: resident.societyId, name,
        flatCount: 0, floorCount: 0, operatorUserIds: [], status: "active", createdAt: now,
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

  // ---- one society per supervisor ---------------------------------------------
  const societies = await store.societies.all();
  const bySupervisor = new Map<string, string[]>();
  for (const society of societies) {
    if (!society.supervisorUserId) continue;
    const held = bySupervisor.get(society.supervisorUserId) ?? [];
    held.push(society.id);
    bySupervisor.set(society.supervisorUserId, held);
  }

  for (const [supervisorUserId, held] of bySupervisor) {
    const [keeps, ...releases] = held;
    for (const societyId of releases) {
      const society = await store.societies.get(societyId);
      if (society) await store.societies.put({ ...society, supervisorUserId: null });
    }
    const user = await store.users.get(supervisorUserId);
    if (!user) continue;
    const already = (user.societyIds ?? []).length === 1 && user.societyIds[0] === keeps;
    if (already && releases.length === 0) continue;
    user.societyIds = [keeps];
    user.assignmentUpdatedAt = now;
    await store.users.put(user);
    report.supervisorsNarrowed += 1;
  }

  // ---- an operator's blocks ----------------------------------------------------
  const currentBlocks = await store.blocks.all();
  const operators = await store.users.find((u) => u.roles.includes("operator"));
  for (const operator of operators) {
    if ((operator.blockIds ?? []).length > 0) continue;
    const covered = currentBlocks.filter((b) => (operator.societyIds ?? []).includes(b.societyId));
    if (covered.length === 0) continue;
    operator.blockIds = covered.map((b) => b.id);
    operator.assignmentUpdatedAt = now;
    await store.users.put(operator);
    // Both sides, or the block's own list and the operator's disagree about who
    // covers what and the assignment screen shows one of them.
    for (const block of covered) {
      if (block.operatorUserIds.includes(operator.id)) continue;
      const current = { ...block, operatorUserIds: [...block.operatorUserIds, operator.id] };
      await store.blocks.put(current);
      block.operatorUserIds = current.operatorUserIds;
    }
    report.operatorsGivenBlocks += 1;
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

  // ---- and who is going to collect it -----------------------------------------
  // Orders booked before a tower's operator was carried onto the order itself.
  // Now that each order knows its block, the operator is a lookup, and every
  // screen that used to print "Unassigned" beside a tower that plainly had
  // somebody on it can say who.
  report.ordersAssigned = await backfillOrderOperators(store);

  return report;
}
