"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Plus, Search } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type SocietySummary } from "@/lib/api/admin";
import { cn } from "@/lib/utils";
import { itemV, listV } from "../motion";

export function SocietiesSection() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const { data, loading, error, reload } = useAsync(() => adminApi.societies.list({ q: q || undefined, status: status === "all" ? undefined : status }), [q, status]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const toast = useToast();

  const columns: Column<SocietySummary>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={{ active: "success", coming_soon: "warning", inactive: "muted" }} /> },
    { header: "Supervisor", cell: (r) => r.supervisorName ?? <span className="text-muted-foreground">Unassigned</span> },
    { header: "Blocks", align: "right", cell: (r) => r.blocks.length },
    { header: "Address", cell: (r) => <span className="text-muted-foreground">{r.addressLine ?? "—"}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search societies" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="coming_soon">Coming soon</option>
          <option value="inactive">Inactive</option>
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> New society
        </button>
      </div>

      <motion.div variants={listV} initial="hidden" animate="show">
        <motion.div variants={itemV}>
          <DataTable columns={columns} rows={data?.societies ?? []} keyField={(r) => r.id} loading={loading} error={error}
            onRowClick={(r) => setOpenId(r.id)} emptyTitle="No societies yet" emptyDescription="Add the first society to start onboarding residents." />
        </motion.div>
      </motion.div>

      <CreateSocietyModal open={createOpen} onClose={() => setCreateOpen(false)} states={data?.supportedStates ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Society created"); }} />
      {openId && <SocietyDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function CreateSocietyModal({ open, onClose, states, onCreated }: { open: boolean; onClose: () => void; states: string[]; onCreated: () => void }) {
  const [name, setName] = React.useState("");
  const [house, setHouse] = React.useState("");
  const [street, setStreet] = React.useState("");
  const [locality, setLocality] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [pincode, setPincode] = React.useState("");
  const [blockNames, setBlockNames] = React.useState("");
  const create = useAction(() => adminApi.societies.create({
    name,
    address: { house, street, locality, city, state, pincode },
    blocks: blockNames.split(",").map((b) => b.trim()).filter(Boolean).map((n) => ({ name: n })),
  }));

  React.useEffect(() => { if (open) { setName(""); setHouse(""); setStreet(""); setLocality(""); setCity(""); setState(""); setPincode(""); setBlockNames(""); } }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="New society" description="Blocks can also be added later from the society detail.">
      <form onSubmit={(e) => { e.preventDefault(); create.run().then(onCreated).catch(() => {}); }} className="space-y-4">
        <FormField label="Society name" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Building / house" value={house} onChange={(e) => setHouse(e.target.value)} />
          <FormField label="Street" value={street} onChange={(e) => setStreet(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Locality" value={locality} onChange={(e) => setLocality(e.target.value)} />
          <FormField label="City" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField as="select" label="State" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Choose a state</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </FormField>
          <FormField label="Pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} />
        </div>
        <FormField label="Blocks / towers" value={blockNames} onChange={(e) => setBlockNames(e.target.value)} hint="Comma separated, e.g. A, B, C" />
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button type="submit" disabled={create.busy || !name} className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Creating…" : "Create society"}
        </button>
      </form>
    </Modal>
  );
}

function SocietyDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => adminApi.societies.get(id), [id]);
  const assignments = useAsync(() => adminApi.societies.assignments(id), [id]);
  const toast = useToast();
  const [supervisorUserId, setSupervisorUserId] = React.useState("");
  const [newBlockName, setNewBlockName] = React.useState("");

  React.useEffect(() => { setSupervisorUserId(detail.data?.society.supervisorUserId ?? ""); }, [detail.data]);

  const setSupervisor = useAction(() => adminApi.societies.setSupervisor(id, supervisorUserId || null));
  const addBlock = useAction(() => adminApi.societies.addBlock(id, { name: newBlockName }));
  const setStatus = useAction((status: "active" | "coming_soon" | "inactive") => adminApi.societies.update(id, { status }));
  const toggleBlock = useAction((blockId: string, status: "active" | "inactive") => adminApi.societies.updateBlock(blockId, { status }));

  const refresh = () => { detail.reload(); assignments.reload(); onChanged(); };

  return (
    <Modal open onClose={onClose} variant="drawer" title={detail.data?.society.name ?? "Society"} description={detail.data?.society.addressLine}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <StatusBadge status={detail.data.society.status} toneMap={{ active: "success", coming_soon: "warning", inactive: "muted" }} />
              <div className="flex gap-1.5">
                {(["active", "coming_soon", "inactive"] as const).filter((s) => s !== detail.data!.society.status).map((s) => (
                  <button key={s} onClick={() => setStatus.run(s).then(() => { toast.push("Status updated"); refresh(); }).catch(() => {})}
                    className="rounded-full glass px-3 py-1 text-xs capitalize hover:ring-1 hover:ring-primary/40">
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl glass p-3 text-center">
                <p className="font-display text-xl font-bold tabular-nums">{detail.data.residents.length}</p>
                <p className="text-xs text-muted-foreground">Residents</p>
              </div>
              <div className="rounded-xl glass p-3 text-center">
                <p className="font-display text-xl font-bold tabular-nums">{detail.data.operators.length}</p>
                <p className="text-xs text-muted-foreground">Operators</p>
              </div>
              <div className="rounded-xl glass p-3 text-center">
                <p className="font-display text-xl font-bold tabular-nums">{detail.data.orders.length}</p>
                <p className="text-xs text-muted-foreground">Orders</p>
              </div>
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supervisor</h3>
              <div className="flex gap-2">
                <select value={supervisorUserId} onChange={(e) => setSupervisorUserId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Unassigned</option>
                  {(assignments.data?.supervisorOptions ?? []).map((s) => (
                    <option key={s.id} value={s.id} disabled={Boolean(s.heldSocietyName)}>
                      {s.fullName} {s.heldSocietyName ? `(runs ${s.heldSocietyName})` : ""}
                    </option>
                  ))}
                </select>
                <button onClick={() => setSupervisor.run().then(() => { toast.push("Supervisor updated"); refresh(); }).catch(() => {})}
                  disabled={setSupervisor.busy} className="shrink-0 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">
                  Save
                </button>
              </div>
              {setSupervisor.error && <p className="text-xs text-danger">{setSupervisor.error}</p>}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Blocks</h3>
              <div className="space-y-2">
                {detail.data.society.blocks.length === 0 && <p className="text-sm text-muted-foreground">No blocks yet.</p>}
                {detail.data.society.blocks.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-xl glass p-3">
                    <div>
                      <p className="text-sm font-medium">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(b.operators ?? []).length > 0 ? (b.operators ?? []).map((o) => o.fullName).join(", ") : "No operator"}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleBlock.run(b.id, b.status === "active" ? "inactive" : "active").then(() => { toast.push("Block updated"); refresh(); }).catch(() => {})}
                      className={cn("rounded-full px-3 py-1 text-xs font-medium", b.status === "active" ? "bg-success/15 text-success ring-1 ring-success/30" : "bg-foreground/5 text-muted-foreground ring-1 ring-foreground/10")}>
                      {b.status === "active" ? "Active" : "Inactive"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newBlockName} onChange={(e) => setNewBlockName(e.target.value)} placeholder="New block name"
                  className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={() => addBlock.run().then(() => { setNewBlockName(""); toast.push("Block added"); refresh(); }).catch(() => {})}
                  disabled={addBlock.busy || !newBlockName.trim()} className="shrink-0 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">
                  Add
                </button>
              </div>
              {addBlock.error && <p className="text-xs text-danger">{addBlock.error}</p>}
            </section>
          </div>
        )}
      </Panel>
    </Modal>
  );
}
