import { describe, it, expect } from "vitest";
import { transition, canTransition } from "../../src/domain/order-state-machine";

describe("order state machine", () => {
  it("allows a legal transition", () => {
    expect(canTransition("scheduled", "picked_up")).toBe(true);
    expect(transition("scheduled", "picked_up")).toBe("picked_up");
  });
  it("blocks an illegal transition", () => {
    expect(canTransition("scheduled", "delivered")).toBe(false);
    expect(() => transition("scheduled", "delivered")).toThrow(/Illegal/);
  });
  it("requires QC to pass before ready for delivery", () => {
    expect(() => transition("qc", "ready_for_delivery", { qcPassed: false })).toThrow(/Quality check/);
    expect(transition("qc", "ready_for_delivery", { qcPassed: true })).toBe("ready_for_delivery");
  });
  it("requires a discrepancy reason when delivery count mismatches", () => {
    expect(() => transition("out_for_delivery", "delivered", { pickupCount: 5, deliveryCount: 4 })).toThrow(/discrepancy/);
    expect(transition("out_for_delivery", "delivered", { pickupCount: 5, deliveryCount: 4, discrepancyReason: "one shirt held for restain" })).toBe("delivered");
    expect(transition("out_for_delivery", "delivered", { pickupCount: 5, deliveryCount: 5 })).toBe("delivered");
  });
});
