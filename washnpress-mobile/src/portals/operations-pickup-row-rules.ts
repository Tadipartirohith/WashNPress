// Pickup-row actions — the same two Web's PickupsTab offers on each row.
// Failed and Reconcile are disabled until the pickup has an orderId. Failed
// asks for a free-text reason and POSTs /pickup-failed { reason }.

export const PICKUP_FAIL_ENDPOINT_SUFFIX = "/pickup-failed";
export const PICKUP_FAIL_TITLE = "Record a failed pickup";
export const PICKUP_FAIL_REASON_LABEL = "Why couldn't this be collected";
export const PICKUP_FAIL_HINT = "Kept on the order's record — nothing here is silently dropped.";
export const PICKUP_FAIL_SUBMIT = "Record failure";

// Web's Record failure button: busy or a blank/whitespace reason.
export function pickupFailSubmitBlocked(busy: boolean, orderId: string | null | undefined, reason: string): boolean {
  return busy || !canRecordPickupFailure(orderId, reason);
}

export function pickupFailFormReset(): { reason: ""; error: null; failing: null } {
  return { reason: "", error: null, failing: null };
}

export function pickupFailAfterSuccess(): { note: string; reason: ""; failing: null } {
  return { note: "Pickup failure recorded", reason: "", failing: null };
}

export function pickupFailAfterError(message: string): { error: string; failing: "keep" } {
  return { error: message, failing: "keep" };
}

export function pickupRowActions(pickup: { orderId?: string | null }): {
  failed: boolean;
  reconcile: boolean;
} {
  const allowed = Boolean(pickup.orderId);
  return { failed: allowed, reconcile: allowed };
}

export function canRecordPickupFailure(orderId: string | null | undefined, reason: string): boolean {
  return Boolean(orderId && reason.trim());
}

export function pickupFailReasonToSend(reason: string): string | null {
  const trimmed = reason.trim();
  return trimmed || null;
}

export function pickupFailRequest(orderId: string, reason: string): {
  method: "POST";
  path: string;
  body: { reason: string };
} | null {
  const trimmed = pickupFailReasonToSend(reason);
  if (!orderId || !trimmed) return null;
  return {
    method: "POST",
    path: `/v1/operations/orders/${orderId}/pickup-failed`,
    body: { reason: trimmed },
  };
}
