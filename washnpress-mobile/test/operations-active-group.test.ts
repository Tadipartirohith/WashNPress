import { describe, it, expect } from "vitest";
import {
  operatorStageDestination, resolveActiveGroup,
} from "../src/portals/operations-active-group";

describe("dashboard stage → Active group", () => {
  it("sends Scheduled to Pickups, the same as Web Today's Work", () => {
    expect(operatorStageDestination("scheduled")).toEqual({ tab: "pickups" });
  });

  it("maps each pipeline stage to the Web Active group", () => {
    expect(operatorStageDestination("picked_up")).toEqual({ tab: "active", group: "pickedUp" });
    expect(operatorStageDestination("in_wash")).toEqual({ tab: "active", group: "washing" });
    expect(operatorStageDestination("ironing")).toEqual({ tab: "active", group: "ironing" });
    expect(operatorStageDestination("qc")).toEqual({ tab: "active", group: "qc" });
    expect(operatorStageDestination("qc_hold")).toEqual({ tab: "active", group: "qcFailed" });
    expect(operatorStageDestination("ready_for_delivery")).toEqual({ tab: "active", group: "readyForDelivery" });
    expect(operatorStageDestination("out_for_delivery")).toEqual({ tab: "active", group: "outForDelivery" });
  });

  it("accepts the Web tile ids and attention keys as well", () => {
    expect(operatorStageDestination("pickedUp").group).toBe("pickedUp");
    expect(operatorStageDestination("washing").group).toBe("washing");
    expect(operatorStageDestination("qcPending").group).toBe("qc");
    expect(operatorStageDestination("qcFailed").group).toBe("qcFailed");
    expect(operatorStageDestination("ready").group).toBe("readyForDelivery");
  });

  it("opens Active on All when the source is not a stage", () => {
    expect(operatorStageDestination("issues")).toEqual({ tab: "active" });
    expect(operatorStageDestination(undefined)).toEqual({ tab: "active" });
  });

  it("keeps an unknown group off the Active tabs so first load still works", () => {
    expect(resolveActiveGroup("pickedUp")).toBe("pickedUp");
    expect(resolveActiveGroup("all")).toBe("all");
    expect(resolveActiveGroup("picked_up")).toBe("all");
    expect(resolveActiveGroup(undefined)).toBe("all");
  });
});
