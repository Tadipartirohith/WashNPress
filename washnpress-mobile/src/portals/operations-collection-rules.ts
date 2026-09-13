// What Confirm Collection sends, and when it is allowed to send it.
//
// Web's ReconcileModal (I-135 / I-137) is the source of truth: booked lines need a
// fresh reconcile preview before confirm, a slot-only order goes as collectedLines,
// early collection carries a trimmed reason or is refused, and a line-level
// mismatch must say why. The older mobile path sent `{ items }` and auto-previewed
// as the operator typed — that is not rebuilt here.

export interface CollectedLine {
  category: string;
  serviceId: string;
  quantity: number;
}

export interface ReconcileLine {
  lineId: string;
  acceptedQuantity: number;
  acceptedMeasuredQuantity?: number;
}

export type PreviewStatus = "not_required" | "missing" | "stale" | "fresh";

export interface CollectionDraft {
  bookedLines: ReconcileLine[];
  collected: CollectedLine[];
  early: boolean;
  earlyReason: string;
  mismatch: boolean;
  discrepancyReason: string | null;
  discrepancyRemarks: string;
  preview: PreviewStatus;
}

export interface CollectionBody {
  lines?: ReconcileLine[];
  collectedLines?: CollectedLine[];
  early?: boolean;
  earlyReason?: string;
  discrepancyReason?: string;
  discrepancyRemarks?: string;
}

export const PREVIEW_FIRST = "Preview the split to compare expected and collected quantities before confirming.";
export const QUANTITY_CHANGED = "The quantities changed after the preview. Preview again before confirming.";
export const EARLY_REASON_REQUIRED = "Early collection reason is required.";
export const COLLECTED_LINES_REQUIRED = "Add each garment with its service and quantity.";
export const DISCREPANCY_REQUIRED = "Choose why the quantity differs and say what happened before confirming.";

export function collectedLinesValid(rows: CollectedLine[]): boolean {
  return rows.length > 0 && rows.every((r) => Boolean(r.category && r.serviceId && r.quantity >= 1));
}

// Same line body Web builds: accepted count, and a measured value for any non-piece unit.
export function bookedLinePayload(
  lines: { id: string; quantity: number; unit?: string | null; measuredQuantity?: number | null }[],
  accepted: Record<string, number>,
  measured: Record<string, string>,
): ReconcileLine[] {
  return lines.map((l) => ({
    lineId: l.id,
    acceptedQuantity: accepted[l.id] ?? l.quantity,
    ...(l.unit && l.unit !== "piece"
      ? { acceptedMeasuredQuantity: Number(measured[l.id] ?? l.measuredQuantity ?? 0) }
      : {}),
  }));
}

export function previewKey(lines: ReconcileLine[]): string {
  return JSON.stringify(lines);
}

// A preview only counts for the exact quantities it was run with. Clearing the
// preview object after a change, while keeping the last previewed key, is how
// Web marks the previous preview stale.
export function previewStatus(opts: {
  bookedLineCount: number;
  hasPreview: boolean;
  payloadKey: string;
  previewedKey: string | null;
}): PreviewStatus {
  if (opts.bookedLineCount === 0) return "not_required";
  if (opts.hasPreview && opts.previewedKey === opts.payloadKey) return "fresh";
  if (opts.previewedKey !== null && opts.previewedKey !== opts.payloadKey) return "stale";
  return "missing";
}

export function previewProblem(status: PreviewStatus): string | null {
  if (status === "missing") return PREVIEW_FIRST;
  if (status === "stale") return QUANTITY_CHANGED;
  return null;
}

// Web: mismatch is any fresh preview line whose status is not "matched", not a
// comparison of the two totals.
export function hasLineMismatch(
  preview: { lines: { status: string }[] } | null,
  fresh: boolean,
): boolean {
  return Boolean(fresh && preview && preview.lines.some((l) => l.status !== "matched"));
}

export function collectionProblems(draft: CollectionDraft): string[] {
  const problems: string[] = [];
  const previewIssue = previewProblem(draft.preview);
  if (previewIssue) problems.push(previewIssue);
  if (draft.bookedLines.length === 0 && !collectedLinesValid(draft.collected)) {
    problems.push(COLLECTED_LINES_REQUIRED);
  }
  if (draft.early && !draft.earlyReason.trim()) {
    problems.push(EARLY_REASON_REQUIRED);
  }
  if (draft.bookedLines.length > 0 && draft.mismatch) {
    if (!draft.discrepancyReason || !draft.discrepancyRemarks.trim()) {
      problems.push(DISCREPANCY_REQUIRED);
    }
  }
  return problems;
}

// Confirm stays disabled for the same reasons Web's button does. Discrepancy is
// checked on press, not by disabling the button.
export function collectionConfirmDisabled(draft: CollectionDraft): boolean {
  if (draft.preview === "missing" || draft.preview === "stale") return true;
  if (draft.bookedLines.length === 0 && !collectedLinesValid(draft.collected)) return true;
  if (draft.early && !draft.earlyReason.trim()) return true;
  return false;
}

export function collectionPayload(draft: CollectionDraft): CollectionBody {
  const recordingGarments = draft.bookedLines.length === 0;
  const body: CollectionBody = recordingGarments
    ? { collectedLines: draft.collected.filter((r) => r.category && r.serviceId && r.quantity >= 1) }
    : { lines: draft.bookedLines };
  if (draft.early) {
    body.early = true;
    body.earlyReason = draft.earlyReason.trim();
  }
  if (!recordingGarments && draft.mismatch) {
    if (draft.discrepancyReason) body.discrepancyReason = draft.discrepancyReason;
    if (draft.discrepancyRemarks) body.discrepancyRemarks = draft.discrepancyRemarks;
  }
  return body;
}

// Offline replay: new collections store the Web body; older queued actions still
// have `{ items }`. The runner must not drop either.
export function pickedUpReplay(payload: { orderId?: string; body?: CollectionBody; items?: unknown }):
  | { api: "opsPickedUpLines"; orderId: string; body: CollectionBody }
  | { api: "markPickedUp"; orderId: string; items: unknown }
  | null {
  if (!payload.orderId) return null;
  if (payload.body) return { api: "opsPickedUpLines", orderId: payload.orderId, body: payload.body };
  return { api: "markPickedUp", orderId: payload.orderId, items: payload.items };
}
