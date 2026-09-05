"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { StatusBadge } from "@/components/portal/status-badge";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { Button } from "@/components/ui/button";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { formatDateTime, rupees } from "@/lib/format";
import { operationsApi, type ServiceRequestView } from "@/lib/api/operations";

// On-demand services — vehicle washing, at-home ironing — are bookings rather than
// laundry orders: nothing is collected, nothing goes through a batch. Assign, start
// and complete are the whole lifecycle.
export function ServicesTab() {
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState("");
  const services = useAsync(() => operationsApi.services({ mine: mine || undefined, status: status || undefined }), [mine, status]);
  const [completing, setCompleting] = useState<ServiceRequestView | null>(null);
  const toast = useToast();

  const assign = useAction((id: string) => operationsApi.assignService(id));
  const start = useAction(operationsApi.startService);

  const columns: Column<ServiceRequestView>[] = [
    {
      header: "Job",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.offeringName}</p>
          <p className="text-xs text-muted-foreground">{r.kindLabel}{r.vehicleType ? ` · ${r.vehicleType}` : ""}</p>
        </div>
      ),
    },
    { header: "Scheduled", cell: (r) => <span className="text-sm">{formatDateTime(r.scheduledFor)}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} label={r.statusLabel} toneMap={{ completed: "success", cancelled: "muted", in_progress: "primary" }} /> },
    { header: "Quoted", cell: (r) => <span className="tabular-nums">{rupees(r.quotedPaise)}</span>, align: "right" },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-2">
          {r.status === "requested" && (
            <Button size="sm" disabled={assign.busy} onClick={() => assign.run(r.id).then(() => { services.reload(); toast.push("Job taken"); }).catch(() => {})}>
              Take this job
            </Button>
          )}
          {r.status === "assigned" && (
            <Button size="sm" disabled={start.busy} onClick={() => start.run(r.id).then(() => { services.reload(); toast.push("Job started"); }).catch(() => {})}>
              Start
            </Button>
          )}
          {r.status === "in_progress" && <Button size="sm" onClick={() => setCompleting(r)}>Complete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full glass px-3.5 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-ring">
          <option value="">All statuses</option>
          {services.data?.statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 rounded border-border" />
          My jobs only
        </label>
      </div>
      {(assign.error || start.error) && <p className="text-sm text-danger">{assign.error ?? start.error}</p>}
      <DataTable
        columns={columns}
        rows={services.data?.requests ?? []}
        keyField={(r) => r.id}
        loading={services.loading}
        error={services.error}
        emptyTitle="No service jobs"
        emptyDescription="Vehicle washing and at-home ironing bookings will show up here."
      />
      {completing && (
        <CompleteServiceModal
          request={completing}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); services.reload(); toast.push("Job completed"); }}
        />
      )}
    </div>
  );
}

function CompleteServiceModal({ request, onClose, onDone }: { request: ServiceRequestView; onClose: () => void; onDone: () => void }) {
  const [actualHours, setActualHours] = useState(request.estimatedHours ? String(request.estimatedHours) : "");
  const [note, setNote] = useState("");
  const action = useAction(operationsApi.completeService);

  return (
    <Modal open onClose={onClose} title="Complete this job" description={request.offeringName}>
      <div className="space-y-4">
        {request.estimatedHours != null && (
          <FormField label="Actual hours" type="number" min={0} step="0.5" value={actualHours} onChange={(e) => setActualHours(e.target.value)} />
        )}
        <FormField as="textarea" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {action.error && <p className="text-sm text-danger">{action.error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1" disabled={action.busy}
            onClick={() => action.run(request.id, { actualHours: actualHours ? Number(actualHours) : undefined, note: note.trim() || undefined }).then(onDone)}
          >
            {action.busy ? <Loader2 className="size-4 animate-spin" /> : "Complete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
