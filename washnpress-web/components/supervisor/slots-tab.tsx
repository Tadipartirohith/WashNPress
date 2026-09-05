"use client";

import { useState } from "react";
import { Plus, Ban, Pencil } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { formatDate } from "@/lib/format";
import { supervisorApi, type SlotView } from "@/lib/api/supervisor";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SlotView | null>(null);
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

  const columns: Column<SlotView>[] = [
    { header: "Date", cell: (s) => formatDate(s.date) },
    { header: "Window", cell: (s) => <span className="font-medium">{s.window}</span> },
    { header: "Time", cell: (s) => `${s.startTime}–${s.endTime}` },
    { header: "Capacity", cell: (s) => <span className="tabular-nums">{s.bookedCount}/{s.capacityTotal}</span>, align: "right" },
    {
      header: "Status", cell: (s) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {!s.isActive ? <StatusBadge status="inactive" /> : s.full ? <StatusBadge status="full" toneMap={{ full: "danger" }} /> : <StatusBadge status="open" toneMap={{ open: "success" }} />}
          {s.subscribersOnly && <StatusBadge status="plan_only" toneMap={{ plan_only: "accent" }} label="Plan only" />}
        </div>
      ),
    },
    {
      header: "", align: "right", cell: (s) => (
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditing(s)} aria-label={`Edit ${s.window} slot on ${s.date}`} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <Pencil className="size-4" />
          </button>
          {s.isActive && (
            <button onClick={() => onCancel(s)} aria-label={`Cancel ${s.window} slot on ${s.date}`} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring">
              <Ban className="size-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <FormField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          disabled={!society.data?.society}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" /> New slot
        </button>
      </div>

      <Panel loading={slots.loading} error={slots.error} onRetry={slots.reload}>
        <DataTable
          columns={columns}
          rows={slots.data?.slots ?? []}
          keyField={(s) => s.id}
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
      {editing && (
        <EditSlotModal slot={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); slots.reload(); }} />
      )}
    </div>
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
        <FormField label="Date" type="date" required value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
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
