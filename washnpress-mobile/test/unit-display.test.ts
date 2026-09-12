import { describe, it, expect } from "vitest";
import { bareFlatNumber, formatUnit, towerLabel } from "../src/unit-display";

// A flat number used to carry its tower — "A-402", "Tower 1-101" — and screens then
// printed the tower beside it too. The tower and the flat are two things, and old
// records still arrive written the old way, so every screen goes through these.

describe("the number on the door", () => {
  it("takes the tower out of an old flat number", () => {
    expect(bareFlatNumber("A-402", "A")).toBe("402");
    expect(bareFlatNumber("Tower 1-101", "Tower 1")).toBe("101");
    expect(bareFlatNumber("North Wing-201", "North Wing")).toBe("201");
  });

  it("recognises the tower by its short form as well as its name", () => {
    expect(bareFlatNumber("1-101", "Tower 1")).toBe("101");
  });

  it("accepts a space or a slash between the tower and the flat, in any case", () => {
    expect(bareFlatNumber("a 301", "A")).toBe("301");
    expect(bareFlatNumber("A/401", "A")).toBe("401");
  });

  it("drops a leading Flat word", () => {
    expect(bareFlatNumber("Flat A-204", "A")).toBe("204");
    expect(bareFlatNumber("Flat no. 12", null)).toBe("12");
  });

  it("leaves a number that is already bare alone", () => {
    expect(bareFlatNumber("402", "A")).toBe("402");
    expect(bareFlatNumber("101", null)).toBe("101");
  });

  it("does not eat the first digit of a flat whose number starts like its tower", () => {
    // Flat 1101 in Tower 1 has no separator after the "1", so it is not a prefix.
    expect(bareFlatNumber("1101", "Tower 1")).toBe("1101");
  });

  it("has nothing to show for nothing", () => {
    expect(bareFlatNumber(null, "A")).toBe("");
    expect(bareFlatNumber(undefined)).toBe("");
  });
});

describe("what a tower is called", () => {
  it("adds Tower to a bare name", () => {
    expect(towerLabel("A")).toBe("Tower A");
    expect(towerLabel("1")).toBe("Tower 1");
    expect(towerLabel("East")).toBe("Tower East");
  });

  it("leaves a name that already says what it is", () => {
    expect(towerLabel("Tower 1")).toBe("Tower 1");
    expect(towerLabel("North Wing")).toBe("North Wing");
    expect(towerLabel("Block C")).toBe("Block C");
  });

  it("has nothing to show for nothing", () => {
    expect(towerLabel("")).toBe("");
    expect(towerLabel("   ")).toBe("");
    expect(towerLabel(null)).toBe("");
  });
});

describe("a tower and a flat together", () => {
  it("shows each once", () => {
    expect(formatUnit("Tower 1", "Tower 1-101")).toBe("Tower 1 · Flat 101");
    expect(formatUnit("A", "A-402")).toBe("Tower A · Flat 402");
    expect(formatUnit("1", "101")).toBe("Tower 1 · Flat 101");
  });

  it("shows whichever part there is", () => {
    expect(formatUnit(null, "101")).toBe("Flat 101");
    expect(formatUnit("A", null)).toBe("Tower A");
    expect(formatUnit(null, null)).toBe("");
  });
});
