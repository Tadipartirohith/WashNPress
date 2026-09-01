import { describe, it, expect } from "vitest";
import { timeSlotProblems } from "../src/portals/service-wizard-rules";

// The windows a service runs in, and how many bookings fit in each.
//
// The draft has carried them, the payload has sent them and the backend has read
// them since services were configurable — but the wizard never drew a control for
// them, so the only way to put a service on a timetable was to write to the
// database. A service was therefore either unlimited or unconfigurable, and the
// capacity the booking screen shows had nothing behind it.
//
// Windows stay optional. A half-written one does not: it is drawn on the booking
// screen and cannot be booked, which is a worse answer than not offering it.

const slot = (over: Partial<Parameters<typeof timeSlotProblems>[0][number]> = {}) => ({
  window: "Morning", startTime: "10:00", endTime: "11:00", capacity: "2",
  maxBookings: "", subscriberAvailable: true, nonSubscriberAvailable: true,
  ...over,
});

describe("the times a service runs", () => {
  it("is happy with none at all, because a timetable is optional", () => {
    expect(timeSlotProblems([])).toEqual([]);
  });

  it("is happy with a complete one", () => {
    expect(timeSlotProblems([slot()])).toEqual([]);
  });

  it("will not save a window with no times", () => {
    expect(timeSlotProblems([slot({ startTime: "", endTime: "" })])).toHaveLength(1);
    expect(timeSlotProblems([slot({ endTime: "" })])).toHaveLength(1);
  });

  it("insists on a clock time rather than whatever was typed", () => {
    expect(timeSlotProblems([slot({ startTime: "10am" })])[0]).toMatch(/24 hour clock/);
    expect(timeSlotProblems([slot({ startTime: "25:00" })])).toHaveLength(1);
    expect(timeSlotProblems([slot({ endTime: "11:60" })])).toHaveLength(1);
  });

  it("will not save a window that ends before it starts", () => {
    expect(timeSlotProblems([slot({ startTime: "14:00", endTime: "10:00" })])[0]).toMatch(/ends before it starts/);
  });

  it("will not save a window with room for nobody", () => {
    // Drawn as a slot, bookable by no one.
    expect(timeSlotProblems([slot({ capacity: "0" })])[0]).toMatch(/at least one booking/);
    expect(timeSlotProblems([slot({ capacity: "" })])).toHaveLength(1);
    expect(timeSlotProblems([slot({ capacity: "-2" })])).toHaveLength(1);
  });

  it("will not save a window offered to nobody", () => {
    expect(timeSlotProblems([slot({ subscriberAvailable: false, nonSubscriberAvailable: false })])[0])
      .toMatch(/offered to nobody/);
  });

  it("allows a window held back for subscribers", () => {
    expect(timeSlotProblems([slot({ nonSubscriberAvailable: false })])).toEqual([]);
  });

  it("catches two windows starting at the same time", () => {
    // Capacity is counted by start time, so two windows at ten are one window with
    // an argument about how big it is.
    const problems = timeSlotProblems([slot(), slot({ endTime: "12:00" })]);
    expect(problems.some((p) => /two times starting at 10:00/.test(p))).toBe(true);
  });

  it("reports every broken window rather than stopping at the first", () => {
    const problems = timeSlotProblems([slot({ capacity: "0" }), slot({ startTime: "16:00", endTime: "15:00" })]);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});
