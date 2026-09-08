"use client";

import * as React from "react";
import { Plus, Settings2 } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { EmptyState } from "@/components/portal/empty-state";
import { DatePicker } from "@/components/portal/date-picker";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type Slot } from "@/lib/api/admin";
import { formatDate } from "@/lib/format";
import { SlotsSchedulingConfig } from "./config/slots-scheduling";

const SLOT_STATUS_TONE = { open: "success", full: "warning", cancelled: "danger", closed: "muted" } as const;
function slotStatus(r: Slot): string {
  if (!r.isActive) return "cancelled";
  if (r.capacityRemaining <= 0) return "full";
  return r.status ?? "open";
}

export function SlotsSection() {
  const [societyId, setSocietyId] = React.useState("");
  const [date, setDate] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("");
  const societies = useAsync(() => adminApi.societies.list(), []);
  const { data, loading, error, reload } = useAsync(
    () => adminApi.slots.list({ societyId: societyId || undefined, date: date || undefined, status: status || undefined }),
    [societyId, date, status],
  );
  const toast = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [viewing, setViewing] = React.useState<Slot | null>(null);
  const [bookingsFor, setBookingsFor] = React.useState<string | null>(null);

  const columns: Column<Slot>[] = [
    { header: "Society", cell: (r) => r.societyName ?? r.societyId },
    { header: "Date", cell: (r) => formatDate(r.date) },
    { header: "Window", cell: (r) => `${r.window} (${r.startTime}–${r.endTime})` },
    { header: "Capacity", align: "right", cell: (r) => `${r.capacityTotal - r.capacityRemaining} / ${r.capacityTotal}` },
    { header: "Status", cell: (r) => <StatusBadge status={slotStatus(r)} toneMap={SLOT_STATUS_TONE} /> },
    { header: "Actions", align: "right", cell: (r) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setBookingsFor(r.id)} className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">Bookings</button>
        <button onClick={() => setViewing(r)} className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">Edit</button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All societies</option>
          {(societies.data?.societies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {/* Calendar filter — historical dates stay selectable so past slots can be reviewed. */}
        <DatePicker value={date} onChange={setDate} placeholder="All dates" className="w-44" ariaLabel="Filter by date" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All statuses</option>
          {(data?.statuses ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-1.5 rounded-full glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40">
            <Settings2 className="size-4" /> Slot Settings
          </button>
          <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
            <Plus className="size-4" /> New slot
          </button>
        </div>
      </div>
      <DataTable columns={columns} rows={data?.slots ?? []} keyField={(r) => r.id} loading={loading} error={error} onRowClick={(r) => setViewing(r)}
        emptyTitle="No slots match" emptyDescription="Create a slot for residents to book against." />

      <CreateSlotModal open={createOpen} onClose={() => setCreateOpen(false)} societies={societies.data?.societies ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Slot created"); }} />
      {viewing && (
        <SlotDrawer slot={viewing} onClose={() => setViewing(null)} onChanged={() => { reload(); }}
          onBookings={() => { const id = viewing.id; setViewing(null); setBookingsFor(id); }} />
      )}
      {bookingsFor && <SlotBookingsModal id={bookingsFor} onClose={() => setBookingsFor(null)} />}

      {settingsOpen && (
        <Modal open onClose={() => setSettingsOpen(false)} variant="drawer" title="Slot Settings"
          description="Configure slot and scheduling rules for all societies.">
          <SlotsSchedulingConfig onClose={() => setSettingsOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

// The slot detail / edit drawer. Opens read-only, and an Edit toggle turns the
// window, capacity, status and reservation into editable controls. Capacity cannot
// be set below the number already booked.
function SlotDrawer({ slot, onClose, onChanged, onBookings }: { slot: Slot; onClose: () => void; onChanged: () => void; onBookings: () => void }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [editing, setEditing] = React.useState(false);
  const [window_, setWindow] = React.useState(slot.window);
  const [capacity, setCapacity] = React.useState(String(slot.capacityTotal));
  const [active, setActive] = React.useState(slot.isActive);
  const [subscribersOnly, setSubscribersOnly] = React.useState(Boolean(slot.subscribersOnly));
  const booked = slot.capacityTotal - slot.capacityRemaining;
  const save = useAction(() => adminApi.slots.update(slot.id, { window: window_, capacityTotal: Number(capacity), isActive: active, subscribersOnly }));
  const cancel = useAction(() => adminApi.slots.cancel(slot.id));

  const capacityError = Number(capacity) < booked ? `Capacity cannot be less than the current number of bookings (${booked}).` : "";

  return (
    <Modal open onClose={onClose} variant="drawer" title={`${slot.window} slot`} description={`${slot.societyName ?? ""} · ${formatDate(slot.date)}`}>
      <div className="space-y-4">
        {!editing ? (
          <>
            <section className="rounded-2xl glass p-3">
              {[["Society", slot.societyName ?? slot.societyId], ["Date", formatDate(slot.date)], ["Time window", `${slot.window} (${slot.startTime}–${slot.endTime})`],
                ["Capacity", String(slot.capacityTotal)], ["Current bookings", String(booked)], ["Available", String(slot.capacityRemaining)],
                ["Status", slotStatus(slot)], ["Reserved for", slot.subscribersOnly ? "Plan subscribers only" : "All residents"]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium capitalize">{v}</span></div>
              ))}
            </section>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setEditing(true)} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110">Edit slot</button>
              <button onClick={onBookings} className="rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40">View bookings</button>
              {slot.isActive && (
                <button onClick={async () => {
                  const ok = await confirm({ title: "Cancel this slot?", description: booked > 0 ? `${booked} resident(s) are booked and will be notified to reschedule.` : "This slot will be closed to new bookings.", confirmLabel: "Cancel slot", danger: true });
                  if (!ok) return;
                  cancel.run().then(() => { toast.push("Slot cancelled"); onChanged(); onClose(); }).catch((e) => toast.push(e?.message ?? "Could not cancel", "danger"));
                }} className="rounded-xl glass px-4 py-2 text-sm font-medium text-danger hover:ring-1 hover:ring-danger/40">Cancel slot</button>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (capacityError) return; save.run().then(() => { toast.push("Slot updated"); onChanged(); setEditing(false); }).catch(() => {}); }} className="space-y-4">
            <FormField as="select" label="Time window" value={window_} onChange={(e) => setWindow(e.target.value)}>
              <option value="Morning">Morning</option>
              <option value="Afternoon">Afternoon</option>
              <option value="Evening">Evening</option>
            </FormField>
            <FormField label="Capacity" type="number" min={booked} value={capacity} onChange={(e) => setCapacity(e.target.value)} error={capacityError} hint={`${booked} already booked`} />
            <FormField as="select" label="Status" value={active ? "active" : "cancelled"} onChange={(e) => setActive(e.target.value === "active")}>
              <option value="active">Open</option>
              <option value="cancelled">Cancelled</option>
            </FormField>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subscribersOnly} onChange={(e) => setSubscribersOnly(e.target.checked)} className="size-4 rounded border-border" /> Reserved for plan subscribers only</label>
            {save.error && <p className="text-sm text-danger">Unable to save changes. {save.error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
              <button type="submit" disabled={save.busy || !!capacityError} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">{save.busy ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

function CreateSlotModal({ open, onClose, societies, onCreated }: { open: boolean; onClose: () => void; societies: { id: string; name: string }[]; onCreated: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [societyId, setSocietyId] = React.useState("");
  const [date, setDate] = React.useState<string | null>(null);
  const [window_, setWindow] = React.useState<"Morning" | "Afternoon" | "Evening">("Morning");
  const [capacityTotal, setCapacityTotal] = React.useState("10");
  const [subscribersOnly, setSubscribersOnly] = React.useState(false);
  const create = useAction(() => adminApi.slots.create({ societyId, date: date!, window: window_, capacityTotal: Number(capacityTotal), subscribersOnly }));

  React.useEffect(() => { if (open) { setSocietyId(""); setDate(null); setWindow("Morning"); setCapacityTotal("10"); setSubscribersOnly(false); } }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="New slot">
      <form onSubmit={(e) => { e.preventDefault(); create.run().then(onCreated).catch(() => {}); }} className="space-y-4">
        <FormField as="select" label="Society" required value={societyId} onChange={(e) => setSocietyId(e.target.value)}>
          <option value="">Choose a society</option>
          {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormField>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">Date <span className="text-danger">*</span></label>
          {/* Slot creation cannot pick a day that has already gone. */}
          <DatePicker value={date} onChange={setDate} min={today} placeholder="Choose a date" clearable={false} ariaLabel="Slot date" />
        </div>
        <FormField as="select" label="Window" required value={window_} onChange={(e) => setWindow(e.target.value as typeof window_)} hint="Start and end times follow the window.">
          <option value="Morning">Morning</option>
          <option value="Afternoon">Afternoon</option>
          <option value="Evening">Evening</option>
        </FormField>
        <FormField label="Capacity" type="number" required min={1} value={capacityTotal} onChange={(e) => setCapacityTotal(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subscribersOnly} onChange={(e) => setSubscribersOnly(e.target.checked)} className="size-4 rounded border-border" /> Subscribers only</label>
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button type="submit" disabled={create.busy || !societyId || !date} className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Creating…" : "Create slot"}
        </button>
      </form>
    </Modal>
  );
}

function SlotBookingsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.slots.bookings(id), [id]);
  const [q, setQ] = React.useState("");
  const rows = (data?.bookings ?? []).filter((b) => !q.trim() || JSON.stringify(b).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal open onClose={onClose} title="Slot bookings" variant="drawer">
      <Panel loading={loading} error={error} onRetry={reload}>
        {data && (
          <div className="space-y-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bookings" className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            {rows.length === 0 ? (
              <EmptyState title="Nobody booked yet" description="This slot has no matching bookings." />
            ) : (
              <div className="space-y-2">
                {rows.map((b, i) => (
                  <div key={i} className="rounded-xl glass p-3 text-sm">
                    <p className="font-medium">{String(b.residentName ?? "Resident")}</p>
                    <p className="text-xs text-muted-foreground">{String(b.unitNumber ?? "")} {b.blockName ? `· ${String(b.blockName)}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{String(b.orderCode ?? "")} {b.state ? `· ${String(b.state)}` : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </Modal>
  );
}
