"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, ShieldAlert, Search, Truck } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/portal/form-field";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { cn } from "@/lib/utils";
import { rupees, formatDateTime } from "@/lib/format";
import {
  operationsApi, type ProcessingBatch, type BatchStep, type OrderDetail, type QcFailureReason,
} from "@/lib/api/operations";
import { QcFailModal } from "./qc-fail-modal";

// One batch's own pipeline: its sequence, what it has done, and the single action
// that moves it on. A batch never offers a stage it does not need — the sequence
// itself is what the backend computed from the service the resident chose.
function BatchCard({ orderId, batch, onChanged }: { orderId: string; batch: ProcessingBatch; onChanged: () => void }) {
  const [failing, setFailing] = useState(false);
  const advance = useAction((step: BatchStep) => operationsApi.advanceBatch(orderId, batch.id, step));
  const qc = useAction((passed: boolean, failure?: Parameters<typeof operationsApi.batchQc>[3]) =>
    operationsApi.batchQc(orderId, batch.id, passed, failure));

  const held = batch.heldFor;

  return (
    <div className={cn("rounded-2xl p-4", held ? "bg-danger/10 ring-1 ring-danger/30" : "glass")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{batch.quantity} × {batch.category}</p>
          <p className="text-xs text-muted-foreground">{batch.serviceName}</p>
        </div>
        <StatusBadge
          status={batch.status}
          label={batch.statusLabel}
          toneMap={{ completed: "success", qc_failed: "danger", held: "danger", awaiting_qc: "primary", in_progress: "primary", pending: "muted" }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {batch.steps.map((s) => (
          <span
            key={s.step}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium ring-1",
              s.done ? "bg-success/15 text-success ring-success/30"
                : s.current ? "bg-primary/15 text-primary ring-primary/30"
                : "bg-foreground/5 text-muted-foreground ring-foreground/10",
            )}
          >
            {s.label}
          </span>
        ))}
      </div>

      {held ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-danger">
          <ShieldAlert className="size-4 shrink-0" />
          Held for {held === "supervisor" ? "supervisor review" : "investigation"} — {batch.qcReason ?? "see QC history"}. The order's other batches keep moving.
        </p>
      ) : batch.currentStep === "qc" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1" disabled={qc.busy} onClick={() => qc.run(true).then(onChanged)}>
            {qc.busy ? <Loader2 className="size-4 animate-spin" /> : "Pass QC"}
          </Button>
          <Button size="sm" variant="outline" className="flex-1 border-danger/40 text-danger hover:bg-danger/10" onClick={() => setFailing(true)}>
            Fail QC
          </Button>
        </div>
      ) : batch.currentStep ? (
        <Button size="sm" className="mt-3 w-full" disabled={advance.busy} onClick={() => advance.run(batch.currentStep!).then(onChanged)}>
          {advance.busy ? <Loader2 className="size-4 animate-spin" /> : `Complete ${batch.currentStepLabel}`}
        </Button>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> Completed</p>
      )}

      {advance.error && <p className="mt-2 text-xs text-danger">{advance.error}</p>}
      {qc.error && <p className="mt-2 text-xs text-danger">{qc.error}</p>}

      {(batch.qcFailures?.length ?? 0) > 0 && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">QC history ({batch.qcFailures!.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {batch.qcFailures!.map((f, i) => (
              <li key={i}>Attempt {f.attempt}: {f.reasonLabel} — {f.remarks} ({f.correctiveLabel})</li>
            ))}
          </ul>
        </details>
      )}

      {failing && (
        <QcFailModal
          title={`Fail QC — ${batch.category}`}
          busy={qc.busy}
          error={qc.error}
          onClose={() => setFailing(false)}
          onSubmit={(input) => qc.run(false, {
            reason: input.reason as QcFailureReason, remarks: input.remarks, evidenceUrl: input.evidenceUrl, evidencePhoto: input.evidencePhoto,
          }).then(() => { setFailing(false); onChanged(); }).catch(() => {})}
        />
      )}
    </div>
  );
}

