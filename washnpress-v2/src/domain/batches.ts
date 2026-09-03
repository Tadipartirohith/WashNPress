import type { CleanStage, OrderLine, ProcessingBatch, BatchStatus, BatchStep } from "./models";
import { CLEAN_STAGE_LABELS } from "./processing";
import {
  planCorrection, assertQcFailure, QcFailureIncompleteError,
  type QcFailureReason, type QcFailureOutcome,
} from "./qc";

// A processing batch is one Garment + Service combination, handled on its own.
//
// Two shirts sent for washing and ironing and two more sent for dry cleaning are not
// four shirts: they are two batches that go through different machines, take
// different times and cost different amounts. Merging them because the garment type
// matched is how a dry-clean-only garment ended up in a wash, and how an additional
// garment was billed at a rate belonging to a service nobody chose.
//
// Batches run in parallel — one can finish while another is still washing — but the
// steps inside a batch are strictly sequential, because you cannot iron a shirt you
// have not finished washing.

export const BATCH_STEP_LABELS: Record<BatchStep, string> = {
  wash: CLEAN_STAGE_LABELS.wash,
  dry_clean: CLEAN_STAGE_LABELS.dry_clean,
  premium: CLEAN_STAGE_LABELS.premium,
  iron: "Ironing",
  qc: "Quality Check",
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  awaiting_qc: "Awaiting QC",
  qc_failed: "QC Failed",
  held: "Held for review",
  completed: "Completed",
};

// What this batch has to go through, in the order it has to happen. Derived from the
// service the resident actually chose, so the batch is never offered a stage its
// garments do not need and never skips one they do.
export function sequenceFor(line: Pick<OrderLine, "requiresClean" | "cleanStage" | "requiresPress">): BatchStep[] {
  const steps: BatchStep[] = [];
  if (line.requiresClean) steps.push(cleanStep(line.cleanStage));
  if (line.requiresPress) steps.push("iron");
  // Every batch is checked before it counts as done, whatever it went through.
  steps.push("qc");
  return steps;
}

function cleanStep(stage: CleanStage): BatchStep {
  return stage === "dry_clean" ? "dry_clean" : stage === "premium" ? "premium" : "wash";
}

// The step this batch is waiting to have done. Null when there is nothing left.
export function nextStep(batch: Pick<ProcessingBatch, "sequence" | "completedSteps">): BatchStep | null {
  return batch.sequence.find((step) => !batch.completedSteps.includes(step)) ?? null;
}

// What the batch's status follows from. Status is derived rather than set, so it
// cannot disagree with the steps that have actually been recorded.
export function statusOf(batch: Pick<ProcessingBatch, "sequence" | "completedSteps" | "qcPassed" | "heldFor">): BatchStatus {
  const next = nextStep(batch);
  if (next === null) return "completed";
  // Held for a person rather than for a machine: a missing garment is not going to be
  // produced by another wash, so the batch waits rather than pretending to be in one.
  if (batch.heldFor) return "held";
  if (batch.qcPassed === false) return "qc_failed";
  if (next === "qc") return "awaiting_qc";
  return batch.completedSteps.length === 0 ? "pending" : "in_progress";
}

export class BatchStepOutOfOrderError extends Error {
  constructor(attempted: BatchStep, expected: BatchStep | null) {
    super(
      expected === null
        ? `This batch is finished; there is no ${BATCH_STEP_LABELS[attempted]} left to do.`
        : `This batch needs ${BATCH_STEP_LABELS[expected]} before ${BATCH_STEP_LABELS[attempted]}.`,
    );
    this.name = "BatchStepOutOfOrderError";
  }
}

export class BatchNotReadyForQcError extends Error {
  constructor(expected: BatchStep) {
    super(`This batch still needs ${BATCH_STEP_LABELS[expected]} before it can be checked.`);
    this.name = "BatchNotReadyForQcError";
  }
}

// Record a step as done. Refuses anything out of order, which is what keeps ironing
// from being marked complete on a batch that has not been washed.
export function completeStep(batch: ProcessingBatch, step: BatchStep, actorUserId: string | null, note?: string): ProcessingBatch {
  const expected = nextStep(batch);
  if (step !== expected) throw new BatchStepOutOfOrderError(step, expected);
  if (step === "qc") throw new BatchNotReadyForQcError("qc");
  batch.completedSteps = [...batch.completedSteps, step];
  batch.history = [...batch.history, { step, at: new Date().toISOString(), actorUserId, note: note ?? null }];
  batch.status = statusOf(batch);
  return batch;
}

