"use client";

import { useState } from "react";
import { Plus, Ban, Pencil, CalendarPlus } from "lucide-react";
import { CreateSlotModal as CreateServiceSlotModal } from "@/components/portal/create-slot-modal";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { EmptyState } from "@/components/portal/empty-state";
import { DatePicker } from "@/components/portal/date-picker";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { formatDate } from "@/lib/format";
import { supervisorApi, type SlotView } from "@/lib/api/supervisor";

// A row in the slots table, whichever kind of slot it came from.
//
// `laundry` carries the original when there is one, because editing, cancelling and
// the bookings drawer are all laundry-only operations that need the real record. A
// service slot has none, which is what stops those actions being offered for it.
interface SlotRow {
  id: string;
  kind: "laundry" | "service";
  service: string;
  date: string;
  window: string;
  startTime: string | null;
  endTime: string | null;
  capacityTotal: number;
  booked: number;
  isActive: boolean;
  laundry: SlotView | null;
}

// The three windows the backend allows, in the order the day happens.
//
// Sorting the names alphabetically put Afternoon above Morning, so a supervisor
// reading down a day read it backwards. A service slot is booked against the window
// rather than a clock time and has no start time to sort by, so the order has to come
// from the names. A window added later sorts after the three that are known rather
// than silently taking Morning's place at the top.
const WINDOW_ORDER = ["Morning", "Afternoon", "Evening"];
function windowRank(window: string): number {
  const rank = WINDOW_ORDER.indexOf(window);
  return rank === -1 ? WINDOW_ORDER.length : rank;
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function daysFromNow(n: number): string { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// Pickup slots for the one society this supervisor runs. There is no society
// selector: /v1/supervisor/slots is already scoped to the session's societies, and
// creating a slot takes the society id from the supervisor's own /society call
// rather than from anything picked on screen.
export function SlotsTab() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(daysFromNow(6));
  const society = useAsync(() => supervisorApi.mySociety(), []);
  const slots = useAsync(() => supervisorApi.slots({ from, to }), [from, to]);
  // Additional-service slots live on their own endpoint and were never shown here,
  // so a supervisor who created a car wash slot had no way to see it afterwards.
  const serviceSlots = useAsync(() => supervisorApi.serviceSlots(), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [serviceSlotOpen, setServiceSlotOpen] = useState(false);
  const [editing, setEditing] = useState<SlotView | null>(null);
  const [viewing, setViewing] = useState<SlotView | null>(null);
  const toast = useToast();
  const { confirm } = useConfirm();

  const cancel = useAction((id: string) => supervisorApi.cancelSlot(id));

  const onCancel = async (slot: SlotView) => {
    const ok = await confirm({
      title: `Cancel the ${slot.window} slot on ${formatDate(slot.date)}?`,
      description: "Residents booked into it will need to be moved.",
      confirmLabel: "Cancel slot",
      danger: true,
    });
    if (!ok) return;
    try { await cancel.run(slot.id); toast.push("Slot cancelled."); slots.reload(); }
    catch (e) { toast.push(e instanceof Error ? e.message : "Could not cancel slot", "danger"); }
  };

  // One table, two sources.
  //
  // A laundry slot and a service slot are the same question — when can work happen,
  // and how much of it — asked about different work. Keeping them in separate places
  // meant a supervisor had to remember which screen a slot had been created on.
  //
  // Laundry has no service of its own, so it says "Laundry" rather than leaving the
  // column blank: an empty cell reads as missing data, not as "not applicable".
  const rows: SlotRow[] = [
    ...(slots.data?.slots ?? []).map((s): SlotRow => ({
      id: s.id, kind: "laundry", service: "Laundry", date: s.date, window: s.window,
      startTime: s.startTime, endTime: s.endTime,
      capacityTotal: s.capacityTotal, booked: s.bookedCount,
      isActive: s.isActive, laundry: s,
    })),
    // Held to the same From/To the laundry list obeys. The service endpoint takes a
    // single day rather than a range, so the range is applied here — without it the
    // table showed slots from outside the dates the supervisor had just chosen, which
    // reads as the filter being broken rather than as extra information.
    ...(serviceSlots.data?.slots ?? []).filter((s) => s.date >= from && s.date <= to).map((s): SlotRow => ({
      id: s.id, kind: "service", service: s.offeringName, date: s.date, window: s.window,
      // The service endpoint reports what is left rather than what is taken.
      startTime: null, endTime: null,
      capacityTotal: s.capacityTotal, booked: s.capacityTotal - s.capacityRemaining,
      isActive: s.isActive, laundry: null,
    })),
  ].sort((a, b) => (
    a.date === b.date
      ? windowRank(a.window) - windowRank(b.window) || a.window.localeCompare(b.window)
      : a.date.localeCompare(b.date)
  ));

  const columns: Column<SlotRow>[] = [
    { header: "Date", cell: (s) => formatDate(s.date) },
    {
      header: "Slot Type",
      cell: (s) => (
        <StatusBadge
          status={s.kind}
          toneMap={{ laundry: "accent", service: "primary" }}
          label={s.kind === "laundry" ? "Laundry Slot" : "Additional Service Slot"}
        />
      ),
    },
    { header: "Service", cell: (s) => <span className="font-medium">{s.service}</span> },
    { header: "Window", cell: (s) => <span className="font-medium">{s.window}</span> },
    // A service slot is booked against its window rather than a clock time, so it
    // has none to show. An em dash says that; "null–null" said something worse.
    { header: "Time", cell: (s) => (s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : "—") },
    { header: "Capacity", cell: (s) => <span className="tabular-nums">{s.booked}/{s.capacityTotal}</span>, align: "right" },
    {
      header: "Status", cell: (s) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {!s.isActive ? <StatusBadge status="inactive" /> : s.booked >= s.capacityTotal ? <StatusBadge status="full" toneMap={{ full: "danger" }} /> : <StatusBadge status="open" toneMap={{ open: "success" }} />}
          {s.laundry?.subscribersOnly && <StatusBadge status="plan_only" toneMap={{ plan_only: "accent" }} label="Plan only" />}
        </div>
      ),
    },
    {
      // Editing and cancelling are laundry-only: the service endpoints have no
      // equivalent, and offering a control that cannot work is worse than offering
      // none.
      header: "Actions", align: "right", cell: (s) => (s.laundry ? (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setEditing(s.laundry)} aria-label={`Edit ${s.window} slot on ${s.date}`} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <Pencil className="size-4" />
          </button>
          {s.isActive && (
            <button onClick={() => s.laundry && onCancel(s.laundry)} aria-label={`Cancel ${s.window} slot on ${s.date}`} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring">
              <Ban className="size-4" />
            </button>
          )}
        </div>
      ) : null),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">From</label>
            <DatePicker value={from} onChange={(v) => setFrom(v ?? today())} clearable={false} ariaLabel="From date" className="w-40" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">To</label>
            <DatePicker value={to} onChange={(v) => setTo(v ?? today())} min={from} clearable={false} ariaLabel="To date" className="w-40" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setServiceSlotOpen(true)}
            className="inline-flex items-center gap-2 rounded-full glass px-4 py-2.5 text-sm font-medium hover:ring-1 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarPlus className="size-4" /> Create Additional Service Slot
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            disabled={!society.data?.society}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" /> Create Laundry Slot
          </button>
        </div>
      </div>

      <Panel loading={slots.loading || serviceSlots.loading} error={slots.error} onRetry={() => { slots.reload(); serviceSlots.reload(); }}>
        <DataTable
          columns={columns}
          rows={rows}
          keyField={(s) => `${s.kind}:${s.id}`}
          onRowClick={(s) => s.laundry && setViewing(s.laundry)}
          emptyTitle="No slots in this range"
          emptyDescription="Create a slot so residents in your society can book a pickup."
        />
      </Panel>

      {createOpen && society.data?.society && (
        <CreateSlotModal
          societyId={society.data.society.id}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); slots.reload(); }}
        />
      )}
      {viewing && (
        <SlotDetailsDrawer
          slot={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { const s = viewing; setViewing(null); setEditing(s); }}
          onCancelSlot={() => { const s = viewing; setViewing(null); onCancel(s); }}
        />
      )}
      {editing && (
        <EditSlotModal slot={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); slots.reload(); }} />
      )}
      {serviceSlotOpen && (
        <CreateServiceSlotModal
          onClose={() => setServiceSlotOpen(false)}
          // Reload the list it now appears in. Without this the supervisor creates a
          // slot, is told it worked, and looks at a table that does not have it.
          onCreated={() => { setServiceSlotOpen(false); toast.push("Additional service slot created"); serviceSlots.reload(); }}
          loadSocieties={() => supervisorApi.societies().then((r) => r.societies.map((s) => ({ id: s.id, name: s.name })))}
          loadServices={() => supervisorApi.serviceOfferings().then((r) => r.offerings.map((o) => ({ id: o.id, name: o.name })))}
          createSlot={(body) => supervisorApi.createServiceSlot(body)}
        />
      )}
    </div>
  );
}