// Legacy path: an order booked before per-line services existed has no batches at
// all, so it is still worked stage by stage at the order level.
function LegacyStageControls({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const [qcFailReason, setQcFailReason] = useState("");
  const [showQcFail, setShowQcFail] = useState(false);
  const stage = useAction(async (fn: () => Promise<unknown>) => { await fn(); });
  const cleanLabel = order.processing?.cleanLabel ?? "Washing";
  const requiresClean = order.processing?.requiresClean ?? true;
  const requiresPress = order.processing?.requiresPress ?? true;

  const run = (fn: () => Promise<unknown>) => stage.run(fn).then(onChanged);

  return (
    <div className="space-y-3 rounded-2xl glass p-4">
      <p className="text-sm font-medium">Order-level processing (no per-line batches on this order)</p>
      {order.state === "picked_up" && requiresClean && (
        <Button className="w-full" disabled={stage.busy} onClick={() => run(() => operationsApi.startWash(order.id))}>Start {cleanLabel}</Button>
      )}
      {order.state === "picked_up" && !requiresClean && requiresPress && (
        <Button className="w-full" disabled={stage.busy} onClick={() => run(() => operationsApi.startIroning(order.id))}>Start Ironing</Button>
      )}
      {order.state === "in_wash" && (
        <Button className="w-full" disabled={stage.busy} onClick={() => run(() => operationsApi.completeWash(order.id))}>Complete {cleanLabel}</Button>
      )}
      {order.state === "ironing" && !order.ironingStarted && (
        <Button className="w-full" disabled={stage.busy} onClick={() => run(() => operationsApi.startIroning(order.id))}>Start Ironing</Button>
      )}
      {order.state === "ironing" && order.ironingStarted && (
        <Button className="w-full" disabled={stage.busy} onClick={() => run(() => operationsApi.completeIroning(order.id))}>Complete Ironing</Button>
      )}
      {order.state === "qc" && !showQcFail && (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={stage.busy} onClick={() => run(() => operationsApi.submitQc(order.id, true))}>Pass QC</Button>
          <Button variant="outline" className="flex-1 border-danger/40 text-danger hover:bg-danger/10" onClick={() => setShowQcFail(true)}>Fail QC</Button>
        </div>
      )}
      {order.state === "qc" && showQcFail && (
        <div className="space-y-2">
          <FormField as="textarea" label="Why did it fail" required value={qcFailReason} onChange={(e) => setQcFailReason(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowQcFail(false)}>Cancel</Button>
            <Button
              className="flex-1 bg-danger text-white shadow-none hover:brightness-110"
              disabled={stage.busy || !qcFailReason.trim()}
              onClick={() => run(() => operationsApi.submitQc(order.id, false, qcFailReason.trim()))}
            >
              {stage.busy ? <Loader2 className="size-4 animate-spin" /> : "Confirm failure"}
            </Button>
          </div>
        </div>
      )}
      {order.state === "qc_hold" && (
        <div className="space-y-2">
          <p className="text-sm text-danger">{order.qcReason ?? "Held after a failed check."}</p>
          <div className="flex gap-2">
            {requiresClean && <Button variant="outline" className="flex-1" disabled={stage.busy} onClick={() => run(() => operationsApi.reprocess(order.id, "in_wash"))}>Send back to {cleanLabel.toLowerCase()}</Button>}
            {requiresPress && <Button variant="outline" className="flex-1" disabled={stage.busy} onClick={() => run(() => operationsApi.reprocess(order.id, "ironing"))}>Send back to ironing</Button>}
          </div>
        </div>
      )}
      {stage.error && <p className="text-sm text-danger">{stage.error}</p>}
    </div>
  );
}

function DeliverForm({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const [count, setCount] = useState(String(order.acceptedCount ?? 0));
  const [reason, setReason] = useState("");
  const action = useAction(operationsApi.deliver);
  const mismatch = Number(count) !== (order.acceptedCount ?? 0);

  return (
    <div className="space-y-3 rounded-2xl glass p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Truck className="size-4" /> Confirm delivery count</p>
      <FormField label="Items being delivered" required type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} hint={`Accepted at pickup: ${order.acceptedCount ?? 0}`} />
      {mismatch && (
        <FormField
          as="textarea" label="This differs from what was accepted at pickup — why?" required
          value={reason} onChange={(e) => setReason(e.target.value)}
        />
      )}
      {action.error && <p className="text-sm text-danger">{action.error}</p>}
      <Button
        className="w-full"
        disabled={action.busy || count === "" || (mismatch && !reason.trim())}
        onClick={() => action.run(order.id, Number(count), mismatch ? reason.trim() : undefined).then(onChanged)}
      >
        {action.busy ? <Loader2 className="size-4 animate-spin" /> : "Mark delivered"}
      </Button>
    </div>
  );
}

function ReassignPanel({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const operators = useAsync(() => operationsApi.assignableOperators(), []);
  const action = useAction(operationsApi.assignOrder);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-primary hover:underline">
        {order.operatorName ? `Assigned to ${order.operatorName} · Reassign` : "Unassigned · Assign"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
        defaultValue=""
        onChange={(e) => { if (e.target.value) action.run(order.id, e.target.value).then(() => { setOpen(false); onChanged(); }); }}
      >
        <option value="" disabled>Choose an operator</option>
        {operators.data?.operators.map((o) => <option key={o.userId} value={o.userId}>{o.fullName ?? o.phone}</option>)}
      </select>
      <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      {action.busy && <Loader2 className="size-3.5 animate-spin text-primary" />}
      {action.error && <span className="text-xs text-danger">{action.error}</span>}
    </div>
  );
}

export function BatchDrawer({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => void }) {
  const order = useAsync(() => operationsApi.order(orderId), [orderId]);
  const toast = useToast();

  const refresh = () => { order.reload(); onChanged(); };

  return (
    <Modal open onClose={onClose} variant="drawer" title={order.data?.order.orderCode ?? "Order"} description={order.data?.order.residentName ?? undefined}>
      {order.loading ? (
        <div className="grid place-items-center py-12"><Loader2 className="size-5 animate-spin text-primary" /></div>
      ) : order.error ? (
        <p className="text-sm text-danger">{order.error}</p>
      ) : order.data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status={order.data.order.state} />
            <ReassignPanel order={order.data.order} onChanged={refresh} />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Society / Unit</p><p>{order.data.order.societyName ?? "—"} · {order.data.order.unitNumber ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Accepted</p><p className="tabular-nums">{order.data.order.acceptedCount ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Additional charge</p><p className="tabular-nums">{rupees(order.data.order.additionalChargePaise ?? 0)}</p></div>
            <div><p className="text-xs text-muted-foreground">Picked up</p><p>{order.data.order.pickedUpAt ? formatDateTime(order.data.order.pickedUpAt) : "—"}</p></div>
          </div>

          {order.data.order.qcReason && order.data.order.state === "qc_hold" && (
            <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-danger/30">
              <ShieldAlert className="mr-1.5 inline size-4" />{order.data.order.qcReason}
            </p>
          )}

          {order.data.order.batches.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Batches ({order.data.order.batches.filter((b) => b.status === "completed").length}/{order.data.order.batches.length} complete)</p>
              {order.data.order.batches.map((b) => (
                <BatchCard key={b.id} orderId={order.data!.order.id} batch={b} onChanged={refresh} />
              ))}
            </div>
          ) : (
            <LegacyStageControls order={order.data.order} onChanged={refresh} />
          )}

          {order.data.order.state === "ready_for_delivery" && (
            <OutForDeliveryButton orderId={order.data.order.id} onChanged={refresh} />
          )}
          {order.data.order.state === "out_for_delivery" && (
            <DeliverForm order={order.data.order} onChanged={() => { refresh(); toast.push("Order delivered"); }} />
          )}

          {order.data.order.issues.length > 0 && (
            <div className="rounded-2xl glass p-4">
              <p className="flex items-center gap-2 text-sm font-medium"><Search className="size-4" /> Issues on this order</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {order.data.order.issues.map((i) => <li key={i.id}>{i.category}: {i.description} ({i.status})</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function OutForDeliveryButton({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const action = useAction(operationsApi.outForDelivery);
  return (
    <div className="space-y-2">
      {action.error && <p className="text-sm text-danger">{action.error}</p>}
      <Button className="w-full" disabled={action.busy} onClick={() => action.run(orderId).then(onChanged)}>
        {action.busy ? <Loader2 className="size-4 animate-spin" /> : "Send out for delivery"}
      </Button>
    </div>
  );
}
