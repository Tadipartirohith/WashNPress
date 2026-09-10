// The checkout seam.
//
// The backend already has the whole payment path: POST /v1/wallet/topup creates a
// real provider order through RazorpayPaymentProvider and records a pending intent,
// and POST /v1/payments/webhook credits the wallet once the signed webhook lands.
// The web app was the missing half — it took the providerOrderId back and printed a
// sentence about it, so no resident could ever put money in.
//
// This module is the only place that knows about a gateway. Everything above it
// deals in `startCheckout` and a `CheckoutOutcome`, so replacing the demo with the
// real thing is a matter of supplying a key, not editing screens.
//
// TO GO LIVE: set NEXT_PUBLIC_RAZORPAY_KEY_ID to the publishable Razorpay key id
// (`rzp_live_…`, or `rzp_test_…` while verifying) at build time. That single variable
// flips `checkoutMode` from "demo" to "razorpay"; nothing else changes. The matching
// key *secret* and webhook secret belong to the backend and must never appear here —
// anything prefixed NEXT_PUBLIC_ is compiled into the browser bundle.

export const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "";

// "demo" means no gateway key is configured for this build, so no real payment can
// be taken. Callers must say so in the interface rather than pretending otherwise.
export const checkoutMode: "razorpay" | "demo" = RAZORPAY_KEY_ID ? "razorpay" : "demo";

// Deliberately not "paid". The gateway telling the browser that a payment went
// through is not the same fact as the money arriving: the wallet is credited by the
// signed webhook, or by the reconciliation job if the webhook was missed. A UI that
// treated the browser's word as settlement would show a balance the ledger does not
// have.
export type CheckoutOutcome = "submitted" | "dismissed" | "failed";

export interface CheckoutRequest {
  providerOrderId: string;
  amountPaise: number;
  currency?: string;
  description: string;
  prefill?: { name?: string | null; contact?: string | null; email?: string | null };
}

interface RazorpayInstance { open(): void; on(event: string, handler: () => void): void }
interface RazorpayConstructor { new (options: Record<string, unknown>): RazorpayInstance }
declare global {
  interface Window { Razorpay?: RazorpayConstructor }
}

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

// Loaded on first use rather than in the document head: a resident who never tops up
// should not pay for a third-party script on every page.
let scriptPromise: Promise<void> | null = null;
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = CHECKOUT_SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => { scriptPromise = null; reject(new Error("Could not reach the payment gateway.")); };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

// Opens the real gateway. Resolves once the sheet closes, one way or the other —
// never rejects on a dismissal, because a resident changing their mind is not an
// error to report to them.
export async function startCheckout(request: CheckoutRequest): Promise<CheckoutOutcome> {
  if (checkoutMode !== "razorpay") throw new Error("No payment gateway is configured for this build.");
  await loadCheckoutScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("The payment gateway did not load.");

  return new Promise<CheckoutOutcome>((resolve) => {
    // Guards against resolving twice: dismissing after a failure fires both events.
    let settled = false;
    const settle = (outcome: CheckoutOutcome) => { if (!settled) { settled = true; resolve(outcome); } };

    const checkout = new Razorpay({
      key: RAZORPAY_KEY_ID,
      order_id: request.providerOrderId,
      amount: request.amountPaise,
      currency: request.currency ?? "INR",
      name: "Wash N Press",
      description: request.description,
      prefill: {
        name: request.prefill?.name ?? undefined,
        contact: request.prefill?.contact ?? undefined,
        email: request.prefill?.email ?? undefined,
      },
      // The result is confirmed server-side by the webhook, so the handler's only
      // job is to close the loop in the interface.
      handler: () => settle("submitted"),
      modal: { ondismiss: () => settle("dismissed") },
    });
    checkout.on("payment.failed", () => settle("failed"));
    checkout.open();
  });
}
