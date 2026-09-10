import type { Slot, SlotWindows } from "../api/types";

// What the supervisor's Slots screen shows, and in what order.
//
// A laundry slot and an additional-service slot answer the same question — when can
// work happen, and how much of it — about different work. They used to be two lists
// under two headings, so a supervisor who had just created a car wash slot had to know
// to scroll past the laundry slots to find it, and nothing on the screen showed a
// day's work in one place. The web table merges them; this is the same decision, made
// somewhere it can be tested without a tree.

export type SlotKind = "laundry" | "service";

export interface SlotRow {
  key: string;
  kind: SlotKind;
  // Laundry has no service of its own, so it says "Laundry" rather than nothing: a
  // blank reads as missing data, not as "not applicable".
  service: string;
  // When the slot runs. A service slot carries no clock time of its own, but every
  // slot in a window runs at that window's hours, so the time is taken from there
  // rather than left blank. Null only when nothing knows the window.
  startTime: string | null;
  endTime: string | null;
  slot: Slot;
}

// A date the screen's From/To is asking for.
//
// Either end may be absent — the fields are clearable, and "any day" is a real
// answer. The service endpoint takes a single day rather than a range, so the range
// is applied here; without it the list showed slots from outside the dates the
// supervisor had just chosen, which reads as the filter being broken.
function inRange(date: string, from: string | null, to: string | null): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function slotRows(
  laundry: readonly Slot[],
  service: readonly Slot[],
  range: { from: string | null; to: string | null } = { from: null, to: null },
  windows: SlotWindows = {},
): SlotRow[] {
  const rows: SlotRow[] = [
    // The laundry list arrives already filtered by the endpoint, but is filtered again
    // rather than trusted: the two halves of one list disagreeing about which days
    // they cover is the bug this is here to prevent.
    ...laundry
      .filter((slot) => inRange(slot.date, range.from, range.to))
      .map((slot): SlotRow => ({
        key: `laundry:${slot.id}`,
        kind: "laundry",
        service: "Laundry",
        // A laundry slot is served its own times; the window is only a fallback.
        startTime: slot.startTime || windows[slot.window]?.startTime || null,
        endTime: slot.endTime || windows[slot.window]?.endTime || null,
        slot,
      })),
    ...service
      .filter((slot) => inRange(slot.date, range.from, range.to))
      .map((slot): SlotRow => ({
        key: `service:${slot.id}`,
        kind: "service",
        service: slot.offeringName ?? "—",
        startTime: slot.startTime || windows[slot.window]?.startTime || null,
        endTime: slot.endTime || windows[slot.window]?.endTime || null,
        slot,
      })),
  ];
  // By day, then by window within the day. Sorting by kind instead — which is what
  // two lists did — buries tomorrow's first pickup under next week's car washes.
  return rows.sort((a, b) =>
    a.slot.date === b.slot.date
      ? windowRank(a.slot.window) - windowRank(b.slot.window) || a.slot.window.localeCompare(b.slot.window)
      : a.slot.date.localeCompare(b.slot.date),
  );
}

// The three windows the backend allows, in the order the day happens.
//
// Sorting the names alphabetically put Afternoon above Morning, so a supervisor
// reading down a day read it backwards. A service slot has no start time to sort by —
// it is booked against the window itself — so the order has to come from the names.
const WINDOW_ORDER = ["Morning", "Afternoon", "Evening"];

function windowRank(window: string): number {
  const rank = WINDOW_ORDER.indexOf(window);
  // A window the backend has since added sorts after the three that are known rather
  // than silently taking Morning's place at the top.
  return rank === -1 ? WINDOW_ORDER.length : rank;
}
