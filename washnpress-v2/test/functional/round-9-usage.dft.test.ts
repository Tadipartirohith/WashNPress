import { describe, it, expect } from "vitest";
import {
  makeTestApp, bearer, loginOperator, loginResident, seedSlot, openSlotNow, giveSubscription,
} from "./helpers";

// The plan a resident is on when their garments are collected is the plan that pays
// for them, and what it spent has to be explainable order by order.

async function book(app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, slotId: string, count: number) {
  const res = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(token),
    payload: JSON.stringify({ slotId, estimatedCount: count }),
  });
  return res.json().order.id as string;
}

async function collect(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, orderId: string, quantity: number,
) {
  return app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(token),
    payload: JSON.stringify({ items: [{ category: "Shirts", quantity }] }),
  });
}

async function usage(app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string) {
  const res = await app.inject({ method: "GET", url: "/v1/subscription/usage", headers: bearer(token) });
  return res.json().usage as {
    used: number; remaining: number; allowance: number;
    history: { orderCode: string; quantity: number; usedBefore: number; usedAfter: number }[];
  };
}

describe("DFT subscription usage accumulates across orders", () => {
  it("adds each collection to the running total rather than starting again", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const resident = await loginResident(app);
    const operator = await loginOperator(app);

    for (const [index, quantity] of [10, 8, 12].entries()) {
      const slotId = `slot-usage-${index}`;
      await seedSlot(container, slotId, 5);
      const orderId = await book(app, resident, slotId, quantity);
      await openSlotNow(container, slotId);
      expect((await collect(app, operator, orderId, quantity)).statusCode).toBe(200);
    }

    // 10, then 18, then 30 — the spec's own worked example.
    const after = await usage(app, resident);
    expect(after.used).toBe(30);
    expect(after.remaining).toBe(40 - 30);
  });

  it("counts what the operator received, not what the resident asked for", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const resident = await loginResident(app);
    const operator = await loginOperator(app);
    await seedSlot(container, "slot-usage-short", 5);
    const orderId = await book(app, resident, "slot-usage-short", 10);
    await openSlotNow(container, "slot-usage-short");
    // Ten were expected; eight turned up.
    expect((await collect(app, operator, orderId, 8)).statusCode).toBe(200);

    const after = await usage(app, resident);
    expect(after.used).toBe(8);
    expect(after.remaining).toBe(32);
  });

  it("says which order spent what", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const resident = await loginResident(app);
    const operator = await loginOperator(app);
    await seedSlot(container, "slot-usage-trace", 5);
    const orderId = await book(app, resident, "slot-usage-trace", 6);
    await openSlotNow(container, "slot-usage-trace");
    await collect(app, operator, orderId, 6);

    const after = await usage(app, resident);
    expect(after.history).toHaveLength(1);
    // "Order X consumed 6, taking used from 0 to 6" — the working behind the total.
    expect(after.history[0]).toMatchObject({ quantity: 6, usedBefore: 0, usedAfter: 6 });
    expect(after.history[0].orderCode).toBeTruthy();
  });

  it("never lets the used count run past the allowance", async () => {
    const { app, container } = await makeTestApp();
    // Thirty-eight of forty already gone.
    await giveSubscription(container, "res-demo", "plan-basic", 38);
    const resident = await loginResident(app);
    const operator = await loginOperator(app);
    await seedSlot(container, "slot-usage-cap", 5);
    const orderId = await book(app, resident, "slot-usage-cap", 10);
    await openSlotNow(container, "slot-usage-cap");
    await collect(app, operator, orderId, 10);

    const after = await usage(app, resident);
    expect(after.used).toBe(40);
    expect(after.remaining).toBe(0);
  });

  it("does not spend the allowance merely because an order exists", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const resident = await loginResident(app);
    await seedSlot(container, "slot-usage-booked", 5);
    await book(app, resident, "slot-usage-booked", 9);

    // Booked, not collected. Nothing has left the flat.
    const after = await usage(app, resident);
    expect(after.used).toBe(0);
    expect(after.remaining).toBe(40);
  });
});

describe("DFT the plan that is active at collection is the plan that pays", () => {
  it("covers a collection made after the resident took out a plan", async () => {
    const { app, container } = await makeTestApp();
    const resident = await loginResident(app);
    const operator = await loginOperator(app);
    await seedSlot(container, "slot-late-plan", 5);

    // Booked with no plan at all, which is how somebody tries the service first.
    const orderId = await book(app, resident, "slot-late-plan", 10);
    expect((await container.store.orders.get(orderId))!.subscriptionId).toBeNull();

    // Then they subscribe, and only afterwards is the bag collected.
    await giveSubscription(container, "res-demo", "plan-basic");
    await openSlotNow(container, "slot-late-plan");
    const collected = await collect(app, operator, orderId, 10);
    expect(collected.statusCode).toBe(200);

    // The garments were taken while the plan was running, so the plan paid for
    // them. Before this the order still pointed at the nothing that existed when it
    // was booked, and the resident was billed the pay per garment rate.
    const order = collected.json().order;
    expect(order.payPerOrder).toBe(false);
    expect(order.subscriptionCoveredCount).toBe(10);
    expect(order.additionalChargePaise).toBe(0);

    const after = await usage(app, resident);
    expect(after.used).toBe(10);
    expect(after.remaining).toBe(30);
  });

  it("charges per garment when the plan was cancelled before the collection", async () => {
    const { app, container } = await makeTestApp();
    const subscription = await giveSubscription(container, "res-demo", "plan-basic");
    const resident = await loginResident(app);
    const operator = await loginOperator(app);
    await seedSlot(container, "slot-gone-plan", 5);
    const orderId = await book(app, resident, "slot-gone-plan", 4);

    // The plan goes before the bag does.
    await container.store.subscriptions.put({ ...subscription, status: "cancelled" });
    await openSlotNow(container, "slot-gone-plan");
    const collected = await collect(app, operator, orderId, 4);

    expect(collected.json().order.payPerOrder).toBe(true);
    expect(collected.json().order.subscriptionCoveredCount).toBe(0);
  });
});
