// The order lifecycle is an explicit state machine. Every transition is validated
// in one place, and the QC and delivery guard rules from the specification live here.
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
  | "cancelled"
  | "disputed";

export const TRANSITIONS: Record<OrderState, OrderState[]> = {
  scheduled: ["picked_up", "cancelled"],
  picked_up: ["in_wash"],
  in_wash: ["ironing"],
  ironing: ["qc"],
  qc: ["ready_for_delivery", "qc_hold"],
  qc_hold: ["ready_for_delivery", "disputed"],
  ready_for_delivery: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: ["disputed"],
  cancelled: [],
  disputed: [],
};

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
