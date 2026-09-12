// How many bookings a slot may hold: 2 to 30, in whole bookings (ST1-I113).
//
// The API refuses anything else and says why, but a form should not offer to send
// something the server is certain to turn down. Kept here rather than in the screen,
// like the other rules modules, so the range is tested without rendering anything.
export const SLOT_CAPACITY_MIN = 2;
export const SLOT_CAPACITY_MAX = 30;

/** The reason a typed capacity cannot be used, or null when it is fine. */
export function slotCapacityProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "Capacity is required.";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Capacity must be a number.";
  if (!Number.isInteger(n)) return "Capacity must be a whole number.";
  if (n < SLOT_CAPACITY_MIN) return `Capacity must be at least ${SLOT_CAPACITY_MIN}.`;
  if (n > SLOT_CAPACITY_MAX) return `Capacity cannot exceed ${SLOT_CAPACITY_MAX}.`;
  return null;
}
