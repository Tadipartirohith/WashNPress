// Delivery on a batched order — the same gates the web BatchDrawer uses.
//
// Active orders with batches used to open the processing screen and stop there.
// Out-for-delivery and Mark delivered lived only on the generic order page, which
// that path never opened. The rules that decide whether those actions are offered,
// and whether the delivered count can be confirmed, live here so the screen and a
// test agree with the web drawer rather than with each other by coincidence.

export type DeliveryAction = "out_for_delivery" | "deliver" | null;

export function deliveryActionFor(state: string | null | undefined): DeliveryAction {
  if (state === "ready_for_delivery") return "out_for_delivery";
  if (state === "out_for_delivery") return "deliver";
  return null;
}

export function deliveryMismatch(deliveredCount: number, acceptedCount: number | null | undefined): boolean {
  return deliveredCount !== (acceptedCount ?? 0);
}

// Web DeliverForm: disabled when `count === "" || (mismatch && !reason.trim())`.
export function deliveryBlocked(
  deliveredCount: string,
  acceptedCount: number | null | undefined,
  reason: string,
): boolean {
  if (deliveredCount === "") return true;
  return deliveryMismatch(Number(deliveredCount), acceptedCount) && !reason.trim();
}

export function deliveryReasonToSend(
  deliveredCount: number,
  acceptedCount: number | null | undefined,
  reason: string,
): string | undefined {
  return deliveryMismatch(deliveredCount, acceptedCount) ? reason.trim() || undefined : undefined;
}

export function deliveryPayload(
  deliveredCount: string,
  acceptedCount: number | null | undefined,
  reason: string,
): { deliveryCount: number; discrepancyReason?: string } {
  const count = Number(deliveredCount);
  return {
    deliveryCount: count,
    discrepancyReason: deliveryReasonToSend(count, acceptedCount, reason),
  };
}

export function deliveryRequest(
  orderId: string,
  deliveredCount: string,
  acceptedCount: number | null | undefined,
  reason: string,
): { method: "POST"; path: string; body: ReturnType<typeof deliveryPayload> } {
  return {
    method: "POST",
    path: `/v1/operations/orders/${orderId}/deliver`,
    body: deliveryPayload(deliveredCount, acceptedCount, reason),
  };
}
