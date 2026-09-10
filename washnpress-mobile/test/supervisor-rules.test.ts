import { describe, it, expect } from "vitest";
import {
  SUPERVISOR_TABS, SUPERVISOR_ORDER_VIEWS, SUPERVISOR_PRIMARY,
  isPositiveCount, towerProblem,
} from "../src/portals/supervisor-rules";

describe("what a supervisor's portal is made of", () => {
  it("carries Search, and keeps the one society it runs", () => {
    // Search survives as a global cross-entity lookup, distinct from the per-list
    // filters. And no Societies tab: a supervisor runs one society, which is My
    // society.
    const keys = SUPERVISOR_TABS.map((t) => t.key);
    expect(keys).toContain("search");
    expect(keys).not.toContain("societies");
  });

  it("keeps the sections that are, and adds the services a supervisor could not see", () => {
    // Services joined the list: a booking used to go into the operator's queue and
    // the only way to find out who was doing it was to ask them. Plans joined it too:
    // subscription plans are system-wide, and a supervisor now creates and edits them
    // with the same wizard the admin uses.
    expect(SUPERVISOR_TABS.map((t) => t.key)).toEqual([
      "home", "search", "mysociety", "slots", "operators",
      "orders", "services", "plans", "issues", "profile",
    ]);
  });

  it("stops treating one pipeline as four destinations", () => {
    // Pickups, quality checks and delayed orders were tabs of their own, two of them
    // behind "More" — so chasing a late order meant remembering which of nine menu
    // rows it lived under. The web portal has always shown them as views inside
    // Orders, and mobile matches that now.
    const keys = SUPERVISOR_TABS.map((t) => t.key);
    for (const folded of ["pickups", "qc", "delayed", "processing"]) {
      expect(keys, folded).not.toContain(folded);
    }
    expect(SUPERVISOR_ORDER_VIEWS.map((v) => v.key)).toEqual([
      "orders", "pickups", "processing", "qc", "delayed",
    ]);
  });

  it("gives Processing somewhere to be reached from", () => {
    // It was only ever arrived at by tapping a dashboard number, so a supervisor who
    // wanted to know what was in the machines had to first notice a figure worth
    // tapping. The drill-down still works; this is the way in that did not exist.
    expect(SUPERVISOR_ORDER_VIEWS.map((v) => v.key)).toContain("processing");
  });

  it("puts the society in the slot pickups left behind", () => {
    // Four tabs and More is the bar. Folding pickups into Orders freed one, and
    // leaving it empty would have been a gap rather than a decision.
    expect(SUPERVISOR_PRIMARY).toEqual(["home", "orders", "mysociety", "issues"]);
  });

  it("names every view it offers, not just every tab", () => {
    expect(SUPERVISOR_ORDER_VIEWS.every((v) => v.label.trim().length > 0)).toBe(true);
  });

  it("keeps every primary tab reachable as a real destination", () => {
    // A bar item that is not in the tab list is an item that renders nothing.
    const keys = SUPERVISOR_TABS.map((t) => t.key);
    for (const key of SUPERVISOR_PRIMARY) expect(keys, key).toContain(key);
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
