import type { CreatedOrder, CreateOrderInput, PaymentProvider, ProviderOrderStatus } from "../../domain/payments/provider";

// Real Razorpay integration. Only used when keys are configured. The base URL comes
// from configuration so it can be pointed at a sandbox during verification.
export class RazorpayPaymentProvider implements PaymentProvider {
  constructor(private readonly keyId: string, private readonly keySecret: string, private readonly baseUrl: string) {}

  private auth(): string {
    return Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${this.auth()}` },
      body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt }),
    });
    if (!res.ok) throw new Error(`Razorpay order creation failed with status ${res.status}`);
    const body = (await res.json()) as { id: string; amount: number; currency: string };
    return { providerOrderId: body.id, amountPaise: body.amount, currency: body.currency };
  }

  async getOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus> {
    const res = await fetch(`${this.baseUrl}/orders/${providerOrderId}`, {
      headers: { authorization: `Basic ${this.auth()}` },
    });
    if (!res.ok) throw new Error(`Razorpay order lookup failed with status ${res.status}`);
    const body = (await res.json()) as { status: string };
    return body.status === "paid" ? "paid" : "created";
  }
}
