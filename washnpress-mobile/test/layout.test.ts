import { describe, it, expect } from "vitest";
import {
  breakpointFor, cardBasisPercent, columnsFor, fieldWidth, placeDropdown, DESKTOP_MIN, TABLET_MIN,
} from "../src/components/layout";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

describe("how many cards fit in a row", () => {
  it("steps down from desktop to tablet to phone", () => {
    const rule = { desktop: 3, tablet: 2, mobile: 1 };
    expect(columnsFor(1440, rule)).toBe(3);
    expect(columnsFor(TABLET_MIN, rule)).toBe(2);
    expect(columnsFor(390, rule)).toBe(1);
  });

  it("never returns a row with no cards in it", () => {
    expect(columnsFor(390, { desktop: 4, tablet: 2, mobile: 0 })).toBe(1);
  });

  it("leaves room between the cards rather than filling the row edge to edge", () => {
    // Three cards and two gaps: the cards cannot each be a third of the row.
    expect(cardBasisPercent(3)).toBeLessThan(100 / 3);
    expect(cardBasisPercent(3) * 3 + 4).toBeCloseTo(100, 5);
    expect(cardBasisPercent(1)).toBe(100);
  });

  it("puts the boundaries where a tablet actually is", () => {
    expect(breakpointFor(DESKTOP_MIN)).toBe("desktop");
    expect(breakpointFor(DESKTOP_MIN - 1)).toBe("tablet");
    expect(breakpointFor(TABLET_MIN)).toBe("tablet");
    expect(breakpointFor(TABLET_MIN - 1)).toBe("mobile");
  });
});

describe("how wide a field should be", () => {
  it("gives a price a price-sized box, not the whole screen", () => {
    expect(fieldWidth("small", 1200)).toBe(110);
    expect(fieldWidth("medium", 1200)).toBe(190);
  });

  it("still fills the row when the field is a paragraph", () => {
    expect(fieldWidth("full", 1200)).toBe(1200);
  });

  it("puts two small fields side by side on a phone", () => {
    // A phone row is 358 wide inside the padding. Two prices fit; one price with
    // 250 points of nothing beside it is what this replaces.
    const half = fieldWidth("small", 358);
    expect(half).toBeGreaterThan(110);
    expect(half * 2).toBeLessThanOrEqual(358);
  });

  it("keeps a search box wide, because people type sentences into it", () => {
    expect(fieldWidth("wide", 358)).toBe(358);
  });

  it("never asks for more room than there is", () => {
    expect(fieldWidth("wide", 200)).toBe(200);
    expect(fieldWidth("medium", 90)).toBe(90);
  });
});

describe("where a dropdown's list goes", () => {
  const anchor = { x: 40, y: 200, width: 190, height: 42 };

  it("opens directly under its field", () => {
    const at = placeDropdown(anchor, DESKTOP, { count: 5 });
    expect(at.top).toBe(anchor.y + anchor.height + 4);
    expect(at.left).toBe(anchor.x);
    expect(at.above).toBe(false);
  });

  it("is at least as wide as the field it belongs to", () => {
    const at = placeDropdown({ ...anchor, width: 260 }, DESKTOP, { count: 3 });
    expect(at.width).toBe(260);
    // And never narrower than a name and a caret, however small the field is.
    expect(placeDropdown({ ...anchor, width: 60 }, DESKTOP, { count: 3 }).width).toBe(180);
  });

  it("stays on the screen when the field is near the right edge", () => {
    const near = { x: 1380, y: 100, width: 190, height: 42 };
    const at = placeDropdown(near, DESKTOP, { count: 3 });
    expect(at.left + at.width).toBeLessThanOrEqual(DESKTOP.width);
    expect(at.left).toBeGreaterThanOrEqual(8);
  });

  it("opens upwards when there is no room below", () => {
    // A filter near the bottom of a phone screen. Opening downwards would put the
    // list off the bottom, which is how a list ends up invisible.
    const low = { x: 16, y: 760, width: 200, height: 42 };
    const at = placeDropdown(low, PHONE, { count: 8 });
    expect(at.above).toBe(true);
    expect(at.top).toBeLessThan(low.y);
    expect(at.top).toBeGreaterThanOrEqual(0);
  });

  it("scrolls rather than running off the screen when there are many options", () => {
    const at = placeDropdown({ x: 16, y: 80, width: 200, height: 42 }, PHONE, { count: 60 });
    expect(at.maxHeight).toBeLessThan(PHONE.height);
    expect(at.top + at.maxHeight).toBeLessThanOrEqual(PHONE.height);
  });

  it("gives a short list only the room it needs", () => {
    const at = placeDropdown({ x: 16, y: 80, width: 200, height: 42 }, DESKTOP, { count: 2, rowHeight: 44 });
    expect(at.maxHeight).toBe(88);
  });

  it("keeps a list on a narrow screen inside the screen", () => {
    const at = placeDropdown({ x: 8, y: 100, width: 374, height: 42 }, PHONE, { count: 4 });
    expect(at.left).toBeGreaterThanOrEqual(8);
    expect(at.left + at.width).toBeLessThanOrEqual(PHONE.width);
  });
});
