import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, giveSubscription } from "./helpers";

// Cancelling gives back what was already paid for and will not be used: the
// unused days of the current cycle, refunded to the wallet immediately. There is
// no plan left to hold that value the way a downgrade's credit sits until cycle
// end, so a refund is the only way it is not simply forfeited.

async function setCycleEnd(
  container: Awaited<ReturnType<typeof makeTestApp>>["container"],
  subscriptionId: string,
  daysFromNow: number,
) {
  const sub = await container.store.subscriptions.get(subscriptionId);
  if (!sub) throw new Error("subscription not found");
  sub.cycleEnd = new Date(Date.now() + daysFromNow * 86400_000).toISOString();
  await container.store.subscriptions.put(sub);
}

describe("Subscription cancel — prorated refund", () => {
  it("refunds half the monthly price when cancelled with half the cycle remaining", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const sub = await giveSubscription(container, "res-demo", "plan-standard");
    await setCycleEnd(container, sub.id, 15); // half of a 30 day monthly cycle

    const before = await container.wallet.balancePaise("res-demo");
    const cancelled = await app.inject({
      method: "POST", url: "/v1/subscription/cancel", headers: bearer(token),
      payload: JSON.stringify({ reason: "Moving out of the society" }),
    });
    expect(cancelled.statusCode).toBe(200);
    const body = cancelled.json();
    expect(body.subscription.status).toBe("cancelled");
    expect(body.refundPaise).toBe(44950); // 89900 * 15/30
    expect(await container.wallet.balancePaise("res-demo")).toBe(before + 44950);
  });

  it("has nothing left to cancel once the cycle has run out", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const sub = await giveSubscription(container, "res-demo", "plan-standard");
    await setCycleEnd(container, sub.id, 0);

    // This used to answer 200 with a refund of nothing, because a subscription was
    // active on its status alone and its cycle end was never compared to the date. A
    // cycle that has ended is over: there is nothing left to give back, and nothing
    // left to cancel either.
    const cancelled = await app.inject({
      method: "POST", url: "/v1/subscription/cancel", headers: bearer(token),
      payload: JSON.stringify({ reason: "Done for now" }),
    });
    expect(cancelled.statusCode).toBe(404);
    expect(cancelled.json().error).toBe("no_active_subscription");
  });

  // Days remaining is only half the question. The other half is what the resident has
  // already had for the money, and refunding without asking it made a monthly plan
  // into a four-day plan at a sixth of the price.
  it("refunds nothing when the allowance has already been spent, however early it is cancelled", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const sub = await giveSubscription(container, "res-demo", "plan-family");
    await setCycleEnd(container, sub.id, 25); // cancelled on day five of thirty

    // The whole of the Family Pack wash-and-iron allowance, collected in four days.
    const stored = (await container.store.subscriptions.get(sub.id))!;
    stored.serviceUsage = { wash_iron: 100 };
    await container.store.subscriptions.put(stored);

    const before = await container.wallet.balancePaise("res-demo");
    const cancelled = await app.inject({
      method: "POST", url: "/v1/subscription/cancel", headers: bearer(token),
      payload: JSON.stringify({ reason: "Got what I came for" }),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().refundPaise).toBe(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(before);
  });

  it("refunds the smaller of the unused days and the unused allowance", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const sub = await giveSubscription(container, "res-demo", "plan-family");
    await setCycleEnd(container, sub.id, 24); // 80% of the cycle still to run

    // Half the wash-and-iron allowance gone, and it is the most depleted service.
    const stored = (await container.store.subscriptions.get(sub.id))!;
    stored.serviceUsage = { wash_iron: 50 };
    await container.store.subscriptions.put(stored);

    const cancelled = await app.inject({
      method: "POST", url: "/v1/subscription/cancel", headers: bearer(token),
      payload: JSON.stringify({ reason: "Moving out" }),
    });
    expect(cancelled.statusCode).toBe(200);
    // 199900 * min(0.8, 0.5) — the allowance, not the calendar, is what is left.
    expect(cancelled.json().refundPaise).toBe(99950);
  });

  it("returns 404 rather than a server error when there is nothing to cancel", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);

    const cancelled = await app.inject({
      method: "POST", url: "/v1/subscription/cancel", headers: bearer(token),
      payload: JSON.stringify({ reason: "No plan anyway" }),
    });
    expect(cancelled.statusCode).toBe(404);
    expect(cancelled.json().error).toBe("no_active_subscription");
  });
});
