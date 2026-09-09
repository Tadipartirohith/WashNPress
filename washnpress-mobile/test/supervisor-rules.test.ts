import { describe, it, expect } from "vitest";
import { SUPERVISOR_TABS, isPositiveCount, towerProblem } from "../src/portals/supervisor-rules";

describe("what a supervisor's portal is made of", () => {
  it("carries Search and QC (re-added for parity with the web supervisor)", () => {
    // Search and QC were once dropped as duplicative, but the web supervisor keeps
    // both — a global cross-entity Search (distinct from the per-list filters) and a
    // read-only QC monitoring view — so mobile carries them too for exact parity.
    // Processing stays folded into the tappable dashboard pipeline (not its own tab).
    const keys = SUPERVISOR_TABS.map((t) => t.key);
    expect(keys).toContain("search");
    expect(keys).toContain("qc");
    expect(keys).not.toContain("processing");
    // And no Societies tab: a supervisor runs one society, which is My society.
    expect(keys).not.toContain("societies");
  });

  it("keeps the sections that are, and adds the services a supervisor could not see", () => {
    // Services joined the list: a booking used to go into the operator's queue and
    // the only way to find out who was doing it was to ask them. Plans joined it too:
    // subscription plans are system-wide, and a supervisor now creates and edits them
    // with the same wizard the admin uses. Search and QC round out web parity.
    expect(SUPERVISOR_TABS.map((t) => t.key)).toEqual([
      "home", "search", "mysociety", "slots", "operators", "pickups",
      "orders", "qc", "services", "delayed", "plans", "issues", "profile",
    ]);
  });

  it("drops the mobile-only Refunds and Reports tabs the web supervisor never had", () => {
    // Per ST1-I72 the web app is the source of truth: its supervisor portal has no
    // Refunds queue and no Reports screen (refunds live in the admin portal), so
    // mobile carries neither.
    const keys = SUPERVISOR_TABS.map((t) => t.key);
    expect(keys).not.toContain("refunds");
    expect(keys).not.toContain("reports");
  });

  it("names every section it offers", () => {
    expect(SUPERVISOR_TABS.every((t) => t.label.trim().length > 0)).toBe(true);
  });
});

describe("adding a tower", () => {
  it("wants a name, a number of floors and a number of flats", () => {
    expect(towerProblem("Tower A", "10", "40")).toBeNull();
  });

  it("refuses zero as firmly as a negative number", () => {
    // A tower of no floors is not a smaller building, it is a field somebody has
    // not filled in.
    expect(towerProblem("Tower A", "0", "40")).toMatch(/Floors/);
    expect(towerProblem("Tower A", "10", "0")).toMatch(/Flats/);
    expect(towerProblem("Tower A", "-2", "40")).toMatch(/Floors/);
    expect(towerProblem("Tower A", "10", "-1")).toMatch(/Flats/);
  });

  it("refuses a name that is only spacing, and half a floor", () => {
    expect(towerProblem("   ", "10", "40")).toMatch(/name/);
    expect(towerProblem("Tower A", "4.5", "40")).toMatch(/Floors/);
  });

  it("says one problem at a time, because the fields are filled in left to right", () => {
    expect(towerProblem("", "0", "0")).toMatch(/name/);
  });

  it("does not read a blank box as zero", () => {
    expect(isPositiveCount("")).toBe(false);
    expect(isPositiveCount(" ")).toBe(false);
    expect(isPositiveCount("abc")).toBe(false);
    expect(isPositiveCount("1")).toBe(true);
  });
});
