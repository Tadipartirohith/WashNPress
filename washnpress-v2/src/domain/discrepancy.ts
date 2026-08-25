// What happens when the bag does not hold what the resident said it would.
//
// The resident declares a quantity when they book; the operator counts what is
// actually in the bag. Those two numbers are both real and they are not the same
// kind of fact: one is what was expected, the other is what was verified. The system
// used to keep only the second — the operator's count simply replaced the resident's
// declaration — so a resident who sent six shirts and got four back had no record
// that they ever said six.
//
// Both numbers are kept. The difference between them is a discrepancy: recorded,
// explained, communicated and auditable.

export type DiscrepancyReason =
  | "not_handed_over"
  | "resident_unavailable"
  | "item_missing"
  | "incorrect_quantity_declared"
  | "extra_items_handed_over"
  | "other";

export const DISCREPANCY_REASONS: DiscrepancyReason[] = [
  "not_handed_over", "resident_unavailable", "item_missing",
  "incorrect_quantity_declared", "extra_items_handed_over", "other",
];

export const DISCREPANCY_REASON_LABELS: Record<DiscrepancyReason, string> = {
  not_handed_over: "Garments not handed over",
  resident_unavailable: "Resident unavailable for the remaining items",
  item_missing: "Item missing",
  incorrect_quantity_declared: "Incorrect quantity declared",
  extra_items_handed_over: "Extra items handed over",
  other: "Other",
};

// Which way the difference goes. Both are recorded: an extra garment in the bag is a
// discrepancy too, and billing for it without saying so is how a resident finds a
// charge they did not expect.
export type DiscrepancyDirection = "short" | "excess";

export interface QuantityDiscrepancy {
  // What the resident said when they booked. Never overwritten.
  requested: number;
  // What the operator physically counted. This is what gets processed and billed.
  received: number;
  difference: number;
  direction: DiscrepancyDirection;
  reason: DiscrepancyReason;
  reasonLabel: string;
  remarks: string;
  at: string;
  actorUserId: string | null;
  // Whether the resident has accepted it or is disputing it.
  acknowledgement: "pending" | "acknowledged" | "disputed";
  acknowledgedAt: string | null;
  disputeNote: string | null;
}

export function describeDifference(requested: number, received: number): string {
  const difference = Math.abs(received - requested);
  if (difference === 0) return "Matched";
  return received < requested ? `${difference} short` : `${difference} extra`;
}

// ------------------------------------------------------------------ validation

export class DiscrepancyIncompleteError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "A quantity discrepancy needs a reason and remarks.");
    this.name = "DiscrepancyIncompleteError";
  }
}

export interface DiscrepancyInput {
  reason?: string;
  remarks?: string;
}

// A discrepancy has to say enough to be settled later. "We received four" without a
// reason leaves the resident with two missing shirts and nobody to ask about them.
export function discrepancyProblems(input: DiscrepancyInput): string[] {
  const problems: string[] = [];
  const reason = input.reason as DiscrepancyReason | undefined;
  if (!reason || !DISCREPANCY_REASONS.includes(reason)) {
    problems.push("Choose why the quantity differs.");
  }
  if (!(input.remarks ?? "").trim()) problems.push("Say what happened.");
  return problems;
}

export function assertDiscrepancy(input: DiscrepancyInput): void {
  const problems = discrepancyProblems(input);
  if (problems.length) throw new DiscrepancyIncompleteError(problems);
}

// ---------------------------------------------------------------- the record

export function buildDiscrepancy(input: {
  requested: number;
  received: number;
  reason: DiscrepancyReason;
  remarks: string;
  actorUserId: string | null;
  at?: string;
}): QuantityDiscrepancy {
  const requested = Math.max(0, Math.trunc(input.requested));
  const received = Math.max(0, Math.trunc(input.received));
  return {
    requested,
    received,
    difference: Math.abs(received - requested),
    direction: received < requested ? "short" : "excess",
    reason: input.reason,
    reasonLabel: DISCREPANCY_REASON_LABELS[input.reason],
    remarks: input.remarks.trim(),
    at: input.at ?? new Date().toISOString(),
    actorUserId: input.actorUserId,
    acknowledgement: "pending",
    acknowledgedAt: null,
    disputeNote: null,
  };
}

// What the resident is told. Said in their terms — what they asked for, what arrived,
// and what the difference is — rather than as an internal status.
export function residentMessage(discrepancy: QuantityDiscrepancy): string {
  const { requested, received, difference, direction } = discrepancy;
  return direction === "short"
    ? `You requested ${requested} garment${requested === 1 ? "" : "s"}, but the operator collected ${received}. ${difference} ${difference === 1 ? "was" : "were"} not received. Please review and acknowledge the discrepancy.`
    : `You requested ${requested} garment${requested === 1 ? "" : "s"}, and the operator collected ${received}. ${difference} extra ${difference === 1 ? "was" : "were"} handed over and ${difference === 1 ? "has" : "have"} been added to your order.`;
}
