"use client";

import { useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Plus, Minus, Trash2 } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { Button } from "@/components/ui/button";
import { useAsync, useAction } from "@/lib/use-async";
import { rupees } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import {
  operationsApi, type PickupQueueItem, type Reconciliation, type OrderDetail, type DiscrepancyReason,
  type GarmentSummary,
} from "@/lib/api/operations";

// One garment the operator records at collection: which garment, which service, how
// many. The same garment may appear more than once for different services.
type CollectedRow = { key: number; category: string; serviceId: string; quantity: number };
let rowSeq = 0;

// The garment entry / reconcile screen. The operator only ever types the quantity
// they physically counted — the covered/additional split and the resulting charge
// always come back from the backend's own response, never computed here.
export function ReconcileModal({
  pickup, onClose, onDone,
}: {
  pickup: PickupQueueItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const orderId = pickup.orderId!;
  const order = useAsync(() => operationsApi.order(orderId), [orderId]);
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const [measured, setMeasured] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Reconciliation | null>(null);
  // I-86: the plan-coverage split shown in the review step, so the operator sees what
  // the plan covers and what is chargeable before confirming — not only afterwards.
  const [summary, setSummary] = useState<GarmentSummary | null>(null);
  const [confirmed, setConfirmed] = useState<OrderDetail | null>(null);
  const [discrepancyReason, setDiscrepancyReason] = useState<DiscrepancyReason | "">("");
  const [discrepancyRemarks, setDiscrepancyRemarks] = useState("");
  const [collectEarly, setCollectEarly] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const discrepancyReasons = useAsync(() => operationsApi.discrepancyReasons(), []);
  const config = useAsync(() => operationsApi.config(), []);
  const previewAction = useAction(operationsApi.reconcile);
  const confirmAction = useAction(operationsApi.markPickedUp);

  // The garments the operator records at the door for an order booked slot-only.
  const [collected, setCollected] = useState<CollectedRow[]>([]);
  const activeServices = (config.data?.garmentServices ?? []).filter((s) => s.isActive !== false);
  const addRow = () => setCollected((rows) => [...rows, { key: rowSeq++, category: "", serviceId: "", quantity: 1 }]);
  const patchRow = (key: number, patch: Partial<CollectedRow>) =>
    setCollected((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: number) => setCollected((rows) => rows.filter((r) => r.key !== key));
  const collectedValid = collected.length > 0 && collected.every((r) => r.category && r.serviceId && r.quantity >= 1);
  const collectedTotal = collected.reduce((n, r) => n + (r.quantity || 0), 0);

  const lines = order.data?.order.processing?.lines ?? [];

  const linePayload = useMemo(
    () => lines.map((l) => ({
      lineId: l.id,
      acceptedQuantity: Number(accepted[l.id] ?? l.quantity),
      ...(l.unit && l.unit !== "piece" ? { acceptedMeasuredQuantity: Number(measured[l.id] ?? l.measuredQuantity ?? 0) } : {}),
    })),
    [lines, accepted, measured],
  );

  const hasMismatch = preview ? preview.lines.some((l) => l.status !== "matched") : false;

  const runPreview = async () => {
    setFormError(null);
    try {
      const result = await previewAction.run(orderId, linePayload);
      setPreview(result.reconciliation);
      // The plan-coverage split for the same accepted quantities. Best-effort: the
      // per-line reconcile above is what gates confirmation, so a failure here only
      // hides the covered/additional counts, it does not block the operator.
      try {
        const items = lines
          .map((l) => ({ category: l.category, quantity: Number(accepted[l.id] ?? l.quantity) }))
          .filter((i) => i.quantity > 0);
        setSummary((await operationsApi.previewGarments(orderId, items)).summary);
      } catch { setSummary(null); }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not preview the split");
    }
  };

  const confirm = async () => {
    setFormError(null);
    if (hasMismatch && (!discrepancyReason || !discrepancyRemarks.trim())) {
      setFormError("Choose why the quantity differs and say what happened before confirming.");
      return;
    }
    try {
      const recordingGarments = lines.length === 0;
      const result = await confirmAction.run(orderId, {
        ...(recordingGarments
          ? { collectedLines: collected.map((r) => ({ category: r.category, serviceId: r.serviceId, quantity: r.quantity })) }
          : { lines: linePayload }),
        early: collectEarly || undefined,
        earlyReason: collectEarly ? earlyReason : undefined,
        discrepancyReason: hasMismatch ? (discrepancyReason as DiscrepancyReason) : undefined,
        discrepancyRemarks: hasMismatch ? discrepancyRemarks : undefined,
      });
      setConfirmed(result.order);
    } catch (e) {
      if (e instanceof ApiError) {
        const data = e.data as { message?: string; error?: string } | undefined;
        if (data?.error === "pickup_not_due") {
          setFormError("This pickup's window hasn't opened yet. Tick “Collect early” and say why, or come back later.");
          return;
        }
        setFormError(data?.message ?? e.message);
        return;
      }
      setFormError(e instanceof Error ? e.message : "Could not confirm the pickup");
    }
  };

  return (
    <Modal open onClose={onClose} variant="drawer" title="Confirm pickup" description={`${pickup.residentName ?? "Resident"} · ${pickup.unitNumber ?? ""}`}>
      {order.loading ? (
        <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-primary" /></div>
      ) : order.error ? (
        <p className="text-sm text-danger">{order.error}</p>
      ) : confirmed ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm text-success ring-1 ring-success/30">
            <CheckCircle2 className="size-4 shrink-0" /> Pickup confirmed.
          </div>
          <div className="rounded-2xl glass p-4 text-sm">
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Accepted</span><span className="tabular-nums font-medium">{confirmed.acceptedCount ?? 0}</span></div>
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Covered by plan</span><span className="tabular-nums font-medium">{confirmed.subscriptionCoveredCount ?? 0}</span></div>
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Additional</span><span className="tabular-nums font-medium">{confirmed.additionalCount ?? 0}</span></div>
            <div className="mt-2 flex justify-between border-t border-white/10 pt-2"><span className="font-medium">Charge</span><span className="tabular-nums font-display font-bold">{rupees(confirmed.additionalChargePaise ?? 0)}</span></div>
          </div>
          <Button className="w-full" onClick={onDone}>Done</Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* I-86: a clear three-step flow — enter garments, review the split, confirm. */}
          <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium">
            {["Garments", "Review", "Confirm"].map((label, i) => {
              const n = i + 1;
              const cur = preview || summary ? 2 : 1;
              return (
                <span key={label} className={`rounded-full px-2 py-0.5 ${n === cur ? "bg-primary text-primary-foreground" : n < cur ? "bg-primary/15 text-primary" : "bg-foreground/5 text-muted-foreground"}`}>
                  {n}. {label}
                </span>
              );
            })}
          </div>
          {lines.length === 0 ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Record garments</p>
                <p className="text-xs text-muted-foreground">Add each garment with its service and quantity. The same garment can repeat for a different service.</p>
              </div>
              {config.loading ? (
                <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-primary" /></div>
              ) : collected.length === 0 ? (
                <p className="rounded-xl glass p-4 text-center text-sm text-muted-foreground">No garments yet. Add the first one below.</p>
              ) : (
                <div className="space-y-2">
                  {collected.map((row) => (
                    <div key={row.key} className="space-y-2 rounded-xl glass p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <select value={row.category} onChange={(e) => patchRow(row.key, { category: e.target.value })}
                          className="rounded-lg border border-border bg-background/60 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                          <option value="">Garment</option>
                          {(config.data?.garmentCategories ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <select value={row.serviceId} onChange={(e) => patchRow(row.key, { serviceId: e.target.value })}
                          className="rounded-lg border border-border bg-background/60 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                          <option value="">Service</option>
                          {activeServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button type="button" aria-label="Decrease" onClick={() => patchRow(row.key, { quantity: Math.max(1, row.quantity - 1) })}
                            className="grid size-8 place-items-center rounded-lg glass hover:ring-1 hover:ring-primary/40"><Minus className="size-3.5" /></button>
                          <span className="w-8 text-center text-sm tabular-nums">{row.quantity}</span>
                          <button type="button" aria-label="Increase" onClick={() => patchRow(row.key, { quantity: row.quantity + 1 })}
                            className="grid size-8 place-items-center rounded-lg glass hover:ring-1 hover:ring-primary/40"><Plus className="size-3.5" /></button>
                        </div>
                        <button type="button" aria-label="Remove garment" onClick={() => removeRow(row.key)}
                          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"><Trash2 className="size-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="outline" className="w-full" onClick={addRow}><Plus className="size-4" /> Add Garment</Button>
              {collected.length > 0 && (
                <div className="rounded-xl bg-foreground/5 px-4 py-2.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total garments</span><span className="font-medium tabular-nums">{collectedTotal}</span></div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {lines.map((line) => (
                <div key={line.id} className="rounded-xl glass p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.category}</p>
                      <p className="truncate text-xs text-muted-foreground">{line.serviceName} · requested {line.quantity}{line.unit && line.unit !== "piece" ? ` (${line.measuredQuantity ?? "—"} ${line.unit})` : ""}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        type="number" min={0} inputMode="numeric"
                        aria-label={`Accepted quantity for ${line.category}`}
                        defaultValue={line.quantity}
                        onChange={(e) => { setAccepted((a) => ({ ...a, [line.id]: e.target.value })); setPreview(null); setSummary(null); }}
                        className="w-20 rounded-lg border border-border bg-background/60 px-2.5 py-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
                      />
                      <span className="text-xs text-muted-foreground">pcs</span>
                    </div>
                  </div>
                  {line.unit && line.unit !== "piece" && (
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <span className="text-xs text-muted-foreground">Measured ({line.unit})</span>
                      <input
                        type="number" min={0} step="0.01" inputMode="decimal"
                        aria-label={`Measured ${line.unit} for ${line.category}`}
                        defaultValue={line.measuredQuantity ?? undefined}
                        onChange={(e) => { setMeasured((m) => ({ ...m, [line.id]: e.target.value })); setPreview(null); setSummary(null); }}
                        className="w-24 rounded-lg border border-border bg-background/60 px-2.5 py-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!pickup.dueNow && (
            <div className="space-y-2 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning ring-1 ring-warning/30">
              <p className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" /> This pickup&apos;s window hasn&apos;t opened yet.</p>
              <label className="flex items-center gap-2 text-foreground">
                <input type="checkbox" checked={collectEarly} onChange={(e) => setCollectEarly(e.target.checked)} className="size-4 rounded border-border" />
                Collect early anyway
              </label>
              {collectEarly && (
                <input
                  value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)}
                  placeholder="Why collect before the window opens?"
                  className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </div>
          )}

          {lines.length > 0 && (
            <Button variant="outline" className="w-full" onClick={runPreview} disabled={previewAction.busy}>
              {previewAction.busy ? <Loader2 className="size-4 animate-spin" /> : "Preview split"}
            </Button>
          )}

          {preview && (
            <div className="space-y-2 rounded-2xl glass p-4">
              <div className="space-y-1.5 text-sm">
                {preview.lines.map((l) => (
                  <div key={l.lineId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{l.category} · {l.serviceName}</span>
                    <span className={l.status === "matched" ? "text-muted-foreground" : l.status === "short" ? "text-danger" : "text-warning"}>
                      {l.actual}/{l.requested} {l.status !== "matched" && `(${l.status})`}
                    </span>
                  </div>
                ))}
              </div>
              {summary && (
                <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total garments</span><span className="tabular-nums font-medium">{summary.acceptedCount}</span></div>
                  {summary.planTier && <div className="flex justify-between"><span className="text-muted-foreground">Covered by plan</span><span className="tabular-nums font-medium">{summary.subscriptionCoveredCount}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">Additional / chargeable</span><span className="tabular-nums font-medium">{summary.additionalCount}</span></div>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-sm font-medium">
                <span>Additional charge</span>
                <span className="font-display tabular-nums">{rupees(preview.additionalPaise)}</span>
              </div>
            </div>
          )}

          {preview && hasMismatch && (
            <div className="space-y-3 rounded-xl bg-warning/10 p-4 ring-1 ring-warning/30">
              <p className="text-sm font-medium text-warning">Quantity differs from what was requested — record why.</p>
              <FormField
                as="select" label="Reason" required
                value={discrepancyReason}
                onChange={(e) => setDiscrepancyReason(e.target.value as DiscrepancyReason)}
              >
                <option value="">Choose a reason</option>
                {discrepancyReasons.data?.reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </FormField>
              <FormField as="textarea" label="What happened" required value={discrepancyRemarks} onChange={(e) => setDiscrepancyRemarks(e.target.value)} />
            </div>
          )}

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={confirm} disabled={confirmAction.busy || (lines.length === 0 && !collectedValid)}>
              {confirmAction.busy ? <Loader2 className="size-4 animate-spin" /> : "Confirm Collection"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
