import { describe, it, expect } from "vitest";
import {
  allowedNext, isAllowedNext, lifecycleFor, lineStages, orderRequirement,
} from "../../src/domain/processing";
import { timelineStages } from "../../src/domain/order-state-machine";
import type { OrderLine } from "../../src/domain/models";

// Only the fields the processing rules read. Prices and ids are irrelevant here.
type Req = Pick<OrderLine, "requiresClean" | "cleanStage" | "requiresPress">;

const washAndIron: Req = { requiresClean: true, cleanStage: "wash", requiresPress: true };
const washOnly: Req = { requiresClean: true, cleanStage: "wash", requiresPress: false };
const ironOnly: Req = { requiresClean: false, cleanStage: "wash", requiresPress: true };
const drycleanAndIron: Req = { requiresClean: true, cleanStage: "dry_clean", requiresPress: true };

describe("per garment processing", () => {
  it("takes the union of what the garments in the order need", () => {
    expect(orderRequirement([washOnly, ironOnly])).toEqual({
      requiresClean: true, cleanStage: "wash", requiresPress: true,
    });
  });

  it("names the cleaning stage after the most specialised service in the batch", () => {
    // A batch carrying both is physically handled as dry cleaning.
    expect(orderRequirement([washOnly, drycleanAndIron]).cleanStage).toBe("dry_clean");
    expect(orderRequirement([washOnly, washAndIron]).cleanStage).toBe("wash");
  });

  it("keeps the full wash and iron path for an order with no line detail", () => {
    // Orders booked before per line services must still be able to move.
    expect(orderRequirement([])).toEqual({ requiresClean: true, cleanStage: "wash", requiresPress: true });
  });

  describe("an Iron Only order", () => {
    const requirement = orderRequirement([ironOnly]);

    it("is never offered washing", () => {
      expect(allowedNext("picked_up", requirement)).toEqual(["ironing"]);
      expect(isAllowedNext("picked_up", "in_wash", requirement)).toBe(false);
    });

    it("goes from ironing straight to quality check", () => {
      expect(allowedNext("ironing", requirement)).toEqual(["qc"]);
    });

    it("cannot be sent back to washing when quality check holds it", () => {
      expect(allowedNext("qc_hold", requirement)).toEqual(["ironing", "disputed"]);
    });

    it("shows the resident a timeline with no washing step in it", () => {
      expect(lifecycleFor(requirement)).toEqual([
        "scheduled", "picked_up", "ironing", "qc", "ready_for_delivery", "out_for_delivery", "delivered",
      ]);
      const stages = timelineStages("picked_up", ["scheduled", "picked_up"], lifecycleFor(requirement));
      expect(stages.map((s) => s.state)).not.toContain("in_wash");
    });
  });

  describe("a Wash Only order", () => {
    const requirement = orderRequirement([washOnly]);

    it("goes to washing and then straight to quality check", () => {
      expect(allowedNext("picked_up", requirement)).toEqual(["in_wash"]);
      expect(allowedNext("in_wash", requirement)).toEqual(["qc"]);
    });

    it("is never offered ironing", () => {
      expect(isAllowedNext("in_wash", "ironing", requirement)).toBe(false);
    });
  });

  describe("an order that needs both", () => {
    const requirement = orderRequirement([washAndIron]);

    it("must be washed before it can be ironed", () => {
      expect(allowedNext("picked_up", requirement)).toEqual(["in_wash"]);
      expect(isAllowedNext("picked_up", "ironing", requirement)).toBe(false);
    });

    it("cannot reach quality check until both stages are done", () => {
      expect(isAllowedNext("picked_up", "qc", requirement)).toBe(false);
      expect(isAllowedNext("in_wash", "qc", requirement)).toBe(false);
      expect(isAllowedNext("ironing", "qc", requirement)).toBe(true);
    });
  });

  describe("a mixed order", () => {
    // Four shirts dry cleaned and pressed, six ironed only.
    const requirement = orderRequirement([drycleanAndIron, ironOnly]);

    it("goes through every stage any of its garments needs", () => {
      expect(requirement).toEqual({ requiresClean: true, cleanStage: "dry_clean", requiresPress: true });
      expect(lifecycleFor(requirement)).toContain("in_wash");
      expect(lifecycleFor(requirement)).toContain("ironing");
    });

    it("labels the cleaning stage as dry cleaning for the resident", () => {
      const stages = timelineStages("in_wash", ["scheduled", "picked_up", "in_wash"], lifecycleFor(requirement), {
        in_wash: "Dry Cleaning",
      });
      expect(stages.find((s) => s.state === "in_wash")?.label).toBe("Dry Cleaning");
    });
  });

  it("lists what each individual line still has to go through", () => {
    expect(lineStages(ironOnly)).toEqual([{ key: "iron", label: "Ironing" }]);
    expect(lineStages(drycleanAndIron)).toEqual([
      { key: "dry_clean", label: "Dry Cleaning" },
      { key: "iron", label: "Ironing" },
    ]);
    expect(lineStages(washOnly)).toEqual([{ key: "wash", label: "Washing" }]);
  });
});
