import { describe, it, expect } from "vitest";
import { bareFlatNumber, formatUnit } from "../../src/domain/unit";

// A tower and a flat are two fields. The flat number is stored bare, and the tower is
// only put in front of it when a sentence is written for a person to read. The web and
// mobile apps implement these same rules, so every example here is part of the contract.

describe("the flat number alone", () => {
  it("strips a tower written in front of the flat", () => {
    expect(bareFlatNumber("A-402", "A")).toBe("402");
    expect(bareFlatNumber("Tower 1-101", "Tower 1")).toBe("101");
    expect(bareFlatNumber("North Wing-201", "North Wing")).toBe("201");
    expect(bareFlatNumber("a 301", "A")).toBe("301");
    expect(bareFlatNumber("A/401", "A")).toBe("401");
  });

  it("strips the tower's short form", () => {
    expect(bareFlatNumber("1-101", "Tower 1")).toBe("101");
  });

  it("strips a leading flat word", () => {
    expect(bareFlatNumber("Flat A-204", "A")).toBe("204");
  });

  it("leaves a bare flat as it is", () => {
    expect(bareFlatNumber("402", "A")).toBe("402");
    expect(bareFlatNumber("101", null)).toBe("101");
  });

  it("never mistakes the flat's own digits for its tower", () => {
    expect(bareFlatNumber("1101", "Tower 1")).toBe("1101");
  });
});

describe("a tower and a flat as a person reads them", () => {
  it("prefixes Tower only where the name does not already say what it is", () => {
    expect(formatUnit("A", null)).toBe("Tower A");
    expect(formatUnit("1", null)).toBe("Tower 1");
    expect(formatUnit("East", null)).toBe("Tower East");
    expect(formatUnit("Tower 1", null)).toBe("Tower 1");
    expect(formatUnit("North Wing", null)).toBe("North Wing");
    expect(formatUnit("Block C", null)).toBe("Block C");
  });

  it("writes the flat bare, after the word Flat", () => {
    expect(formatUnit(null, "402")).toBe("Flat 402");
  });

  it("joins the two with a middle dot", () => {
    expect(formatUnit("Tower 1", "101")).toBe("Tower 1 · Flat 101");
    expect(formatUnit("A", "A-402")).toBe("Tower A · Flat 402");
  });

  it("writes nothing when there is nothing", () => {
    expect(formatUnit(null, null)).toBe("");
    expect(formatUnit("", "")).toBe("");
  });
});
