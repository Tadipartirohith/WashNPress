import { describe, it, expect } from "vitest";
import {
  PAYMENT_METHODS, enabledPaymentMethods, isPaymentMethod, methodBlockedReason, needsGateway,
} from "../../src/domain/payments/methods";

// Card, UPI, netbanking and cash are not four settings of one thing. Three of them
// are instructions to a gateway and cannot work without its credentials; the fourth
// is a note handed to an operator at the door and works when the gateway is down or
// was never configured at all. Collapsing that difference produces the obvious bug —
// asking a payment provider to create an order for a cash collection — and the less
// obvious one, offering a resident a payment page that cannot load.

const off = { card: false, upi: false, netbanking: false, cash: false };
const on = { card: true, upi: true, netbanking: true, cash: true };
const keys = { keyId: "rzp_test", keySecret: "secret" };
const noKeys = { keyId: "", keySecret: "" };

describe("which methods need a gateway", () => {
  it("counts card, UPI and netbanking as the gateway's to collect", () => {
    expect(needsGateway("card")).toBe(true);
    expect(needsGateway("upi")).toBe(true);
    expect(needsGateway("netbanking")).toBe(true);
  });

  it("does not put cash through a gateway", () => {
    // Cash never reaches a provider. This is the assertion that stops somebody
    // calling createOrder for a note handed over at the door.
    expect(needsGateway("cash")).toBe(false);
  });

  it("recognises exactly the four and nothing else", () => {
    expect(PAYMENT_METHODS).toHaveLength(4);
    expect(isPaymentMethod("upi")).toBe(true);
    expect(isPaymentMethod("cheque")).toBe(false);
    expect(isPaymentMethod("")).toBe(false);
  });
});

describe("what is actually offered", () => {
  it("offers nothing while every method is switched off", () => {
    expect(enabledPaymentMethods({ methods: off, ...keys })).toEqual([]);
  });

  it("withholds a gateway method that has no gateway behind it", () => {
    // The failure this prevents: an admin ticks UPI before the keys exist, and a
    // resident choosing it lands on a payment page that cannot load.
    expect(enabledPaymentMethods({ methods: on, ...noKeys })).toEqual(["cash"]);
  });

  it("still offers cash when there is no gateway at all", () => {
    const onlyCash = { ...off, cash: true };
    expect(enabledPaymentMethods({ methods: onlyCash, ...noKeys })).toEqual(["cash"]);
  });

  it("treats half a credential as none", () => {
    expect(enabledPaymentMethods({ methods: on, keyId: "rzp_test", keySecret: "" })).toEqual(["cash"]);
    expect(enabledPaymentMethods({ methods: on, keyId: "", keySecret: "secret" })).toEqual(["cash"]);
  });

  it("offers all four once the gateway is configured and all four are on", () => {
    expect(enabledPaymentMethods({ methods: on, ...keys })).toEqual(["card", "upi", "netbanking", "cash"]);
  });

  it("keeps the order stable, so the payment screen does not reshuffle itself", () => {
    const some = { ...off, netbanking: true, card: true };
    expect(enabledPaymentMethods({ methods: some, ...keys })).toEqual(["card", "netbanking"]);
  });
});

describe("why a method the admin switched on is not being offered", () => {
  it("says the gateway has no key", () => {
    expect(methodBlockedReason("upi", { methods: on, ...noKeys })).toMatch(/no key/i);
  });

  it("has nothing to say about a method nobody asked for", () => {
    // An unticked method is not a problem, and reporting one would fill the
    // integrations screen with complaints about things working as intended.
    expect(methodBlockedReason("upi", { methods: off, ...noKeys })).toBeNull();
  });

  it("has nothing to say once the gateway is configured", () => {
    expect(methodBlockedReason("upi", { methods: on, ...keys })).toBeNull();
  });

  it("never blocks cash on the gateway", () => {
    expect(methodBlockedReason("cash", { methods: on, ...noKeys })).toBeNull();
  });
});
