import { describe, it, expect } from "vitest";
import { orderWashIronAction, washIronEndpoint } from "../src/portals/operations-wash-iron-rules";

const washPress = { requiresClean: true, requiresPress: true, cleanLabel: "Washing" };
const ironOnly = { requiresClean: false, requiresPress: true, cleanLabel: "Washing" };
const dryClean = { requiresClean: true, requiresPress: true, cleanLabel: "Dry cleaning" };

describe("order-level wash / iron matches Web LegacyStageControls", () => {
  it("starts wash from picked_up when the order needs cleaning", () => {
    const action = orderWashIronAction({ state: "picked_up", processing: washPress });
    expect(action).toEqual({ kind: "startWash", label: "Start Washing" });
    expect(washIronEndpoint(action!.kind, "ord-1")).toEqual({
      method: "POST",
      path: "/v1/operations/orders/ord-1/wash/start",
      body: undefined,
    });
  });

  it("starts ironing from picked_up when there is no clean stage", () => {
    expect(orderWashIronAction({ state: "picked_up", processing: ironOnly }))
      .toEqual({ kind: "startIroning", label: "Start Ironing" });
  });

  it("completes wash from in_wash, using the clean label", () => {
    const action = orderWashIronAction({ state: "in_wash", processing: dryClean });
    expect(action).toEqual({ kind: "completeWash", label: "Complete Dry cleaning" });
    expect(washIronEndpoint("completeWash", "ord-2").path)
      .toBe("/v1/operations/orders/ord-2/wash/complete");
  });

  it("starts then completes ironing from the ironing state", () => {
    expect(orderWashIronAction({ state: "ironing", ironingStarted: false, processing: washPress }))
      .toEqual({ kind: "startIroning", label: "Start Ironing" });
    expect(orderWashIronAction({ state: "ironing", ironingStarted: true, processing: washPress }))
      .toEqual({ kind: "completeIroning", label: "Complete Ironing" });
    expect(washIronEndpoint("startIroning", "ord-3").path)
      .toBe("/v1/operations/orders/ord-3/ironing/start");
    expect(washIronEndpoint("completeIroning", "ord-3").path)
      .toBe("/v1/operations/orders/ord-3/ironing/complete");
  });

  it("never uses POST /advance or a { to } body", () => {
    for (const kind of ["startWash", "completeWash", "startIroning", "completeIroning"] as const) {
      const call = washIronEndpoint(kind, "ord-9");
      expect(call.path).not.toContain("/advance");
      expect(call.body).toBeUndefined();
    }
  });

  it("offers no wash/iron action on QC or delivery", () => {
    expect(orderWashIronAction({ state: "qc", processing: washPress })).toBeNull();
    expect(orderWashIronAction({ state: "ready_for_delivery", processing: washPress })).toBeNull();
  });
});
