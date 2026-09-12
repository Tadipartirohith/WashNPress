import { describe, it, expect } from "vitest";
import { makeTestApp, makeTestContainer, seedSlot } from "./helpers";
import { loadConfig, resetConfigCache } from "../../src/config";
import { buildContainer, type Container } from "../../src/container";
import { createMemoryStore } from "../../src/adapters/memory/store";
import { FakePaymentProvider } from "../../src/adapters/payments/fake-provider";
import { CompositeNotificationProvider } from "../../src/adapters/notifications/composite";
import { computeSignature } from "../../src/domain/payments/signature";
import { ReconciliationService } from "../../src/services/reconciliation-service";
import { RenewalService } from "../../src/services/renewal-service";
import type { OutboxEvent } from "../../src/domain/models";

// The background jobs run on timers inside the API process. A timer fires whether or
// not its last pass has finished, a webhook arrives while a pass is running, and a
// second instance runs every job again. Each of these passes used to decide what to do
// with a read and then act on it, so two passes that read before either acted both
// acted: a top-up credited twice, a month charged twice, a text sent twice. What they
// act on now is taken, not read, and each of these runs two passes at once.
//
// The memory store cannot show a real database race; the Postgres adapter's SQL is
// proven under real concurrency separately. These pin the contract every store keeps.

const DAY = 86400_000;

describe("DFT work the jobs do is done once however many passes run", () => {
  it("credits a top-up once when its webhook lands during a reconciliation pass", async () => {
    // The case that needs no second instance at all: the webhook is a request and
    // reconciliation is a timer, in the same process, sharing one key.
    const { app, container } = await makeTestApp();
    const order = await container.wallet.startTopUp("r1", 5000);
    const payload = JSON.stringify({
      id: "evt-overlap", event: "payment.captured",
      payload: { providerOrderId: order.providerOrderId, residentId: "r1", amountPaise: 5000 },
    });
    const [webhook] = await Promise.all([
      app.inject({
        method: "POST", url: "/v1/payments/webhook",
        headers: { "content-type": "application/json", "x-razorpay-signature": computeSignature(payload, "change-me-in-config-local-or-env") },
        payload,
      }),
      new ReconciliationService(container.store, new FakePaymentProvider({ status: "paid" })).runOnce(),
    ]);
    expect(webhook.statusCode).toBe(200);
    expect(await container.wallet.balancePaise("r1")).toBe(5000);
    await app.close();
  });

  it("credits a paid top-up once when two reconciliation passes overlap", async () => {
    const container = await makeTestContainer();
    await container.wallet.startTopUp("res-demo", 250000);
    const paid = new FakePaymentProvider({ status: "paid" });
    const [a, b] = await Promise.all([
      new ReconciliationService(container.store, paid).runOnce(),
      new ReconciliationService(container.store, paid).runOnce(),
    ]);
    expect(a.credited + b.credited).toBe(1);
    expect(await container.wallet.balancePaise("res-demo")).toBe(250000);
  });

  it("charges a cycle once when two renewal passes overlap", async () => {
    const container = await makeTestContainer();
    await container.wallet.startTopUp("res-demo", 5_000_000);
    await new ReconciliationService(container.store, new FakePaymentProvider({ status: "paid" })).runOnce();
    const [plan] = await container.store.plans.all();
    const cycleEnd = new Date(Date.now() - DAY).toISOString();
    await container.store.subscriptions.put({
      id: "sub-overlap", residentId: "res-demo", planId: plan.id, status: "active", cycle: "monthly",
      cycleStart: new Date(Date.parse(cycleEnd) - 30 * DAY).toISOString(), cycleEnd,
      garmentsUsed: 0, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
    });
    const pass = () => new RenewalService(container.store, container.wallet, container.systemConfig).runOnce();
    const [a, b] = await Promise.all([pass(), pass()]);
    expect(a.renewed + b.renewed).toBe(1);
    const charges = (await container.store.ledger.all()).filter((t) => t.reference.startsWith("sub-renew-sub-overlap-"));
    expect(charges).toHaveLength(1);
  });

  it("sends each notification once when two outbox passes overlap", async () => {
    // Matched against the same booking delivered by a single pass. Not every event a
    // booking raises is addressed to this resident, so the queue length is not the
    // number of pushes they should get.
    const booked = async (slotId: string): Promise<Container> => {
      resetConfigCache();
      const container = await buildContainer(loadConfig({
        reload: true, env: { WNP_APP__ENV: "test", WNP_NOTIFICATIONS__PUSH__ENABLED: "true" },
      }));
      await container.devices.register({ userId: "user-res", token: "token-once", platform: "android", app: "resident" });
      await seedSlot(container, slotId, 3);
      await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId });
      return container;
    };
    const pushesTo = (container: Container) => (container.notificationProvider as CompositeNotificationProvider).mock.sent
      .filter((m) => m.channel === "push" && m.to === "token-once");

    const single = await booked("slot-once-single");
    await single.notifications.processOutboxOnce();
    const expected = pushesTo(single).length;
    expect(expected).toBeGreaterThanOrEqual(1);

    const overlapping = await booked("slot-once-overlap");
    const queued = (await overlapping.store.outbox.listPending()).length;
    const [a, b] = await Promise.all([
      overlapping.notifications.processOutboxOnce(),
      overlapping.notifications.processOutboxOnce(),
    ]);
    expect(a + b).toBe(queued);
    expect(pushesTo(overlapping)).toHaveLength(expected);
  });
});

