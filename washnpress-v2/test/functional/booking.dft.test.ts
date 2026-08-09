import { describe, it, expect } from "vitest";
import { makeTestContainer, seedSlot } from "./helpers";
import { SlotUnavailableError } from "../../src/services/scheduling-service";

describe("DFT booking", () => {
  it("books a pickup and decrements capacity", async () => {
    const container = await makeTestContainer();
    await seedSlot(container, "slot-a", 2);
    const r = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-a" });
    expect(r.order.state).toBe("scheduled");
    expect(r.slot.capacityRemaining).toBe(1);
  });

  it("rejects a booking on a full slot", async () => {
    const container = await makeTestContainer();
    await seedSlot(container, "slot-b", 1);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-b" });
    await expect(container.scheduling.book({ residentId: "r2", societyId: "soc-demo", slotId: "slot-b" }))
      .rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("never oversells the last slot under concurrency", async () => {
    const container = await makeTestContainer();
    await seedSlot(container, "slot-c", 1);
    const results = await Promise.allSettled([
      container.scheduling.book({ residentId: "r1", societyId: "soc-demo", slotId: "slot-c" }),
      container.scheduling.book({ residentId: "r2", societyId: "soc-demo", slotId: "slot-c" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const slot = await container.store.slots.get("slot-c");
    expect(slot?.capacityRemaining).toBe(0);
  });
});
