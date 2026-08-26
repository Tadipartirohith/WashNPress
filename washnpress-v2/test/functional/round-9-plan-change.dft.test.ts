import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, giveSubscription } from "./helpers";
import { buildTransaction } from "../../src/domain/ledger";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";

// A plan must not change in the database merely because somebody pressed Upgrade.

async function fund(container: Awaited<ReturnType<typeof makeTestApp>>["container"], paise: number) {
  await container.store.ledger.post(buildTransaction({
    id: `test-fund-${Math.random()}`, reference: "test-fund",
    entries: [
      { account: Account.GatewayClearing, direction: "debit", amount: paise },
      { account: walletAccount("res-demo"), direction: "credit", amount: paise },
    ],
    at: new Date(),
  }));
}

describe("DFT a quote says what a change would cost before anything happens", () => {
  it("answers with both plans, both prices, the difference and the date", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const res = await app.inject({
      method: "GET", url: "/v1/subscription/change/quote?planId=plan-standard", headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    const quote = res.json().quote;
    expect(quote.currentPlanTier).toBeTruthy();
    expect(quote.newPlanTier).toBeTruthy();
    expect(quote.currentCyclePaise).toBeGreaterThan(0);
    expect(quote.newCyclePaise).toBeGreaterThan(quote.currentCyclePaise);
    expect(quote.kind).toBe("upgrade");
    expect(quote.prorationPaise).toBeGreaterThan(0);
    expect(quote.amountDuePaise).toBe(quote.prorationPaise);
    expect(quote.effectiveFrom).toBeTruthy();
  });

  it("writes nothing at all", async () => {
    const { app, container } = await makeTestApp();
    const subscription = await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    await app.inject({
      method: "GET", url: "/v1/subscription/change/quote?planId=plan-premium", headers: bearer(token),
    });
    const after = (await container.store.subscriptions.get(subscription.id))!;
    // Not the plan, and not a pending one either. Asking what something costs is
    // not agreeing to it.
    expect(after.planId).toBe("plan-basic");
    expect(after.pendingPlanId ?? null).toBeNull();
  });

  it("refuses to quote the plan they are already on", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const res = await app.inject({
      method: "GET", url: "/v1/subscription/change/quote?planId=plan-basic", headers: bearer(token),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/already on that plan/i);
  });
});

describe("DFT an upgrade happens only once it is paid for", () => {
  it("leaves the plan alone when the wallet cannot cover the difference", async () => {
    const { app, container } = await makeTestApp();
    const subscription = await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const res = await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-premium" }),
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe("payment_failed");
    // Said plainly, because the old flow left the resident unable to tell whether
    // anything had happened.
    expect(res.json().message).toMatch(/unchanged/i);

    const after = (await container.store.subscriptions.get(subscription.id))!;
    expect(after.planId).toBe("plan-basic");
    expect(after.pendingPlanId ?? null).toBeNull();
  });

  it("charges the difference and moves the plan at once when it can", async () => {
    const { app, container } = await makeTestApp();
    const subscription = await giveSubscription(container, "res-demo", "plan-basic");
    await fund(container, 500000);
    const before = await container.wallet.balancePaise("res-demo");
    const token = await loginResident(app);

    const res = await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-standard" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("applied");
    expect(res.json().note).toMatch(/upgraded successfully/i);

    const paid = res.json().paidPaise as number;
    expect(paid).toBeGreaterThan(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - paid);

    const after = (await container.store.subscriptions.get(subscription.id))!;
    expect(after.planId).toBe("plan-standard");
    expect(after.pendingPlanId ?? null).toBeNull();
  });

  it("starts the new allowance rather than carrying the old plan's usage over", async () => {
    const { app, container } = await makeTestApp();
    const subscription = await giveSubscription(container, "res-demo", "plan-basic", 30);
    await fund(container, 500000);
    const token = await loginResident(app);
    await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-standard" }),
    });
    const after = (await container.store.subscriptions.get(subscription.id))!;
    // Thirty of Basic's forty were used. Standard's eighty are not eighty minus
    // thirty: what was used of one plan is not what has been used of the other.
    expect(after.garmentsUsed).toBe(0);
  });
});

describe("DFT a downgrade waits for the cycle that was paid for", () => {
  it("is scheduled rather than applied, and costs nothing today", async () => {
    const { app, container } = await makeTestApp();
    const subscription = await giveSubscription(container, "res-demo", "plan-premium");
    const token = await loginResident(app);
    const before = await container.wallet.balancePaise("res-demo");

    const res = await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-basic" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("scheduled");
    expect(res.json().paidPaise).toBe(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(before);

    const after = (await container.store.subscriptions.get(subscription.id))!;
    // They keep what this cycle bought, and the cheaper plan starts when it ends.
    expect(after.planId).toBe("plan-premium");
    expect(after.pendingPlanId).toBe("plan-basic");
    expect(res.json().effectiveFrom).toBe(after.cycleEnd);
    expect(res.json().note).toMatch(/scheduled/i);
  });

  it("can be called off, leaving them on what they are already on", async () => {
    const { app, container } = await makeTestApp();
    const subscription = await giveSubscription(container, "res-demo", "plan-premium");
    const token = await loginResident(app);
    await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-basic" }),
    });
    const cancelled = await app.inject({
      method: "DELETE", url: "/v1/subscription/change", headers: bearer(token),
    });
    expect(cancelled.statusCode).toBe(200);
    const after = (await container.store.subscriptions.get(subscription.id))!;
    expect(after.pendingPlanId ?? null).toBeNull();
    expect(after.planId).toBe("plan-premium");
  });
});

describe("DFT the plan list says which one they are on", () => {
  it("marks the current plan so it is never offered as an upgrade", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);
    const res = await app.inject({ method: "GET", url: "/v1/resident/subscription", headers: bearer(token) });
    const plans = res.json().availablePlans as { id: string; isCurrent: boolean }[];
    expect(plans.find((p) => p.id === "plan-standard")!.isCurrent).toBe(true);
    expect(plans.filter((p) => p.isCurrent)).toHaveLength(1);
  });
});
