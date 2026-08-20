import { describe, it, expect } from "vitest";
import { scopeFor, allowsArea, allowsSociety, hasRole } from "../../src/domain/access";
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

  it("binds a supervisor to exactly their assigned area", () => {
    const scope = scopeFor(session({ roles: ["supervisor"], areaId: "area-madhapur" }));
    expect(allowsArea(scope, "area-madhapur")).toBe(true);
    expect(allowsArea(scope, "area-gachibowli")).toBe(false);
    expect(allowsSociety(scope, "soc-a", "area-madhapur")).toBe(true);
    expect(allowsSociety(scope, "soc-b", "area-gachibowli")).toBe(false);
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

  it("lets admin stand in for any lower role but never the reverse", () => {
    expect(hasRole(session({ roles: ["admin"] }), "supervisor")).toBe(true);
    expect(hasRole(session({ roles: ["admin"] }), "operator")).toBe(true);
    expect(hasRole(session({ roles: ["supervisor"] }), "admin")).toBe(false);
    expect(hasRole(session({ roles: ["operator"] }), "supervisor")).toBe(false);
    expect(hasRole(session({ roles: ["resident"] }), "operator")).toBe(false);
  });
});
