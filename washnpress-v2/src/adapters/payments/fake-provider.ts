import { randomUUID } from "node:crypto";
import type { CreatedOrder, CreateOrderInput, PaymentProvider, ProviderOrderStatus } from "../../domain/payments/provider";

// Used in development and tests. Produces a deterministic order id and a configurable
// status so reconciliation can be exercised without a real gateway.
export class FakePaymentProvider implements PaymentProvider {
  constructor(private readonly status: ProviderOrderStatus = "paid") {}
  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    return { providerOrderId: `order_fake_${randomUUID().slice(0, 12)}`, amountPaise: input.amountPaise, currency: input.currency };
  }
  async getOrderStatus(): Promise<ProviderOrderStatus> {
    return this.status;
  }
}
