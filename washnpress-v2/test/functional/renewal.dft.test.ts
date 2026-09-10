import { describe, it, expect } from "vitest";
import { makeTestContainer } from "./helpers";
import { FakePaymentProvider } from "../../src/adapters/payments/fake-provider";
import { ReconciliationService } from "../../src/services/reconciliation-service";
import { RenewalService } from "../../src/services/renewal-service";
import type { Container } from "../../src/container";
import type { Subscription } from "../../src/domain/models";

// There was no billing job. cycleStart and cycleEnd were written once, by subscribe(),
// and never again — so a subscription was active forever, was charged for one cycle in
// its life, never got its allowance back, and every scheduled downgrade waited for a
// next cycle that could not come.

function renewal(container: Container): RenewalService {
  return new RenewalService(container.store, container.wallet, container.systemConfig);
}

// Real money, arriving the real way: a top-up settled by a provider that says it was
// paid, which is now something a test has to ask for.
async function fund(container: Container, residentId: string, amountPaise: number): Promise<void> {
  await container.wallet.startTopUp(residentId, amountPaise);
  await new ReconciliationService(container.store, new FakePaymentProvider({ status: "paid" })).runOnce();
}

const DAY = 86400_000;

async function subscriptionDue(
  container: Container,
  planId: string,
  over: Partial<Subscription> = {},
  endedDaysAgo = 1,
): Promise<Subscription> {
  const cycleEnd = new Date(Date.now() - endedDaysAgo * DAY).toISOString();
  return container.store.subscriptions.put({
    id: "sub-renew", residentId: "res-demo", planId, status: "active", cycle: "monthly",
    cycleStart: new Date(Date.parse(cycleEnd) - 30 * DAY).toISOString(), cycleEnd,
    garmentsUsed: 0, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
    ...over,
  });
}

describe("DFT subscription renewal", () => {
  it("charges the new cycle, rolls the dates and gives the allowance back", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 200000);
    const { cycleEnd: boundary } = await subscriptionDue(container, "plan-standard", {
      garmentsUsed: 70, serviceUsage: { wash_iron: 38, iron_only: 12 },
      usageHistory: [{
        orderId: "o1", orderCode: "WNP-1", quantity: 70, usedBefore: 0, usedAfter: 70,
        at: new Date(Date.now() - 5 * DAY).toISOString(),
      }],
    });

    const run = await renewal(container).runOnce();
    expect(run).toMatchObject({ due: 1, renewed: 1, expired: 0 });

    const after = (await container.store.subscriptions.get("sub-renew"))!;
    expect(after.status).toBe("active");
    // The cycle starts where the last one ended, so a job that runs late does not
    // shorten the month it is billing for or walk the renewal date forward.
    expect(after.cycleStart).toBe(boundary);
    expect(Date.parse(after.cycleEnd) - Date.parse(after.cycleStart)).toBe(30 * DAY);
    // A new cycle is a new allowance. garmentsUsed was monotonic and nothing reset it,
    // so a resident who reached the cap in month one stayed there for good.
    expect(after.garmentsUsed).toBe(0);
    expect(after.serviceUsage).toEqual({});
    expect(after.usageHistory).toEqual([]);
    expect(await container.wallet.balancePaise("res-demo")).toBe(200000 - 89900);
  });

  it("applies the downgrade the resident scheduled, and charges the new plan's price", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 300000);
    await subscriptionDue(container, "plan-family", { pendingPlanId: "plan-basic" });

    await renewal(container).runOnce();

    const after = (await container.store.subscriptions.get("sub-renew"))!;
    // pendingPlanId was read only for display. Every downgrade a resident scheduled
    // was shown to them and then never happened.
    expect(after.planId).toBe("plan-basic");
    expect(after.pendingPlanId).toBeNull();
    expect(await container.wallet.balancePaise("res-demo")).toBe(300000 - 49900);
  });

  it("bills one boundary once, however many times the job runs over it", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 300000);
    const { cycleEnd: boundary } = await subscriptionDue(container, "plan-standard");

    const first = await renewal(container).runOnce();
    expect(first.renewed).toBe(1);
    // Nothing is due any more, which is the ordinary case.
    expect((await renewal(container).runOnce()).due).toBe(0);

    // And the case that matters: another instance of the job reaching the same
    // boundary. The claim is on the boundary, not the run, so it is refused.
    const rolled = (await container.store.subscriptions.get("sub-renew"))!;
    rolled.cycleEnd = boundary;
    await container.store.subscriptions.put(rolled);
    const third = await renewal(container).runOnce();
    expect(third).toMatchObject({ due: 1, renewed: 0 });
    expect(await container.wallet.balancePaise("res-demo")).toBe(300000 - 89900);
  });

  it("bills every boundary that has gone by, one pass each", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 300000);
    // Two full cycles missed — an outage, or a job that was never wired.
    await subscriptionDue(container, "plan-standard", {}, 65);

    await renewal(container).runOnce();
    await renewal(container).runOnce();
    await renewal(container).runOnce();

    // The resident had the service for those months and is charged for them, rather
    // than being handed them free or having the dates quietly jumped to today.
    expect(await container.wallet.balancePaise("res-demo")).toBe(300000 - 3 * 89900);
    const after = (await container.store.subscriptions.get("sub-renew"))!;
    expect(Date.parse(after.cycleEnd)).toBeGreaterThan(Date.now());
  });

  it("expires the subscription rather than serving a cycle nobody paid for", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 1000);
    await subscriptionDue(container, "plan-standard");

    const run = await renewal(container).runOnce();
    expect(run).toMatchObject({ renewed: 0, expired: 1 });

    const after = (await container.store.subscriptions.get("sub-renew"))!;
    expect(after.status).toBe("expired");
    expect(await container.wallet.balancePaise("res-demo")).toBe(1000);
    expect(await container.subscriptions.getActive("res-demo")).toBeNull();
  });

  it("takes autoRenew off as the answer it is", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 300000);
    await subscriptionDue(container, "plan-standard", { autoRenew: false });

    expect(await renewal(container).runOnce()).toMatchObject({ expired: 1 });
    expect((await container.store.subscriptions.get("sub-renew"))!.status).toBe("expired");
    // autoRenew was written and read by nothing. Nobody is charged for saying no.
    expect(await container.wallet.balancePaise("res-demo")).toBe(300000);
  });

  it("leaves a paused subscription alone", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 300000);
    await subscriptionDue(container, "plan-standard", { status: "paused", pauseUntil: null });

    expect(await renewal(container).runOnce()).toMatchObject({ due: 0 });
    expect(await container.wallet.balancePaise("res-demo")).toBe(300000);
  });
});

describe("a cycle that has ended is not an active subscription", () => {
  it("stops answering as active the moment the cycle runs out, before any job runs", async () => {
    const container = await makeTestContainer();
    await subscriptionDue(container, "plan-standard", { garmentsUsed: 12 });

    // The status column knows nothing about time. On its own it said this January
    // subscription was still active in June, and it was still being served.
    expect(await container.subscriptions.getActive("res-demo")).toBeNull();
    expect(await container.subscriptions.usage("res-demo")).toBeNull();
  });
});
