import { describe, it, expect } from "vitest";
import type { Slot } from "../src/api/types";
import { slotRows } from "../src/portals/slot-list-rules";

// The supervisor's Slots screen showed two lists under two headings, so a car wash
// slot created from the same form landed below every laundry slot on the screen and a
// day's work was never in one place. Web merges them into one table; these are the
// rules that make mobile agree with it.

const laundry = (over: Partial<Slot> = {}): Slot => ({
  id: "l1", date: "2026-09-14", window: "Evening",
  startTime: "17:00", endTime: "20:00",
  capacityTotal: 6, capacityRemaining: 6, bookedCount: 0, isActive: true,
  ...over,
});

const service = (over: Partial<Slot> = {}): Slot => ({
  id: "s1", date: "2026-09-13", window: "Morning",
  startTime: "", endTime: "",
  capacityTotal: 10, capacityRemaining: 10, isActive: true,
  offeringId: "wash-car", offeringName: "Car wash",
  ...over,
});

describe("what the Slots screen lists", () => {
  it("puts both kinds in one list, in date order", () => {
    // The service slot is the earlier day, so it comes first — which two lists could
    // never do, because they sorted by kind before they sorted by anything.
    const rows = slotRows([laundry()], [service()]);
    expect(rows.map((r) => r.kind)).toEqual(["service", "laundry"]);
    expect(rows.map((r) => r.slot.date)).toEqual(["2026-09-13", "2026-09-14"]);
  });

  it("orders a day the way the day happens, not alphabetically", () => {
    // Afternoon sorts above Morning by name, which had a supervisor reading the day
    // backwards. A service slot has no start time to sort by, so the order has to come
    // from the window names themselves.
    const rows = slotRows(
      [laundry({ id: "evening", date: "2026-09-13", window: "Evening" })],
      [
        service({ id: "afternoon", date: "2026-09-13", window: "Afternoon" }),
        service({ id: "morning", date: "2026-09-13", window: "Morning" }),
      ],
    );
    expect(rows.map((r) => r.slot.id)).toEqual(["morning", "afternoon", "evening"]);
  });

  it("puts a window it has never heard of last rather than first", () => {
    const rows = slotRows(
      [],
      [
        service({ id: "night", date: "2026-09-13", window: "Night" }),
        service({ id: "morning", date: "2026-09-13", window: "Morning" }),
      ],
    );
    expect(rows.map((r) => r.slot.id)).toEqual(["morning", "night"]);
  });

  it("names laundry as its own service rather than leaving it blank", () => {
    // An empty cell reads as data that failed to load, not as "not applicable".
    expect(slotRows([laundry()], [])[0].service).toBe("Laundry");
  });

  it("carries the service name for a service slot", () => {
    expect(slotRows([], [service()])[0].service).toBe("Car wash");
  });

  it("says something rather than nothing when a service slot has lost its name", () => {
    expect(slotRows([], [service({ offeringName: null })])[0].service).toBe("—");
  });

  it("keys the two kinds apart", () => {
    // Both endpoints mint their own ids; nothing stops the same string appearing in
    // each, and a duplicate key silently drops a row from the list.
    const rows = slotRows([laundry({ id: "same" })], [service({ id: "same" })]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("holds service slots to the same From/To the laundry list obeys", () => {
    // The service endpoint takes a single day, not a range, so nothing but this stops
    // a slot from outside the chosen dates appearing under them.
    const rows = slotRows(
      [],
      [service({ id: "in", date: "2026-09-13" }), service({ id: "out", date: "2026-09-30" })],
      { from: "2026-09-10", to: "2026-09-16" },
    );
    expect(rows.map((r) => r.slot.id)).toEqual(["in"]);
  });

  it("filters the laundry half by the same range rather than trusting it", () => {
    const rows = slotRows(
      [laundry({ id: "out", date: "2026-10-30" })],
      [],
      { from: "2026-09-10", to: "2026-09-16" },
    );
    expect(rows).toEqual([]);
  });

  it("treats a cleared end of the range as any day", () => {
    // Both fields are clearable, and "any day" is an answer the screen offers.
    const rows = slotRows([], [service({ date: "2027-01-01" })], { from: "2026-09-10", to: null });
    expect(rows).toHaveLength(1);
    expect(slotRows([], [service({ date: "2020-01-01" })], { from: null, to: "2026-09-16" })).toHaveLength(1);
  });

  it("keeps both ends inclusive", () => {
    const rows = slotRows(
      [],
      [service({ id: "first", date: "2026-09-10" }), service({ id: "last", date: "2026-09-16" })],
      { from: "2026-09-10", to: "2026-09-16" },
    );
    expect(rows.map((r) => r.slot.id)).toEqual(["first", "last"]);
  });

  it("has nothing to show rather than throwing when neither list has arrived", () => {
    expect(slotRows([], [])).toEqual([]);
  });
});
