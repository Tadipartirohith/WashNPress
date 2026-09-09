"use client";

import * as React from "react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { StatCard } from "@/components/portal/stat-card";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type RefundRequest } from "@/lib/api/admin";
import { formatDate, rupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IndianRupee, Clock, CheckCircle2, XCircle } from "lucide-react";

const STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger" } as const;

// The refunds queue. Every refund a resident is owed waits here until an admin
// approves it — the money moves on approval — or rejects it. Mirrors the mobile
// RefundsQueue (api.refunds / approveRefund / rejectRefund).
export function RefundsSection() {
  const [status, setStatus] = React.useState("pending");
  const { data, loading, error, reload } = useAsync(() => adminApi.refunds.list(status ? { status } : {}), [status]);
  const [deciding, setDeciding] = React.useState<{ request: RefundRequest; action: "approve" | "reject" } | null>(null);

  const requests = data?.requests ?? [];
  const pending = requests.filter((r) => r.status === "pending").length;
  const approved = requests.filter((r) => r.status === "approved").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;
  const pendingPaise = requests.filter((r) => r.status === "pending").reduce((n, r) => n + r.amountPaise + r.taxPaise, 0);

  const columns: Column<RefundRequest>[] = [
    { header: "Order", cell: (r) => <span className="font-medium">{r.orderCode || r.orderId.slice(0, 8)}</span> },
    { header: "Amount", align: "right", cell: (r) => (
      <span className="tabular-nums">{rupees(r.amountPaise + r.taxPaise)}{r.taxPaise > 0 && <span className="ml-1 text-xs text-muted-foreground">incl. {rupees(r.taxPaise)} tax</span>}</span>
    ) },
    { header: "Reason", cell: (r) => <span className="text-sm text-muted-foreground">{r.reason || "—"}</span> },
    { header: "Requested", cell: (r) => r.createdAt ? formatDate(r.createdAt) : "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={STATUS_TONE} /> },
    { header: "Decision", cell: (r) => r.status === "pending"
      ? <span className="text-xs text-muted-foreground">Awaiting</span>
      : <span className="text-xs text-muted-foreground">{r.decidedAt ? formatDate(r.decidedAt) : ""}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span> },
    { header: "Actions", align: "right", cell: (r) => r.status !== "pending" ? <span className="text-xs text-muted-foreground">—</span> : (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setDeciding({ request: r, action: "approve" })}
          className="rounded-full glass px-2.5 py-1 text-xs text-success hover:ring-1 hover:ring-success/40">Approve</button>
        <button onClick={() => setDeciding({ request: r, action: "reject" })}
          className="rounded-full glass px-2.5 py-1 text-xs text-danger hover:ring-1 hover:ring-danger/40">Reject</button>
      </div>
    ) },
  ];

  const STATUSES = [
    { id: "pending", label: "Pending" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
    { id: "", label: "All" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Clock} label="Pending" value={String(pending)} tint="warning" />
        <StatCard icon={IndianRupee} label="Pending value" value={rupees(pendingPaise)} tint="primary" />
        <StatCard icon={CheckCircle2} label="Approved" value={String(approved)} tint="success" />
        <StatCard icon={XCircle} label="Rejected" value={String(rejected)} tint="danger" />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button key={s.id} onClick={() => setStatus(s.id)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium", status === s.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
            {s.label}
          </button>
        ))}
      </div>

      <DataTable columns={columns} rows={requests} keyField={(r) => r.id} loading={loading} error={error}
        emptyTitle="No refunds" emptyDescription="No refund requests match this filter." />

      {deciding && (
        <DecideModal request={deciding.request} action={deciding.action}
          onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload(); }} />
      )}
    </div>
  );
}

function DecideModal({ request, action, onClose, onDone }: {
  request: RefundRequest; action: "approve" | "reject"; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = React.useState("");
  const decide = useAction(() => action === "approve"
    ? adminApi.refunds.approve(request.id, note.trim() || undefined)
    : adminApi.refunds.reject(request.id, note.trim() || undefined));
  const approving = action === "approve";

  return (
    <Modal open onClose={onClose} title={approving ? "Approve refund" : "Reject refund"}
      description={`Order ${request.orderCode || request.orderId.slice(0, 8)} · ${rupees(request.amountPaise + request.taxPaise)}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {approving
            ? "Approving releases the refund back to the resident. This cannot be undone."
            : "Rejecting closes the request without moving any money."}
        </p>
        <FormField as="textarea" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={approving ? "Why this is being approved" : "Why this is being rejected"} />
        {decide.error && <p className="text-sm text-danger">{decide.error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
          <button type="button" disabled={decide.busy}
            onClick={() => decide.run().then(() => { toast.push(approving ? "Refund approved" : "Refund rejected"); onDone(); }).catch(() => {})}
            className={cn("flex-1 rounded-xl py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50",
              approving ? "bg-primary hover:brightness-110" : "bg-danger hover:brightness-110")}>
            {decide.busy ? "Working…" : approving ? "Approve refund" : "Reject refund"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
