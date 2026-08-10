export interface CreateOrderInput { amountPaise: number; currency: string; receipt: string; }
export interface CreatedOrder { providerOrderId: string; amountPaise: number; currency: string; }

// A payment provider creates an order that the client pays against. Verification of
// the result arrives asynchronously through the signed webhook, never inline.
export type ProviderOrderStatus = "created" | "paid" | "failed";

export interface PaymentProvider {
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  // Used by the reconciliation job to confirm the outcome of an order when a webhook
  // was missed, so a payment is never assumed successful on a timeout.
  getOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus>;
}
