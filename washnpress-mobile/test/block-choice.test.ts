import { describe, it, expect } from "vitest";
import { blocksForSociety, type BlockOption } from "../src/portals/block-choice-rules";

// The operator assignment step showed "A, A, B" for a society that has only A and
// B: it was offering every tower the page had loaded, from every society, because
// its filter never looked at the block.

const blocks: BlockOption[] = [
  { id: "b1", name: "A", societyId: "soc-1", status: "active" },
  { id: "b2", name: "B", societyId: "soc-1", status: "active" },
  { id: "b3", name: "A", societyId: "soc-2", status: "active" },
  { id: "b4", name: "C", societyId: "soc-2", status: "active" },
];

describe("towers an operator can be put on", () => {
  it("offers only the chosen society's towers", () => {
    expect(blocksForSociety(blocks, "soc-1").map((b) => b.name)).toEqual(["A", "B"]);
    expect(blocksForSociety(blocks, "soc-2").map((b) => b.name)).toEqual(["A", "C"]);
  });

  it("never shows one name twice for two different societies", () => {
    const names = blocksForSociety(blocks, "soc-1").map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("shows the same tower once even when it arrives twice", () => {
    const doubled = [...blocks, { id: "b1", name: "A", societyId: "soc-1", status: "active" }];
    expect(blocksForSociety(doubled, "soc-1").map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("offers nothing until a society is chosen", () => {
    expect(blocksForSociety(blocks, undefined)).toEqual([]);
  });

  it("leaves out a tower that is not active", () => {
    const withRetired = [...blocks, { id: "b9", name: "D", societyId: "soc-1", status: "inactive" }];
    expect(blocksForSociety(withRetired, "soc-1").map((b) => b.name)).toEqual(["A", "B"]);
  });

  it("treats an unstamped tower as belonging to the society being asked about", () => {
    // A supervisor's own screen passes the towers of the one society they run.
    const unstamped: BlockOption[] = [{ id: "x", name: "T1" }, { id: "y", name: "T2" }];
    expect(blocksForSociety(unstamped, "soc-1").map((b) => b.name)).toEqual(["T1", "T2"]);
  });

  it("puts them in name order rather than load order", () => {
    const jumbled: BlockOption[] = [
      { id: "1", name: "C", societyId: "s" }, { id: "2", name: "A", societyId: "s" },
      { id: "3", name: "B", societyId: "s" },
    ];
    expect(blocksForSociety(jumbled, "s").map((b) => b.name)).toEqual(["A", "B", "C"]);
  });

  it("reproduces the reported list, and no longer returns it", () => {
    // Exactly the report: society has A and B; the screen showed A, A, B.
    const shown = blocksForSociety(blocks, "soc-1").map((b) => b.name);
    expect(shown).not.toEqual(["A", "A", "B"]);
    expect(shown).toEqual(["A", "B"]);
  });
});
