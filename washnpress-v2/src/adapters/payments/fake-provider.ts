import { randomUUID } from "node:crypto";
import type { CreatedOrder, CreateOrderInput, PaymentProvider } from "../../domain/payments/provider";

// Used in development and tests. Produces a deterministic-looking order id without
// calling any network service.
export class FakePaymentProvider implements PaymentProvider {
  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    return { providerOrderId: `order_fake_${randomUUID().slice(0, 12)}`, amountPaise: input.amountPaise, currency: input.currency };
  }
}
