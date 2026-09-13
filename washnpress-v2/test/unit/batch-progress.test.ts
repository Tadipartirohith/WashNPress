import { describe, it, expect } from "vitest";
import { batchProgressOf, batchProgressLabel } from "../../src/domain/batches";
import { overallStatusOf } from "../../src/domain/order-state-machine";
import type { BatchStatus, BatchStep, ProcessingBatch } from "../../src/domain/models";

// I-87. The Active card summarises an order that runs as several batches: how far each
// batch has got, and what the order as a whole is doing.

let n = 0;
const batch = (sequence: BatchStep[], completedSteps: BatchStep[], status: BatchStatus, extra: Partial<ProcessingBatch> = {}): ProcessingBatch => ({
  id: `b${(n += 1)}`, lineId: "l", category: "Shirts", serviceId: "s", serviceName: "Wash & Iron", quantity: 1,
  sequence, completedSteps, status, qcPassed: null, qcReason: null, qcAttempts: 0, history: [], ...extra,
}) as ProcessingBatch;

describe("the batch progress an order card shows", () => {
  it("counts each batch at the stage it is waiting on, Ready first", () => {
    // The example from the issue: one ready, one washing, one at the checks.
    const batches = [
      batch(["wash", "iron", "qc"], ["wash", "iron", "qc"], "completed"),
      batch(["wash", "qc"], [], "pending"),
      batch(["wash", "iron", "qc"], ["wash", "iron"], "awaiting_qc"),
    ];
    expect(batchProgressOf(batches)).toEqual([
      { label: "Ready", count: 1 }, { label: "Washing", count: 1 }, { label: "QC", count: 1 },
    ]);
    expect(batchProgressLabel(batches)).toBe("1 Ready · 1 Washing · 1 QC");
  });

  it("moves a batch on from Washing to Ironing when its washing is done", () => {
    expect(batchProgressLabel([batch(["wash", "iron", "qc"], ["wash"], "in_progress")])).toBe("1 Ironing");
  });

  it("never shows Ironing for a wash-only batch", () => {
    // Washed, and a wash-only batch has nothing left but the check.
    expect(batchProgressLabel([batch(["wash", "qc"], ["wash"], "awaiting_qc")])).toBe("1 QC");
  });

  it("names a failed check and a batch held for review", () => {
    const batches = [
      batch(["wash", "qc"], ["wash"], "qc_failed", { qcPassed: false }),
      batch(["wash", "qc"], ["wash"], "held", { heldFor: "supervisor" }),
      batch(["wash", "qc"], ["wash"], "qc_failed", { qcPassed: false }),
    ];
    expect(batchProgressLabel(batches)).toBe("2 QC Failed · 1 Held");
  });

  it("says nothing for an order that is not worked as batches", () => {
    expect(batchProgressOf([])).toEqual([]);
    expect(batchProgressLabel([])).toBeNull();
  });
});

describe("the overall status an order card shows", () => {
  it("is Processing for every stage between collection and ready", () => {
    // Never Ready because one batch is ready: an order in any of these still has work left.
    for (const state of ["in_wash", "ironing", "qc", "qc_hold"] as const) {
      expect(overallStatusOf(state)).toEqual({ key: "processing", label: "Processing" });
    }
  });

  it("keeps the ends of the journey by name", () => {
    expect(overallStatusOf("picked_up")?.label).toBe("Picked Up");
    expect(overallStatusOf("ready_for_delivery")?.label).toBe("Ready");
    expect(overallStatusOf("out_for_delivery")?.label).toBe("Out for Delivery");
    expect(overallStatusOf("delivered")?.label).toBe("Delivered");
  });

  it("has nothing to say about an order that is not in the facility", () => {
    expect(overallStatusOf("scheduled")).toBeNull();
    expect(overallStatusOf("cancelled")).toBeNull();
  });
});
