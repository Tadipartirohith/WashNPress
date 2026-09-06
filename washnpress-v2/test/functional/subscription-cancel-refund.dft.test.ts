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

  it("refunds nothing when cancelled right at the end of the cycle", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const sub = await giveSubscription(container, "res-demo", "plan-standard");
    await setCycleEnd(container, sub.id, 0);

    const cancelled = await app.inject({
      method: "POST", url: "/v1/subscription/cancel", headers: bearer(token),
      payload: JSON.stringify({ reason: "Done for now" }),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().refundPaise).toBe(0);
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
