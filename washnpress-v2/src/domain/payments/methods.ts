// How a resident can pay, and which of those the gateway has to be involved in.
//
// The four are not four settings of one thing. Card, UPI and netbanking are ways of
// telling the same gateway to move money, and none of them can be offered without
// gateway credentials — switching one on with no keys configured produces a payment
// page that cannot load. Cash is not a gateway method at all: it is a note handed to
// an operator at the door, recorded afterwards, and it is the only one that still
// works when the gateway is down or was never set up.
//
// Keeping that distinction in the domain is what stops the obvious mistake of
// asking a payment provider to create an order for a cash collection.
export const PAYMENT_METHODS = ["card", "upi", "netbanking", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// The methods the gateway collects. Cash is deliberately absent.
const GATEWAY_METHODS: readonly PaymentMethod[] = ["card", "upi", "netbanking"];

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function needsGateway(method: PaymentMethod): boolean {
  return GATEWAY_METHODS.includes(method);
}

export interface MethodConfig {
  methods: Record<PaymentMethod, boolean>;
  // A gateway is only usable once it has been given something to authenticate with.
  keyId: string;
  keySecret: string;
}

// What the applications should actually offer.
//
// A method that is switched on but has nothing behind it is not offered, because
// the alternative is a resident choosing UPI and reaching a dead page. Cash is
// unaffected by the gateway either way.
export function enabledPaymentMethods(config: MethodConfig): PaymentMethod[] {
  const gatewayReady = Boolean(config.keyId && config.keySecret);
  return PAYMENT_METHODS.filter((method) => {
    if (!config.methods[method]) return false;
    return needsGateway(method) ? gatewayReady : true;
  });
}

// Why a method the admin switched on is not being offered, for the integrations
// screen. A method nobody asked for is not a problem and has nothing to say.
export function methodBlockedReason(method: PaymentMethod, config: MethodConfig): string | null {
  if (!config.methods[method]) return null;
  if (needsGateway(method) && !(config.keyId && config.keySecret)) {
    return "The payment gateway has no key configured.";
  }
  return null;
}
