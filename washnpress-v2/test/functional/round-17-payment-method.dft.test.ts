import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp } from "./helpers";
import { computeSignature } from "../../src/domain/payments/signature";

// Payment method, finished. The only movement that carries a real external method is
// a top-up: the gateway knows whether it was UPI, a card, or net banking, and tells
// us on the webhook. That method is recorded against the top-up it settled, and the
// revenue report breaks the platform's inflows down by it. Everything the platform
// then charges is spent from the wallet, so its method is the wallet — never a guess.

describe("DFT a top-up records how the money arrived", () => {
  const secret = "change-me-in-config-local-or-env";
  const header = "x-razorpay-signature";
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
  });

  // Start a real top-up so an intent exists keyed by the provider order id the
  // webhook will name, then settle it with the gateway's method.
  async function topUp(residentId: string, amountPaise: number, method: string | null) {
    const order = await container.wallet.startTopUp(residentId, amountPaise);
    const eventId = `evt-${order.providerOrderId}`;
    const payload: Record<string, unknown> = { residentId, amountPaise, providerOrderId: order.providerOrderId };
    if (method) payload.method = method;
    const body = JSON.stringify({ id: eventId, event: "payment.captured", payload });
    await app.inject({
      method: "POST", url: "/v1/payments/webhook",
      headers: { "content-type": "application/json", [header]: computeSignature(body, secret) },
      payload: body,
    });
    return order.providerOrderId;
  }

  it("marks the top-up reconciled and stamps the gateway method on it", async () => {
    const providerOrderId = await topUp("res-demo", 50000, "upi");
    const [intent] = await container.store.paymentIntents.find((i) => i.providerOrderId === providerOrderId);
    expect(intent.status).toBe("reconciled");
    expect(intent.method).toBe("upi");
    // The wallet was still credited, exactly as before the method existed.
    expect(await container.wallet.balancePaise("res-demo")).toBe(50000);
  });

  it("leaves the method unrecorded, not guessed, when the gateway names none", async () => {
    const providerOrderId = await topUp("res-demo", 30000, null);
    const [intent] = await container.store.paymentIntents.find((i) => i.providerOrderId === providerOrderId);
    expect(intent.status).toBe("reconciled");
    expect(intent.method ?? null).toBeNull();
  });

  it("breaks the period's inflows down by method, with a fixed set of rows", async () => {
    await topUp("res-demo", 50000, "upi");
    await topUp("res-demo", 20000, "card");
    await topUp("res-demo", 10000, "upi");
    await topUp("res-demo", 5000, null);

    const report = await container.revenue.report({ preset: "all" });
    const by = Object.fromEntries(report.topUpsByMethod.map((r) => [r.method, r]));

    // Every known method appears, even net banking at zero, so the breakdown is a
    // fixed table rather than only the methods that happened to be used.
    expect(report.topUpsByMethod.map((r) => r.method)).toEqual(["upi", "card", "netbanking", "unrecorded"]);
    expect(by.upi).toMatchObject({ count: 2, amountPaise: 60000, label: "UPI" });
    expect(by.card).toMatchObject({ count: 1, amountPaise: 20000 });
    expect(by.netbanking).toMatchObject({ count: 0, amountPaise: 0 });
    expect(by.unrecorded).toMatchObject({ count: 1, amountPaise: 5000 });
  });

  it("shows no inflow breakdown once the report is narrowed to an operator", async () => {
    await topUp("res-demo", 50000, "upi");
    const report = await container.revenue.report({ preset: "all", operatorUserId: "user-op" });
    // A top-up has no operator, so a narrowing that a top-up cannot belong to leaves
    // it out rather than misreporting it — the same rule subscription revenue follows.
    expect(report.topUpsByMethod).toEqual([]);
  });
});
