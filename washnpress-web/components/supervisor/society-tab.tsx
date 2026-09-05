"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Users, Pencil, Building2, ChevronRight } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { EmptyState } from "@/components/portal/empty-state";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { supervisorApi, type MySocietyResponse } from "@/lib/api/supervisor";
import { cn } from "@/lib/utils";

const listV = { show: { transition: { staggerChildren: 0.05 } } };
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

// A supervisor runs exactly one society — creating or reassigning it is an admin
// decision (see supervisor.ts's comment above GET /v1/supervisor/societies). What
// they own here is what's inside it: its towers, their capacity, and who covers
// each one.
export function SocietyTab() {
  const society = useAsync(() => supervisorApi.mySociety(), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [editBlock, setEditBlock] = useState<MySocietyResponse["blocks"][number] | null>(null);
  const [operatorsBlock, setOperatorsBlock] = useState<MySocietyResponse["blocks"][number] | null>(null);
  const [residentsBlock, setResidentsBlock] = useState<MySocietyResponse["blocks"][number] | null>(null);

  return (
    <Panel loading={society.loading} error={society.error} onRetry={society.reload}>
      {society.data && !society.data.society ? (
        <EmptyState
          icon={Building2}
          title="No society assigned"
          description="An admin needs to assign you a society before you can manage its towers, operators or slots."
        />
      ) : society.data?.society ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold">{society.data.society.name}</h2>
              <p className="text-sm text-muted-foreground">{society.data.society.addressLine}</p>
            </div>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-4" /> Add tower
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Towers" value={society.data.blocks.length} />
            <MiniStat label="Residents" value={society.data.society.residentCount} />
            <MiniStat label="Operators" value={society.data.society.operationsStaffCount} />
            <MiniStat label="Active orders" value={society.data.society.activeOrderCount} />
          </div>

          {society.data.blocks.length === 0 ? (
            <EmptyState title="No towers yet" description="Add the first tower to start assigning operators and onboarding residents." action={{ label: "Add tower", onClick: () => setCreateOpen(true) }} />
          ) : (
            <motion.div variants={listV} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {society.data.blocks.map((b) => (
                <motion.div key={b.blockId} variants={itemV} className="rounded-2xl glass p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-lg font-bold">Tower {b.blockName}</p>
                      <p className="text-xs text-muted-foreground">{b.flatCount} flats · {b.floorCount} floors</p>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
                      b.status === "active" ? "bg-success/15 text-success ring-success/30" : "bg-foreground/5 text-muted-foreground ring-foreground/10")}>
                      {b.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Residents</dt><dd className="font-semibold tabular-nums">{b.residentCount}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Active orders</dt><dd className="font-semibold tabular-nums">{b.activeOrderCount}</dd></div>
                  </dl>
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground">Operators</p>
                    <p className="mt-1 text-sm">{b.operators.length ? b.operators.map((o) => o.fullName).join(", ") : "None assigned"}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => setEditBlock(b)} className="inline-flex items-center gap-1.5 rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring">
                      <Pencil className="size-3.5" /> Edit
                    </button>
                    <button onClick={() => setOperatorsBlock(b)} className="inline-flex items-center gap-1.5 rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring">
                      <Users className="size-3.5" /> Operators
                    </button>
                    <button onClick={() => setResidentsBlock(b)} className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-primary hover:underline">
                      Residents <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          <CreateBlockModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            societyId={society.data.society.id}
            onCreated={() => { setCreateOpen(false); society.reload(); }}
          />
          {editBlock && (
            <EditBlockModal block={editBlock} onClose={() => setEditBlock(null)} onSaved={() => { setEditBlock(null); society.reload(); }} />
          )}
          {operatorsBlock && (
            <BlockOperatorsModal
              block={operatorsBlock}
              options={society.data.operatorOptions}
              onClose={() => setOperatorsBlock(null)}
              onSaved={() => { setOperatorsBlock(null); society.reload(); }}
            />
          )}
          {residentsBlock && (
            <BlockResidentsDrawer block={residentsBlock} onClose={() => setResidentsBlock(null)} />
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl glass p-4">
      <p className="font-display text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function CreateBlockModal({ open, onClose, societyId, onCreated }: { open: boolean; onClose: () => void; societyId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [floors, setFloors] = useState("");
  const [flats, setFlats] = useState("");
  const toast = useToast();
  const create = useAction(() => supervisorApi.createBlock(societyId, {
    name,
    floorCount: floors ? Number(floors) : undefined,
    flatCount: flats ? Number(flats) : undefined,
  }));

  const submit = async () => {
    try {
      await create.run();
      toast.push(`Tower ${name} added.`);
      setName(""); setFloors(""); setFlats("");
      onCreated();
    } catch { /* surfaced via create.error */ }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a tower" description="Towers organise residents and let you assign operators by area of the society.">
      <div className="space-y-4">
        <FormField label="Tower name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. D" />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Floors" type="number" min={1} value={floors} onChange={(e) => setFloors(e.target.value)} />
          <FormField label="Flats" type="number" min={1} value={flats} onChange={(e) => setFlats(e.target.value)} />
        </div>
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button onClick={submit} disabled={!name.trim() || create.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Adding…" : "Add tower"}
        </button>
      </div>
    </Modal>
  );
}

function EditBlockModal({ block, onClose, onSaved }: { block: MySocietyResponse["blocks"][number]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(block.blockName);
  const [floors, setFloors] = useState(String(block.floorCount ?? ""));
  const [flats, setFlats] = useState(String(block.flatCount ?? ""));
  const [status, setStatus] = useState(block.status);
  const toast = useToast();
  const save = useAction(() => supervisorApi.updateBlock(block.blockId, {
    name, floorCount: floors ? Number(floors) : undefined, flatCount: flats ? Number(flats) : undefined,
    status: status as "active" | "inactive",
  }));

  const submit = async () => {
    try { await save.run(); toast.push("Tower updated."); onSaved(); } catch { /* surfaced below */ }
  };

  return (
    <Modal open onClose={onClose} title={`Edit tower ${block.blockName}`}>
      <div className="space-y-4">
        <FormField label="Tower name" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Floors" type="number" min={1} value={floors} onChange={(e) => setFloors(e.target.value)} />
          <FormField label="Flats" type="number" min={1} value={flats} onChange={(e) => setFlats(e.target.value)} />
        </div>
        <FormField as="select" label="Status" value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </FormField>
        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button onClick={submit} disabled={!name.trim() || save.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

function BlockOperatorsModal({ block, options, onClose, onSaved }: {
  block: MySocietyResponse["blocks"][number];
  options: MySocietyResponse["operatorOptions"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(block.operators.map((o) => o.id)));
  const toast = useToast();
  const save = useAction(() => supervisorApi.setBlockOperators(block.blockId, Array.from(selected)));

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const submit = async () => {
    try { await save.run(); toast.push(`Operators updated for Tower ${block.blockName}.`); onSaved(); } catch { /* surfaced below */ }
  };

  return (
    <Modal open onClose={onClose} title={`Operators for Tower ${block.blockName}`} description="Only operators already working this society can be assigned.">
      <div className="space-y-3">
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operators in this society yet. Add one from the Operators tab first.</p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {options.map((op) => (
              <li key={op.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-foreground/5">
                  <input type="checkbox" checked={selected.has(op.id)} onChange={() => toggle(op.id)} className="size-4 accent-primary" />
                  <span className="text-sm">{op.fullName ?? op.phone}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{op.status}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button onClick={submit} disabled={save.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : "Save operators"}
        </button>
      </div>
    </Modal>
  );
}

function BlockResidentsDrawer({ block, onClose }: { block: MySocietyResponse["blocks"][number]; onClose: () => void }) {
  const detail = useAsync(() => supervisorApi.blockDetail(block.blockId), [block.blockId]);
  return (
    <Modal open onClose={onClose} variant="drawer" title={`Tower ${block.blockName}`} description="Residents living in this tower.">
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && detail.data.residents.length === 0 ? (
          <EmptyState title="No residents yet" description="Nobody has onboarded into this tower yet." />
        ) : (
          <ul className="space-y-2">
            {detail.data?.residents.map((r) => (
              <li key={r.id} className="rounded-xl glass p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{r.fullName ?? "Unnamed resident"}</p>
                  <span className="text-xs text-muted-foreground">{r.unitNumber}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.phone ?? "No phone on file"}{r.planName ? ` · ${r.planName}` : ""}</p>
                {r.activeOrderCount > 0 && <p className="mt-1 text-xs text-primary">{r.activeOrderCount} active order(s) · {r.orderState}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Modal>
  );
}
