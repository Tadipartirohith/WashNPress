"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Pencil, Users, Wallet } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { EmptyState } from "@/components/portal/empty-state";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { rupees } from "@/lib/format";
import { supervisorApi, type PlanUsage } from "@/lib/api/supervisor";

const listV = { show: { transition: { staggerChildren: 0.05 } } };
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

// Plans are system-wide, not scoped to one society — the same wizard an admin uses,
// shared by both routes on the backend (see supervisor.ts's comment above the plans
// routes). A supervisor edits it because they're closest to what residents ask for,
// not because it belongs to their area alone.
export function PlansTab() {
  const plans = useAsync(() => supervisorApi.plans(), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PlanUsage | null>(null);

  return (
    <Panel loading={plans.loading} error={plans.error} onRetry={plans.reload}>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Subscription plans available to every resident.</p>
          <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring">
            <Plus className="size-4" /> New plan
          </button>
        </div>

        {(plans.data?.plans.length ?? 0) === 0 ? (
          <EmptyState title="No plans yet" description="Create the first subscription plan residents can choose from." action={{ label: "New plan", onClick: () => setCreateOpen(true) }} />
        ) : (
          <motion.div variants={listV} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.data!.plans.map((p) => (
              <motion.div key={p.id} variants={itemV} className="rounded-3xl glass-strong p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-lg font-bold">{p.name || p.tier}</p>
                    <p className="text-xs text-muted-foreground">{p.tier}</p>
                  </div>
                  <button onClick={() => setEditing(p)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Edit ${p.name}`}>
                    <Pencil className="size-4" />
                  </button>
                </div>
                {p.description && <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>}
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Monthly</dt><dd className="font-semibold tabular-nums">{rupees(p.monthlyPaise)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Garment cap</dt><dd className="font-semibold tabular-nums">{p.garmentCap}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Turnaround</dt><dd className="font-semibold tabular-nums">{p.turnaroundHours}h</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Active</dt><dd className="font-semibold">{p.isActive === false ? "No" : "Yes"}</dd></div>
                </dl>
                <div className="mt-4 flex items-center gap-4 border-t border-white/10 pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {p.activeSubscribers} active</span>
                  <span className="inline-flex items-center gap-1"><Wallet className="size-3.5" /> {rupees(p.revenuePaise)}</span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {createOpen && <PlanModal mode="create" onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); plans.reload(); }} />}
      {editing && <PlanModal mode="edit" plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); plans.reload(); }} />}
    </Panel>
  );
}

function PlanModal({ mode, plan, onClose, onSaved }: { mode: "create" | "edit"; plan?: PlanUsage; onClose: () => void; onSaved: () => void }) {
  const [tier, setTier] = useState(plan?.tier ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [garmentCap, setGarmentCap] = useState(String(plan?.garmentCap ?? 30));
  const [turnaroundHours, setTurnaroundHours] = useState(String(plan?.turnaroundHours ?? 48));
  const [monthlyRupees, setMonthlyRupees] = useState(String((plan?.monthlyPaise ?? 0) / 100));
  const [isActive, setIsActive] = useState(plan?.isActive !== false);
  const toast = useToast();

  const payload = {
    tier, name: name || undefined, description: description || null,
    garmentCap: Number(garmentCap) || 1,
    turnaroundHours: Number(turnaroundHours) || 1,
    monthlyPaise: Math.round((Number(monthlyRupees) || 0) * 100),
  };

  const create = useAction(() => supervisorApi.createPlan(payload));
  const update = useAction(() => supervisorApi.updatePlan(plan!.id, { ...payload, isActive }));

  const submit = async () => {
    try {
      if (mode === "create") { await create.run(); toast.push("Plan created."); }
      else { await update.run(); toast.push("Plan updated."); }
      onSaved();
    } catch { /* surfaced below */ }
  };

  const action = mode === "create" ? create : update;
  const valid = tier.trim().length >= 2 && Number(garmentCap) > 0 && Number(turnaroundHours) > 0;

  return (
    <Modal open onClose={onClose} title={mode === "create" ? "New plan" : `Edit ${plan?.name || plan?.tier}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tier code" required value={tier} onChange={(e) => setTier(e.target.value)} placeholder="e.g. gold" />
          <FormField label="Display name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gold" />
        </div>
        <FormField as="textarea" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Garment cap" type="number" min={1} required value={garmentCap} onChange={(e) => setGarmentCap(e.target.value)} />
          <FormField label="Turnaround (h)" type="number" min={1} required value={turnaroundHours} onChange={(e) => setTurnaroundHours(e.target.value)} />
          <FormField label="Monthly (₹)" type="number" min={0} required value={monthlyRupees} onChange={(e) => setMonthlyRupees(e.target.value)} />
        </div>
        {mode === "edit" && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 accent-primary" />
            Plan is active and offered to residents
          </label>
        )}
        {action.error && <p className="text-sm text-danger">{action.error}</p>}
        <button onClick={submit} disabled={!valid || action.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {action.busy ? "Saving…" : mode === "create" ? "Create plan" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}
