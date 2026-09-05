"use client";

import { useState } from "react";
import { Search, ChevronRight, ArrowRightLeft, PackageSearch, Truck, Shirt, ShieldCheck, AlertTriangle } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { formatDateTime, rupees } from "@/lib/format";
import { supervisorApi, type OrderSummary, type OrderDetail, type PickupRow } from "@/lib/api/supervisor";
import { cn } from "@/lib/utils";

type SubView = "orders" | "pickups" | "processing" | "qc" | "delayed";

function today(): string { return new Date().toISOString().slice(0, 10); }

export function OrdersTab() {
  const [view, setView] = useState<SubView>("orders");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {([
          ["orders", "Orders", PackageSearch],
          ["pickups", "Pickups", Truck],
          ["processing", "Processing", Shirt],
          ["qc", "Quality checks", ShieldCheck],
          ["delayed", "Delayed", AlertTriangle],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              view === id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {view === "orders" && <OrdersList />}
      {view === "pickups" && <PickupsPanel />}
      {view === "processing" && <ProcessingPanel />}
      {view === "qc" && <QcPanel />}
      {view === "delayed" && <DelayedPanel />}
    </div>
  );
}

// ------------------------------------------------------------------- orders

function OrdersList() {
  const [state, setState] = useState("all");
  const [blockId, setBlockId] = useState("all");
  const [operatorUserId, setOperatorUserId] = useState("all");
  const [orderCode, setOrderCode] = useState("");
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  const list = useAsync(() => supervisorApi.orders({
    state: state === "all" ? undefined : state,
    blockId: blockId === "all" ? undefined : blockId,
    operatorUserId: operatorUserId === "all" ? undefined : operatorUserId,
    orderCode: orderCode || undefined,
  }), [state, blockId, operatorUserId, orderCode]);

  const columns: Column<OrderSummary>[] = [
    { header: "Order", cell: (o) => <div><p className="font-medium">{o.orderCode}</p><p className="text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</p></div> },
    { header: "Resident", cell: (o) => <div><p>{o.residentName ?? "—"}</p><p className="text-xs text-muted-foreground">{o.unitNumber ?? ""} {o.blockName ? `· Tower ${o.blockName}` : ""}</p></div> },
    { header: "State", cell: (o) => <StatusBadge status={o.state} /> },
    { header: "Operator", cell: (o) => o.operatorName ?? <span className="text-muted-foreground">Unassigned</span> },
    { header: "", align: "right", cell: () => <ChevronRight className="ml-auto size-4 text-muted-foreground" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm">
          <Search className="size-4 text-muted-foreground" />
          <input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="Search order code" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <FormField as="select" label="State" value={state} onChange={(e) => setState(e.target.value)} className="w-44">
          <option value="all">All states</option>
          {Object.entries(list.data?.stateLabels ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </FormField>
        <FormField as="select" label="Tower" value={blockId} onChange={(e) => setBlockId(e.target.value)} className="w-40">
          <option value="all">All towers</option>
          {list.data?.filters.blocks.map((b) => <option key={b.id} value={b.id}>Tower {b.name}</option>)}
        </FormField>
        <FormField as="select" label="Operator" value={operatorUserId} onChange={(e) => setOperatorUserId(e.target.value)} className="w-44">
          <option value="all">All operators</option>
          {list.data?.filters.operators.map((o) => <option key={o.id} value={o.id}>{o.fullName ?? o.id}</option>)}
        </FormField>
      </div>
      <Panel loading={list.loading} error={list.error} onRetry={list.reload}>
        <DataTable columns={columns} rows={list.data?.orders ?? []} keyField={(o) => o.id} onRowClick={(o) => setOpenOrder(o.id)} emptyTitle="No orders match" emptyDescription="Try clearing a filter." />
      </Panel>
      {openOrder && <OrderDetailDrawer orderId={openOrder} operators={list.data?.filters.operators ?? []} onClose={() => setOpenOrder(null)} onChanged={list.reload} />}
    </div>
  );
}

function OrderDetailDrawer({ orderId, operators, onClose, onChanged }: {
  orderId: string; operators: { id: string; fullName: string | null }[]; onClose: () => void; onChanged: () => void;
}) {
  const detail = useAsync(() => supervisorApi.orderDetail(orderId), [orderId]);
  const [assignOpen, setAssignOpen] = useState(false);
  return (
    <Modal open onClose={onClose} variant="drawer" title="Order detail" description={detail.data?.order.orderCode}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <StatusBadge status={detail.data.order.state} />
              {detail.data.order.delayed && <span className="text-xs font-semibold text-danger">{detail.data.order.delayMinutes} min late</span>}
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Resident" value={detail.data.order.residentName ?? "—"} />
              <Field label="Unit" value={detail.data.order.unitNumber ?? "—"} />
              <Field label="Society" value={detail.data.order.societyName ?? "—"} />
              <Field label="Tower" value={detail.data.order.blockName ?? "—"} />
              <Field label="Operator" value={detail.data.order.operatorName ?? "Unassigned"} />
              <Field label="Services" value={rupees(detail.data.order.servicesPaise)} />
            </dl>

            {detail.data.order.lines && detail.data.order.lines.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Garments</p>
                <ul className="space-y-1 text-sm">
                  {detail.data.order.lines.map((l) => (
                    <li key={l.id} className="flex justify-between rounded-lg bg-foreground/5 px-3 py-1.5">
                      <span>{l.category}</span>
                      <span className="tabular-nums">{l.acceptedQuantity ?? l.quantity} {l.acceptedQuantity !== null && l.acceptedQuantity !== l.quantity ? `(asked ${l.quantity})` : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted-foreground">Quantities are as recorded by processing, not recomputed here.</p>
              </div>
            )}

            {detail.data.order.nextActions.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Next in the backend&apos;s workflow</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.data.order.nextActions.map((a) => (
                    <span key={a.to} className="rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-muted-foreground">{a.label}</span>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Performed by the operator handling this order — shown here for visibility only.</p>
              </div>
            )}

            <div className="border-t border-white/10 pt-4">
              <button onClick={() => setAssignOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl glass py-2.5 text-sm font-semibold hover:ring-1 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowRightLeft className="size-4" /> {detail.data.order.assignedOperatorUserId ? "Reassign operator" : "Assign operator"}
              </button>
            </div>
          </div>
        )}
      </Panel>
      {assignOpen && detail.data && (
        <AssignOperatorModal
          order={detail.data.order}
          operators={operators}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => { setAssignOpen(false); detail.reload(); onChanged(); }}
        />
      )}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>;
}

function AssignOperatorModal({ order, operators, onClose, onAssigned }: {
  order: OrderDetail; operators: { id: string; fullName: string | null }[]; onClose: () => void; onAssigned: () => void;
}) {
  const [operatorUserId, setOperatorUserId] = useState(order.assignedOperatorUserId ?? "");
  const [reason, setReason] = useState("");
  const toast = useToast();
  const assign = useAction(() => supervisorApi.assignOrder(order.id, { operatorUserId: operatorUserId || null, reason: reason || undefined }));

  const submit = async () => {
    try {
      await assign.run();
      toast.push(operatorUserId ? "Order reassigned." : "Order returned to the shared queue.");
      onAssigned();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Could not assign order", "danger"); }
  };

  return (
    <Modal open onClose={onClose} title="Assign operator" description={`Order ${order.orderCode}`}>
      <div className="space-y-4">
        <FormField as="select" label="Operator" value={operatorUserId} onChange={(e) => setOperatorUserId(e.target.value)}>
          <option value="">Return to shared queue (unassign)</option>
          {operators.map((o) => <option key={o.id} value={o.id}>{o.fullName ?? o.id}</option>)}
        </FormField>
        <FormField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Closer to their current route" />
        {assign.error && <p className="text-sm text-danger">{assign.error}</p>}
        <button onClick={submit} disabled={assign.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {assign.busy ? "Saving…" : "Confirm"}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ pickups

function PickupsPanel() {
  const [date, setDate] = useState(today());
  const pickups = useAsync(() => supervisorApi.pickups({ date }), [date]);

  const columns: Column<PickupRow>[] = [
    { header: "Resident", cell: (p) => <div><p>{String(p.residentName ?? "—")}</p><p className="text-xs text-muted-foreground">{String(p.unitNumber ?? "")}</p></div> },
    { header: "Society", cell: (p) => p.societyName ?? "—" },
    { header: "Scheduled", cell: (p) => formatDateTime(p.scheduledFor) },
    { header: "Operator", cell: (p) => p.operatorName ?? <span className="text-muted-foreground">Unassigned</span> },
    {
      header: "Status", cell: (p) => (
        <StatusBadge status={p.pickupStatus} label={p.pickupStatusLabel} toneMap={{ due: "danger", scheduled: "warning", completed: "success", failed: "danger" }} />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <FormField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
      <Panel loading={pickups.loading} error={pickups.error} onRetry={pickups.reload}>
        <DataTable columns={columns} rows={pickups.data?.pickups ?? []} keyField={(p) => p.id} emptyTitle="No pickups for this day" />
      </Panel>
    </div>
  );
}

// --------------------------------------------------------------- processing

function ProcessingPanel() {
  const processing = useAsync(() => supervisorApi.processing(), []);
  const [bucket, setBucket] = useState<keyof NonNullable<typeof processing.data> | null>(null);

  const buckets: { key: keyof NonNullable<typeof processing.data>; label: string }[] = [
    { key: "waitingForWashing", label: "Waiting for washing" },
    { key: "washing", label: "Washing" },
    { key: "ironingPending", label: "Ironing pending" },
    { key: "ironing", label: "Ironing" },
    { key: "waitingForQc", label: "Waiting for QC" },
    { key: "qcFailed", label: "QC failed" },
    { key: "readyForDelivery", label: "Ready for delivery" },
    { key: "outForDelivery", label: "Out for delivery" },
  ];

  return (
    <Panel loading={processing.loading} error={processing.error} onRetry={processing.reload}>
      {processing.data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {buckets.map((b) => (
              <button key={b.key} onClick={() => setBucket(bucket === b.key ? null : b.key)} className={cn("text-left", bucket === b.key && "outline-none")}>
                <StatCard icon={b.key === "qcFailed" ? AlertTriangle : Shirt} label={b.label} value={String(processing.data![b.key].length)} tint={b.key === "qcFailed" ? "danger" : bucket === b.key ? "primary" : "accent"} />
              </button>
            ))}
          </div>
          {bucket && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{buckets.find((b) => b.key === bucket)?.label}</h3>
              {processing.data[bucket].length === 0 ? (
                <EmptyState title="Nothing here right now" />
              ) : (
                <ul className="space-y-2">
                  {processing.data[bucket].map((o) => (
                    <li key={o.id} className="flex items-center justify-between rounded-xl glass p-3.5 text-sm">
                      <div><p className="font-medium">{o.orderCode}</p><p className="text-xs text-muted-foreground">{o.residentName} · {o.blockName}</p></div>
                      <span className="text-xs text-muted-foreground">{o.operatorName ?? "Unassigned"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------- qc

function QcPanel() {
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const qc = useAsync(() => supervisorApi.qc({ status: status === "all" ? undefined : status, q: q || undefined, limit, offset }), [status, q, offset]);

  const cols: Column<OrderSummary>[] = [
    { header: "Order", cell: (o) => <div><p className="font-medium">{o.orderCode}</p><p className="text-xs text-muted-foreground">{o.residentName}</p></div> },
    { header: "Checked", cell: (o) => (o.qcCheckedAt ? formatDateTime(o.qcCheckedAt) : "—") },
    { header: "Result", cell: (o) => <StatusBadge status={o.qcStatus ?? "pending"} toneMap={{ passed: "success", failed: "danger", recheck: "warning", pending: "muted" }} /> },
    { header: "Operator", cell: (o) => o.operatorName ?? "—" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search order or resident" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <FormField as="select" label="Result" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="w-40">
          <option value="all">All results</option>
          {(qc.data?.filters.statuses ?? ["pending", "passed", "recheck", "failed"]).map((s) => <option key={s} value={s}>{s}</option>)}
        </FormField>
      </div>
      <Panel loading={qc.loading} error={qc.error} onRetry={qc.reload}>
        <DataTable columns={cols} rows={qc.data?.qc ?? []} keyField={(o) => o.id} emptyTitle="No quality checks match" />
        {qc.data && qc.data.page.hasMore && (
          <div className="mt-3 text-center">
            <button onClick={() => setOffset(offset + limit)} className="rounded-full glass px-4 py-2 text-xs font-medium hover:ring-1 hover:ring-primary/40">Load more</button>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ delayed

function DelayedPanel() {
  const delayed = useAsync(() => supervisorApi.delayed(), []);
  const columns: Column<OrderSummary>[] = [
    { header: "Order", cell: (o) => <div><p className="font-medium">{o.orderCode}</p><p className="text-xs text-muted-foreground">{o.residentName}</p></div> },
    { header: "State", cell: (o) => <StatusBadge status={o.state} /> },
    { header: "Operator", cell: (o) => o.operatorName ?? "Unassigned" },
    { header: "Late by", align: "right", cell: (o) => <span className="font-semibold text-danger">{o.delayMinutes} min</span> },
  ];
  return (
    <Panel loading={delayed.loading} error={delayed.error} onRetry={delayed.reload}>
      <DataTable columns={columns} rows={delayed.data?.orders ?? []} keyField={(o) => o.id} emptyTitle="Nothing is delayed" emptyDescription="Every order in your area is on schedule." />
    </Panel>
  );
}
