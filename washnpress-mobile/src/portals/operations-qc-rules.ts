// Order-level Fail QC uses the same reason list Web loads from
// GET /v1/operations/qc-reasons (QcFailModal). The dropdown shows `label`;
// POST /v1/operations/orders/:id/qc receives `reason` as that option's `key`.
// Pass sends no reason — the same as Web `submitQc(id, true)`.

export interface QcReasonChoice {
  key: string;
  label: string;
}

export const QC_REASON_REQUIRED = "Record why the quality check failed";

export function qcReasonsReady(reasons: QcReasonChoice[] | null | undefined): boolean {
  return Array.isArray(reasons) && reasons.length > 0;
}

export function qcFailAllowed(reason: string | null | undefined, reasons: QcReasonChoice[]): boolean {
  return Boolean(reason && reasons.some((r) => r.key === reason));
}

export function qcFailReasonToSend(reason: string | null | undefined, reasons: QcReasonChoice[]): string | null {
  return qcFailAllowed(reason, reasons) ? reason! : null;
}

export function qcFailProblems(reason: string | null | undefined, reasons: QcReasonChoice[]): string[] {
  if (!qcFailAllowed(reason, reasons)) return [QC_REASON_REQUIRED];
  return [];
}

export function qcPassPayload(): { pass: true; reason: undefined } {
  return { pass: true, reason: undefined };
}
