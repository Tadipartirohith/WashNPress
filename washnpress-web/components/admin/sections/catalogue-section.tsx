"use client";

import * as React from "react";
import { Plus, Search, Copy } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type Plan, type ServiceOffering } from "@/lib/api/admin";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CatalogueSection() {
  const [tab, setTab] = React.useState<"plans" | "services" | "config">("plans");
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(["plans", "services", "config"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium capitalize", tab === t ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
            {t === "config" ? "Garment config" : t}
          </button>
        ))}
      </div>
      {tab === "plans" && <PlansTab />}
      {tab === "services" && <ServicesTab />}
      {tab === "config" && <ConfigTab />}
    </div>
  );
}

// ---------------------------------------------------------------------- plans

function PlansTab() {
  const { data, loading, error, reload } = useAsync(() => adminApi.plans.list(), []);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const toast = useToast();

  const columns: Column<Plan>[] = [
    { header: "Plan", cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.tier}</p></div> },
    { header: "Price / month", align: "right", cell: (r) => rupees(r.monthlyPaise) },
    { header: "Garment cap", align: "right", cell: (r) => r.garmentCap },
    { header: "Turnaround", align: "right", cell: (r) => `${r.turnaroundHours}h` },
    { header: "Subscribers", align: "right", cell: (r) => r.activeSubscribers ?? 0 },
    { header: "Revenue", align: "right", cell: (r) => rupees(r.revenuePaise ?? 0) },
    { header: "Status", cell: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} toneMap={{ active: "success", inactive: "muted" }} /> },
    { header: "Edit", align: "right", cell: (r) => <button onClick={(e) => { e.stopPropagation(); setEditing(r); }} className="rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40">Edit</button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> New plan
        </button>
      </div>
      <DataTable columns={columns} rows={data?.plans ?? []} keyField={(r) => r.id} loading={loading} error={error}
        emptyTitle="No plans yet" emptyDescription="Create a subscription plan for residents to choose." />
      <PlanFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload(); toast.push("Plan created"); }} />
      {editing && (
        <PlanFormModal open plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); toast.push("Plan updated"); }} />
      )}
    </div>
  );
}

function PlanFormModal({ open, plan, onClose, onSaved }: { open: boolean; plan?: Plan; onClose: () => void; onSaved: () => void }) {
  const [tier, setTier] = React.useState(plan?.tier ?? "");
  const [name, setName] = React.useState(plan?.name ?? "");
  const [description, setDescription] = React.useState(plan?.description ?? "");
  const [garmentCap, setGarmentCap] = React.useState(String(plan?.garmentCap ?? ""));
  const [turnaroundHours, setTurnaroundHours] = React.useState(String(plan?.turnaroundHours ?? ""));
  const [monthlyRupees, setMonthlyRupees] = React.useState(plan ? String(plan.monthlyPaise / 100) : "");
  const [annualDiscountPercent, setAnnualDiscountPercent] = React.useState(String(plan?.annualDiscountPercent ?? 0));

  const body = {
    tier, name: name || tier, description: description || null,
    garmentCap: Number(garmentCap), turnaroundHours: Number(turnaroundHours),
    monthlyPaise: Math.round(Number(monthlyRupees) * 100), annualDiscountPercent: Number(annualDiscountPercent),
  };
  const save = useAction(() => (plan ? adminApi.plans.update(plan.id, body) : adminApi.plans.create(body)));
  const valid = tier && garmentCap && turnaroundHours && monthlyRupees;

  return (
    <Modal open={open} onClose={onClose} title={plan ? "Edit plan" : "New plan"}>
      <form onSubmit={(e) => { e.preventDefault(); save.run().then(onSaved).catch(() => {}); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tier key" required value={tier} onChange={(e) => setTier(e.target.value)} hint="e.g. basic, premium" />
          <FormField label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <FormField as="textarea" label="Description" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Garment cap" type="number" required value={garmentCap} onChange={(e) => setGarmentCap(e.target.value)} />
          <FormField label="Turnaround (hrs)" type="number" required value={turnaroundHours} onChange={(e) => setTurnaroundHours(e.target.value)} />
          <FormField label="Monthly price (₹)" type="number" required value={monthlyRupees} onChange={(e) => setMonthlyRupees(e.target.value)} />
        </div>
        <FormField label="Annual discount %" type="number" value={annualDiscountPercent} onChange={(e) => setAnnualDiscountPercent(e.target.value)} />
        {plan && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" defaultChecked={plan.isActive} onChange={(e) => adminApi.plans.update(plan.id, { isActive: e.target.checked }).then(onSaved)} className="size-4 rounded border-border" />
            Active — offered to residents
          </label>
        )}
        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button type="submit" disabled={save.busy || !valid} className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : plan ? "Save changes" : "Create plan"}
        </button>
      </form>
    </Modal>
  );
}

// -------------------------------------------------------------------- services

