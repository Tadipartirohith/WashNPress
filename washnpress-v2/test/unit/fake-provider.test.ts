import { describe, it, expect } from "vitest";
import { FakePaymentProvider, FakeProviderNotPermittedError } from "../../src/adapters/payments/fake-provider";

// The provider a deployment gets when nobody configured a gateway. It answered "paid"
// to every order it was asked about, and the container falls back to it whenever
// payments.keyId and payments.keySecret are empty — which they are in the committed
// config — so the reconciliation job credited every pending top-up in full, every
// sixty seconds, against money that had never moved.

describe("the fake payment provider cannot invent a payment", () => {
  it("reports an order as unpaid unless a caller asked for otherwise", async () => {
    const provider = new FakePaymentProvider();
    const order = await provider.createOrder({ amountPaise: 500000, currency: "INR", receipt: "r" });
    expect(order.amountPaise).toBe(500000);
    expect(await provider.getOrderStatus()).toBe("created");
  });

  it("reports a settled payment only when the test says so", async () => {
    expect(await new FakePaymentProvider({ status: "paid" }).getOrderStatus()).toBe("paid");
    expect(await new FakePaymentProvider({ status: "failed" }).getOrderStatus()).toBe("failed");
  });

  it("refuses to exist in production at all", () => {
    // Failing the boot is recoverable. Failing the ledger is not.
    expect(() => new FakePaymentProvider({ env: "production" })).toThrow(FakeProviderNotPermittedError);
    expect(() => new FakePaymentProvider({ env: "staging" })).not.toThrow();
  });
});
