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

// Web QcFailModal: evidence is required only when the chosen reason says so, and
// either a photo or a trimmed evidenceUrl satisfies it. No URL-format check.
export const QC_EVIDENCE_URL_PLACEHOLDER = "or paste a link to a photo";

export function qcEvidenceUrlToSend(url: string | null | undefined): string | undefined {
  return url?.trim() || undefined;
}

export function qcEvidenceSatisfied(opts: {
  evidenceRequired: boolean;
  photo?: unknown | null;
  evidenceUrl?: string | null;
}): boolean {
  if (!opts.evidenceRequired) return true;
  return Boolean(opts.photo || qcEvidenceUrlToSend(opts.evidenceUrl));
}

export function qcEvidenceProblem(label: string): string {
  return `${label} needs a photograph`;
}

export function qcBatchFailPayload(input: {
  reason: string;
  remarks: string;
  evidenceUrl?: string | null;
  evidencePhoto?: { filename: string; contentType: string; data: string } | null;
}): {
  reason: string;
  remarks: string;
  evidenceUrl?: string;
  evidencePhoto?: { filename: string; contentType: string; data: string };
} {
  return {
    reason: input.reason,
    remarks: input.remarks.trim(),
    evidenceUrl: qcEvidenceUrlToSend(input.evidenceUrl),
    evidencePhoto: input.evidencePhoto ?? undefined,
  };
}

export function qcBatchFailRequest(
  orderId: string,
  batchId: string,
  failure: ReturnType<typeof qcBatchFailPayload>,
): { method: "POST"; path: string; body: { passed: false } & ReturnType<typeof qcBatchFailPayload> } {
  return {
    method: "POST",
    path: `/v1/operations/orders/${orderId}/batches/${batchId}/qc`,
    body: { passed: false, ...failure },
  };
}