// Row-click details drawer (I-76). Shows the slot's particulars and the residents
// booked into it — replacing the separate Bookings screen — with Edit and
// Close/Disable actions kept.
function SlotDetailsDrawer({ slot, onClose, onEdit, onCancelSlot }: {
  slot: SlotView;
  onClose: () => void;
  onEdit: () => void;
  onCancelSlot: () => void;
}) {
  const bookings = useAsync(() => supervisorApi.slotBookings(slot.id), [slot.id]);
  const rows: [string, string][] = [
    ["Society", slot.societyName ?? "—"],
    ["Date", formatDate(slot.date)],
    ["Time window", `${slot.window} · ${slot.startTime}–${slot.endTime}`],
    ["Capacity", `${slot.bookedCount} booked / ${slot.capacityTotal}`],
    ["Reserved for", slot.subscribersOnly ? "Plan subscribers only" : "All residents"],
  ];
  return (
    <Modal open onClose={onClose} variant="drawer" title={`${slot.window} slot`} description={formatDate(slot.date)}>
      <div className="space-y-4">
        <section className="rounded-2xl glass p-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v}</span></div>
          ))}
        </section>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Residents booked</h3>
          <Panel loading={bookings.loading} error={bookings.error} onRetry={bookings.reload}>
            {(bookings.data?.bookings.length ?? 0) === 0 ? (
              <EmptyState title="No bookings yet" description="Nobody has booked this slot." />
            ) : (
              <div className="space-y-2">
                {bookings.data!.bookings.map((b) => (
                  <div key={b.pickupId} className="rounded-xl glass p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{b.residentName ?? "Resident"}</p>
                      <StatusBadge status={b.state} toneMap={{ scheduled: "warning", picked_up: "accent", delivered: "success", cancelled: "danger" }} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Flat {b.unitNumber ?? "—"}{b.blockName ? ` · Tower ${b.blockName}` : ""}{b.orderCode ? ` · ${b.orderCode}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={onEdit} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110">Edit slot</button>
          {slot.isActive && (
            <button onClick={onCancelSlot} className="inline-flex items-center gap-1.5 rounded-xl glass px-4 py-2 text-sm font-medium text-danger hover:ring-1 hover:ring-danger/40">
              <Ban className="size-4" /> Close / disable
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CreateSlotModal({ societyId, onClose, onCreated }: { societyId: string; onClose: () => void; onCreated: () => void }) {
  const [date, setDate] = useState(today());
  const [window, setWindowValue] = useState<"Morning" | "Afternoon" | "Evening">("Morning");
  const [capacity, setCapacity] = useState("20");
  const [subscribersOnly, setSubscribersOnly] = useState(false);
  const toast = useToast();
  const create = useAction(() => supervisorApi.createSlot({
    societyId, date, window, capacityTotal: Number(capacity) || 1, subscribersOnly,
  }));

  const submit = async () => {
    try { await create.run(); toast.push("Slot created."); onCreated(); } catch { /* surfaced below */ }
  };

  return (
    <Modal open onClose={onClose} title="New pickup slot" description="Start and end times follow the window automatically.">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">Date <span className="text-danger">*</span></label>
          <DatePicker value={date} onChange={(v) => setDate(v ?? today())} min={today()} clearable={false} ariaLabel="Slot date" />
        </div>
        <FormField as="select" label="Window" value={window} onChange={(e) => setWindowValue(e.target.value as typeof window)}>
          <option value="Morning">Morning</option>
          <option value="Afternoon">Afternoon</option>
          <option value="Evening">Evening</option>
        </FormField>
        <FormField label="Capacity" type="number" min={1} required value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" checked={subscribersOnly} onChange={(e) => setSubscribersOnly(e.target.checked)} className="size-4 accent-primary" />
          Reserve this slot for plan subscribers only
        </label>
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button onClick={submit} disabled={create.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Creating…" : "Create slot"}
        </button>
      </div>
    </Modal>
  );
}

function EditSlotModal({ slot, onClose, onSaved }: { slot: SlotView; onClose: () => void; onSaved: () => void }) {
  const [window, setWindowValue] = useState(slot.window as "Morning" | "Afternoon" | "Evening");
  const [capacity, setCapacity] = useState(String(slot.capacityTotal));
  const [isActive, setIsActive] = useState(slot.isActive);
  const [subscribersOnly, setSubscribersOnly] = useState(Boolean(slot.subscribersOnly));
  const toast = useToast();
  const save = useAction(() => supervisorApi.updateSlot(slot.id, {
    window, capacityTotal: Number(capacity) || 1, isActive, subscribersOnly,
  }));

  const submit = async () => {
    try { await save.run(); toast.push("Slot updated."); onSaved(); } catch { /* surfaced below */ }
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${formatDate(slot.date)} slot`}>
      <div className="space-y-4">
        <FormField as="select" label="Window" value={window} onChange={(e) => setWindowValue(e.target.value as typeof window)}>
          <option value="Morning">Morning</option>
          <option value="Afternoon">Afternoon</option>
          <option value="Evening">Evening</option>
        </FormField>
        <FormField label="Capacity" type="number" min={slot.bookedCount || 1} required value={capacity}
          hint={slot.bookedCount > 0 ? `${slot.bookedCount} already booked into this slot` : undefined}
          onChange={(e) => setCapacity(e.target.value)} />
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 accent-primary" />
          Slot is active and bookable
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" checked={subscribersOnly} onChange={(e) => setSubscribersOnly(e.target.checked)} className="size-4 accent-primary" />
          Reserved for plan subscribers only
        </label>
        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button onClick={submit} disabled={save.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
