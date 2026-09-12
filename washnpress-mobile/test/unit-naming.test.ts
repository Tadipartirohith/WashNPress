import { describe, it, expect } from "vitest";
import { floorsOf, flatsOn, flatsPerFloor, flatName, unitIsValid } from "../src/portals/unit-naming";

const towerA = { id: "a", name: "A", floorCount: 10, flatCount: 40 };

describe("the floors and flats of a tower", () => {
  it("names a flat by its floor and position, without the tower", () => {
    // The seeded resident lives in Tower A, flat 402: floor 4, second flat along.
    expect(flatName(towerA, 4, 2)).toBe("402");
    expect(flatsOn(towerA, 4)).toContain("402");
  });

  it("lists the floors the tower was given", () => {
    expect(floorsOf(towerA)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("divides the flats across the floors", () => {
    expect(flatsPerFloor(towerA)).toBe(4);
    expect(flatsOn(towerA, 3)).toEqual(["301", "302", "303", "304"]);
  });

  it("does not offer flats that do not exist on the last floor", () => {
    // 3 floors, 10 flats: 4, 4 and 2 — not 4, 4 and 4.
    const odd = { id: "b", name: "B", floorCount: 3, flatCount: 10 };
    expect(flatsOn(odd, 1)).toHaveLength(4);
    expect(flatsOn(odd, 2)).toHaveLength(4);
    expect(flatsOn(odd, 3)).toEqual(["301", "302"]);
    const all = [1, 2, 3].flatMap((f) => flatsOn(odd, f));
    expect(all).toHaveLength(10);
  });

  it("changes with the tower rather than being fixed", () => {
    const bigger = { id: "c", name: "C", floorCount: 12, flatCount: 60 };
    expect(floorsOf(bigger)).toHaveLength(12);
    expect(flatsPerFloor(bigger)).toBe(5);
    expect(flatsOn(bigger, 12)).toEqual(["1201", "1202", "1203", "1204", "1205"]);
  });

  it("copes with a tower recorded before floors were asked for", () => {
    const flat = { id: "d", name: "D", flatCount: 6 };
    expect(floorsOf(flat)).toEqual([1]);
    expect(flatsOn(flat, 1)).toHaveLength(6);
  });

  it("offers nothing for a tower with nothing in it", () => {
    const empty = { id: "e", name: "E", floorCount: 0, flatCount: 0 };
    expect(floorsOf(empty)).toEqual([]);
    expect(flatsOn(empty, 1)).toEqual([]);
  });

  it("offers nothing until a floor is chosen", () => {
    expect(flatsOn(towerA, null)).toEqual([]);
    expect(flatsOn(null, 3)).toEqual([]);
  });

  it("refuses a flat that belongs to another floor or another tower", () => {
    expect(unitIsValid(towerA, 4, "402")).toBe(true);
    // Right tower, wrong floor.
    expect(unitIsValid(towerA, 3, "402")).toBe(false);
    // A flat past the end of the floor.
    expect(unitIsValid(towerA, 4, "409")).toBe(false);
    // Another tower's flat, written the old way with its tower in front.
    const towerB = { id: "b", name: "B", floorCount: 10, flatCount: 40 };
    expect(unitIsValid(towerB, 4, "A-402")).toBe(false);
  });

  it("still accepts a flat written the old way with its own tower in front", () => {
    expect(unitIsValid(towerA, 4, "A-402")).toBe(true);
  });

  it("refuses an unanswered unit", () => {
    expect(unitIsValid(towerA, null, "402")).toBe(false);
    expect(unitIsValid(towerA, 4, null)).toBe(false);
    expect(unitIsValid(null, 4, "402")).toBe(false);
  });
});
