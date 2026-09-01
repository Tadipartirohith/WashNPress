import { describe, it, expect } from "vitest";
import {
  DEFAULT_NAMING, towerName, floorName, flatName, previewNaming,
  sameName, nameIsFree, conventionProblems,
} from "../../src/domain/naming";

// Every society was named by whatever the person filling in the form happened to
// type — "Tower A" here, "A" there, "Block-A" somewhere else. Nothing was wrong
// with any of them; what was wrong was that the platform did not know which one
// this society used, so it could not generate a name, check one, or tell two
// spellings of the same tower apart.

describe("what a society calls its towers", () => {
  it("counts past Z rather than starting again at A", () => {
    // Wrapping would produce a second tower called A in the same society.
    expect(towerName("letter", 1)).toBe("A");
    expect(towerName("letter", 26)).toBe("Z");
    expect(towerName("letter", 27)).toBe("AA");
    expect(towerName("letter", 28)).toBe("AB");
  });

  it("offers the forms the societies here actually use", () => {
    expect(towerName("tower_letter", 2)).toBe("Tower B");
    expect(towerName("block_letter", 3)).toBe("Block C");
    expect(towerName("number", 4)).toBe("4");
    expect(towerName("tower_number", 5)).toBe("Tower 5");
  });
});

describe("what it calls its floors", () => {
  it("numbers them from one, or names the first Ground", () => {
    expect(floorName("number", 1)).toBe("1");
    expect(floorName("ground_then_number", 1)).toBe("Ground");
    expect(floorName("ground_then_number", 2)).toBe("1");
    expect(floorName("floor_number", 3)).toBe("Floor 3");
  });
});

describe("what it calls its flats", () => {
  it("keeps the address the platform already uses", () => {
    // The seeded resident lives at A-402: tower A, floor 4, second flat along.
    expect(flatName(DEFAULT_NAMING, 1, 4, 2)).toBe("A-402");
  });

  it("does not put the word Tower inside a flat number", () => {
    // "Tower A-301" reads as a road, not a flat.
    expect(flatName({ tower: "tower_letter", floor: "number", flat: "tower_floor_unit" }, 1, 3, 1)).toBe("A-301");
    expect(flatName({ tower: "block_letter", floor: "number", flat: "tower_floor_unit" }, 2, 1, 1)).toBe("B-101");
  });

  it("shifts the storey when the ground floor is named", () => {
    const c = { tower: "letter" as const, floor: "ground_then_number" as const, flat: "tower_floor_unit" as const };
    // Ground floor flats are 001…, the floor above is 101…
    expect(flatName(c, 1, 1, 1)).toBe("A-001");
    expect(flatName(c, 1, 2, 1)).toBe("A-101");
  });

  it("supports a flat number without its tower, and a plain count", () => {
    expect(flatName({ tower: "letter", floor: "number", flat: "floor_unit" }, 1, 2, 3)).toBe("203");
    expect(flatName({ tower: "letter", floor: "number", flat: "tower_dash_unit" }, 2, 5, 3)).toBe("B-3");
  });
});

describe("the preview an admin decides from", () => {
  it("shows the result rather than the label", () => {
    const preview = previewNaming(DEFAULT_NAMING, { towers: 3, floors: 5, flatsPerFloor: 4 });
    expect(preview[0].tower).toBe("A");
    expect(preview[0].floors[0].floor).toBe("1");
    expect(preview[0].floors[0].flats).toEqual(["A-101", "A-102", "A-103", "A-104"]);
  });

  it("stays short: a preview is a sample, not the whole building", () => {
    const preview = previewNaming(DEFAULT_NAMING, { towers: 20, floors: 30, flatsPerFloor: 12 });
    expect(preview).toHaveLength(2);
    expect(preview[0].floors).toHaveLength(3);
    expect(preview[0].floors[0].flats).toHaveLength(4);
  });

  it("does not invent floors a tower does not have", () => {
    const preview = previewNaming(DEFAULT_NAMING, { towers: 1, floors: 2, flatsPerFloor: 2 });
    expect(preview).toHaveLength(1);
    expect(preview[0].floors).toHaveLength(2);
  });
});

describe("two names that are the same name", () => {
  it("ignores case and surrounding space", () => {
    expect(sameName("Tower A", "tower a")).toBe(true);
    expect(sameName(" Tower A ", "Tower A")).toBe(true);
    expect(sameName("Tower A", "Tower B")).toBe(false);
  });

  it("refuses a name already taken in this list", () => {
    const towers = [{ id: "1", name: "A" }, { id: "2", name: "B" }];
    expect(nameIsFree(towers, "C")).toBe(true);
    expect(nameIsFree(towers, "a")).toBe(false);
    expect(nameIsFree(towers, " B ")).toBe(false);
  });

  it("lets a record keep its own name while being edited", () => {
    const towers = [{ id: "1", name: "A" }, { id: "2", name: "B" }];
    expect(nameIsFree(towers, "A", "1")).toBe(true);
    expect(nameIsFree(towers, "B", "1")).toBe(false);
  });
});

describe("a convention has to be complete", () => {
  it("accepts the default", () => {
    expect(conventionProblems(DEFAULT_NAMING)).toEqual([]);
  });

  it("says which part is missing rather than refusing silently", () => {
    expect(conventionProblems({})).toHaveLength(3);
    expect(conventionProblems({ ...DEFAULT_NAMING, floor: undefined })).toEqual(["Choose how floors are named"]);
  });
});