// QC for one batch, once that batch's own processing is done. A batch does not wait
// for the rest of the order to catch up before it can be checked.
export function recordQc(
  batch: ProcessingBatch,
  passed: boolean,
  actorUserId: string | null,
  // A failure has to say why. The reason decides where the work goes back to, whether
  // a supervisor is involved and whether the resident hears about it — none of which
  // can be worked out from "failed".
  failure?: { reason: QcFailureReason; remarks: string; evidenceUrl?: string | null },
): { batch: ProcessingBatch; outcome: QcFailureOutcome | null } {
  const expected = nextStep(batch);
  if (expected !== "qc") throw new BatchNotReadyForQcError(expected ?? "qc");

  if (passed) {
    batch.qcAttempts += 1;
    batch.qcPassed = true;
    batch.qcReason = null;
    batch.heldFor = null;
    batch.completedSteps = [...batch.completedSteps, "qc"];
    batch.history = [...batch.history, {
      step: "qc", at: new Date().toISOString(), actorUserId, note: "Passed",
    }];
    batch.status = statusOf(batch);
    return { batch, outcome: null };
  }

  if (!failure) throw new QcFailureIncompleteError(["Choose the reason this failed."]);
  assertQcFailure(failure);

  // Where this particular failure sends the work. A stain that did not come out is
  // rewashed; a torn garment is not, because no amount of reprocessing will fix it.
  const outcome = planCorrection(batch, failure);
  const at = new Date().toISOString();

  batch.qcAttempts += 1;
  batch.qcPassed = false;
  batch.qcReason = `${outcome.reasonLabel}: ${outcome.remarks}`;
  batch.heldFor = outcome.correction.kind === "supervisor"
    ? "supervisor"
    : outcome.correction.kind === "investigate" ? "investigation" : null;

  // Only the step the failure actually points at is undone. A poor iron does not
  // send a batch back through the wash.
  if (outcome.correctiveStep) {
    batch.completedSteps = batch.completedSteps.filter((s) => s !== outcome.correctiveStep);
  }

  // Every attempt is kept. "Failed twice" is a different fact from "failed", and the
  // second one is the one a supervisor needs.
  batch.qcFailures = [...(batch.qcFailures ?? []), {
    attempt: outcome.attempt,
    reason: outcome.reason,
    reasonLabel: outcome.reasonLabel,
    remarks: outcome.remarks,
    evidenceUrl: outcome.evidenceUrl,
    correctiveStep: outcome.correctiveStep,
    correctiveLabel: outcome.correctiveLabel,
    serious: outcome.serious,
    at,
    actorUserId,
  }];

  batch.history = [...batch.history, {
    step: "qc", at, actorUserId,
    note: `Failed (${outcome.reasonLabel}): ${outcome.remarks}. ${outcome.correctiveLabel}.`,
  }];
  batch.status = statusOf(batch);
  return { batch, outcome };
}

// The batches an order needs, built from the lines the resident actually ordered and
// the quantities the operator actually received. A line received as nothing produces
// no batch, because there is nothing to process.
export function batchesForLines(
  lines: OrderLine[],
  quantityOf: (line: OrderLine) => number,
  idFor: (line: OrderLine, index: number) => string,
): ProcessingBatch[] {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => quantityOf(line) > 0)
    .map(({ line, index }) => {
      const sequence = sequenceFor(line);
      const batch: ProcessingBatch = {
        id: idFor(line, index),
        lineId: line.id,
        category: line.category,
        serviceId: line.serviceId,
        serviceName: line.serviceName,
        quantity: quantityOf(line),
        sequence,
        completedSteps: [],
        qcPassed: null,
        qcReason: null,
        qcAttempts: 0,
        qcFailures: [],
        heldFor: null,
        status: "pending",
        history: [],
      };
      batch.status = statusOf(batch);
      return batch;
    });
}

// Where the order as a whole has got to, given its batches. The order is processing
// while any batch still is, and only moves on when every batch has finished and
// passed. This is derived, so the order can never claim to be ready while a batch is
// still in a machine.
export function orderStageFromBatches(batches: ProcessingBatch[]): {
  allComplete: boolean;
  anyFailed: boolean;
  anyHeld: boolean;
  inProgress: number;
  completed: number;
} {
  return {
    // Every batch, not some of them. An order with three batches is not ready for
    // delivery because one of them finished.
    allComplete: batches.length > 0 && batches.every((b) => b.status === "completed"),
    anyFailed: batches.some((b) => b.status === "qc_failed"),
    // Waiting on a person rather than on a machine.
    anyHeld: batches.some((b) => b.status === "held"),
    inProgress: batches.filter((b) => b.status !== "completed").length,
    completed: batches.filter((b) => b.status === "completed").length,
  };
}

const CLEAN_STEPS: BatchStep[] = ["wash", "dry_clean", "premium"];

// The order-level stage an order in mid-processing is showing, read from where its
// batches actually are. Least-advanced first: an order is washing while any batch
// still needs washing, ironing once the washing is done and something still needs the
// iron, and at the checks once everything is washed and ironed and only QC remains.
//
// Null when there is no in-flight batch to read — every batch complete, or none
// started — because those are the ends the caller decides on its own (ready, or still
// at pickup). This exists so an order being worked through its batches shows in the
// operator's Active list under the stage it is at, rather than sitting at Picked Up
// until the whole order either fails or finishes.
export function intermediateStageFromBatches(
  batches: ProcessingBatch[],
): "in_wash" | "ironing" | "qc" | null {
  const pending = batches
    .filter((b) => b.status !== "completed")
    .map((b) => nextStep(b))
    .filter((step): step is BatchStep => step !== null);
  if (pending.length === 0) return null;
  if (pending.some((step) => CLEAN_STEPS.includes(step))) return "in_wash";
  if (pending.some((step) => step === "iron")) return "ironing";
  if (pending.some((step) => step === "qc")) return "qc";
  return null;
}

// How a batch reads to the person working it.
export function describeBatch(batch: ProcessingBatch) {
  const next = nextStep(batch);
  return {
    ...batch,
    statusLabel: BATCH_STATUS_LABELS[batch.status],
    sequenceLabels: batch.sequence.map((step) => BATCH_STEP_LABELS[step]),
    currentStep: next,
    currentStepLabel: next ? BATCH_STEP_LABELS[next] : null,
    steps: batch.sequence.map((step) => ({
      step,
      label: BATCH_STEP_LABELS[step],
      done: batch.completedSteps.includes(step),
      current: step === next,
    })),
  };
}
