import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp } from "./helpers";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";
import { buildTransaction } from "../../src/domain/ledger";
import { SYSTEM_CONFIG_ID } from "../../src/services/system-config-service";

// GST applies to a subscription on the same terms as a garment charge: exclusive,
// added on top, held in TaxPayable apart from revenue, and reported beside it. Off
// by default, so a subscription costs exactly its plan price until an admin switches
// GST on. Basic is 49,900 paise a month; 18% GST on it is 8,982.

describe("DFT GST on a subscription charge", () => {
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];

  beforeEach(async () => {
    ({ container } = await makeTestApp());
  });

  async function enableGst(ratePercent = 18) {
    const config = await container.systemConfig.get();
    await container.store.systemConfig.put({ ...config, id: SYSTEM_CONFIG_ID, gstEnabled: true, gstRatePercent: ratePercent });
  }

  async function fundWallet(residentId: string, paise: number) {
    await container.store.ledger.post(buildTransaction({
      id: `fund-${residentId}-${Date.now()}`,
      reference: `fund-${residentId}`,
      entries: [
        { account: Account.GatewayClearing, direction: "debit", amount: paise },
        { account: walletAccount(residentId), direction: "credit", amount: paise },
      ],
      at: new Date(),
    }));
  }

  it("takes the plan price plus tax, and holds the tax in TaxPayable", async () => {
    await enableGst(18);
    await fundWallet("res-demo", 100000);
    const before = await container.wallet.balancePaise("res-demo");

    await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");

    // 49,900 + 18% (8,982) = 58,882 left the wallet.
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - 58882);

    const ledger = await container.store.ledger.all();
    const credited = (account: string) => ledger.flatMap((t) => t.entries)
      .filter((e) => e.account === account && e.direction === "credit")
      .reduce((s, e) => s + e.amount, 0);
    expect(credited(Account.SubscriptionRevenue)).toBe(49900);
    expect(credited(Account.TaxPayable)).toBe(8982);
  });

  it("reports the subscription tax beside the revenue, not folded into it", async () => {
    await enableGst(18);
    await fundWallet("res-demo", 100000);
    await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");

    const report = await container.revenue.report({ preset: "all" });
    expect(report.summary.subscriptionRevenuePaise).toBe(49900);
    expect(report.summary.taxCollectedPaise).toBe(8982);
    expect(report.summary.cgstPaise + report.summary.sgstPaise).toBe(8982);
    // Revenue is the pre-tax figure; the tax is reported separately.
    expect(report.summary.totalRevenuePaise).toBe(49900);
  });

  it("costs exactly the plan price when GST is off", async () => {
    await fundWallet("res-demo", 100000);
    const before = await container.wallet.balancePaise("res-demo");
    await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - 49900);
    const report = await container.revenue.report({ preset: "all" });
    expect(report.summary.taxCollectedPaise).toBe(0);
  });

  it("does not double-count order tax and subscription tax", async () => {
    await enableGst(18);
    await fundWallet("res-demo", 200000);
    await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");

    // An order charge taxed the same period. Its tax must add to the subscription's,
    // not be swept up twice by the ledger-based subscription-tax count.
    await container.store.orders.put({
      id: "ord-sub-gst", orderCode: "ORD-SUB-GST", residentId: "res-demo", societyId: "soc-demo",
      state: "delivered", createdAt: new Date().toISOString(),
      servicesPaise: 10000, additionalChargePaise: 10000, additionalChargeStatus: "pending",
      assignedOperatorUserId: "user-op",
    } as never);
    await container.orders.payAdditionalCharge("ord-sub-gst");

    const report = await container.revenue.report({ preset: "all" });
    // 8,982 subscription tax + 1,800 order tax = 10,782, counted once each.
    expect(report.summary.taxCollectedPaise).toBe(10782);
  });
});
