import { describe, it, expect } from "vitest";
import { makeTestContainer, seedSlot, openSlotNow, OPERATOR } from "./helpers";

async function book(container: Awaited<ReturnType<typeof makeTestContainer>>, slotId: string) {
  await seedSlot(container, slotId, 5);
  const r = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId });
  // Booked for a future slot, then collected once that slot has started, which is
  // the order things happen in outside a test as well.
  await openSlotNow(container, slotId);
  return r.order.id;
}

describe("DFT order lifecycle", () => {
  it("runs the full happy path from booking to delivered", async () => {
    const container = await makeTestContainer();
    const id = await book(container, "slot-life-1");
    await container.orders.markPickedUp(id, [{ category: "Shirts", quantity: 3 }, { category: "Trousers", quantity: 2 }], OPERATOR);
    await container.orders.startWash(id, OPERATOR);
    await container.orders.completeWash(id, OPERATOR);
    await container.orders.startIroning(id, OPERATOR);
    await container.orders.completeIroning(id, OPERATOR);
    await container.orders.submitQc(id, true, undefined, OPERATOR);
    await container.orders.outForDelivery(id, OPERATOR);
    const delivered = await container.orders.deliver(id, 5, undefined, OPERATOR);
    expect(delivered.state).toBe("delivered");
    expect(delivered.qrBatchCode).toMatch(/^WNP-/);
    expect(delivered.acceptedCount).toBe(5);
    expect(delivered.deliveredByUserId).toBe(OPERATOR.userId);
  });

  it("opens an issue automatically on a QC fail and requires a second QC pass", async () => {
    const container = await makeTestContainer();
    const id = await book(container, "slot-life-2");
    await container.orders.markPickedUp(id, [{ category: "Shirts", quantity: 2 }], OPERATOR);
    await container.orders.advanceStage(id, "in_wash", OPERATOR);
    await container.orders.advanceStage(id, "ironing", OPERATOR);
    await container.orders.advanceStage(id, "qc", OPERATOR);
    const held = await container.orders.submitQc(id, false, "stain not removed", OPERATOR);
    expect(held.state).toBe("qc_hold");
    const tickets = await container.store.tickets.find((t) => t.category === "qc_fail");
    expect(tickets).toHaveLength(1);

    // A held batch cannot jump straight to ready: it goes back through processing.
    await expect(container.orders.submitQc(id, true, undefined, OPERATOR)).rejects.toThrow(/Illegal order transition/);
    await container.orders.reprocess(id, "in_wash", OPERATOR);
    await container.orders.completeWash(id, OPERATOR);
    await container.orders.completeIroning(id, OPERATOR);
    const ready = await container.orders.submitQc(id, true, undefined, OPERATOR);
    expect(ready.state).toBe("ready_for_delivery");
    expect(ready.qcAttempts).toBe(2);
  });

  it("blocks delivery on a count mismatch until a reason is given", async () => {
    const container = await makeTestContainer();
    const id = await book(container, "slot-life-3");
    await container.orders.markPickedUp(id, [{ category: "Shirts", quantity: 5 }], OPERATOR);
    await container.orders.advanceStage(id, "in_wash", OPERATOR);
    await container.orders.advanceStage(id, "ironing", OPERATOR);
    await container.orders.advanceStage(id, "qc", OPERATOR);
    await container.orders.submitQc(id, true, undefined, OPERATOR);
    await container.orders.outForDelivery(id, OPERATOR);
    await expect(container.orders.deliver(id, 4, undefined, OPERATOR)).rejects.toThrow(/discrepancy/);
    const delivered = await container.orders.deliver(id, 4, "one shirt held for restain", OPERATOR);
    expect(delivered.state).toBe("delivered");
    const tickets = await container.store.tickets.find((t) => t.category === "garment_quantity_mismatch");
    expect(tickets).toHaveLength(1);
  });

  it("keeps a failed pickup visible instead of dropping the order", async () => {
    const container = await makeTestContainer();
    const id = await book(container, "slot-life-4");
    const failed = await container.orders.failPickup(id, "Resident unavailable", OPERATOR);
    expect(failed.state).toBe("pickup_failed");
    expect(failed.pickupFailureReason).toBe("Resident unavailable");
    const stillThere = await container.store.orders.get(id);
    expect(stillThere).not.toBeNull();
    const issues = await container.store.tickets.find((t) => t.category === "pickup_failed");
    expect(issues).toHaveLength(1);
  });
});
