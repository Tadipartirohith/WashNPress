import { describe, it, expect } from "vitest";
import { makeTestContainer } from "./helpers";
import { computeSignature } from "../../src/domain/payments/signature";
import { InsufficientBalanceError } from "../../src/services/wallet-service";

const secret = "change-me-in-config-local-or-env";
async function fund(container: Awaited<ReturnType<typeof makeTestContainer>>, residentId: string, amountPaise: number) {
  const body = JSON.stringify({ id: `evt-${residentId}-${amountPaise}`, payload: { residentId, amountPaise } });
  await container.payments.handleWebhook(body, computeSignature(body, secret));
}

describe("DFT subscription", () => {
  it("subscribes by charging the wallet", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 200000);
    const sub = await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");
    expect(sub.status).toBe("active");
    expect(await container.wallet.balancePaise("res-demo")).toBe(200000 - 49900);
  });

  it("charges the difference and moves an upgrade at once", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 200000);
    await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");
    const before = await container.wallet.balancePaise("res-demo");

    const result = await container.subscriptions.changePlan("res-demo", "plan-standard");
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    // Proration is what an upgrade is for: pay the difference for the days left of
    // this cycle, and have the better plan for them.
    expect(result.quote.prorationPaise).toBeGreaterThan(0);
    expect(result.subscription.planId).toBe("plan-standard");
    expect(result.subscription.pendingPlanId).toBeNull();
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - result.quote.amountDuePaise);
  });

  it("blocks subscribing without enough balance", async () => {
    const container = await makeTestContainer();
    await expect(container.subscriptions.subscribe("res-broke", "plan-premium", "monthly"))
      .rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});
