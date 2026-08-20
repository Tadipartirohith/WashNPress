// The order lifecycle is an explicit state machine. Every transition is validated
// in one place, and the QC, reprocessing and delivery guard rules from the
// specification live here. The UI never sets a state directly: it asks for an
// action and the backend decides whether the transition is legal.
export type OrderState =
  | "scheduled"
  | "picked_up"
  | "in_wash"
  | "ironing"
  | "qc"
  | "qc_hold"
  | "ready_for_delivery"
  | "out_for_delivery"
  | "delivered"
  | "pickup_failed"
  | "cancelled"
  | "disputed";

export const TRANSITIONS: Record<OrderState, OrderState[]> = {
  scheduled: ["picked_up", "pickup_failed", "cancelled"],
  picked_up: ["in_wash"],
  in_wash: ["ironing"],
  ironing: ["qc"],
  qc: ["ready_for_delivery", "qc_hold"],
  // A held batch is reprocessed: it goes back to washing or ironing and must pass
  // QC again before it can ever reach ready_for_delivery.
  qc_hold: ["in_wash", "ironing", "disputed"],
  ready_for_delivery: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: ["disputed"],
  // A failed pickup is preserved rather than deleted, and may be rescheduled.
  pickup_failed: ["scheduled", "cancelled"],
  cancelled: [],
  disputed: [],
};

// States where the garments are physically in the facility being worked on.
export const PROCESSING_STATES: OrderState[] = ["picked_up", "in_wash", "ironing", "qc", "qc_hold", "ready_for_delivery", "out_for_delivery"];
export const ACTIVE_STATES: OrderState[] = ["scheduled", ...PROCESSING_STATES];
export const TERMINAL_STATES: OrderState[] = ["delivered", "cancelled", "pickup_failed", "disputed"];

export const STATE_LABELS: Record<OrderState, string> = {
  scheduled: "Scheduled",
  picked_up: "Picked Up",
  in_wash: "Washing",
  ironing: "Ironing",
  qc: "QC",
  qc_hold: "QC Failed",
  ready_for_delivery: "Ready for Delivery",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  pickup_failed: "Pickup Failed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

// The customer facing lifecycle, in order. Used to render a tracking timeline with
// completed, current and pending stages.
export const LIFECYCLE: OrderState[] = [
  "scheduled", "picked_up", "in_wash", "ironing", "qc", "ready_for_delivery", "out_for_delivery", "delivered",
];

export interface TransitionContext {
  qcPassed?: boolean;
  pickupCount?: number;
  deliveryCount?: number;
  discrepancyReason?: string;
}

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(from: OrderState, to: OrderState, context: TransitionContext = {}): OrderState {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order transition from ${from} to ${to}`);
  }
  if (to === "ready_for_delivery" && context.qcPassed !== true) {
    throw new Error("Quality check must pass before an order can be marked ready for delivery");
  }
  if (to === "delivered") {
    const { pickupCount, deliveryCount, discrepancyReason } = context;
    if (
      pickupCount != null && deliveryCount != null &&
      pickupCount !== deliveryCount && !discrepancyReason
    ) {
      throw new Error("A delivery count mismatch requires a documented discrepancy reason");
    }
  }
  return to;
}

// Renders the tracking timeline the resident and the operations portal display.
export function timelineStages(current: OrderState, reached: OrderState[]): Array<{ state: OrderState; label: string; status: "completed" | "current" | "pending" }> {
  const currentIndex = LIFECYCLE.indexOf(current);
  return LIFECYCLE.map((state, index) => {
    if (state === current) return { state, label: STATE_LABELS[state], status: "current" as const };
    const done = reached.includes(state) || (currentIndex >= 0 && index < currentIndex);
    return { state, label: STATE_LABELS[state], status: done ? ("completed" as const) : ("pending" as const) };
  });
}
