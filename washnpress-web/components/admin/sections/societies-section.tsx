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
import { towerLabel } from "@/lib/unit";
import { itemV, listV } from "../motion";
import { SocietyResidentsDrawer } from "./society-residents";

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

// I-31: a society is created in two steps — Details, then Naming & Structure. The
// naming convention chosen here (how towers, floors and flats are named) is stored on
// the society and becomes the single source of truth every portal reads, so the
// supervisor never re-enters a tower name by hand. A live preview shows what the
// chosen styles produce before the society is created.
function CreateSocietyModal({ open, onClose, states, onCreated }: { open: boolean; onClose: () => void; states: string[]; onCreated: () => void }) {
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState("");
  const [house, setHouse] = React.useState("");
  const [street, setStreet] = React.useState("");
  const [locality, setLocality] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [pincode, setPincode] = React.useState("");
  const [blockNames, setBlockNames] = React.useState("");
  const [tower, setTower] = React.useState("letter");
  const [floor, setFloor] = React.useState("number");
  // A flat is named without its tower ("101", not "A-101"); the tower is its own field.
  const [flat, setFlat] = React.useState("floor_unit");
  const [floors, setFloors] = React.useState("5");
  const [flatsPerFloor, setFlatsPerFloor] = React.useState("4");

  const blocks = blockNames.split(",").map((b) => b.trim()).filter(Boolean);
  const naming = useAsync(
    () => adminApi.societies.naming({ tower, floor, flat, towers: Math.max(blocks.length, 2), floors: Number(floors) || 5, flatsPerFloor: Number(flatsPerFloor) || 4 }),
    [tower, floor, flat, blocks.length, floors, flatsPerFloor],
  );
  const styles = naming.data?.styles;

  const create = useAction(() => adminApi.societies.create({
    name,
    address: { house, street, locality, city, state, pincode },
    naming: { tower, floor, flat },
    blocks: blocks.map((n) => ({ name: n, floorCount: Number(floors) || undefined, flatCount: (Number(floors) || 0) * (Number(flatsPerFloor) || 0) || undefined })),
  }));

  React.useEffect(() => { if (open) { setStep(0); setName(""); setHouse(""); setStreet(""); setLocality(""); setCity(""); setState(""); setPincode(""); setBlockNames(""); setTower("letter"); setFloor("number"); setFlat("floor_unit"); setFloors("5"); setFlatsPerFloor("4"); } }, [open]);

  const STEPS = ["Details", "Naming & structure"];
  return (
    <Modal open={open} onClose={onClose} title="New society" description="Details, then the naming that every portal will use for this society.">
      <ol className="mb-5 flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", i <= step ? "text-foreground" : "text-muted-foreground")}>
            <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-semibold", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-foreground/10")}>{i + 1}</span>
            {s}{i < 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
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
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={() => setStep(1)} disabled={!name.trim()} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <FormField label="Tower / block names" value={blockNames} onChange={(e) => setBlockNames(e.target.value)} hint="Comma separated, e.g. A, B, C — these are saved exactly as entered." />
          <div className="grid grid-cols-3 gap-3">
            <FormField as="select" label="Tower / block naming" value={tower} onChange={(e) => setTower(e.target.value)}>
              {(styles?.tower ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </FormField>
            <FormField as="select" label="Floor naming" value={floor} onChange={(e) => setFloor(e.target.value)}>
              {(styles?.floor ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </FormField>
            <FormField as="select" label="Flat naming" value={flat} onChange={(e) => setFlat(e.target.value)}>
              {(styles?.flat ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Floors per tower" type="number" min="1" value={floors} onChange={(e) => setFloors(e.target.value)} />
            <FormField label="Flats per floor" type="number" min="1" value={flatsPerFloor} onChange={(e) => setFlatsPerFloor(e.target.value)} />
          </div>
          <div className="rounded-xl border border-border bg-foreground/5 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
            {naming.data ? (
              <div className="space-y-2 text-sm">
                {naming.data.preview.map((t) => (
                  <div key={t.tower}>
                    <span className="font-display font-bold text-primary">{towerLabel(t.tower)}</span>
                    <span className="ml-2 text-muted-foreground">{t.floors.map((f) => f.flats.join(" ")).join("   ")}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">…and so on for every floor and flat.</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">Loading preview…</p>}
          </div>
          {create.error && <p className="text-sm text-danger">{create.error}</p>}
          <div className="flex justify-between gap-2 pt-2">
            <button onClick={() => setStep(0)} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground">← Back</button>
            <button onClick={() => create.run().then(onCreated).catch(() => {})} disabled={create.busy || !name.trim()}
              className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              {create.busy ? "Creating…" : "Create society"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SocietyDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => adminApi.societies.get(id), [id]);
  const assignments = useAsync(() => adminApi.societies.assignments(id), [id]);
  const toast = useToast();
  const [supervisorUserId, setSupervisorUserId] = React.useState("");
  const [newBlockName, setNewBlockName] = React.useState("");
  const [residentsOpen, setResidentsOpen] = React.useState(false);

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

            {/* I-110: only the resident count leads anywhere, so only it is a button.
                Operators and Orders stay plain text rather than looking pressable and
                doing nothing — the admin reads those in People and in Orders. */}
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setResidentsOpen(true)}
                className="rounded-xl glass p-3 text-center transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="font-display text-xl font-bold tabular-nums">{detail.data.residents.length}</p>
                <p className="text-xs text-muted-foreground">Residents</p>
              </button>
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
                      <p className="text-sm font-medium">{towerLabel(b.name)}</p>
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
      {residentsOpen && detail.data && (
        <SocietyResidentsDrawer
          societyName={detail.data.society.name}
          residents={detail.data.residents}
          onClose={() => setResidentsOpen(false)}
        />
      )}
    </Modal>
  );
}
