import type { Block, Society, User } from "./models";

// Who answers for what.
//
// The platform used to record responsibility one level too high and one level too
// coarse: a supervisor was attached to an *area*, so one person answered for every
// society in it, and an operator was attached to a whole *society*, so being given
// My Home Bhooja meant being given all three of its towers and a hundred and twenty
// flats. Neither matched how the work is actually divided.
//
// The chain is Admin → Society → Supervisor → Blocks → Operators → Residents/Orders,
// and every pickup, order and operational activity follows it. Areas are not a rung
// on it: an admin gives a supervisor one society, and that supervisor gives each of
// their operators blocks inside it. This module is the one statement of the rules
// along that chain; it does no I/O, so the rules can be read and tested without a
// database behind them.

export class AssignmentError extends Error {
  constructor(message: string) { super(message); this.name = "AssignmentError"; }
}

// One supervisor, one society. Assigning somebody who already holds a society is a
// mistake worth naming rather than a silent move: the person deciding is usually
// not the person who made the earlier assignment, and quietly vacating a society is
// how a society ends up with nobody running it and nobody noticing.
export function supervisorConflict(
  supervisorUserId: string,
  targetSocietyId: string,
  societies: Society[],
): Society | null {
  return societies.find(
    (s) => s.supervisorUserId === supervisorUserId && s.id !== targetSocietyId,
  ) ?? null;
}

export function assertSupervisorFree(
  supervisorUserId: string,
  targetSocietyId: string,
  societies: Society[],
): void {
  const held = supervisorConflict(supervisorUserId, targetSocietyId, societies);
  if (held) {
    throw new AssignmentError(
      `That supervisor already runs ${held.name || "another society"}. Remove that assignment first.`,
    );
  }
}

// Somebody has to be a supervisor, be approved, and still be on duty before they can
// be given a society. An account that is on leave or blocked is not a supervisor for
// the purpose of a new assignment, whatever its role says.
export function supervisorEligibility(user: User | null): { ok: boolean; reason: string | null } {
  if (!user) return { ok: false, reason: "That supervisor does not exist" };
  if (!user.roles.includes("supervisor")) return { ok: false, reason: `${user.fullName ?? "That account"} is not a supervisor` };
  if ((user.verificationStatus ?? "approved") !== "approved") {
    return { ok: false, reason: `${user.fullName ?? "That supervisor"} has not been approved yet` };
  }
  if (user.status !== "active") {
    return { ok: false, reason: `${user.fullName ?? "That supervisor"} is not on duty` };
  }
  return { ok: true, reason: null };
}

export function operatorEligibility(user: User | null): { ok: boolean; reason: string | null } {
  if (!user) return { ok: false, reason: "That operator does not exist" };
  if (!user.roles.includes("operator")) return { ok: false, reason: `${user.fullName ?? "That account"} is not an operator` };
  if ((user.verificationStatus ?? "approved") !== "approved") {
    return { ok: false, reason: `${user.fullName ?? "That operator"} has not been approved yet` };
  }
  // An operator on leave keeps their blocks — the assignment is what gets handed
  // over when they go, and taking it away at the same moment loses the record of
  // what needs covering. Only a blocked or deleted account is refused.
  if (user.status === "blocked" || user.status === "deleted") {
    return { ok: false, reason: `${user.fullName ?? "That operator"} is blocked` };
  }
  return { ok: true, reason: null };
}

// An operator works blocks, and every block they work has to be in the society they
// are attached to. Assigning across societies is not a narrower permission, it is a
// wider one, and it would let a block assignment quietly grant a whole extra society
// — including one run by a different supervisor.
export function blocksWithinSocieties(blocks: Block[], societyIds: string[]): boolean {
  return blocks.every((b) => societyIds.includes(b.societyId));
}

// What one operator ends up covering. Blocks are the assignment now rather than a
// narrowing of one, so an operator covers the blocks they were named on and nothing
// else — an empty list is somebody who has not been given any work yet, not somebody
// who has been given all of it. (Accounts made before that was true are put on every
// block of their society by the backfill, so nobody loses work to the change.)
//
// A supervisor covers their whole society, which is what a null block list means.
export interface Coverage { societyIds: string[]; blockIds: string[] | null }

export function coverageOf(user: Pick<User, "societyIds" | "blockIds">): Coverage {
  return { societyIds: user.societyIds ?? [], blockIds: user.blockIds ?? [] };
}

export function supervisorCoverage(user: Pick<User, "societyIds">): Coverage {
  return { societyIds: user.societyIds ?? [], blockIds: null };
}

// Whether a piece of work is inside somebody's coverage. A block that is not known —
// an order raised before blocks existed, or a resident who never said which tower
// they live in — is inside the society's coverage but outside any narrower one, so
// an operator restricted to two of three blocks does not silently pick it up.
export function coversWork(
  coverage: Coverage,
  work: { societyId: string | null | undefined; blockId?: string | null },
): boolean {
  if (!work.societyId || !coverage.societyIds.includes(work.societyId)) return false;
  if (coverage.blockIds === null) return true;
  if (!work.blockId) return false;
  return coverage.blockIds.includes(work.blockId);
}

// The row the assignment screens are built from: a block, how big it is, and who is
// on it. The spec asks for society, block, flats, operator, residents and active
// orders together, because deciding who covers a block means knowing how much work
// the block is.
export interface BlockAllocation {
  blockId: string;
  blockName: string;
  societyId: string;
  societyName: string;
  flatCount: number;
  floorCount: number;
  operators: { id: string; fullName: string | null }[];
  residentCount: number;
  activeOrderCount: number;
  status: Block["status"];
}

// A block name normalised for comparison. Residents type "A", "Block A", "Tower-A"
// and "a" for the same tower, and a block record should not be created three times
// because of it.
export function blockKey(name: string): string {
  return name.trim().toLowerCase().replace(/^(block|tower|wing|phase)\s*[-:]?\s*/i, "").replace(/\s+/g, " ");
}

export function sameBlock(a: string, b: string): boolean {
  return blockKey(a) === blockKey(b);
}

// What a tower has to say about itself before it can be added.
//
// Only what was actually given is checked. A block recorded before towers had
// floors has none, and editing its name must not be refused for a number nobody
// was ever asked for.
export function blockProblems(input: { name?: string; flatCount?: number; floorCount?: number }): string[] {
  const problems: string[] = [];
  if (!input.name || !input.name.trim()) problems.push("A block needs a name");
  problems.push(...countProblems("Floors", input.floorCount));
  problems.push(...countProblems("Flats", input.flatCount));
  return problems;
}

// A tower of no floors, or of half a floor, is not a tower. Zero is refused as
// firmly as a negative number: it is not a smaller building, it is a mistake.
function countProblems(what: string, value: number | undefined): string[] {
  if (value === undefined) return [];
  if (!Number.isFinite(value)) return [`${what} must be a number`];
  if (!Number.isInteger(value)) return [`${what} are counted whole`];
  if (value < 1) return [`${what} must be a positive number`];
  return [];
}
