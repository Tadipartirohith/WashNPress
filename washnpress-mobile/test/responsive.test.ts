import { describe, it, expect } from "vitest";
import { cardBasisPercent, columnsFor } from "../src/components/layout";

// Two things left blank space where there was content to put in it.
//
// A three-column rule with two records drew two cards and reserved the third
// column, so a page with one society showed it in the left third of the screen
// with two thirds of nothing beside it. And a table of narrow columns ended
// around the middle of a desktop screen, because every column was pinned to its
// own pixel width and nothing claimed the rest.
//
// The arithmetic for both lives here rather than in a component, so it can be
// checked without rendering anything.

// What CardGrid computes: the rule is a ceiling on how many fit, not a promise
// that many exist.
function columnsShown(width: number, rule: { desktop: number; tablet: number; mobile: number }, items: number): number {
  return Math.max(1, Math.min(columnsFor(width, rule), items));
}

// What DataTable computes: surplus width is shared in proportion, and nothing
// shrinks when there is not enough.
function tableWidths(columns: number[], available: number): number[] {
  const natural = columns.reduce((sum, w) => sum + w, 0);
  const surplus = Math.max(0, available - natural);
  return columns.map((w) => (surplus > 0 ? w + (surplus * w) / natural : w));
}

const THREE = { desktop: 3, tablet: 2, mobile: 1 };

describe("a grid never reserves a column for a card that does not exist", () => {
  it("gives one record the whole row rather than a third of it", () => {
    expect(columnsShown(1440, THREE, 1)).toBe(1);
    expect(cardBasisPercent(columnsShown(1440, THREE, 1))).toBe(100);
  });

  it("splits two records in half rather than leaving a third empty", () => {
    expect(columnsShown(1440, THREE, 2)).toBe(2);
  });

  it("still caps at the rule once there are enough records", () => {
    expect(columnsShown(1440, THREE, 3)).toBe(3);
    expect(columnsShown(1440, THREE, 12)).toBe(3);
  });

  it("keeps the narrow-screen rule whatever the count", () => {
    expect(columnsShown(390, THREE, 12)).toBe(1);
    expect(columnsShown(390, THREE, 1)).toBe(1);
  });

  it("never asks for zero columns", () => {
    expect(columnsShown(1440, THREE, 0)).toBe(1);
  });
});

describe("a table takes the width it is given", () => {
  const columns = [190, 110, 110, 90];

  it("fills the container when there is more room than the columns need", () => {
    const widths = tableWidths(columns, 1000);
    expect(Math.round(widths.reduce((a, b) => a + b, 0))).toBe(1000);
  });

  it("gives the surplus out in proportion, so wide columns stay wide", () => {
    const widths = tableWidths(columns, 1000);
    // The widest column is still the widest, and by more than before.
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[0] - widths[1]).toBeGreaterThan(190 - 110);
  });

  it("changes nothing when the columns already fill the space", () => {
    const natural = columns.reduce((a, b) => a + b, 0);
    expect(tableWidths(columns, natural)).toEqual(columns);
  });

  it("does not shrink when there is less room than the columns need", () => {
    // Narrower than the table: it scrolls sideways rather than squeezing, which
    // is what keeps it readable on a phone.
    expect(tableWidths(columns, 320)).toEqual(columns);
  });

  it("copes with a container it has not measured yet", () => {
    expect(tableWidths(columns, 0)).toEqual(columns);
  });
});
