import { describe, it, expect } from "vitest";
import { scopeFor, allowsBlock, allowsSociety, allowsWork, hasRole } from "../../src/domain/access";
import type { Session } from "../../src/domain/models";

function session(overrides: Partial<Session>): Session {
  return {
    token: "t", userId: "u", roles: ["resident"], residentId: null, societyId: null,
    societyIds: [], expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

describe("role and society scope", () => {
  it("gives an admin an unrestricted scope", () => {
    const scope = scopeFor(session({ roles: ["admin"] }));
    expect(scope.societyIds).toBeNull();
    expect(allowsSociety(scope, "any-society")).toBe(true);
    expect(allowsBlock(scope, "any-block")).toBe(true);
  });

  it("binds a supervisor to exactly the society they run, and to the whole of it", () => {
    const scope = scopeFor(session({ roles: ["supervisor"], societyIds: ["soc-a"] }));
    expect(allowsSociety(scope, "soc-a")).toBe(true);
    expect(allowsSociety(scope, "soc-b")).toBe(false);
    // Blocks narrow an operator, not a supervisor: they run every tower of theirs.
    expect(scope.blockIds).toBeNull();
    expect(allowsWork(scope, { societyId: "soc-a", blockId: "blk-anything" })).toBe(true);
  });

  it("gives a supervisor with no society nothing, rather than a corridor", () => {
    // The boundary used to be an area, so a supervisor waiting for a society
    // inherited every society in the area they happened to sit in. There is no
    // area to fall back to: an empty assignment reaches nothing, which is what an
    // empty assignment ought to mean.
    const scope = scopeFor(session({ roles: ["supervisor"], societyIds: [] }));
    expect(scope.societyIds).toEqual([]);
    expect(allowsSociety(scope, "soc-a")).toBe(false);
  });

  it("binds an operator to the blocks they were given", () => {
    const scope = scopeFor(session({
      roles: ["operator"], societyIds: ["soc-a"], blockIds: ["blk-a", "blk-b"],
    }));
    expect(allowsWork(scope, { societyId: "soc-a", blockId: "blk-a" })).toBe(true);
    // The third tower of the same society is not theirs.
    expect(allowsWork(scope, { societyId: "soc-a", blockId: "blk-c" })).toBe(false);
    // Nor is work whose block nobody recorded.
    expect(allowsBlock(scope, null)).toBe(false);
  });

  it("gives an operator with no blocks nothing", () => {
    // Blocks are the assignment now rather than a narrowing of one. An empty list
    // is somebody who has not been given work yet, not somebody given all of it.
    const scope = scopeFor(session({ roles: ["operator"], societyIds: ["soc-a"] }));
    expect(scope.blockIds).toEqual([]);
    expect(allowsWork(scope, { societyId: "soc-a", blockId: "blk-anything" })).toBe(false);
  });

  it("binds a resident to their own record and to no society at all", () => {
    const scope = scopeFor(session({ roles: ["resident"], residentId: "res-1" }));
    expect(scope.residentId).toBe("res-1");
    expect(allowsSociety(scope, "soc-a")).toBe(false);
  });

  it("never lets a block scope widen what a society scope already refused", () => {
    const scope = scopeFor(session({
      roles: ["operator"], societyIds: ["soc-a"], blockIds: ["blk-a"],
    }));
    // The same block id, in a society this operator has no claim on.
    expect(allowsWork(scope, { societyId: "soc-b", blockId: "blk-a" })).toBe(false);
  });

  it("lets admin stand in for any lower role but never the reverse", () => {
    expect(hasRole(session({ roles: ["admin"] }), "supervisor")).toBe(true);
    expect(hasRole(session({ roles: ["admin"] }), "operator")).toBe(true);
    expect(hasRole(session({ roles: ["supervisor"] }), "admin")).toBe(false);
    expect(hasRole(session({ roles: ["operator"] }), "supervisor")).toBe(false);
    expect(hasRole(session({ roles: ["resident"] }), "operator")).toBe(false);
  });
});
