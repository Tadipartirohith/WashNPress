import { describe, it, expect } from "vitest";
import type { ProcessingBatch } from "../../src/domain/models";
import {
  qcFailureProblems, planCorrection, evidenceRequired, isSerious, notifiesResident,
  isRepeatedFailure, QC_FAILURE_REASONS, QC_REASON_LABELS,
} from "../../src/domain/qc";
import { recordQc, statusOf, orderStageFromBatches } from "../../src/domain/batches";

// A QC failure used to mean one thing: redo the last step before the check. That is
// right for a stain that did not come out and wrong for everything else. A garment
// that is not in the bag does not need washing again — it needs somebody to find it.
// QC is a checkpoint, not a reason to restart the order.

function batch(over: Partial<ProcessingBatch> = {}): ProcessingBatch {
  return {
    id: "b1", lineId: "l1", category: "Shirts", serviceId: "wash_iron", serviceName: "Wash and Iron",
    quantity: 4, sequence: ["wash", "iron", "qc"], completedSteps: ["wash", "iron"],
    qcPassed: null, qcReason: null, qcAttempts: 0, qcFailures: [], heldFor: null,
    status: "awaiting_qc", history: [],
    ...over,
  } as ProcessingBatch;
}

describe("a failure has to say enough to be acted on", () => {
  it("wants a reason from the list", () => {
    expect(qcFailureProblems({})).toContain("Choose the reason this failed.");
    expect(qcFailureProblems({ reason: "made_up", remarks: "x" })).toContain("Choose the reason this failed.");
  });

  it("wants remarks", () => {
    expect(qcFailureProblems({ reason: "poor_ironing" })).toContain("Say what went wrong.");
    expect(qcFailureProblems({ reason: "poor_ironing", remarks: "  " })).toContain("Say what went wrong.");
    expect(qcFailureProblems({ reason: "poor_ironing", remarks: "Creased at the collar" })).toEqual([]);
  });

  it("wants a photograph where the failure is a claim about the garment", () => {
    // "It is torn" is an assertion somebody will be asked to stand behind.
    expect(evidenceRequired("garment_damage")).toBe(true);
    expect(evidenceRequired("missing_garment")).toBe(true);
    expect(evidenceRequired("wrong_garment")).toBe(true);
    // The quality of the work is judged by looking at it again, not by a photo.
    expect(evidenceRequired("poor_ironing")).toBe(false);

    expect(qcFailureProblems({ reason: "garment_damage", remarks: "Small tear" }))
      .toContain("Garment damage needs a photograph.");
    expect(qcFailureProblems({ reason: "garment_damage", remarks: "Small tear", evidenceUrl: "photo.jpg" }))
      .toEqual([]);
  });

  it("names every problem at once", () => {
    const problems = qcFailureProblems({ reason: "wrong_garment" });
    expect(problems.length).toBe(2);
  });
});

describe("where the work goes back to", () => {
  it("rewashes a washing fault", () => {
    const plan = planCorrection(batch(), { reason: "stain_not_removed", remarks: "Collar still marked" });
    expect(plan.correctiveStep).toBe("wash");
    expect(plan.correctiveLabel).toBe("Back to wash");
  });

  it("re-irons an ironing fault rather than sending it through the wash", () => {
    const plan = planCorrection(batch(), { reason: "poor_ironing", remarks: "Creased" });
    expect(plan.correctiveStep).toBe("iron");
  });

  it("sends a cleaning fault on a dry-cleaning batch back to the dry cleaning", () => {
    const dry = batch({ sequence: ["dry_clean", "iron", "qc"], completedSteps: ["dry_clean", "iron"] });
    const plan = planCorrection(dry, { reason: "stain_not_removed", remarks: "Mark remains" });
    expect(plan.correctiveStep).toBe("dry_clean");
  });

  it("sends an ironing fault on a batch that is not ironed to the step it does have", () => {
    const washOnly = batch({ sequence: ["wash", "qc"], completedSteps: ["wash"] });
    const plan = planCorrection(washOnly, { reason: "poor_ironing", remarks: "Creased" });
    expect(plan.correctiveStep).toBe("wash");
  });

  it("sends nothing back to a machine for a garment that is not there", () => {
    // Nothing in a machine will produce a garment that is missing.
    const plan = planCorrection(batch(), { reason: "missing_garment", remarks: "Only 3 of 4 in the bag" });
    expect(plan.correctiveStep).toBeNull();
    expect(plan.correction.kind).toBe("investigate");
    expect(plan.correctiveLabel).toBe("Held for investigation");
  });

  it("sends a damaged garment to a supervisor", () => {
    const plan = planCorrection(batch(), { reason: "garment_damage", remarks: "Small tear", evidenceUrl: "photo.jpg" });
    expect(plan.correction.kind).toBe("supervisor");
    expect(plan.correctiveLabel).toBe("Held for supervisor review");
  });
});

