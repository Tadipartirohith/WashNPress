"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { EmptyState } from "@/components/portal/empty-state";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type Slot } from "@/lib/api/admin";
import { formatDate } from "@/lib/format";

export function SlotsSection() {
  const [societyId, setSocietyId] = React.useState("");
  const [date, setDate] = React.useState("");
  const [status, setStatus] = React.useState("");
  const societies = useAsync(() => adminApi.societies.list(), []);
  const { data, loading, error, reload } = useAsync(
    () => adminApi.slots.list({ societyId: societyId || undefined, date: date || undefined, status: status || undefined }),
    [societyId, date, status],
  );
  const toast = useToast();
  const { confirm } = useConfirm();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [bookingsFor, setBookingsFor] = React.useState<string | null>(null);
  const cancel = useAction((id: string) => adminApi.slots.cancel(id));

  const columns: Column<Slot>[] = [
    { header: "Society", cell: (r) => r.societyName ?? r.societyId },
    { header: "Date", cell: (r) => formatDate(r.date) },
    { header: "Window", cell: (r) => `${r.window} (${r.startTime}–${r.endTime})` },
    { header: "Capacity", align: "right", cell: (r) => `${r.capacityTotal - r.capacityRemaining} / ${r.capacityTotal}` },
    { header: "Status", cell: (r) => <StatusBadge status={r.isActive ? (r.status ?? "open") : "cancelled"} toneMap={{ open: "success", full: "warning", cancelled: "danger", closed: "muted" }} /> },
    { header: "Actions", align: "right", cell: (r) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setBookingsFor(r.id)} className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">Bookings</button>
        {r.isActive && (
          <button
            onClick={async () => {
              const ok = await confirm({ title: "Cancel this slot?", description: "Anyone booked will need to be rescheduled.", confirmLabel: "Cancel slot", danger: true });
              if (!ok) return;
              cancel.run(r.id).then(() => { toast.push("Slot cancelled"); reload(); }).catch((e) => toast.push(e?.message ?? "Could not cancel", "danger"));
            }}
            className="rounded-full glass px-2.5 py-1 text-xs text-danger hover:ring-1 hover:ring-danger/40">Cancel</button>
        )}
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
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All statuses</option>
          {(data?.statuses ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> New slot
        </button>
      </div>
      <DataTable columns={columns} rows={data?.slots ?? []} keyField={(r) => r.id} loading={loading} error={error}
        emptyTitle="No slots match" emptyDescription="Create a slot for residents to book against." />

      <CreateSlotModal open={createOpen} onClose={() => setCreateOpen(false)} societies={societies.data?.societies ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Slot created"); }} />
      {bookingsFor && <SlotBookingsModal id={bookingsFor} onClose={() => setBookingsFor(null)} />}
    </div>
  );
}

function CreateSlotModal({ open, onClose, societies, onCreated }: { open: boolean; onClose: () => void; societies: { id: string; name: string }[]; onCreated: () => void }) {
  const [societyId, setSocietyId] = React.useState("");
  const [date, setDate] = React.useState("");
  const [window_, setWindow] = React.useState<"Morning" | "Afternoon" | "Evening">("Morning");
  const [capacityTotal, setCapacityTotal] = React.useState("10");
  const [subscribersOnly, setSubscribersOnly] = React.useState(false);
  const create = useAction(() => adminApi.slots.create({ societyId, date, window: window_, capacityTotal: Number(capacityTotal), subscribersOnly }));

  React.useEffect(() => { if (open) { setSocietyId(""); setDate(""); setWindow("Morning"); setCapacityTotal("10"); setSubscribersOnly(false); } }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="New slot">
      <form onSubmit={(e) => { e.preventDefault(); create.run().then(onCreated).catch(() => {}); }} className="space-y-4">
        <FormField as="select" label="Society" required value={societyId} onChange={(e) => setSocietyId(e.target.value)}>
          <option value="">Choose a society</option>
          {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormField>
        <FormField label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <FormField as="select" label="Window" required value={window_} onChange={(e) => setWindow(e.target.value as typeof window_)}>
          <option value="Morning">Morning</option>
          <option value="Afternoon">Afternoon</option>
          <option value="Evening">Evening</option>
        </FormField>
        <FormField label="Capacity" type="number" required value={capacityTotal} onChange={(e) => setCapacityTotal(e.target.value)} />
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
  return (
    <Modal open onClose={onClose} title="Slot bookings" variant="drawer">
      <Panel loading={loading} error={error} onRetry={reload}>
        {data && (
          (data.bookings.length === 0 ? (
            <EmptyState title="Nobody booked yet" description="This slot has no bookings." />
          ) : (
            <div className="space-y-2">
              {data.bookings.map((b, i) => (
                <div key={i} className="rounded-xl glass p-3 text-sm">
                  <p className="font-medium">{String(b.residentName ?? "Resident")}</p>
                  <p className="text-xs text-muted-foreground">{String(b.unitNumber ?? "")} {b.blockName ? `· ${String(b.blockName)}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{String(b.orderCode ?? "")} {b.state ? `· ${String(b.state)}` : ""}</p>
                </div>
              ))}
            </div>
          ))
        )}
      </Panel>
    </Modal>
  );
}