describe("DFT an outbox claim is a lease", () => {
  const event = (id: string, createdAt: string): OutboxEvent => ({ id, type: "t", payload: {}, status: "pending", attempts: 0, createdAt });

  it("hands out the oldest events first, no more than asked for", async () => {
    const store = createMemoryStore();
    for (const [id, at] of [["c", "03"], ["a", "01"], ["b", "02"]]) await store.outbox.add(event(id, `2026-09-12T${at}:00:00.000Z`));
    expect((await store.outbox.claimPending(2, 300)).map((e) => e.id)).toEqual(["a", "b"]);
    expect((await store.outbox.claimPending(2, 300)).map((e) => e.id)).toEqual(["c"]);
  });

  it("gives an undelivered event back when its lease runs out, and not before", async () => {
    // The process delivering it died. Repeating a notification is the price of never
    // losing one.
    const store = createMemoryStore();
    const now = new Date("2026-09-12T12:00:00.000Z");
    await store.outbox.add(event("stranded", "2026-09-12T11:00:00.000Z"));
    await store.outbox.add(event("delivered", "2026-09-12T11:00:01.000Z"));
    expect(await store.outbox.claimPending(50, 300, now)).toHaveLength(2);
    await store.outbox.mark("delivered", "sent");

    expect(await store.outbox.claimPending(50, 300, new Date(now.getTime() + 299_000))).toHaveLength(0);
    const reclaimed = await store.outbox.claimPending(50, 300, new Date(now.getTime() + 301_000));
    expect(reclaimed.map((e) => e.id)).toEqual(["stranded"]);
  });

  it("still counts a leased event as pending, because it has not been delivered", async () => {
    const store = createMemoryStore();
    await store.outbox.add(event("in-flight", "2026-09-12T11:00:00.000Z"));
    await store.outbox.claimPending(50, 300);
    expect((await store.outbox.listPending()).map((e) => e.id)).toEqual(["in-flight"]);
  });
});

describe("DFT a ledger key and its credit are taken together", () => {
  it("posts once per key and shares keys with claim", async () => {
    const store = createMemoryStore();
    const txn = (id: string) => ({
      id, reference: "ord-1", createdAt: new Date().toISOString(),
      entries: [
        { account: "gateway_clearing", direction: "debit" as const, amount: 100 },
        { account: "resident_wallet:r1", direction: "credit" as const, amount: 100 },
      ],
    });
    expect(await store.ledger.postOnce("payment:ord-1", txn("t1"))).toBe(true);
    expect(await store.ledger.postOnce("payment:ord-1", txn("t2"))).toBe(false);
    expect(await store.idempotency.claim("payment:ord-1")).toBe(false);
    expect(await store.idempotency.claim("renewal:x")).toBe(true);
    expect(await store.ledger.postOnce("renewal:x", txn("t3"))).toBe(false);
    expect(await store.ledger.all()).toHaveLength(1);
  });
});
