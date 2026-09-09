"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { formatDateTime, rupees } from "@/lib/format";
import { supervisorApi, type RefundRequest } from "@/lib/api/supervisor";

// Refunds raised on orders in this supervisor's societies, to approve or turn
// down. The money moves to the resident's wallet on approval and nothing at all on
// reject. The backend scopes the list to this supervisor's societies from the
// session — mirrors the mobile RefundsQueue.
export function RefundsTab() {
  const [status, setStatus] = useState<"pending" | "all" | "approved" | "rejected">("pending");
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useAsync(
    () => supervisorApi.refunds(status === "all" ? {} : { status }),
    [status],
  );

  const columns: Column<RefundRequest>[] = [
    { header: "Order", cell: (r) => <div><p className="font-medium">{r.orderCode}</p><p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</p></div> },
    { header: "Amount", cell: (r) => <div><p className="font-medium tabular-nums">{rupees(r.amountPaise + r.taxPaise)}</p>{r.taxPaise > 0 && <p className="text-xs text-muted-foreground">incl. GST {rupees(r.taxPaise)}</p>}</div> },
    { header: "Reason", cell: (r) => <span className="line-clamp-2 max-w-xs text-sm">{r.reason}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={{ pending: "warning", approved: "success", rejected: "muted" }} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FormField as="select" label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-48">
          <option value="pending">Pending decision</option>
          <option value="all">All refunds</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </FormField>
      </div>
      <Panel loading={list.loading} error={list.error} onRetry={list.reload}>
        <DataTable
          columns={columns}
          rows={list.data?.requests ?? []}
          keyField={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)}
          emptyTitle="No refunds here"
          emptyDescription={status === "pending" ? "No refunds are waiting for a decision." : "No refund requests match this filter."}
        />
      </Panel>
      {openId && (
        <RefundDrawer
          refund={(list.data?.requests ?? []).find((r) => r.id === openId)!}
          onClose={() => setOpenId(null)}
          onDecided={() => { setOpenId(null); list.reload(); }}
        />
      )}
    </div>
  );
}

function RefundDrawer({ refund, onClose, onDecided }: { refund: RefundRequest; onClose: () => void; onDecided: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const approve = useAction(() => supervisorApi.approveRefund(refund.id, note.trim() || undefined));
  const reject = useAction(() => supervisorApi.rejectRefund(refund.id, note.trim() || undefined));

  const decide = async (action: "approve" | "reject") => {
    try {
      if (action === "approve") await approve.run();
      else await reject.run();
      toast.push(action === "approve"
        ? `Refund approved — ${rupees(refund.amountPaise + refund.taxPaise)} returned to the resident's wallet.`
        : "Refund request turned down.");
      onDecided();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Could not record the decision", "danger"); }
  };

  const pending = refund.status === "pending";
  const busy = approve.busy || reject.busy;

  return (
    <Modal open onClose={onClose} variant="drawer" title="Refund request" description={`Order ${refund.orderCode}`}>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <StatusBadge status={refund.status} toneMap={{ pending: "warning", approved: "success", rejected: "muted" }} />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Amount" value={rupees(refund.amountPaise + refund.taxPaise)} />
          {refund.taxPaise > 0 && <Field label="of which GST" value={rupees(refund.taxPaise)} />}
          <Field label="Requested" value={formatDateTime(refund.createdAt)} />
          {refund.decidedAt && <Field label="Decided" value={formatDateTime(refund.decidedAt)} />}
        </dl>

        <div>
          <p className="text-xs text-muted-foreground">Reason</p>
          <p className="mt-1 rounded-xl bg-foreground/5 p-3 text-sm">{refund.reason}</p>
        </div>

        {!pending && refund.decisionNote && (
          <div>
            <p className="text-xs text-muted-foreground">Decision note</p>
            <p className="mt-1 rounded-xl bg-foreground/5 p-3 text-sm">{refund.decisionNote}</p>
          </div>
        )}

        {pending ? (
          <>
            <FormField as="textarea" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this decision" />
            {(approve.error || reject.error) && <p className="text-sm text-danger">{approve.error ?? reject.error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => decide("approve")} disabled={busy} className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
                <Check className="size-4" /> Approve
              </button>
              <button onClick={() => decide("reject")} disabled={busy} className="flex items-center justify-center gap-2 rounded-xl bg-danger py-3 font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-50">
                <X className="size-4" /> Reject
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">Approving returns the money to the resident&apos;s wallet. Rejecting records the decision and moves nothing.</p>
          </>
        ) : (
          <p className="rounded-xl bg-foreground/5 p-3 text-sm text-muted-foreground">This refund has already been decided. It&apos;s read-only from here.</p>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
