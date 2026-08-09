import { describe, it, expect } from "vitest";
import { makeTestContainer, seedSlot } from "./helpers";

async function book(container: Awaited<ReturnType<typeof makeTestContainer>>, slotId: string) {
  await seedSlot(container, slotId, 5);
  const r = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId });
  return r.order.id;
}

describe("DFT order lifecycle", () => {
  it("runs the full happy path from booking to delivered", async () => {
    const container = await makeTestContainer();
    const id = await book(container, "slot-life-1");
    await container.orders.markPickedUp(id, [{ category: "Shirts", quantity: 3 }, { category: "Trousers", quantity: 2 }]);
    await container.orders.advanceStage(id, "in_wash");
    await container.orders.advanceStage(id, "ironing");
    await container.orders.advanceStage(id, "qc");
    await container.orders.submitQc(id, true);
    await container.orders.outForDelivery(id);
    const delivered = await container.orders.deliver(id, 5);
    expect(delivered.state).toBe("delivered");
    expect(delivered.qrBatchCode).toMatch(/^WNP-/);
  });

  it("opens a support ticket automatically on a QC fail", async () => {
    const container = await makeTestContainer();
    const id = await book(container, "slot-life-2");
    await container.orders.markPickedUp(id, [{ category: "Shirts", quantity: 2 }]);
    await container.orders.advanceStage(id, "in_wash");
    await container.orders.advanceStage(id, "ironing");
    await container.orders.advanceStage(id, "qc");
    const held = await container.orders.submitQc(id, false, "stain not removed");
    expect(held.state).toBe("qc_hold");
    const tickets = await container.store.tickets.find((t) => t.category === "qc_fail");
    expect(tickets).toHaveLength(1);
  });

  it("blocks delivery on a count mismatch until a reason is given", async () => {
    const container = await makeTestContainer();
    const id = await book(container, "slot-life-3");
    await container.orders.markPickedUp(id, [{ category: "Shirts", quantity: 5 }]);
    await container.orders.advanceStage(id, "in_wash");
    await container.orders.advanceStage(id, "ironing");
    await container.orders.advanceStage(id, "qc");
    await container.orders.submitQc(id, true);
    await container.orders.outForDelivery(id);
    await expect(container.orders.deliver(id, 4)).rejects.toThrow(/discrepancy/);
    const delivered = await container.orders.deliver(id, 4, "one shirt held for restain");
    expect(delivered.state).toBe("delivered");
    const tickets = await container.store.tickets.find((t) => t.category === "delivery_discrepancy");
    expect(tickets).toHaveLength(1);
  });
});
