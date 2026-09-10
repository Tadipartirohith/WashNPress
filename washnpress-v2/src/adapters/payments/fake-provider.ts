import { randomUUID } from "node:crypto";
import type { CreatedOrder, CreateOrderInput, PaymentProvider, ProviderOrderStatus } from "../../domain/payments/provider";

export class FakeProviderNotPermittedError extends Error {
  constructor() {
    super("The fake payment provider cannot be used in production. Configure payments.keyId and payments.keySecret.");
    this.name = "FakeProviderNotPermittedError";
  }
}

// Used in development and tests. Produces a deterministic order id and a status the
// caller chooses, so reconciliation can be exercised without a real gateway.
//
// The status defaults to "created". It defaulted to "paid", and with no Razorpay keys
// configured the container falls back to this provider — so every sixty seconds the
// reconciliation job asked an unconfigured deployment whether a pending top-up had
// been paid for, and was told yes. Posting ₹5,000 to /v1/wallet/topup with no card,
// no checkout and no money moving credited ₹5,000 of spendable wallet balance, which
// then bought subscriptions, earned SubscriptionRevenue and accrued TaxPayable
// against money that had never existed. Nothing caught it because the whole test
// suite ran against that same default.
//
// A settled payment is now something a test asks for by name.
export class FakePaymentProvider implements PaymentProvider {
  private readonly status: ProviderOrderStatus;

  constructor(options: { status?: ProviderOrderStatus; env?: string } = {}) {
    // Reaching this class in production means the deployment has no gateway keys and
    // is one job tick away from inventing wallet balance. Refusing at construction
    // fails the boot, which is recoverable, rather than the ledger, which is not.
    if (options.env === "production") throw new FakeProviderNotPermittedError();
    this.status = options.status ?? "created";
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    return { providerOrderId: `order_fake_${randomUUID().slice(0, 12)}`, amountPaise: input.amountPaise, currency: input.currency };
  }

  async getOrderStatus(): Promise<ProviderOrderStatus> {
    return this.status;
  }
}
