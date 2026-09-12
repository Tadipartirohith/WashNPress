import { randomUUID } from "node:crypto";
import type { Block, Session, Society, User } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import { generateFlats, flatsByFloor } from "../domain/flats";
import { bareFlatNumber } from "../domain/unit";
import {
  AssignmentError, assertSupervisorFree, blockKey, blockProblems, coverageOf, coversWork,
  operatorEligibility, supervisorEligibility, flatLayoutOfBlock,
  type BlockAllocation,
} from "../domain/assignment";
import type { AuditService } from "./audit-service";
import { reassignBlock } from "./auto-assign";

// The assignment chain, as something a screen can read and an admin can change.
//
// Admin → Society → Supervisor → Blocks → Operators → Residents/Orders. Every part
// of it used to be implied by a pair of fields on the user record, which meant
// nothing could show a society and say who ran it, or show a block and say who
// collected from it. This service owns the whole chain: it writes both sides of an assignment
// in one place, so the society's idea of its supervisor and the supervisor's idea of
// their society cannot drift apart.

export const ACTIVE_ORDER_STATES = [
  "scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold",
  "ready_for_delivery", "out_for_delivery",
];

// A tower's flats. Most towers never stored an explicit list, only a floor count and a
// flat count, so those are generated from the counts. Without this every such tower
// had no floors to show, no floor for its residents, and no flat that could be
// switched off.
function flatsOf(block: Block): NonNullable<Block["flats"]> {
  if (block.flats?.length) return block.flats;
  return flatLayoutOfBlock(block).map((flat) => ({ ...flat, status: "available" as const }));
}

export class AssignmentService {
  constructor(private readonly store: DataStore, private readonly audit: AuditService) {}

  // ---------------------------------------------------------------- reading

  async blocksOf(societyId: string): Promise<Block[]> {
    const blocks = await this.store.blocks.find((b) => b.societyId === societyId);
    return blocks.sort((a, b) => a.name.localeCompare(b.name));
  }

  // A society, its supervisor, and every block in it with the work each one carries.
  // Assembled in one pass rather than one query per block, because an assignment
  // screen showing a society with six towers should not make seven round trips.
  async allocation(societyId: string): Promise<{
    society: Society;
    supervisor: { id: string; fullName: string | null; phone: string; status: User["status"] } | null;
    blocks: BlockAllocation[];
    unassignedResidentCount: number;
  } | null> {
    const society = await this.store.societies.get(societyId);
    if (!society) return null;
    const supervisorUser = society.supervisorUserId
      ? await this.store.users.get(society.supervisorUserId)
      : null;
    const blocks = await this.blocksOf(societyId);
    const residents = await this.store.residents.find((r) => r.societyId === societyId);
    const orders = await this.store.orders.find(
      (o) => o.societyId === societyId && ACTIVE_ORDER_STATES.includes(o.state),
    );
    const operators = await this.store.users.find((u) => u.roles.includes("operator"));
    const byId = new Map(operators.map((o) => [o.id, o]));

    const rows: BlockAllocation[] = blocks.map((block) => ({
      blockId: block.id,
      blockName: block.name,
      societyId: society.id,
      societyName: society.name,
      flatCount: block.flatCount,
      floorCount: block.floorCount ?? 0,
      flatsPerFloor: block.flatsPerFloor ?? null,
      operators: block.operatorUserIds
        .map((id) => byId.get(id))
        .filter((u): u is User => Boolean(u))
        .map((u) => ({ id: u.id, fullName: u.fullName })),
      residentCount: residents.filter((r) => r.blockId === block.id).length,
      activeOrderCount: orders.filter((o) => o.blockId === block.id).length,
      status: block.status,
    }));

    return {
      society,
      supervisor: supervisorUser
        ? {
            id: supervisorUser.id, fullName: supervisorUser.fullName,
            phone: supervisorUser.phone, status: supervisorUser.status,
          }
        : null,
      blocks: rows,
      // Residents whose block was never recorded. Worth stating plainly on the
      // screen: they belong to the society but to no block, so a fully block-based
      // assignment leaves them uncovered until somebody says where they live.
      unassignedResidentCount: residents.filter((r) => !r.blockId).length,
    };
  }

  // ------------------------------------------------------------- blocks

