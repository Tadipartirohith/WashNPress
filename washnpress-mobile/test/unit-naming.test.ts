import { describe, it, expect } from "vitest";
import { floorsOf, flatsOn, flatsPerFloor, flatName, unitIsValid } from "../src/portals/unit-naming";

const towerA = { id: "a", name: "A", floorCount: 10, flatCount: 40 };

describe("the floors and flats of a tower", () => {
  it("matches the address the platform already uses", () => {
    // The seeded resident lives at A-402: tower A, floor 4, second flat along.
    expect(flatName(towerA, 4, 2)).toBe("A-402");
    expect(flatsOn(towerA, 4)).toContain("A-402");
  });

  it("lists the floors the tower was given", () => {
    expect(floorsOf(towerA)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("divides the flats across the floors", () => {
    expect(flatsPerFloor(towerA)).toBe(4);
    expect(flatsOn(towerA, 3)).toEqual(["A-301", "A-302", "A-303", "A-304"]);
  });

  it("does not offer flats that do not exist on the last floor", () => {
    // 3 floors, 10 flats: 4, 4 and 2 — not 4, 4 and 4.
    const odd = { id: "b", name: "B", floorCount: 3, flatCount: 10 };
    expect(flatsOn(odd, 1)).toHaveLength(4);
    expect(flatsOn(odd, 2)).toHaveLength(4);
    expect(flatsOn(odd, 3)).toEqual(["B-301", "B-302"]);
    const all = [1, 2, 3].flatMap((f) => flatsOn(odd, f));
    expect(all).toHaveLength(10);
  });

  it("changes with the tower rather than being fixed", () => {
    const bigger = { id: "c", name: "C", floorCount: 12, flatCount: 60 };
    expect(floorsOf(bigger)).toHaveLength(12);
    expect(flatsPerFloor(bigger)).toBe(5);
    expect(flatsOn(bigger, 12)).toEqual(["C-1201", "C-1202", "C-1203", "C-1204", "C-1205"]);
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
    expect(unitIsValid(towerA, 4, "A-402")).toBe(true);
    // Right tower, wrong floor.
    expect(unitIsValid(towerA, 3, "A-402")).toBe(false);
    // A flat past the end of the floor.
    expect(unitIsValid(towerA, 4, "A-409")).toBe(false);
    // Another tower's flat.
    const towerB = { id: "b", name: "B", floorCount: 10, flatCount: 40 };
    expect(unitIsValid(towerB, 4, "A-402")).toBe(false);
  });

  it("refuses an unanswered unit", () => {
    expect(unitIsValid(towerA, null, "A-402")).toBe(false);
    expect(unitIsValid(towerA, 4, null)).toBe(false);
    expect(unitIsValid(null, 4, "A-402")).toBe(false);
  });
});
