// What an operator needs to see once a job is finished.
//
// Accepting an order and completing one both end with the screen going quiet: the
// action disappears, the state pill changes, and nothing says what was just agreed
// to. An operator who has taken eleven garments and quoted a charge has no record of
// it in front of them, so the question "what did I just accept" is answered by
// scrolling back through a timeline.
//
// A summary answers it in one place: what the order is, what was in it, what it came
// to, and what happened at each end of it.

export interface SummaryOrder {
  state: string;
  estimatedCount?: number | null;
  acceptedCount?: number | null;
  deliveryCount?: number | null;
  discrepancyReason?: string | null;
  servicesPaise?: number | null;
  additionalPaise?: number | null;
  totalPaise?: number | null;
  paymentStatus?: string | null;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
}

// The two moments worth summarising, and nothing in between.
//
// Mid-process states have an action attached and the operator is looking at what to
// do next, not at what was concluded. A summary there would be a second copy of the
// page they are already on.
export const COLLECTED_STATES = ["picked_up", "in_wash", "ironing", "qc", "qc_hold", "ready_for_delivery", "out_for_delivery"];
export const FINISHED_STATES = ["delivered"];

export type SummaryMoment = "collected" | "finished" | null;

export function summaryMoment(state: string): SummaryMoment {
  if (FINISHED_STATES.includes(state)) return "finished";
  if (COLLECTED_STATES.includes(state)) return "collected";
  return null;
}

// Whether the count changed hands intact, said plainly.
//
// The difference between what a resident estimated and what an operator actually
// received is the single most disputed number in the whole platform, so it is stated
// rather than left to be worked out from two figures on different rows.
export function countStory(order: SummaryOrder): string | null {
  const estimated = order.estimatedCount ?? null;
  const accepted = order.acceptedCount ?? null;
  if (accepted === null) return null;
  if (estimated === null) return `${accepted} accepted`;
  const difference = accepted - estimated;
  if (difference === 0) return `${accepted} accepted, exactly as estimated`;
  if (difference > 0) return `${accepted} accepted, ${difference} more than estimated`;
  return `${accepted} accepted, ${Math.abs(difference)} fewer than estimated`;
}

// And whether everything that was taken came back.
export function deliveryStory(order: SummaryOrder): string | null {
  const accepted = order.acceptedCount ?? null;
  const delivered = order.deliveryCount ?? null;
  if (delivered === null) return null;
  if (accepted === null) return `${delivered} delivered`;
  if (delivered === accepted) return `${delivered} delivered, all of them`;
  const missing = accepted - delivered;
  return missing > 0
    ? `${delivered} delivered, ${missing} short`
    : `${delivered} delivered, ${Math.abs(missing)} more than were collected`;
}

// A discrepancy is only a discrepancy when the counts actually differ. A reason
// recorded against matching counts is a note, and calling it a discrepancy would
// raise an alarm about an order that is fine.
export function isDiscrepant(order: SummaryOrder): boolean {
  const accepted = order.acceptedCount ?? null;
  const delivered = order.deliveryCount ?? null;
  return accepted !== null && delivered !== null && accepted !== delivered;
}

// What is still owed, if anything.
//
// "Paid" and "nothing to pay" are different facts and both are worth saying; an
// empty payment row reads as a screen that failed to load its figure.
export function paymentStory(order: SummaryOrder): string {
  const total = order.totalPaise ?? 0;
  if (total <= 0) return "Nothing to collect";
  const status = (order.paymentStatus ?? "").toLowerCase();
  if (status === "paid" || status === "settled") return "Paid";
  if (status === "failed") return "Payment failed";
  return "Payment outstanding";
}
