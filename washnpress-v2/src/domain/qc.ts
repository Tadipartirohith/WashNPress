import type { BatchStep, ProcessingBatch } from "./models";

// What happens when a batch fails its quality check.
//
// A failure used to mean one thing: redo the last step before the check. That is right
// for a stain that did not come out and wrong for everything else. A garment that came
// back with the wrong number in the bag does not need washing again — it needs
// somebody to find the missing one. A torn shirt does not need ironing again — it
// needs a supervisor. QC is a checkpoint, not a reason to restart the order.
//
// So a failure now says *why*, and the reason decides where the work goes back to.

export type QcFailureReason =
  | "stain_not_removed"
  | "improper_washing"
  | "poor_ironing"
  | "folding_issue"
  | "garment_damage"
  | "missing_garment"
  | "wrong_garment"
  | "packaging_issue"
  | "other";

export const QC_FAILURE_REASONS: QcFailureReason[] = [
  "stain_not_removed", "improper_washing", "poor_ironing", "folding_issue",
  "garment_damage", "missing_garment", "wrong_garment", "packaging_issue", "other",
];

export const QC_REASON_LABELS: Record<QcFailureReason, string> = {
  stain_not_removed: "Stain not removed",
  improper_washing: "Improper washing",
  poor_ironing: "Poor ironing",
  folding_issue: "Folding issue",
  garment_damage: "Garment damage",
  missing_garment: "Missing garment",
  wrong_garment: "Wrong garment",
  packaging_issue: "Packaging issue",
  other: "Other",
};

// Where the work goes back to. A washing fault is rewashed, an ironing fault is
// re-ironed, and the three that are not about the work at all — a garment missing,
// the wrong garment, or a damaged one — are not sent back to a machine but to a
// person, because no amount of reprocessing will fix them.
// The steps a batch can be sent back to. Never "qc" — sending a failed check back to
// the check is not a correction.
export type WorkingStep = Exclude<BatchStep, "qc">;

export type CorrectiveAction =
  | { kind: "rework"; step: WorkingStep }
  | { kind: "supervisor" }
  | { kind: "investigate" };

export const REASON_CORRECTION: Record<QcFailureReason, CorrectiveAction> = {
  stain_not_removed: { kind: "rework", step: "wash" },
  improper_washing: { kind: "rework", step: "wash" },
  poor_ironing: { kind: "rework", step: "iron" },
  // Folding and packaging happen after the work, so the garments are refolded rather
  // than reprocessed. There is no packing step in a batch's sequence, so this is the
  // last step it has — the point being that it is not sent back to the wash.
  folding_issue: { kind: "rework", step: "iron" },
  packaging_issue: { kind: "rework", step: "iron" },
  // Nothing in a machine will produce a garment that is not there.
  missing_garment: { kind: "investigate" },
  wrong_garment: { kind: "investigate" },
  garment_damage: { kind: "supervisor" },
  other: { kind: "supervisor" },
};

// A failure that needs somebody to look at it rather than a machine to run again.
// These are the ones that create an issue and reach the resident.
export function isSerious(reason: QcFailureReason): boolean {
  const correction = REASON_CORRECTION[reason];
  return correction.kind !== "rework";
}

// A photograph is required where the failure is a claim about the garment's condition
// rather than about the quality of the work. "It is torn" and "it is not the right
// shirt" are assertions somebody will be asked to stand behind.
const EVIDENCE_REQUIRED: QcFailureReason[] = ["garment_damage", "wrong_garment", "missing_garment"];

export function evidenceRequired(reason: QcFailureReason): boolean {
  return EVIDENCE_REQUIRED.includes(reason);
}

// Whether a failure directly affects the resident's garments, their delivery date or
// the outcome of their order — which is when they are told, rather than for every
// minor internal fault. A shirt needing another pass of the iron is not news.
export function notifiesResident(reason: QcFailureReason): boolean {
  return isSerious(reason);
}

// How many failures on one batch is too many to keep quietly retrying.
export const REPEATED_FAILURE_THRESHOLD = 2;

