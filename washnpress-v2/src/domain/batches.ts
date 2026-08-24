import type { CleanStage, OrderLine, ProcessingBatch, BatchStatus, BatchStep } from "./models";
import { CLEAN_STAGE_LABELS } from "./processing";

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
export function statusOf(batch: Pick<ProcessingBatch, "sequence" | "completedSteps" | "qcPassed">): BatchStatus {
  const next = nextStep(batch);
  if (next === null) return "completed";
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
  reason?: string,
): ProcessingBatch {
  const expected = nextStep(batch);
  if (expected !== "qc") throw new BatchNotReadyForQcError(expected ?? "qc");
  batch.qcAttempts += 1;
  batch.qcPassed = passed;
  batch.qcReason = passed ? null : reason ?? "Did not pass quality check";
  if (passed) {
    batch.completedSteps = [...batch.completedSteps, "qc"];
  } else {
    // A failed batch is reprocessed: it goes back to the step before the check and
    // has to pass QC again. Only that batch does — the others carry on.
    const redo = batch.sequence.filter((s) => s !== "qc").slice(-1)[0] ?? null;
    batch.completedSteps = redo ? batch.completedSteps.filter((s) => s !== redo) : batch.completedSteps;
  }
  batch.history = [...batch.history, {
    step: "qc", at: new Date().toISOString(), actorUserId,
    note: passed ? "Passed" : batch.qcReason,
  }];
  batch.status = statusOf(batch);
  return batch;
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
  inProgress: number;
  completed: number;
} {
  return {
    allComplete: batches.length > 0 && batches.every((b) => b.status === "completed"),
    anyFailed: batches.some((b) => b.status === "qc_failed"),
    inProgress: batches.filter((b) => b.status !== "completed").length,
    completed: batches.filter((b) => b.status === "completed").length,
  };
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
