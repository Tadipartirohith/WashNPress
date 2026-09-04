import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, loginResident } from "./helpers";
import { computeGst } from "../../src/domain/tax";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";
import { buildTransaction } from "../../src/domain/ledger";
import { SYSTEM_CONFIG_ID } from "../../src/services/system-config-service";

// GST, finished. A deployment is tax-free until an admin switches it on; when they
// do, the tax is exclusive — added on top of the listed price — split into CGST and
// SGST, recorded on the order, held in its own ledger account, and reported beside
// the revenue rather than inside it. Turned off, not a paisa of any figure moves.

describe("computeGst — the arithmetic in one place", () => {
  it("is a zero breakdown when GST is off, whatever the rate", () => {
    const off = computeGst(10000, { gstEnabled: false, gstRatePercent: 18 });
    expect(off).toMatchObject({ applied: false, taxPaise: 0, cgstPaise: 0, sgstPaise: 0, grossPaise: 10000 });
  });

  it("adds the rate on top and splits it into two equal halves", () => {
    const on = computeGst(10000, { gstEnabled: true, gstRatePercent: 18 });
    expect(on).toMatchObject({ applied: true, taxPaise: 1800, cgstPaise: 900, sgstPaise: 900, grossPaise: 11800 });
  });

  it("never loses or invents a paisa when the tax is odd", () => {
    const on = computeGst(101, { gstEnabled: true, gstRatePercent: 5 });
    // 5% of 101 = 5.05 -> 5 paise, split 2 + 3.
    expect(on.taxPaise).toBe(5);
    expect(on.cgstPaise + on.sgstPaise).toBe(on.taxPaise);
    expect(on.grossPaise).toBe(on.taxablePaise + on.taxPaise);
  });
});

describe("DFT GST on a settled order charge", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    await loginResident(app);
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

  async function anOrderOwing(paise: number) {
    const order = {
      id: "ord-gst-1", orderCode: "ORD-GST-1", residentId: "res-demo", societyId: "soc-demo",
      blockId: "block-demo-a", state: "delivered", createdAt: new Date().toISOString(),
      servicesPaise: paise, additionalChargePaise: paise, additionalChargeStatus: "pending",
      assignedOperatorUserId: "user-op",
    };
    await container.store.orders.put(order as never);
    return order.id;
  }

  it("charges the tax on top, records it on the order, and holds it in TaxPayable", async () => {
    await enableGst(18);
    await fundWallet("res-demo", 50000);
    const orderId = await anOrderOwing(10000);

    const before = await container.wallet.balancePaise("res-demo");
    const order = await container.orders.payAdditionalCharge(orderId);

    expect(order.additionalChargeStatus).toBe("paid");
    expect(order.taxPaise).toBe(1800);
    // The resident paid the charge and the tax: 11,800 left the wallet.
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - 11800);

    // The tax sits in its own account, apart from revenue.
    const ledger = await container.store.ledger.all();
    const taxCredits = ledger.flatMap((t) => t.entries)
      .filter((e) => e.account === Account.TaxPayable && e.direction === "credit")
      .reduce((s, e) => s + e.amount, 0);
    expect(taxCredits).toBe(1800);
    const revenueCredits = ledger.flatMap((t) => t.entries)
      .filter((e) => e.account === Account.AddonRevenue && e.direction === "credit")
      .reduce((s, e) => s + e.amount, 0);
    expect(revenueCredits).toBe(10000);
  });

  it("prints the two halves on the order invoice, and totals to what was paid", async () => {
    await enableGst(18);
    await fundWallet("res-demo", 50000);
    const orderId = await anOrderOwing(10000);
    await container.orders.payAdditionalCharge(orderId);

    const detail = await container.orders.detail((await container.store.orders.get(orderId))!);
    expect(detail.charges).toMatchObject({
      additionalChargePaise: 10000, taxPaise: 1800, cgstPaise: 900, sgstPaise: 900, totalPaise: 11800,
    });
  });

  it("reports tax collected beside the revenue, never folded into it", async () => {
    await enableGst(18);
    await fundWallet("res-demo", 50000);
    const orderId = await anOrderOwing(10000);
    await container.orders.payAdditionalCharge(orderId);

    const report = await container.revenue.report({ preset: "all" });
    expect(report.summary.orderRevenuePaise).toBe(10000);
    expect(report.summary.taxCollectedPaise).toBe(1800);
    expect(report.summary.cgstPaise).toBe(900);
    expect(report.summary.sgstPaise).toBe(900);
    // The headline total is revenue, not revenue-plus-tax.
    expect(report.summary.totalRevenuePaise).toBe(10000);
  });

  it("leaves every figure untouched when GST is off", async () => {
    // No enableGst here: the platform is tax-free, which is the default.
    await fundWallet("res-demo", 50000);
    const orderId = await anOrderOwing(10000);
    const order = await container.orders.payAdditionalCharge(orderId);
    expect(order.taxPaise ?? 0).toBe(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(40000);
    const report = await container.revenue.report({ preset: "all" });
    expect(report.summary.taxCollectedPaise).toBe(0);
  });
});
