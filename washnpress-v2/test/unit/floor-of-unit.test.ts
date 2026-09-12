import { describe, it, expect } from "vitest";
import { floorOfUnit } from "../../src/domain/assignment";

const towerA = [
  { floor: 3, flats: [{ number: "301" }, { number: "302" }] },
  { floor: 4, flats: [{ number: "401" }, { number: "402" }] },
];

describe("which floor a resident's flat is on", () => {
  it("finds a bare flat number", () => {
    expect(floorOfUnit("A", towerA, "402")).toBe(4);
  });

  it("finds a flat written with the tower in front of it", () => {
    // The seeded resident is "A-402"; the layout lists "402".
    expect(floorOfUnit("A", towerA, "A-402")).toBe(4);
    expect(floorOfUnit("a", towerA, "A 301")).toBe(3);
    expect(floorOfUnit("A", towerA, "a/401")).toBe(4);
  });

  it("strips only this tower's own name, never another's", () => {
    expect(floorOfUnit("A", towerA, "B-402")).toBeNull();
  });

  it("says nothing rather than guessing when the flat is not in the layout", () => {
    expect(floorOfUnit("A", towerA, "A-999")).toBeNull();
    expect(floorOfUnit("A", towerA, "")).toBeNull();
    expect(floorOfUnit("A", towerA, null)).toBeNull();
    expect(floorOfUnit("A", [], "A-402")).toBeNull();
  });
});
