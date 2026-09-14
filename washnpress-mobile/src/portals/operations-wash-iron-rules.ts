// Order-level wash / iron — the same buttons and endpoints Web's
// LegacyStageControls uses. Mobile used to send nextActions through
// POST /advance { to }, which is a different URL and body than Web.

export type WashIronKind = "startWash" | "completeWash" | "startIroning" | "completeIroning";

export interface WashIronAction {
  kind: WashIronKind;
  label: string;
}

export interface WashIronCall {
  method: "POST";
  path: string;
  body: undefined;
}

export function washIronEndpoint(kind: WashIronKind, orderId: string): WashIronCall {
  const path = {
    startWash: `/v1/operations/orders/${orderId}/wash/start`,
    completeWash: `/v1/operations/orders/${orderId}/wash/complete`,
    startIroning: `/v1/operations/orders/${orderId}/ironing/start`,
    completeIroning: `/v1/operations/orders/${orderId}/ironing/complete`,
  }[kind];
  return { method: "POST", path, body: undefined };
}

export function orderWashIronAction(order: {
  state: string;
  ironingStarted?: boolean;
  processing?: { requiresClean?: boolean; requiresPress?: boolean; cleanLabel?: string } | null;
}): WashIronAction | null {
  const requiresClean = order.processing?.requiresClean ?? true;
  const requiresPress = order.processing?.requiresPress ?? true;
  const cleanLabel = order.processing?.cleanLabel ?? "Washing";

  if (order.state === "picked_up" && requiresClean) {
    return { kind: "startWash", label: `Start ${cleanLabel}` };
  }
  if (order.state === "picked_up" && !requiresClean && requiresPress) {
    return { kind: "startIroning", label: "Start Ironing" };
  }
  if (order.state === "in_wash") {
    return { kind: "completeWash", label: `Complete ${cleanLabel}` };
  }
  if (order.state === "ironing" && !order.ironingStarted) {
    return { kind: "startIroning", label: "Start Ironing" };
  }
  if (order.state === "ironing" && order.ironingStarted) {
    return { kind: "completeIroning", label: "Complete Ironing" };
  }
  return null;
}
