import { describe, it, expect } from "vitest";
import type { ResidentSubscriptionRow } from "../src/api/types";
import { remainingGarments, subscriptionRows } from "../src/portals/subscription-table-rules";

// The supervisor's Plans screen was the plan catalogue, with New plan and Edit.
// Plans belong to the business; a supervisor needs the other direction — which
// resident holds which plan — and only to read it.

const row = (over: Partial<ResidentSubscriptionRow> = {}): ResidentSubscriptionRow => ({
  id: "sub-1", residentId: "res-1",
  residentName: "Anusha Kandula", residentPhone: "9876543210",
  unitNumber: "A-402", towerBlock: "Tower A",
  societyId: "soc-demo", societyName: "My Home Bhooja",
  planId: "plan-basic", planName: "Basic", planTier: "basic",
  monthlyPaise: 49900, cycle: "monthly",
  startDate: "2026-09-01", endDate: "2026-09-30",
  status: "active", autoRenew: true,
  garmentCap: 40, garmentsUsed: 18, turnaroundHours: 48,
  pendingPlanId: null, pendingPlanName: null,
  ...over,
});

describe("what is left of the allowance", () => {
  it("subtracts what has been used", () => {
    expect(remainingGarments(row())).toBe(22);
  });

  it("never goes below nothing", () => {
    // A resident let past their allowance has none left, not minus three, and
    // "-3 garments remaining" is a sentence nobody can act on.
    expect(remainingGarments(row({ garmentCap: 40, garmentsUsed: 43 }))).toBe(0);
  });

  it("says nothing when the plan does not cap it", () => {
    expect(remainingGarments(row({ garmentCap: null }))).toBeNull();
  });
});

describe("narrowing the list", () => {
  const rows = [
    row({ id: "a", residentName: "Anusha Kandula", unitNumber: "A-402", planName: "Basic", status: "active" }),
    row({ id: "b", residentName: "Ravi Kumar", unitNumber: "B-101", planName: "Premium", status: "cancelled" }),
    row({ id: "c", residentName: "Meera Nair", unitNumber: "C-303", planName: "Standard", status: "active" }),
  ];

  it("shows everything when nothing has been asked", () => {
    expect(subscriptionRows(rows, { search: "", status: null })).toHaveLength(3);
  });

  it("finds a resident by name", () => {
    expect(subscriptionRows(rows, { search: "ravi", status: null }).map((r) => r.id)).toEqual(["b"]);
  });

  it("finds a resident by flat, which is what a supervisor is usually given", () => {
    expect(subscriptionRows(rows, { search: "C-303", status: null }).map((r) => r.id)).toEqual(["c"]);
  });

  it("finds by the plan somebody claims to be on", () => {
    expect(subscriptionRows(rows, { search: "premium", status: null }).map((r) => r.id)).toEqual(["b"]);
  });

  it("ignores case and surrounding space", () => {
    expect(subscriptionRows(rows, { search: "  ANUSHA  ", status: null }).map((r) => r.id)).toEqual(["a"]);
  });

  it("filters by status", () => {
    expect(subscriptionRows(rows, { search: "", status: "active" }).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("applies the search and the status together", () => {
    expect(subscriptionRows(rows, { search: "a", status: "cancelled" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("has nothing to show rather than everything when nothing matches", () => {
    expect(subscriptionRows(rows, { search: "nobody", status: null })).toEqual([]);
  });

  it("survives a row with pieces missing", () => {
    // A resident who never finished onboarding has no name; searching must not throw.
    const sparse = [row({ id: "x", residentName: null, unitNumber: null, planName: null, towerBlock: null })];
    expect(() => subscriptionRows(sparse, { search: "any", status: null })).not.toThrow();
    expect(subscriptionRows(sparse, { search: "", status: null })).toHaveLength(1);
  });
});