export function isRepeatedFailure(batch: Pick<ProcessingBatch, "qcAttempts">): boolean {
  return batch.qcAttempts >= REPEATED_FAILURE_THRESHOLD;
}

// ------------------------------------------------------------------ validation

export class QcFailureIncompleteError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "A QC failure needs a reason and remarks.");
    this.name = "QcFailureIncompleteError";
  }
}

export interface QcFailureInput {
  reason?: string;
  remarks?: string;
  evidenceUrl?: string | null;
}

// A failure has to say enough to be acted on. "Failed" on its own tells the next
// person nothing: not what went wrong, not what to do about it, and not whether
// anybody should be told.
export function qcFailureProblems(input: QcFailureInput): string[] {
  const problems: string[] = [];
  const reason = input.reason as QcFailureReason | undefined;
  if (!reason || !QC_FAILURE_REASONS.includes(reason)) {
    problems.push("Choose the reason this failed.");
    return problems;
  }
  if (!(input.remarks ?? "").trim()) problems.push("Say what went wrong.");
  if (evidenceRequired(reason) && !(input.evidenceUrl ?? "").trim()) {
    problems.push(`${QC_REASON_LABELS[reason]} needs a photograph.`);
  }
  return problems;
}

export function assertQcFailure(input: QcFailureInput): void {
  const problems = qcFailureProblems(input);
  if (problems.length) throw new QcFailureIncompleteError(problems);
}

// --------------------------------------------------------- where the work goes

export interface QcFailureOutcome {
  reason: QcFailureReason;
  reasonLabel: string;
  remarks: string;
  evidenceUrl: string | null;
  correction: CorrectiveAction;
  // The step the batch is sent back to, where it is sent back at all.
  correctiveStep: WorkingStep | null;
  correctiveLabel: string;
  serious: boolean;
  notifyResident: boolean;
  needsSupervisor: boolean;
  attempt: number;
}

// What this failure means for this batch, decided in one place so the operator's
// screen, the order's history and the supervisor's queue all agree about it.
export function planCorrection(
  batch: Pick<ProcessingBatch, "sequence" | "qcAttempts">,
  input: { reason: QcFailureReason; remarks: string; evidenceUrl?: string | null },
): QcFailureOutcome {
  const correction = REASON_CORRECTION[input.reason];
  const attempt = batch.qcAttempts + 1;
  const repeated = attempt >= REPEATED_FAILURE_THRESHOLD;

  // Only a step this batch actually has. A wash fault on a dry-cleaning batch goes
  // back to the dry cleaning, and an ironing fault on a batch that is not ironed has
  // nowhere to go but the cleaning it did have.
  let correctiveStep: WorkingStep | null = null;
  if (correction.kind === "rework") {
    const wanted = correction.step;
    const working = batch.sequence.filter((step): step is WorkingStep => step !== "qc");
    correctiveStep = working.includes(wanted)
      ? wanted
      // The nearest thing it does have: the last working step before the check.
      : working[working.length - 1] ?? null;
    // A cleaning fault on a batch that is dry cleaned rather than washed.
    if (wanted === "wash" && !working.includes("wash")) {
      correctiveStep = working.find((step) => step === "dry_clean" || step === "premium") ?? correctiveStep;
    }
  }

  return {
    reason: input.reason,
    reasonLabel: QC_REASON_LABELS[input.reason],
    remarks: input.remarks.trim(),
    evidenceUrl: input.evidenceUrl?.trim() || null,
    correction,
    correctiveStep,
    correctiveLabel: correction.kind === "rework"
      ? `Back to ${correctiveStep ?? "processing"}`
      : correction.kind === "investigate"
        ? "Held for investigation"
        : "Held for supervisor review",
    serious: isSerious(input.reason),
    notifyResident: notifiesResident(input.reason),
    // Anything serious, and anything that has now failed more than once.
    needsSupervisor: isSerious(input.reason) || repeated,
    attempt,
  };
}
