import type { CreatedOrder, CreateOrderInput, PaymentProvider } from "../../domain/payments/provider";

// Real Razorpay order creation. Only used when keys are configured. Kept behind the
// same interface so the rest of the platform is unaware of the vendor.
export class RazorpayPaymentProvider implements PaymentProvider {
  constructor(private readonly keyId: string, private readonly keySecret: string) {}

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
      body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt }),
    });
    if (!res.ok) throw new Error(`Razorpay order creation failed with status ${res.status}`);
    const body = (await res.json()) as { id: string; amount: number; currency: string };
    return { providerOrderId: body.id, amountPaise: body.amount, currency: body.currency };
  }
}
