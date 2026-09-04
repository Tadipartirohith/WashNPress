import { describe, it, expect } from "vitest";
import { SUPERVISOR_TABS, isPositiveCount, towerProblem } from "../src/portals/supervisor-rules";

describe("what a supervisor's portal is made of", () => {
  it("no longer carries Search, QC or Processing", () => {
    // Search duplicated the filters on every list that has them; QC Monitoring was a
    // read-only copy of a screen the operations staff work in; Processing was five
    // sub-tabs of the same. Each was a tab in the way of the ones that are decisions
    // a supervisor actually makes.
    const keys = SUPERVISOR_TABS.map((t) => t.key);
    expect(keys).not.toContain("search");
    expect(keys).not.toContain("qc");
    expect(keys).not.toContain("processing");
    // And no Societies tab: a supervisor runs one society, which is My society.
    expect(keys).not.toContain("societies");
  });

  it("keeps the sections that are, and adds the services a supervisor could not see", () => {
    // Services joined the list: a booking used to go into the operator's queue and
    // the only way to find out who was doing it was to ask them. Plans joined it too:
    // subscription plans are system-wide, and a supervisor now creates and edits them
    // with the same wizard the admin uses.
    expect(SUPERVISOR_TABS.map((t) => t.key)).toEqual([
      "home", "mysociety", "slots", "operators", "pickups",
      "orders", "services", "delayed", "refunds", "plans", "issues", "reports", "profile",
    ]);
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
