export interface CreateOrderInput { amountPaise: number; currency: string; receipt: string; }
export interface CreatedOrder { providerOrderId: string; amountPaise: number; currency: string; }

// A payment provider creates an order that the client pays against. Verification of
// the result arrives asynchronously through the signed webhook, never inline.
export interface PaymentProvider {
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
}
