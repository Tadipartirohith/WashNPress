import type { FrequencyOption, ScheduleView } from "../api/types";

// What makes a repeat pickup a valid one, and how one reads once it exists.
//
// The backend has had recurring pickups for a round: `residentSchedules`,
// `residentCreateSchedule` and `residentPreferences` are all in the client and had
// not one call site between them. A resident who wants their washing collected every
// Tuesday had to book it every Tuesday, which is the whole retention argument for a
// subscription sitting behind a missing button.
//
// The rules are here rather than in the form because how many days a frequency wants
// is data the backend sends — `daysRequired` on each option — and a form that decides
// that for itself is a form that disagrees with the server the first time somebody
// adds a frequency.

// Sunday first, because that is what the backend's 0–6 means and a screen that
// renumbered them would create a schedule for the wrong day.
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function daysRequiredFor(frequency: string | null, options: readonly FrequencyOption[]): number {
  return options.find((o) => o.key === frequency)?.daysRequired ?? 0;
}

// What is standing in the way of creating this schedule, as a sentence.
//
// Returned rather than thrown, and shown beside the button rather than after it is
// pressed: the point is that somebody can see why it is disabled without having to
// try.
export function scheduleProblem(draft: {
  frequency: string | null;
  days: number[];
  window: string | null;
  frequencies: readonly FrequencyOption[];
}): string | null {
  if (!draft.frequency) return "Choose how often you would like a collection.";
  if (!draft.window) return "Choose the time of day you would like it collected.";

  const required = daysRequiredFor(draft.frequency, draft.frequencies);
  if (required > 0 && draft.days.length !== required) {
    // Named rather than counted down to: "choose 1 more" is arithmetic somebody has
    // to do about a form they are already looking at.
    return required === 1
      ? "Choose the day of the week for the collection."
      : `Choose ${required} days of the week for the collections.`;
  }
  // A day outside the week is not something the picker can produce, but a stored
  // draft could carry one and the backend would refuse it with a less useful message.
  if (draft.days.some((d) => d < 0 || d > 6)) return "One of the chosen days is not a day of the week.";
  return null;
}

// The days as words, in the order the week happens.
//
// The backend sends them as a set of numbers, and a resident reading "5, 2" has to
// count. Sorted rather than shown as stored, so Tuesday and Friday read the same way
// whichever order they were tapped in.
export function daysLabel(days: readonly number[]): string {
  const named = [...days]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d]);
  if (named.length === 0) return "";
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

// Whether a schedule is booking more collections than the plan pays for.
//
// A schedule is the one thing in the resident app that commits somebody to a cost
// they are not present for. Twice a week against a plan whose allowance runs out
// mid-month is a bill nobody agreed to, and the moment to say so is while the
// schedule is being looked at rather than when the charge appears.
//
// Null when there is nothing to warn about, or nothing known: an allowance the
// backend did not send is not an allowance of zero.
export function overCommitmentWarning(schedule: Pick<ScheduleView, "perMonth" | "allowance">): string | null {
  if (schedule.allowance == null || schedule.allowance <= 0) return null;
  if (schedule.perMonth <= schedule.allowance) return null;
  return `This books ${schedule.perMonth} collections a month against a plan that covers ${schedule.allowance}. The rest are charged as you go.`;
}
