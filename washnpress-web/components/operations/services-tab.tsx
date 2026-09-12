"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { DatePicker } from "@/components/portal/date-picker";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { formatDate, rupees } from "@/lib/format";
import { operationsApi, type ServiceRequestView } from "@/lib/api/operations";
import { formatUnit } from "@/lib/unit";

// The operator's additional-service bookings. Services come from Admin — the operator
// never picks or prices one; it takes, works and completes the booking the resident made.
const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "requested", label: "Scheduled" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];
const STATUS_LABEL: Record<string, string> = {
  requested: "Scheduled", assigned: "Assigned", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled",
};
const statusTone: Record<string, "success" | "muted" | "primary" | "warning"> = {
  completed: "success", cancelled: "muted", in_progress: "primary", assigned: "warning", requested: "warning",
};
const asCode = (id: string) => `AS-${id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase()}`;
const priceLabel = (r: ServiceRequestView) => (r.includedInPlan ? "Included with plan" : rupees(r.payablePaise));

// I-88: urgency is separate from the operational status. A booking not yet worked is
// Due once its slot window has begun and Overdue once the window has passed — a hint
// to act, shown alongside (not instead of) Scheduled/Assigned/In Progress.
function urgencyOf(r: ServiceRequestView): "" | "Due" | "Overdue" {
  if (r.status === "completed" || r.status === "cancelled" || r.status === "in_progress") return "";
  const start = new Date(r.scheduledFor).getTime();
  if (Number.isNaN(start)) return "";
  const now = Date.now();
  if (now >= start + 3 * 3600 * 1000) return "Overdue";
  if (now >= start) return "Due";
  return "";
}

export function ServicesTab() {
  const [status, setStatus] = useState("");
  const [offeringId, setOfferingId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  // I-88: every status is fetched (status is not sent to the server) so the tab
  // counts are the real totals and a card moves between tabs the moment its status
  // changes — the status filter is applied here, on the client, over the same set.
  const services = useAsync(() => operationsApi.services({
    offeringId: offeringId || undefined,
    assignedToUserId: assignedToUserId || undefined, date: date || undefined,
  }), [offeringId, assignedToUserId, date]);
  const [open, setOpen] = useState<ServiceRequestView | null>(null);

  const all = services.data?.requests ?? [];
  const counts = STATUS_FILTERS.reduce((acc, s) => {
    acc[s.key] = s.key === "" ? all.length : all.filter((r) => r.status === s.key).length;
    return acc;
  }, {} as Record<string, number>);
  const needle = q.trim().toLowerCase();
  const rows = all.filter((r) =>
    (!status || r.status === status)
    && (!needle || asCode(r.id).toLowerCase().includes(needle) || (r.residentName ?? "").toLowerCase().includes(needle) || r.offeringName.toLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">Additional Services</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Manage scheduled additional service bookings.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button key={s.key} onClick={() => setStatus(s.key)}
            className={`rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${status === s.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground"}`}>
            {s.label} <span className="opacity-70">{counts[s.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select value={offeringId} onChange={(e) => setOfferingId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All Services</option>
          {(services.data?.offerings ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">Everyone</option>
          {(services.data?.operators ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <DatePicker value={date || null} placeholder="Any date" ariaLabel="Filter by date" onChange={(v) => setDate(v ?? "")} />
        <span className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 text-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search booking ID or resident" className="w-full bg-transparent py-2 outline-none" />
        </span>
      </div>

      {services.loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : services.error ? (
        <div className="rounded-2xl glass p-6 text-sm text-danger">{services.error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">No additional service bookings match.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start gap-3 rounded-2xl glass p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">{asCode(r.id)}</span>
                  <StatusBadge status={r.status} label={STATUS_LABEL[r.status] ?? r.statusLabel} toneMap={statusTone} />
                  {(() => { const u = urgencyOf(r); return u ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u === "Overdue" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"}`}>{u}</span>
                  ) : null; })()}
                </div>
                <p className="mt-0.5 text-sm font-semibold">{r.offeringName}</p>
                <p className="text-xs text-muted-foreground">{[r.residentName, formatUnit(r.blockName, r.unitNumber), r.societyName].filter(Boolean).join(" · ")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(r.scheduledFor)}{r.slotWindow ? ` · ${r.slotWindow}` : ""} · {priceLabel(r)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Assigned to: {r.assignedToName ?? "Unassigned"}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setOpen(r)}>Open Booking</Button>
            </div>
          ))}
        </div>
      )}

      {open && <BookingModal booking={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); services.reload(); }} />}
    </div>
  );
}

function BookingModal({ booking, onClose, onChanged }: { booking: ServiceRequestView; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const assign = useAction(() => operationsApi.assignService(booking.id));
  const start = useAction(() => operationsApi.startService(booking.id));
  const complete = useAction((note?: string) => operationsApi.completeService(booking.id, note ? { note } : {}));
  const cancel = useAction((reason: string) => operationsApi.cancelService(booking.id, reason));
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="flex justify-between gap-3 py-1"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value || "—"}</span></div>
  );

  return (
    <Modal open onClose={onClose} variant="drawer" title={booking.offeringName} description={asCode(booking.id)}>
      <div className="space-y-4 text-sm">
        <div className="rounded-2xl glass p-4">
          <Row label="Status" value={STATUS_LABEL[booking.status] ?? booking.statusLabel} />
          <Row label="Resident" value={booking.residentName} />
          <Row label="Unit / Society" value={[formatUnit(booking.blockName, booking.unitNumber), booking.societyName].filter(Boolean).join(" · ") || null} />
          <Row label="Scheduled" value={`${formatDate(booking.scheduledFor)}${booking.slotWindow ? ` · ${booking.slotWindow}` : ""}`} />
          <Row label="Price" value={priceLabel(booking)} />
          <Row label="Assigned to" value={booking.assignedToName} />
          {booking.status === "cancelled" && <Row label="Cancelled reason" value={booking.cancelledReason} />}
        </div>

        {cancelling ? (
          <div className="space-y-2 rounded-xl bg-danger/10 p-4 ring-1 ring-danger/30">
            <FormField as="textarea" label="Reason for cancelling" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setCancelling(false)}>Back</Button>
              <Button size="sm" className="flex-1" onClick={() => cancel.run(cancelReason || "Cancelled by operator").then(() => { toast.push("Booking cancelled"); onChanged(); }).catch(() => toast.push(cancel.error ?? "Failed", "danger"))}>Confirm cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {booking.status === "requested" && <Button className="flex-1" disabled={assign.busy} onClick={() => assign.run().then(() => { toast.push("Job taken"); onChanged(); }).catch(() => toast.push(assign.error ?? "Failed", "danger"))}>Take this job</Button>}
            {booking.status === "assigned" && <Button className="flex-1" disabled={start.busy} onClick={() => start.run().then(() => { toast.push("Job started"); onChanged(); }).catch(() => toast.push(start.error ?? "Failed", "danger"))}>Start</Button>}
            {booking.status === "in_progress" && <Button className="flex-1" disabled={complete.busy} onClick={() => complete.run().then(() => { toast.push("Job completed"); onChanged(); }).catch(() => toast.push(complete.error ?? "Failed", "danger"))}>Complete</Button>}
            {(booking.status === "requested" || booking.status === "assigned") && <Button variant="outline" className="flex-1 text-danger" onClick={() => setCancelling(true)}>Cancel booking</Button>}
          </div>
        )}
      </div>
    </Modal>
  );
}
