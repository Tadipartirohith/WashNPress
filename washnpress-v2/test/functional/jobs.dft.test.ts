import { describe, it, expect } from "vitest";
import { makeTestContainer, seedSlot } from "./helpers";
import { addDaysIso } from "../../src/domain/subscriptions";

describe("DFT background jobs", () => {
  it("reconciliation credits a paid top up intent exactly once", async () => {
    const container = await makeTestContainer();
    // startTopUp records a pending intent; the fake provider reports it as paid.
    await container.wallet.startTopUp("res-demo", 250000);
    const first = await container.reconciliation.runOnce();
    expect(first.credited).toBe(1);
    expect(await container.wallet.balancePaise("res-demo")).toBe(250000);
    // Running again must not double credit.
    const second = await container.reconciliation.runOnce();
    expect(second.credited).toBe(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(250000);
  });

  it("recurring generation books the next weekly occurrence", async () => {
    const container = await makeTestContainer();
    // A recurring pickup one week in the past, and a slot for the same window next week.
    const nextDate = addDaysIso(new Date().toISOString(), 0).slice(0, 10);
    await seedSlot(container, "slot-rec", 5);
    // Point the seeded slot at the target next date and window.
    const slot = await container.store.slots.get("slot-rec");
    slot!.date = nextDate; slot!.window = "Morning";
    await container.store.slots.put(slot!);

    await container.store.pickups.put({
      id: "pk-rec", residentId: "res-demo", societyId: "soc-demo", slotId: "slot-rec",
      scheduledFor: addDaysIso(new Date().toISOString(), -7), status: "completed",
      recurring: true, recurringDays: [1], specialInstructions: null,
    });

    const r = await container.recurring.generateUpcoming(new Date());
    expect(r.created).toBe(1);
  });
});