describe("who hears about it", () => {
  it("tells the resident only when it touches their garments", () => {
    // A shirt needing another pass of the iron is not news.
    expect(notifiesResident("poor_ironing")).toBe(false);
    expect(notifiesResident("stain_not_removed")).toBe(false);
    expect(notifiesResident("garment_damage")).toBe(true);
    expect(notifiesResident("missing_garment")).toBe(true);
  });

  it("involves a supervisor for anything serious", () => {
    expect(planCorrection(batch(), { reason: "garment_damage", remarks: "Torn", evidenceUrl: "p.jpg" }).needsSupervisor).toBe(true);
    expect(planCorrection(batch(), { reason: "poor_ironing", remarks: "Creased" }).needsSupervisor).toBe(false);
  });

  it("involves a supervisor once a batch has failed more than once", () => {
    // Repeated failures are a different problem from a first one and are not fixed by
    // retrying again.
    const again = batch({ qcAttempts: 1 });
    const plan = planCorrection(again, { reason: "poor_ironing", remarks: "Still creased" });
    expect(plan.attempt).toBe(2);
    expect(plan.needsSupervisor).toBe(true);
    expect(isRepeatedFailure({ qcAttempts: 2 })).toBe(true);
  });

  it("every reason has a label and a correction", () => {
    for (const reason of QC_FAILURE_REASONS) {
      expect(QC_REASON_LABELS[reason]).toBeTruthy();
      expect(planCorrection(batch(), { reason, remarks: "x", evidenceUrl: "p.jpg" }).correctiveLabel).toBeTruthy();
    }
  });
});

describe("recording it on the batch", () => {
  it("undoes only the step the failure points at", () => {
    const b = batch();
    const { batch: after } = recordQc(b, false, "user-op", { reason: "stain_not_removed", remarks: "Collar marked" });
    // The wash is undone; the ironing is not, because ironing was not the problem.
    expect(after.completedSteps).toEqual(["iron"]);
    expect(after.status).toBe("qc_failed");
  });

  it("undoes the iron and leaves the wash for an ironing fault", () => {
    const { batch: after } = recordQc(batch(), false, "user-op", { reason: "poor_ironing", remarks: "Creased" });
    expect(after.completedSteps).toEqual(["wash"]);
  });

  it("holds a batch rather than pretending it is back in a machine", () => {
    const { batch: after } = recordQc(batch(), false, "user-op", {
      reason: "missing_garment", remarks: "Only 3 of 4", evidenceUrl: "photo.jpg",
    });
    expect(after.heldFor).toBe("investigation");
    expect(after.status).toBe("held");
    // Nothing was undone, because there is nothing to redo.
    expect(after.completedSteps).toEqual(["wash", "iron"]);
  });

  it("keeps every attempt rather than overwriting the last", () => {
    let b = batch();
    ({ batch: b } = recordQc(b, false, "user-op", { reason: "stain_not_removed", remarks: "Marked" }));
    b.completedSteps = ["wash", "iron"]; // reworked and back at the check
    ({ batch: b } = recordQc(b, false, "user-op", { reason: "stain_not_removed", remarks: "Still marked" }));
    expect(b.qcFailures).toHaveLength(2);
    expect(b.qcFailures!.map((f) => f.attempt)).toEqual([1, 2]);
    expect(b.qcFailures![1].remarks).toBe("Still marked");
    expect(b.qcAttempts).toBe(2);
  });

  it("says on the record what happened and where it went", () => {
    const { batch: after } = recordQc(batch(), false, "user-op", { reason: "poor_ironing", remarks: "Creased" });
    expect(after.qcReason).toBe("Poor ironing: Creased");
    expect(after.history[after.history.length - 1].note).toMatch(/Back to iron/);
  });

  it("refuses a failure that does not say why", () => {
    expect(() => recordQc(batch(), false, "user-op")).toThrow(/reason/i);
    expect(() => recordQc(batch(), false, "user-op", { reason: "poor_ironing", remarks: "" })).toThrow();
  });

  it("clears a hold when the batch finally passes", () => {
    let b = batch();
    ({ batch: b } = recordQc(b, false, "user-op", { reason: "garment_damage", remarks: "Torn", evidenceUrl: "p.jpg" }));
    expect(b.heldFor).toBe("supervisor");
    ({ batch: b } = recordQc(b, true, "user-sup"));
    expect(b.heldFor).toBeNull();
    expect(b.status).toBe("completed");
  });
});

describe("the order follows its batches", () => {
  const done = () => batch({ id: "done", completedSteps: ["wash", "iron", "qc"], qcPassed: true, status: "completed" });

  it("is not complete while any batch is unfinished", () => {
    const stage = orderStageFromBatches([done(), batch({ id: "b2" })]);
    expect(stage.allComplete).toBe(false);
    expect(stage.completed).toBe(1);
  });

  it("is complete only when every batch is", () => {
    // An order with three batches is not ready for delivery because one finished.
    expect(orderStageFromBatches([done(), done(), done()]).allComplete).toBe(true);
  });

  it("says when a batch is held, which is not the same as failed", () => {
    const held = batch({ id: "held", heldFor: "investigation" });
    held.status = statusOf(held);
    const stage = orderStageFromBatches([done(), held]);
    expect(stage.anyHeld).toBe(true);
    expect(stage.anyFailed).toBe(false);
    expect(stage.allComplete).toBe(false);
  });
});
