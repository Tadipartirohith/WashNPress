import { describe, it, expect } from "vitest";
import {
  AssignmentError, assertSupervisorFree, blockKey, blockProblems, coverageOf, coversWork,
  operatorEligibility, sameBlock, supervisorConflict, supervisorCoverage, supervisorEligibility,
} from "../../src/domain/assignment";
import type { Society, User } from "../../src/domain/models";

function society(overrides: Partial<Society>): Society {
  return {
    id: "soc-1", name: "Ayyappa Society",
    address: {
      house: "Ayyappa Society", street: "Main Road", locality: "Madhapur",
      city: "Hyderabad", state: "Telangana", pincode: "500081",
    },
    status: "active",
    supervisorUserId: null, createdAt: new Date().toISOString(), ...overrides,
  };
}

function user(overrides: Partial<User>): User {
  return {
    id: "u-1", phone: "9876500011", fullName: "Suresh Kumar", email: null, employeeId: null,
    status: "active", roles: ["supervisor"], lastLoginAt: null, verificationStatus: "approved",
    societyIds: [], blockIds: [], createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("one supervisor, one society", () => {
  it("finds the society a supervisor already runs", () => {
    const societies = [society({ id: "soc-1", supervisorUserId: "u-1" }), society({ id: "soc-2" })];
    expect(supervisorConflict("u-1", "soc-2", societies)?.id).toBe("soc-1");
  });

  it("does not count the society being assigned as a conflict with itself", () => {
    // Re-saving the assignment somebody already holds is not a second society.
    const societies = [society({ id: "soc-1", supervisorUserId: "u-1" })];
    expect(supervisorConflict("u-1", "soc-1", societies)).toBeNull();
    expect(() => assertSupervisorFree("u-1", "soc-1", societies)).not.toThrow();
  });

  it("names the society they hold rather than refusing without saying why", () => {
    const societies = [society({ id: "soc-1", name: "Ayyappa Society", supervisorUserId: "u-1" })];
    expect(() => assertSupervisorFree("u-1", "soc-2", societies)).toThrow(AssignmentError);
    expect(() => assertSupervisorFree("u-1", "soc-2", societies)).toThrow(/Ayyappa Society/);
  });
});

describe("who may be given a society or a block", () => {
  it("refuses somebody who is not a supervisor", () => {
    expect(supervisorEligibility(user({ roles: ["operator"] })).ok).toBe(false);
  });

  it("refuses a supervisor nobody has approved yet", () => {
    const result = supervisorEligibility(user({ verificationStatus: "pending" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/approved/);
  });

  it("refuses a supervisor who is not on duty", () => {
    expect(supervisorEligibility(user({ status: "on_leave" })).ok).toBe(false);
  });

  it("keeps an operator's blocks while they are on leave", () => {
    // The assignment is what gets handed over when somebody goes off duty. Taking
    // it away at the same moment loses the record of what needs covering.
    expect(operatorEligibility(user({ roles: ["operator"], status: "on_leave" })).ok).toBe(true);
    expect(operatorEligibility(user({ roles: ["operator"], status: "blocked" })).ok).toBe(false);
  });
});

describe("what an operator covers", () => {
  it("gives an operator with no blocks nothing", () => {
    // Blocks are the assignment now rather than a narrowing of one, so an empty
    // list is somebody who has not been given work yet. (Accounts made before that
    // was true are put on every block of their society by the backfill, so nobody
    // loses work to the change.)
    const coverage = coverageOf({ societyIds: ["soc-1"], blockIds: [] });
    expect(coverage.blockIds).toEqual([]);
    expect(coversWork(coverage, { societyId: "soc-1", blockId: "blk-a" })).toBe(false);
    expect(coversWork(coverage, { societyId: "soc-1", blockId: null })).toBe(false);
  });

  it("gives a supervisor the whole of the society they run", () => {
    const coverage = supervisorCoverage({ societyIds: ["soc-1"] });
    expect(coverage.blockIds).toBeNull();
    expect(coversWork(coverage, { societyId: "soc-1", blockId: "blk-anything" })).toBe(true);
    expect(coversWork(coverage, { societyId: "soc-2", blockId: "blk-anything" })).toBe(false);
  });

  it("holds an operator with blocks to those blocks", () => {
    const coverage = coverageOf({ societyIds: ["soc-1"], blockIds: ["blk-a", "blk-b"] });
    expect(coversWork(coverage, { societyId: "soc-1", blockId: "blk-a" })).toBe(true);
    expect(coversWork(coverage, { societyId: "soc-1", blockId: "blk-c" })).toBe(false);
  });

  it("keeps work whose block is unknown away from a narrowed assignment", () => {
    // An order raised before blocks existed, or by a resident who never said which
    // tower they live in. It is inside the society but outside any narrower claim,
    // so an operator on two of three blocks does not silently pick it up.
    const narrowed = coverageOf({ societyIds: ["soc-1"], blockIds: ["blk-a"] });
    expect(coversWork(narrowed, { societyId: "soc-1", blockId: null })).toBe(false);
  });

  it("never lets a block assignment reach outside its society", () => {
    const coverage = coverageOf({ societyIds: ["soc-1"], blockIds: ["blk-a"] });
    expect(coversWork(coverage, { societyId: "soc-2", blockId: "blk-a" })).toBe(false);
  });
});

describe("naming a block", () => {
  it("reads the many ways people write the same tower as one block", () => {
    expect(sameBlock("A", "Block A")).toBe(true);
    expect(sameBlock("tower-a", "A")).toBe(true);
    expect(sameBlock(" a ", "Wing A")).toBe(true);
    expect(sameBlock("A", "B")).toBe(false);
  });

  it("keeps a name that is more than a prefix and a letter", () => {
    expect(blockKey("North Wing")).toBe("north wing");
  });

  it("refuses a block with no name or an impossible number of floors or flats", () => {
    expect(blockProblems({ name: "  " })).toContain("A block needs a name");
    expect(blockProblems({ name: "A", flatCount: -1 })).toContain("Flats must be a positive number");
    // Zero is refused as firmly as a negative number: a tower of no flats is not a
    // smaller building, it is somebody who has not filled the field in.
    expect(blockProblems({ name: "A", flatCount: 0 })).toContain("Flats must be a positive number");
    expect(blockProblems({ name: "A", floorCount: 0 })).toContain("Floors must be a positive number");
    expect(blockProblems({ name: "A", flatCount: 4.5 })).toContain("Flats are counted whole");
    expect(blockProblems({ name: "A", floorCount: 10, flatCount: 40 })).toEqual([]);
    // A tower recorded before floors were asked for is not retrospectively invalid.
    expect(blockProblems({ name: "A" })).toEqual([]);
  });
});
