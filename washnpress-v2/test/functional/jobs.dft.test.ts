import { describe, it, expect } from "vitest";
import { makeTestContainer, seedSlot } from "./helpers";
import { addDaysIso } from "../../src/domain/subscriptions";
import { FakePaymentProvider } from "../../src/adapters/payments/fake-provider";
import { ReconciliationService } from "../../src/services/reconciliation-service";

describe("DFT background jobs", () => {
  it("reconciliation credits a paid top up intent exactly once", async () => {
    const container = await makeTestContainer();
    await container.wallet.startTopUp("res-demo", 250000);
    // A settled payment is asked for by name. This used to be what an unconfigured
    // deployment got for free — the fake provider answered "paid" to everything — so
    // the job invented a wallet balance every time it ran.
    const reconciliation = new ReconciliationService(container.store, new FakePaymentProvider({ status: "paid" }));
    const first = await reconciliation.runOnce();
    expect(first.credited).toBe(1);
    expect(await container.wallet.balancePaise("res-demo")).toBe(250000);
    // Running again must not double credit.
    const second = await reconciliation.runOnce();
    expect(second.credited).toBe(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(250000);
  });

  it("credits nothing when the deployment has no payment gateway configured", async () => {
    const container = await makeTestContainer();
    // Exactly the live proof: a top-up with no card, no checkout and no money moving.
    // With no Razorpay keys the container falls back to the fake provider, and the
    // reconciliation job runs every sixty seconds against it.
    await container.wallet.startTopUp("res-demo", 500000);
    const run = await container.reconciliation.runOnce();
    expect(run.checked).toBe(1);
    expect(run.credited).toBe(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(0);
    // And the intent is still pending, so a real settlement can still arrive.
    const [intent] = await container.store.paymentIntents.find((i) => i.residentId === "res-demo");
    expect(intent.status).toBe("pending");
  });

  it("recurring generation books the next weekly occurrence", async () => {
    const container = await makeTestContainer();
    // A recurring pickup six days back, so the next weekly occurrence falls tomorrow
    // rather than on a window that may already have closed today.
    const nextDate = addDaysIso(new Date().toISOString(), 1).slice(0, 10);
    await seedSlot(container, "slot-rec", 5);
    // Point the seeded slot at the target next date and window.
    const slot = await container.store.slots.get("slot-rec");
    slot!.date = nextDate; slot!.window = "Morning";
    await container.store.slots.put(slot!);

    await container.store.pickups.put({
      id: "pk-rec", residentId: "res-demo", societyId: "soc-demo", slotId: "slot-rec",
      scheduledFor: addDaysIso(new Date().toISOString(), -6), status: "completed",
      recurring: true, recurringDays: [1], specialInstructions: null,
    });

    const r = await container.recurring.generateUpcoming(new Date());
    expect(r.created).toBe(1);
  });
});