  async createBlock(input: {
    societyId: string; name: string; flatCount?: number; floorCount?: number; flatsPerFloor?: number; session: Session;
  }): Promise<Block> {
    const society = await this.store.societies.get(input.societyId);
    if (!society) throw new AssignmentError("That society does not exist");
    const problems = blockProblems({
      name: input.name, flatCount: input.flatCount, floorCount: input.floorCount,
    });
    if (problems.length) throw new AssignmentError(problems[0]);

    const existing = await this.blocksOf(input.societyId);
    if (existing.some((b) => blockKey(b.name) === blockKey(input.name))) {
      throw new AssignmentError(`${society.name} already has a block called ${input.name.trim()}`);
    }
    // When both a floor count and flats-per-floor are given, the exact Floor → Flat
    // structure is generated up front; the flatCount is kept in step with it.
    const floorCount = input.floorCount ?? 0;
    const flats = input.flatsPerFloor && floorCount ? generateFlats(floorCount, input.flatsPerFloor) : undefined;
    const block: Block = {
      id: randomUUID(), societyId: input.societyId, name: input.name.trim(),
      flatCount: flats ? flats.length : (input.flatCount ?? 0), floorCount,
      flatsPerFloor: input.flatsPerFloor, flats,
      operatorUserIds: [], status: "active",
      createdAt: new Date().toISOString(),
    };
    await this.store.blocks.put(block);
    await this.audit.record({
      session: input.session, action: "block.created", resource: "block", resourceId: block.id,
      previousValue: null,
      newValue: {
        societyId: block.societyId, name: block.name,
        flatCount: block.flatCount, floorCount: block.floorCount,
      },
    });
    return block;
  }

  async updateBlock(
    id: string,
    patch: Partial<Pick<Block, "name" | "flatCount" | "floorCount" | "status" | "flatsPerFloor">>,
    session: Session,
  ): Promise<Block> {
    const previous = await this.store.blocks.get(id);
    if (!previous) throw new AssignmentError("That block does not exist");
    // Only what this edit actually changes. A block recorded before towers had
    // floors has none, and renaming it must not be refused for a number nobody was
    // ever asked for.
    const problems = blockProblems({
      name: patch.name ?? previous.name,
      flatCount: patch.flatCount,
      floorCount: patch.floorCount,
    });
    if (problems.length) throw new AssignmentError(problems[0]);
    if (patch.name && blockKey(patch.name) !== blockKey(previous.name)) {
      const siblings = await this.blocksOf(previous.societyId);
      if (siblings.some((b) => b.id !== id && blockKey(b.name) === blockKey(patch.name!))) {
        throw new AssignmentError(`That society already has a block called ${patch.name.trim()}`);
      }
    }
    const current: Block = {
      ...previous,
      ...patch,
      name: (patch.name ?? previous.name).trim(),
    };
    // Regenerate the Floor → Flat structure when the floors or flats-per-floor change,
    // preserving the availability of every flat number that still exists. flatCount
    // tracks the generated structure so the card and the structure never disagree.
    const floorCount = patch.floorCount ?? previous.floorCount;
    const flatsPerFloor = patch.flatsPerFloor ?? previous.flatsPerFloor;
    if ((patch.floorCount !== undefined || patch.flatsPerFloor !== undefined) && floorCount && flatsPerFloor) {
      current.flats = generateFlats(floorCount, flatsPerFloor, previous.flats ?? []);
      current.flatsPerFloor = flatsPerFloor;
      current.flatCount = current.flats.length;
    }
    await this.store.blocks.put(current);
    await this.audit.record({
      session, action: "block.updated", resource: "block", resourceId: id,
      previousValue: {
        name: previous.name, flatCount: previous.flatCount,
        floorCount: previous.floorCount, status: previous.status,
      },
      newValue: {
        name: current.name, flatCount: current.flatCount,
        floorCount: current.floorCount, status: current.status,
      },
    });
    return current;
  }

  // The Floor → Flat structure of one tower, with each flat's live occupancy overlaid
  // from residents (a flat someone lives in reads "occupied" regardless of its stored
  // availability). Backs the Manage Flats drawer and the registration dropdowns.
  async blockFlats(blockId: string): Promise<{
    block: Block;
    floors: { floor: number; flats: { number: string; status: "available" | "occupied" | "inactive"; residentName: string | null }[] }[];
  } | null> {
    const block = await this.store.blocks.get(blockId);
    if (!block) return null;
    const residents = await this.store.residents.find((r) => r.blockId === blockId);
    // Keyed by the bare flat on both sides: a resident recorded as "A-402" lives in
    // the layout's "402", and an exact match showed that flat as free.
    const flatKey = (value: string) => bareFlatNumber(String(value), block.name).toLowerCase();
    const occupant = new Map<string, string>();
    for (const r of residents) if (r.unitNumber) occupant.set(flatKey(r.unitNumber), r.userId);
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    const flats = flatsOf(block);
    const floors = flatsByFloor(flats).map(({ floor, flats: fs }) => ({
      floor,
      flats: fs.map((f) => {
        const residentUserId = occupant.get(flatKey(f.number));
        return {
          number: f.number,
          status: residentUserId ? ("occupied" as const) : f.status,
          residentName: residentUserId ? users.get(residentUserId)?.fullName ?? null : null,
        };
      }),
    }));
    return { block, floors };
  }

