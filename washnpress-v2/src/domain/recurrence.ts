// How often a resident wants their laundry collected, and which days that means.
//
// A recurrence used to be a boolean on a pickup and a hard-coded week: whatever day
// the first pickup landed on, the next one was seven days later. That cannot express
// "Tuesdays and Fridays", and it cannot be viewed or changed as a thing in its own
// right — there was nothing to look at, only a flag on one booking.

export type PickupFrequency =
  | "one_time"
  | "daily"
  | "alternate_days"
  | "twice_weekly"
  | "weekly"
  // Whatever days the resident or the plan actually names, rather than a shape
  // chosen from a list. "Mondays, Wednesdays and Saturdays" is a real schedule and
  // was not expressible before.
  | "custom";

export const PICKUP_FREQUENCIES: PickupFrequency[] = [
  "one_time", "daily", "alternate_days", "twice_weekly", "weekly", "custom",
];

export const FREQUENCY_LABELS: Record<PickupFrequency, string> = {
  one_time: "One time",
  daily: "Daily",
  alternate_days: "Alternate days",
  twice_weekly: "Twice a week",
  weekly: "Weekly",
  custom: "Custom",
};

// How many days a frequency needs chosen. Alternate days needs none — the pattern is
// the interval itself — a one-off needs none, and daily is every day by definition.
// Custom needs at least one, which is checked separately because "at least one" is
// not the same shape of rule as "exactly this many".
export const DAYS_REQUIRED: Record<PickupFrequency, number> = {
  one_time: 0,
  daily: 0,
  alternate_days: 0,
  twice_weekly: 2,
  weekly: 1,
  custom: 0,
};

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export class InvalidRecurrenceError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidRecurrenceError"; }
}

// A schedule has to say something a calendar can act on. "Twice a week" without
// saying which two days is not a schedule, it is an intention.
export function validateRecurrence(frequency: PickupFrequency, days: number[]): void {
  const needed = DAYS_REQUIRED[frequency];
  const unique = [...new Set(days)];
  if (unique.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new InvalidRecurrenceError("Days must be given as 0 for Sunday through 6 for Saturday.");
  }
  if (frequency === "custom") {
    // A custom schedule that names no day is not a schedule. This is the rule the
    // requirements call "custom frequency must contain valid configuration".
    if (unique.length === 0) throw new InvalidRecurrenceError("Choose at least one day for a custom schedule.");
    return;
  }
  if (needed === 0) return;
  if (unique.length !== needed) {
    throw new InvalidRecurrenceError(
      needed === 1
        ? "Choose the day of the week for a weekly pickup."
        : `Choose ${needed} days for a ${FREQUENCY_LABELS[frequency].toLowerCase()} pickup.`,
    );
  }
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The dates this schedule wants, from the day after the last one generated, up to a
// horizon. Dates only: whether a slot exists on one of them is a separate question,
// and one this function deliberately does not know the answer to.
export function occurrencesBetween(
  schedule: { frequency: PickupFrequency; days: number[]; startDate: string; anchorDate?: string | null },
  from: string,
  to: string,
): string[] {
  if (schedule.frequency === "one_time") {
    return schedule.startDate >= from && schedule.startDate <= to ? [schedule.startDate] : [];
  }

  const dates: string[] = [];
  const begin = from > schedule.startDate ? from : schedule.startDate;

  if (schedule.frequency === "daily") {
    let cursor = begin;
    while (cursor <= to) { dates.push(cursor); cursor = addDays(cursor, 1); }
    return dates;
  }

  if (schedule.frequency === "alternate_days") {
    // Every other day counted from the day the schedule started, so the pattern does
    // not drift when the horizon is recalculated.
    const anchor = schedule.anchorDate || schedule.startDate;
    const step = 2;
    const gap = Math.round((Date.parse(`${begin}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
    let cursor = addDays(begin, ((step - (gap % step)) % step));
    while (cursor <= to) {
      if (cursor >= begin) dates.push(cursor);
      cursor = addDays(cursor, step);
    }
    return dates;
  }

  const wanted = new Set(schedule.days);
  let cursor = begin;
  while (cursor <= to) {
    if (wanted.has(dayOfWeek(cursor))) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

// How many collections a schedule asks for in a month, which is what a plan's
// entitlement is measured against.
export function occurrencesPerMonth(frequency: PickupFrequency, days: number[]): number {
  switch (frequency) {
    case "one_time": return 1;
    case "daily": return 30;
    case "alternate_days": return 15;
    case "twice_weekly": return 8;
    case "weekly": return Math.max(1, new Set(days).size) * 4;
    case "custom": return Math.max(1, new Set(days).size) * 4;
  }
}

export function describeRecurrence(frequency: PickupFrequency, days: number[]): string {
  if (frequency === "one_time") return FREQUENCY_LABELS.one_time;
  if (frequency === "daily") return FREQUENCY_LABELS.daily;
  if (frequency === "alternate_days") return FREQUENCY_LABELS.alternate_days;
  const named = [...new Set(days)].sort().map((d) => WEEKDAY_LABELS[d]);
  return `${FREQUENCY_LABELS[frequency]} on ${named.join(" and ")}`;
}

// The days of the week a frequency permits a collection on. A booking outside them
// is not a booking the plan allows, which is a different question from whether a
// slot exists — and one nothing used to ask.
export function allowedWeekdays(frequency: PickupFrequency, days: number[]): number[] {
  switch (frequency) {
    // Every day, for the frequencies whose pattern is not made of weekdays at all.
    case "one_time":
    case "daily":
    case "alternate_days":
      return [0, 1, 2, 3, 4, 5, 6];
    default:
      return [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  }
}

// Whether a date falls on a day this frequency permits.
export function permitsDate(frequency: PickupFrequency, days: number[], date: string): boolean {
  return allowedWeekdays(frequency, days).includes(dayOfWeek(date));
}