function ServicesTab() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const { data, loading, error, reload } = useAsync(() => adminApi.services.list({ q: q || undefined, status: status || undefined }), [q, status]);
  const toast = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const duplicate = useAction((id: string) => adminApi.services.duplicate(id));
  const toggleActive = useAction((id: string, isActive: boolean) => adminApi.services.update(id, { isActive }));

  const columns: Column<ServiceOffering>[] = [
    { header: "Service", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Category", cell: (r) => r.category },
    { header: "Unit", cell: (r) => r.unit },
    { header: "Price", align: "right", cell: (r) => rupees(r.unitPricePaise) },
    { header: "Status", cell: (r) => <StatusBadge status={r.isActive === false ? "inactive" : "active"} toneMap={{ active: "success", inactive: "muted" }} /> },
    { header: "Actions", align: "right", cell: (r) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => duplicate.run(r.id).then(() => { toast.push("Duplicated as inactive draft"); reload(); }).catch(() => toast.push(duplicate.error ?? "Failed", "danger"))}
          className="inline-flex items-center gap-1 rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40"><Copy className="size-3" /> Duplicate</button>
        <button onClick={() => toggleActive.run(r.id, r.isActive === false).then(() => { toast.push("Updated"); reload(); }).catch(() => toast.push(toggleActive.error ?? "Failed", "danger"))}
          className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">{r.isActive === false ? "Activate" : "Deactivate"}</button>
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All statuses</option>
          {(data?.filters.statuses ?? ["active", "inactive"]).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> New service
        </button>
      </div>
      <DataTable columns={columns} rows={data?.services ?? []} keyField={(r) => r.id} loading={loading} error={error}
        emptyTitle="No services match" emptyDescription="Add one, or clear the filters." />
      <CreateServiceModal open={createOpen} onClose={() => setCreateOpen(false)} categories={data?.filters.categories ?? []} units={data?.filters.units ?? []}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Service created"); }} />
    </div>
  );
}

function CreateServiceModal({ open, onClose, categories, units, onCreated }: {
  open: boolean; onClose: () => void; categories: { key: string; label: string }[]; units: string[]; onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [unit, setUnit] = React.useState("piece");
  const [priceRupees, setPriceRupees] = React.useState("");
  const create = useAction(() => adminApi.services.create({ name, category, unit, unitPricePaise: Math.round(Number(priceRupees) * 100) }));

  React.useEffect(() => { if (open) { setName(""); setCategory(""); setUnit("piece"); setPriceRupees(""); } }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="New service" description="More detail — plan rules, time slots, eligibility — can be configured afterwards.">
      <form onSubmit={(e) => { e.preventDefault(); create.run().then(onCreated).catch(() => {}); }} className="space-y-4">
        <FormField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormField as="select" label="Category" required value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose a category</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField as="select" label="Unit" required value={unit} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </FormField>
          <FormField label="Price (₹)" type="number" required value={priceRupees} onChange={(e) => setPriceRupees(e.target.value)} />
        </div>
        {create.error && <p className="text-sm text-danger">{create.error}</p>}
        <button type="submit" disabled={create.busy || !name || !category || !priceRupees}
          className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {create.busy ? "Creating…" : "Create service"}
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------- garment config

function ConfigTab() {
  const { data, loading, error, reload } = useAsync(() => adminApi.config.get(), []);
  const toast = useToast();
  const [form, setForm] = React.useState<Record<string, string | boolean>>({});

  React.useEffect(() => {
    if (!data) return;
    setForm({
      additionalGarmentRatePaise: String(data.config.additionalGarmentRatePaise / 100),
      nonSubscriberGarmentRatePaise: String(data.config.nonSubscriberGarmentRatePaise / 100),
      defaultSlotCapacity: String(data.config.defaultSlotCapacity),
      defaultTurnaroundHours: String(data.config.defaultTurnaroundHours),
      delayGraceHours: String(data.config.delayGraceHours),
      qcRequired: data.config.qcRequired,
      notificationsEnabled: data.config.notificationsEnabled,
      gstEnabled: data.config.gstEnabled,
      gstRatePercent: String(data.config.gstRatePercent),
    });
  }, [data]);

  const save = useAction(() => adminApi.config.update({
    additionalGarmentRatePaise: Math.round(Number(form.additionalGarmentRatePaise) * 100),
    nonSubscriberGarmentRatePaise: Math.round(Number(form.nonSubscriberGarmentRatePaise) * 100),
    defaultSlotCapacity: Number(form.defaultSlotCapacity),
    defaultTurnaroundHours: Number(form.defaultTurnaroundHours),
    delayGraceHours: Number(form.delayGraceHours),
    qcRequired: Boolean(form.qcRequired),
    notificationsEnabled: Boolean(form.notificationsEnabled),
    gstEnabled: Boolean(form.gstEnabled),
    gstRatePercent: Number(form.gstRatePercent),
  }));

  const [newService, setNewService] = React.useState({ name: "", unitPriceRupees: "", unit: "piece" });
  const addService = useAction(() => adminApi.config.addService({ name: newService.name, unitPricePaise: Math.round(Number(newService.unitPriceRupees) * 100), unit: newService.unit }));
  const retireService = useAction((id: string) => adminApi.config.retireService(id));
  const toggleService = useAction((id: string, isActive: boolean) => adminApi.config.updateService(id, { isActive }));

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-6">
          <section className="rounded-2xl glass p-5">
            <h3 className="mb-3 font-display text-base font-bold">Pricing & processing defaults</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Additional garment rate (₹)" type="number" value={String(form.additionalGarmentRatePaise ?? "")} onChange={(e) => setForm((f) => ({ ...f, additionalGarmentRatePaise: e.target.value }))} />
              <FormField label="Non-subscriber garment rate (₹)" type="number" value={String(form.nonSubscriberGarmentRatePaise ?? "")} onChange={(e) => setForm((f) => ({ ...f, nonSubscriberGarmentRatePaise: e.target.value }))} />
              <FormField label="Default slot capacity" type="number" value={String(form.defaultSlotCapacity ?? "")} onChange={(e) => setForm((f) => ({ ...f, defaultSlotCapacity: e.target.value }))} />
              <FormField label="Default turnaround (hrs)" type="number" value={String(form.defaultTurnaroundHours ?? "")} onChange={(e) => setForm((f) => ({ ...f, defaultTurnaroundHours: e.target.value }))} />
              <FormField label="Delay grace (hrs)" type="number" value={String(form.delayGraceHours ?? "")} onChange={(e) => setForm((f) => ({ ...f, delayGraceHours: e.target.value }))} />
              <FormField label="GST rate %" type="number" value={String(form.gstRatePercent ?? "")} onChange={(e) => setForm((f) => ({ ...f, gstRatePercent: e.target.value }))} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(form.qcRequired)} onChange={(e) => setForm((f) => ({ ...f, qcRequired: e.target.checked }))} className="size-4 rounded border-border" /> Quality check required</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(form.notificationsEnabled)} onChange={(e) => setForm((f) => ({ ...f, notificationsEnabled: e.target.checked }))} className="size-4 rounded border-border" /> Notifications enabled</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(form.gstEnabled)} onChange={(e) => setForm((f) => ({ ...f, gstEnabled: e.target.checked }))} className="size-4 rounded border-border" /> GST enabled</label>
            </div>
            {save.error && <p className="mt-2 text-sm text-danger">{save.error}</p>}
            <button onClick={() => save.run().then(() => { toast.push("Configuration saved"); reload(); }).catch(() => {})} disabled={save.busy}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              Save configuration
            </button>
          </section>

          <section className="rounded-2xl glass p-5">
            <h3 className="mb-3 font-display text-base font-bold">Garment services</h3>
            <div className="space-y-2">
              {data.config.garmentServices.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2.5 text-sm">
                  <div><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{rupees(s.unitPricePaise)} / {s.unit ?? "piece"}</p></div>
                  <div className="flex gap-1.5">
                    <button onClick={() => toggleService.run(s.id, s.isActive === false).then(() => { toast.push("Updated"); reload(); }).catch(() => {})}
                      className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">{s.isActive === false ? "Activate" : "Deactivate"}</button>
                    {!s.isBase && (
                      <button onClick={() => { if (!window.confirm(`Retire ${s.name}?`)) return; retireService.run(s.id).then(() => { toast.push("Retired"); reload(); }).catch((e) => toast.push(e?.message ?? "Failed", "danger")); }}
                        className="rounded-full glass px-2.5 py-1 text-xs text-danger hover:ring-1 hover:ring-danger/40">Retire</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <FormField label="New service name" value={newService.name} onChange={(e) => setNewService((v) => ({ ...v, name: e.target.value }))} className="min-w-40 flex-1" />
              <FormField label="Price (₹)" type="number" value={newService.unitPriceRupees} onChange={(e) => setNewService((v) => ({ ...v, unitPriceRupees: e.target.value }))} className="w-28" />
              <FormField as="select" label="Unit" value={newService.unit} onChange={(e) => setNewService((v) => ({ ...v, unit: e.target.value }))} className="w-28">
                <option value="piece">piece</option>
                <option value="kg">kg</option>
                <option value="job">job</option>
              </FormField>
              <button onClick={() => addService.run().then(() => { setNewService({ name: "", unitPriceRupees: "", unit: "piece" }); toast.push("Service added"); reload(); }).catch(() => {})}
                disabled={addService.busy || !newService.name || !newService.unitPriceRupees}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
                Add
              </button>
            </div>
            {addService.error && <p className="mt-1 text-xs text-danger">{addService.error}</p>}
          </section>
        </div>
      )}
    </Panel>
  );
}