  // Marks one flat available or inactive. A flat somebody lives in cannot be turned
  // off from under them — the resident must be moved first — so occupied flats are
  // refused rather than silently deactivated.
  async setFlatStatus(blockId: string, number: string, status: "available" | "inactive", session: Session): Promise<Block> {
    const block = await this.store.blocks.get(blockId);
    if (!block) throw new AssignmentError("That tower does not exist");
    const flats = flatsOf(block);
    const flat = flats.find((f) => f.number === number);
    if (!flat) throw new AssignmentError("That flat does not exist");
    if (status === "inactive") {
      const wanted = bareFlatNumber(number, block.name).toLowerCase();
      const occupied = await this.store.residents.find((r) => r.blockId === blockId
        && Boolean(r.unitNumber) && bareFlatNumber(String(r.unitNumber), block.name).toLowerCase() === wanted);
      if (occupied.length > 0) throw new AssignmentError("A resident lives in this flat. Move them before deactivating it.");
    }
    const current: Block = { ...block, flats: flats.map((f) => (f.number === number ? { ...f, status } : f)) };
    await this.store.blocks.put(current);
    await this.audit.record({
      session, action: "flat.status_changed", resource: "block", resourceId: blockId,
      previousValue: { number, status: flat.status }, newValue: { number, status },
    });
    return current;
  }

  // ------------------------------------------------------- the supervisor

  // One supervisor per society, one society per supervisor. Both sides are written
  // here: the society records who runs it, and the supervisor's own scope is set to
  // that society, because a session reads its scope from the user record and the two
  // must say the same thing.
  async assignSupervisor(input: {
    societyId: string;
    supervisorUserId: string | null;
    session: Session;
    // The admin is creating this account and giving it a society in one action.
    // Approval is a separate gate — it decides whether the portal opens, not
    // whether a society is waiting for them — and insisting on it here would mean
    // the mandatory assignment could never be made at the moment of creation.
    newlyCreated?: boolean;
    // Moving somebody who already runs a society, rather than handing them a
    // second one. Assigning into a society from the assignment screen is refused
    // when the person is already spoken for, because the admin there is thinking
    // about the society and would not see what they were quietly vacating. An
    // admin editing the *person* is thinking about exactly that, so the society
    // they leave is released rather than the move being refused.
    releasePrevious?: boolean;
  }): Promise<Society> {
    const society = await this.store.societies.get(input.societyId);
    if (!society) throw new AssignmentError("That society does not exist");
    const previousUserId = society.supervisorUserId ?? null;

    if (input.supervisorUserId) {
      const user = await this.store.users.get(input.supervisorUserId);
      const eligible = input.newlyCreated
        ? { ok: Boolean(user?.roles.includes("supervisor")), reason: "That supervisor does not exist" }
        : supervisorEligibility(user);
      if (!eligible.ok) throw new AssignmentError(eligible.reason!);
      const societies = await this.store.societies.all();
      if (input.releasePrevious) {
        for (const held of societies.filter(
          (sc) => sc.supervisorUserId === input.supervisorUserId && sc.id !== input.societyId)) {
          await this.store.societies.put({ ...held, supervisorUserId: null });
          await this.audit.record({
            session: input.session, action: "society.supervisor_cleared",
            resource: "society", resourceId: held.id,
            previousValue: { supervisorUserId: input.supervisorUserId },
            newValue: { supervisorUserId: null },
          });
        }
      } else {
        assertSupervisorFree(input.supervisorUserId, input.societyId, societies);
      }
    }

    // The person who held it before loses the society, so they are not left holding
    // one they no longer run.
    if (previousUserId && previousUserId !== input.supervisorUserId) {
      const before = await this.store.users.get(previousUserId);
      if (before) {
        before.societyIds = (before.societyIds ?? []).filter((id) => id !== input.societyId);
        before.assignmentUpdatedAt = new Date().toISOString();
        await this.store.users.put(before);
      }
    }

    if (input.supervisorUserId) {
      const user = (await this.store.users.get(input.supervisorUserId))!;
      // A supervisor's society list is exactly one society: the thing they were
      // given, and the whole of their scope.
      user.societyIds = [input.societyId];
      user.assignmentUpdatedAt = new Date().toISOString();
      await this.store.users.put(user);
    }

    const current: Society = { ...society, supervisorUserId: input.supervisorUserId };
    await this.store.societies.put(current);
    await this.audit.record({
      session: input.session,
      action: input.supervisorUserId ? "society.supervisor_assigned" : "society.supervisor_cleared",
      resource: "society", resourceId: society.id,
      previousValue: { supervisorUserId: previousUserId },
      newValue: { supervisorUserId: input.supervisorUserId },
    });
    return current;
  }

