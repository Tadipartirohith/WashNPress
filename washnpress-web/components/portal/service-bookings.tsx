"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { DatePicker } from "@/components/portal/date-picker";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/lib/use-async";
import { formatDate, formatDateTime, rupees } from "@/lib/format";
import { formatUnit } from "@/lib/unit";

// I-82: the Admin and Supervisor window onto every additional-service booking a
// resident has made. Read-only — creating, taking and completing a booking belong to
// the resident and the operator; here staff only see what was booked, its schedule,
// status, price and who is working it. Admin and Supervisor read the same records
// (listForStaff), so the two portals can never disagree about a booking.

export interface ServiceBookingRow {
  id: string;
  offeringName: string;
  status: string;
  statusLabel: string;
  scheduledFor: string;
  slotWindow?: string | null;
  payablePaise: number;
  includedInPlan: boolean;
  residentName: string | null;
  residentPhone?: string | null;
  unitNumber: string | null;
  blockName?: string | null;
  societyName: string | null;
  assignedToName: string | null;
  supervisorName?: string | null;
  cancelledReason?: string | null;
  createdAt?: string;
  kindLabel?: string;
}
export interface ServiceBookingsData {
  requests: ServiceBookingRow[];
  offerings?: { id: string; name: string }[];
  societies?: { id: string; name: string }[];
}
export interface ServiceBookingFilters {
  status?: string; offeringId?: string; societyId?: string; from?: string; to?: string;
}

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
const priceLabel = (r: ServiceBookingRow) => (r.includedInPlan ? "Included with plan" : rupees(r.payablePaise));

export function ServiceBookingsView({
  title, subtitle, fetcher, showSociety = false,
}: {
  title: string;
  subtitle: string;
  fetcher: (filters: ServiceBookingFilters) => Promise<ServiceBookingsData>;
  showSociety?: boolean;
}) {
  const [status, setStatus] = useState("");
  const [offeringId, setOfferingId] = useState("");
  const [societyId, setSocietyId] = useState("");
  const [date, setDate] = useState("");
  const [q, setQ] = useState("");
  const data = useAsync(() => fetcher({
    status: status || undefined, offeringId: offeringId || undefined,
    societyId: showSociety ? (societyId || undefined) : undefined,
    from: date || undefined, to: date || undefined,
  }), [status, offeringId, societyId, date, showSociety]);
  const [open, setOpen] = useState<ServiceBookingRow | null>(null);

  // Text search is applied on the client over the fetched page, matching what the
  // operator list does — the resident's name, the booking code or the service.
  const needle = q.trim().toLowerCase();
  const rows = (data.data?.requests ?? []).filter((r) =>
    !needle
    || asCode(r.id).toLowerCase().includes(needle)
    || (r.residentName ?? "").toLowerCase().includes(needle)
    || r.offeringName.toLowerCase().includes(needle),
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button key={s.key} onClick={() => setStatus(s.key)}
            className={`rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${status === s.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground"}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select value={offeringId} onChange={(e) => setOfferingId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All Services</option>
          {(data.data?.offerings ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {showSociety && (
          <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">All Societies</option>
            {(data.data?.societies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <DatePicker value={date || null} placeholder="Any date" ariaLabel="Filter by date" onChange={(v) => setDate(v ?? "")} />
        <span className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 text-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search booking, resident or service" className="w-full bg-transparent py-2 outline-none" />
        </span>
      </div>

      {data.loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : data.error ? (
        <div className="rounded-2xl glass p-6 text-sm text-danger">{data.error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">No additional service bookings match.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start gap-3 rounded-2xl glass p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{asCode(r.id)}</span>
                  <StatusBadge status={r.status} label={STATUS_LABEL[r.status] ?? r.statusLabel} toneMap={statusTone} />
                </div>
                <p className="mt-0.5 text-sm font-semibold">{r.offeringName}</p>
                <p className="text-xs text-muted-foreground">{[r.residentName, formatUnit(r.blockName, r.unitNumber), r.societyName].filter(Boolean).join(" · ")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(r.scheduledFor)}{r.slotWindow ? ` · ${r.slotWindow}` : ""} · {priceLabel(r)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Operator: {r.assignedToName ?? "Unassigned"}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setOpen(r)}>View</Button>
            </div>
          ))}
        </div>
      )}

      {open && <BookingDetails booking={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BookingDetails({ booking, onClose }: { booking: ServiceBookingRow; onClose: () => void }) {
  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="flex justify-between gap-3 py-1"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value || "—"}</span></div>
  );
  return (
    <Modal open onClose={onClose} variant="drawer" title={booking.offeringName} description={asCode(booking.id)}>
      <div className="space-y-4 text-sm">
        <div className="rounded-2xl glass p-4">
          <Row label="Status" value={STATUS_LABEL[booking.status] ?? booking.statusLabel} />
          <Row label="Resident" value={booking.residentName} />
          <Row label="Phone" value={booking.residentPhone} />
          <Row label="Unit / Society" value={[formatUnit(booking.blockName, booking.unitNumber), booking.societyName].filter(Boolean).join(" · ") || null} />
          <Row label="Scheduled" value={`${formatDate(booking.scheduledFor)}${booking.slotWindow ? ` · ${booking.slotWindow}` : ""}`} />
          <Row label="Price" value={priceLabel(booking)} />
          <Row label="Operator" value={booking.assignedToName} />
          {booking.supervisorName && <Row label="Supervisor" value={booking.supervisorName} />}
          {booking.createdAt && <Row label="Booked" value={formatDateTime(booking.createdAt)} />}
          {booking.status === "cancelled" && <Row label="Cancelled reason" value={booking.cancelledReason} />}
        </div>
      </div>
    </Modal>
  );
}
