import { describe, it, expect } from "vitest";
import {
  DAY_LABELS, daysLabel, daysRequiredFor, overCommitmentWarning, scheduleProblem,
} from "../src/portals/schedule-rules";
import type { FrequencyOption } from "../src/api/types";

// Recurring pickups were built, typed and deployed, and no screen in either app
// called them: `residentSchedules`, `residentCreateSchedule` and `residentPreferences`
// had zero call sites. So a resident who wanted a collection every Tuesday booked one
// every Tuesday, and stopped when they forgot.

const FREQUENCIES: FrequencyOption[] = [
  { key: "daily", label: "Every day", daysRequired: 0 },
  { key: "weekly", label: "Once a week", daysRequired: 1 },
  { key: "twice_weekly", label: "Twice a week", daysRequired: 2 },
];

describe("how many days a frequency asks for", () => {
  it("takes it from what the backend sent, not from the name", () => {
    // A frequency added on the server has to work here without an edit.
    expect(daysRequiredFor("weekly", FREQUENCIES)).toBe(1);
    expect(daysRequiredFor("twice_weekly", FREQUENCIES)).toBe(2);
    expect(daysRequiredFor("daily", FREQUENCIES)).toBe(0);
  });

  it("asks for none from a frequency it has never heard of", () => {
    expect(daysRequiredFor("hourly", FREQUENCIES)).toBe(0);
    expect(daysRequiredFor(null, FREQUENCIES)).toBe(0);
  });
});

describe("what stops a repeat from being set up", () => {
  const complete = { frequency: "weekly", days: [2], window: "Morning", frequencies: FREQUENCIES };

  it("lets a complete one through", () => {
    expect(scheduleProblem(complete)).toBeNull();
  });

  it("asks for the frequency first, because everything else depends on it", () => {
    expect(scheduleProblem({ ...complete, frequency: null })).toMatch(/how often/i);
  });

  it("asks for the time of day", () => {
    expect(scheduleProblem({ ...complete, window: null })).toMatch(/time of day/i);
  });

  it("asks for exactly as many days as the frequency wants", () => {
    expect(scheduleProblem({ ...complete, days: [] })).toMatch(/day of the week/i);
    expect(scheduleProblem({ ...complete, frequency: "twice_weekly", days: [2] })).toMatch(/2 days/);
    expect(scheduleProblem({ ...complete, frequency: "twice_weekly", days: [2, 5] })).toBeNull();
  });

  it("does not ask for days from a frequency that has no use for them", () => {
    expect(scheduleProblem({ ...complete, frequency: "daily", days: [] })).toBeNull();
  });

  it("refuses more days than were asked for", () => {
    expect(scheduleProblem({ ...complete, days: [1, 2] })).toMatch(/day of the week/i);
  });

  it("catches a day that is not a day of the week", () => {
    expect(scheduleProblem({ ...complete, frequency: "daily", days: [9] })).toMatch(/not a day/i);
  });
});

describe("days, as words", () => {
  it("reads in the order the week happens, whatever order they were tapped", () => {
    expect(daysLabel([5, 2])).toBe("Tue and Fri");
  });

  it("says one day as one day", () => {
    expect(daysLabel([0])).toBe("Sun");
  });

  it("joins three with commas and a final and", () => {
    expect(daysLabel([1, 3, 5])).toBe("Mon, Wed and Fri");
  });

  it("says nothing about no days", () => {
    expect(daysLabel([])).toBe("");
  });

  it("numbers Sunday as zero, which is what the backend means", () => {
    // Renumbering the week here would create a schedule for the wrong day.
    expect(DAY_LABELS[0]).toBe("Sun");
    expect(DAY_LABELS[6]).toBe("Sat");
  });
});

describe("a repeat that costs more than the plan covers", () => {
  it("says so, with both numbers", () => {
    const said = overCommitmentWarning({ perMonth: 8, allowance: 4 })!;
    expect(said).toContain("8");
    expect(said).toContain("4");
  });

  it("stays quiet when the plan covers it", () => {
    expect(overCommitmentWarning({ perMonth: 4, allowance: 8 })).toBeNull();
    expect(overCommitmentWarning({ perMonth: 4, allowance: 4 })).toBeNull();
  });

  it("does not treat an unknown allowance as an allowance of nothing", () => {
    expect(overCommitmentWarning({ perMonth: 8, allowance: null })).toBeNull();
  });
});