  // --------------------------------------------------------- the operators

  // Who covers a block. Given as the whole list rather than as add and remove, so
  // the screen sends what it shows and there is no way for the two to disagree.
  async setBlockOperators(input: {
    blockId: string;
    operatorUserIds: string[];
    session: Session;
  }): Promise<Block> {
    const block = await this.store.blocks.get(input.blockId);
    if (!block) throw new AssignmentError("That block does not exist");
    const society = await this.store.societies.get(block.societyId);
    if (!society) throw new AssignmentError("That block's society does not exist");

    const wanted = Array.from(new Set(input.operatorUserIds));
    for (const id of wanted) {
      const user = await this.store.users.get(id);
      const eligible = operatorEligibility(user);
      if (!eligible.ok) throw new AssignmentError(eligible.reason!);
    }

    const previous = block.operatorUserIds;
    const current: Block = { ...block, operatorUserIds: wanted };
    await this.store.blocks.put(current);

    // Both sides again: the block lists its operators, and each operator lists the
    // blocks they cover, because that is what their session scope is read from.
    const touched = Array.from(new Set([...previous, ...wanted]));
    for (const id of touched) {
      const user = await this.store.users.get(id);
      if (!user) continue;
      const blockIds = new Set(user.blockIds ?? []);
      const societyIds = new Set(user.societyIds ?? []);
      if (wanted.includes(id)) {
        blockIds.add(block.id);
        // Being given a block in a society is being given work in that society.
        societyIds.add(block.societyId);
      } else {
        blockIds.delete(block.id);
      }
      user.blockIds = Array.from(blockIds);
      user.societyIds = Array.from(societyIds);
      user.assignmentUpdatedAt = new Date().toISOString();
      await this.store.users.put(user);
    }

    // Orders already booked from this tower and not yet collected follow the
    // tower. Leaving them on somebody who no longer goes there is how a round ends
    // up with an order nobody is expecting.
    await reassignBlock(this.store, block.id);

    await this.audit.record({
      session: input.session, action: "block.operators_assigned", resource: "block", resourceId: block.id,
      previousValue: { operatorUserIds: previous },
      newValue: { operatorUserIds: wanted },
    });
    return current;
  }

  // Every block one operator covers, across societies. What the operator's own
  // portal shows them, and what an assignment screen shows beside their name.
  async blocksFor(operatorUserId: string): Promise<BlockAllocation[]> {
    const user = await this.store.users.get(operatorUserId);
    if (!user) return [];
    const coverage = coverageOf(user);
    const blocks = await this.store.blocks.find((b) =>
      coverage.blockIds === null
        ? coverage.societyIds.includes(b.societyId)
        : coverage.blockIds.includes(b.id));
    const societies = await this.store.societies.all();
    const byId = new Map(societies.map((s) => [s.id, s]));
    const residents = await this.store.residents.all();
    const orders = await this.store.orders.find((o) => ACTIVE_ORDER_STATES.includes(o.state));
    return blocks
      .map((block) => ({
        blockId: block.id, blockName: block.name, societyId: block.societyId,
        societyName: byId.get(block.societyId)?.name ?? "",
        flatCount: block.flatCount,
        floorCount: block.floorCount ?? 0,
        flatsPerFloor: block.flatsPerFloor ?? null,
        operators: [{ id: user.id, fullName: user.fullName }],
        residentCount: residents.filter((r) => r.blockId === block.id).length,
        activeOrderCount: orders.filter((o) => o.blockId === block.id).length,
        status: block.status,
      }))
      .sort((a, b) => (a.societyName + a.blockName).localeCompare(b.societyName + b.blockName));
  }

  // Whether a given operator may touch a given piece of work. The route layer asks
  // this rather than re-deriving the rule per endpoint.
  async operatorCovers(
    operatorUserId: string,
    work: { societyId: string | null | undefined; blockId?: string | null },
  ): Promise<boolean> {
    const user = await this.store.users.get(operatorUserId);
    if (!user) return false;
    return coversWork(coverageOf(user), work);
  }
}
