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

  it("computes proration on an upgrade and defers to next cycle", async () => {
    const container = await makeTestContainer();
    await fund(container, "res-demo", 200000);
    await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");
    const result = await container.subscriptions.changePlan("res-demo", "plan-standard");
    expect(result.subscription.pendingPlanId).toBe("plan-standard");
    expect(result.prorationPaise).toBeGreaterThan(0);
  });

  it("blocks subscribing without enough balance", async () => {
    const container = await makeTestContainer();
    await expect(container.subscriptions.subscribe("res-broke", "plan-premium", "monthly"))
      .rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});
