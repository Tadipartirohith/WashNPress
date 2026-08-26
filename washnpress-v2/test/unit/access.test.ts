import { describe, it, expect } from "vitest";
import { scopeFor, allowsArea, allowsBlock, allowsSociety, allowsWork, hasRole } from "../../src/domain/access";
import type { Session } from "../../src/domain/models";

function session(overrides: Partial<Session>): Session {
  return {
    token: "t", userId: "u", roles: ["resident"], residentId: null, societyId: null,
    areaId: null, societyIds: [], expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

describe("role and area scope", () => {
  it("gives an admin an unrestricted scope", () => {
    const scope = scopeFor(session({ roles: ["admin"] }));
    expect(scope.areaIds).toBeNull();
    expect(allowsArea(scope, "any-area")).toBe(true);
    expect(allowsSociety(scope, "any-society", "any-area")).toBe(true);
  });

  it("binds a supervisor to exactly the society they run", () => {
    const scope = scopeFor(session({ roles: ["supervisor"], areaId: "area-madhapur", societyIds: ["soc-a"] }));
    expect(allowsArea(scope, "area-madhapur")).toBe(true);
    expect(allowsArea(scope, "area-gachibowli")).toBe(false);
    expect(allowsSociety(scope, "soc-a", "area-madhapur")).toBe(true);
    // The other society in their own area is somebody else's. Supervision moved
    // down a level: one person per society, not one per corridor of them.
    expect(allowsSociety(scope, "soc-b", "area-madhapur")).toBe(false);
    expect(allowsSociety(scope, "soc-b", "area-gachibowli")).toBe(false);
  });

  it("leaves a supervisor waiting for a society with their area, not with nothing", () => {
    // An account created before anybody assigned it a society is on its way to
    // being given one, and should not be locked out of the platform in the meantime.
    const scope = scopeFor(session({ roles: ["supervisor"], areaId: "area-madhapur", societyIds: [] }));
    expect(allowsSociety(scope, "soc-a", "area-madhapur")).toBe(true);
    expect(allowsSociety(scope, "soc-b", "area-gachibowli")).toBe(false);
  });

  it("binds an operator to the blocks they were given", () => {
    const scope = scopeFor(session({
      roles: ["operator"], areaId: "area-madhapur", societyIds: ["soc-a"], blockIds: ["blk-a", "blk-b"],
    }));
    expect(allowsWork(scope, { areaId: "area-madhapur", societyId: "soc-a", blockId: "blk-a" })).toBe(true);
    // The third tower of the same society is not theirs.
    expect(allowsWork(scope, { areaId: "area-madhapur", societyId: "soc-a", blockId: "blk-c" })).toBe(false);
    // Nor is work whose block nobody recorded.
    expect(allowsBlock(scope, null)).toBe(false);
  });

  it("gives an operator with no blocks the whole of their societies", () => {
    const scope = scopeFor(session({ roles: ["operator"], areaId: "area-madhapur", societyIds: ["soc-a"] }));
    expect(scope.blockIds).toBeNull();
    expect(allowsWork(scope, { areaId: "area-madhapur", societyId: "soc-a", blockId: "blk-anything" })).toBe(true);
    expect(allowsWork(scope, { areaId: "area-madhapur", societyId: "soc-a", blockId: null })).toBe(true);
  });

  it("binds an operator to their assigned societies inside their area", () => {
    const scope = scopeFor(session({ roles: ["operator"], areaId: "area-madhapur", societyIds: ["soc-a"] }));
    expect(allowsSociety(scope, "soc-a", "area-madhapur")).toBe(true);
    expect(allowsSociety(scope, "soc-b", "area-madhapur")).toBe(false);
    expect(allowsSociety(scope, "soc-a", "area-gachibowli")).toBe(false);
  });

  it("binds a resident to their own record and to no society at all", () => {
    const scope = scopeFor(session({ roles: ["resident"], residentId: "res-1" }));
    expect(scope.residentId).toBe("res-1");
    expect(allowsSociety(scope, "soc-a", "area-madhapur")).toBe(false);
  });

  it("treats a supervisor with no area as having no scope, not full scope", () => {
    const scope = scopeFor(session({ roles: ["supervisor"], areaId: null }));
    expect(scope.areaIds).toEqual([]);
    expect(allowsArea(scope, "area-madhapur")).toBe(false);
  });

  it("never lets a block scope widen what a society scope already refused", () => {
    const scope = scopeFor(session({
      roles: ["operator"], areaId: "area-madhapur", societyIds: ["soc-a"], blockIds: ["blk-a"],
    }));
    // The same block id, in a society this operator has no claim on.
    expect(allowsWork(scope, { areaId: "area-madhapur", societyId: "soc-b", blockId: "blk-a" })).toBe(false);
  });

  it("lets admin stand in for any lower role but never the reverse", () => {
    expect(hasRole(session({ roles: ["admin"] }), "supervisor")).toBe(true);
    expect(hasRole(session({ roles: ["admin"] }), "operator")).toBe(true);
    expect(hasRole(session({ roles: ["supervisor"] }), "admin")).toBe(false);
    expect(hasRole(session({ roles: ["operator"] }), "supervisor")).toBe(false);
    expect(hasRole(session({ roles: ["resident"] }), "operator")).toBe(false);
  });
});
