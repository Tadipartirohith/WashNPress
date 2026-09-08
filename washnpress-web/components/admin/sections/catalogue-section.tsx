"use client";

import * as React from "react";
import { Plus, Search, Copy, CalendarPlus } from "lucide-react";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { CreateSlotModal } from "@/components/portal/create-slot-modal";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type ServiceOffering } from "@/lib/api/admin";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SubscriptionPlansConfig } from "./config/subscription-plans";
import { GarmentCategoriesManager } from "./config/garment-categories";
import { AdditionalChargesConfig } from "./config/additional-charges";

// The Catalogue is the single home for everything an admin sells or configures a
// price against: subscription plans, additional services, garment categories and
// additional charges. The same modules no longer live under System Configuration.
const CATALOGUE_TABS = [
  { id: "plans", label: "Plans" },
  { id: "services", label: "Services" },
  { id: "garments", label: "Garment Categories" },
  { id: "charges", label: "Additional Charges" },
] as const;
type CatalogueTab = (typeof CATALOGUE_TABS)[number]["id"];

export function CatalogueSection() {
  const [tab, setTab] = React.useState<CatalogueTab>("plans");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {CATALOGUE_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium", tab === t.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "plans" && <SubscriptionPlansConfig />}
      {tab === "services" && <ServicesTab />}
      {tab === "garments" && <GarmentCategoriesManager />}
      {tab === "charges" && <AdditionalChargesConfig />}
    </div>
  );
}

// -------------------------------------------------------------------- services

function ServicesTab() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const { data, loading, error, reload } = useAsync(() => adminApi.services.list({ q: q || undefined, status: status || undefined }), [q, status]);
  const toast = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createSlotOpen, setCreateSlotOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ServiceOffering | null>(null);
  const duplicate = useAction((id: string) => adminApi.services.duplicate(id));
  const toggleActive = useAction((id: string, isActive: boolean) => adminApi.services.update(id, { isActive }));

  const columns: Column<ServiceOffering>[] = [
    { header: "Service", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Category", cell: (r) => r.category },
    { header: "Unit", cell: (r) => r.unit },
    { header: "Price", align: "right", cell: (r) => rupees(r.nonSubscriberPricePaise) },
    { header: "Status", cell: (r) => <StatusBadge status={r.isActive === false ? "inactive" : "active"} toneMap={{ active: "success", inactive: "muted" }} /> },
    { header: "Actions", align: "right", cell: (r) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setEditing(r)} className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">Edit</button>
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
        <button onClick={() => setCreateSlotOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-full glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40">
          <CalendarPlus className="size-4" /> Create Slot
        </button>
        <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> Add New Service
        </button>
      </div>
      <DataTable columns={columns} rows={data?.services ?? []} keyField={(r) => r.id} loading={loading} error={error} onRowClick={(r) => setEditing(r)}
        emptyTitle="No services match" emptyDescription="Add one, or clear the filters." />
      <CreateServiceModal open={createOpen} onClose={() => setCreateOpen(false)} existingNames={(data?.services ?? []).map((s) => s.name)}
        onCreated={() => { setCreateOpen(false); reload(); toast.push("Service created"); }} />
      {editing && <ServiceEditDrawer service={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); toast.push("Service updated"); }} />}
      {createSlotOpen && (
        <CreateSlotModal
          onClose={() => setCreateSlotOpen(false)}
          onCreated={() => { setCreateSlotOpen(false); toast.push("Slot created"); }}
          loadSocieties={() => adminApi.societies.list().then((r) => r.societies.map((s) => ({ id: s.id, name: s.name })))}
          loadServices={() => adminApi.services.list({ status: "active" }).then((r) => r.services.map((s) => ({ id: s.id, name: s.name })))}
          createSlot={(body) => adminApi.serviceSlots.create(body)}
        />
      )}
    </div>
  );
}

// I-60: an editable right-side drawer for a service — name, pricing type (Per KG /
// Per Piece), price and status. Prices are GST-inclusive; per-piece pricing is set
// against garment categories rather than re-entered here.
function ServiceEditDrawer({ service, onClose, onSaved }: { service: ServiceOffering; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(service.name);
  const [unit, setUnit] = React.useState(service.unit || "kg");
  const [price, setPrice] = React.useState(String((service.nonSubscriberPricePaise ?? 0) / 100));
  const [active, setActive] = React.useState(service.isActive !== false);
  const perPiece = unit === "piece";
  const priceError = !perPiece && !(Number(price) > 0) ? "Enter a price greater than ₹0." : "";
  const save = useAction(() => adminApi.services.update(service.id, {
    name: name.trim(), unit, isActive: active,
    ...(perPiece ? {} : { nonSubscriberPricePaise: Math.round(Number(price) * 100), unitPricePaise: Math.round(Number(price) * 100) }),
  }));

  return (
    <Modal open onClose={onClose} variant="drawer" title="Edit service" description={service.name}>
      <form onSubmit={(e) => { e.preventDefault(); if (priceError || !name.trim()) return; save.run().then(onSaved).catch(() => {}); }} className="space-y-4">
        <FormField label="Service name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormField as="select" label="Pricing type" value={unit} onChange={(e) => setUnit(e.target.value)} hint="Per-piece services are priced against garment categories.">
          <option value="kg">Per KG</option>
          <option value="piece">Per Piece</option>
          <option value="job">Per Job</option>
        </FormField>
        {!perPiece && <FormField label="Price (₹)" type="number" min={1} required value={price} onChange={(e) => setPrice(e.target.value)} error={priceError} hint="GST included" />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 rounded border-border" /> Active — offered for new bookings</label>
        {save.error && <p className="text-sm text-danger">Unable to save changes. {save.error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
          <button type="submit" disabled={save.busy || !!priceError || !name.trim()} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">{save.busy ? "Saving…" : "Save Changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

// I-22: creating a service in three steps — Basic details, then Pricing & plans,
// then Review & create — rather than one flat form. The name is checked for a
// duplicate as it is typed (case-insensitive, trimmed) and again by the backend on
// create, which returns the same "Service name already exists" message.
type PlanCfg = { on: boolean; included: boolean; bookings: string; extra: string };
function CreateServiceModal({ open, onClose, existingNames, onCreated }: {
  open: boolean; onClose: () => void; existingNames: string[]; onCreated: () => void;
}) {
  const plans = useAsync(() => adminApi.plans.list(), []);
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [forSub, setForSub] = React.useState(false);
  const [forNon, setForNon] = React.useState(false);
  const [nonPrice, setNonPrice] = React.useState("");
  const [cfg, setCfgState] = React.useState<Record<string, PlanCfg>>({});
  const setCfg = (id: string, patch: Partial<PlanCfg>) =>
    setCfgState((m) => {
      const prev: PlanCfg = m[id] ?? { on: false, included: true, bookings: "", extra: "" };
      return { ...m, [id]: { ...prev, ...patch } };
    });

  React.useEffect(() => { if (open) { setStep(0); setName(""); setDescription(""); setForSub(false); setForNon(false); setNonPrice(""); setCfgState({}); } }, [open]);

  const norm = (s: string) => s.trim().toLowerCase();
  const nameTaken = name.trim().length > 0 && existingNames.some((n) => norm(n) === norm(name));
  const step1Ready = name.trim().length >= 2 && !nameTaken && (forSub || forNon);
  const planList = plans.data?.plans ?? [];
  const selectedPlans = planList.filter((p) => cfg[p.id]?.on);
  const step2Ready =
    (!forNon || Number(nonPrice) > 0) &&
    (!forSub || (selectedPlans.length > 0 && selectedPlans.every((p) => { const c = cfg[p.id]!; return !c.included || (Number(c.bookings) > 0 && Number(c.extra) >= 0); })));

  const eligibility = forSub && forNon ? "both" : forSub ? "subscriber" : "non_subscriber";
  const planRules = forSub ? selectedPlans.filter((p) => cfg[p.id]!.included).map((p) => ({
    planId: p.id, planName: (p.name ?? p.tier) as string, mode: "included" as const,
    includedQuantity: Number(cfg[p.id]!.bookings) || 0, additionalUsageAllowed: true,
    additionalRatePaise: Math.round((Number(cfg[p.id]!.extra) || 0) * 100),
    // The allowance is a monthly count; the backend still wants a cadence on an
    // included rule, so it takes the neutral "daily" the plan wizard uses when only
    // the quantity cap matters.
    frequency: "daily" as const,
  })) : [];

  const create = useAction(() => adminApi.services.create({
    // Category was dropped from this flow per the spec; additional services created
    // here default to "other" for the field the backend still stores.
    name: name.trim(), description: description.trim() || null, category: "other", unit: "job", eligibility,
    unitPricePaise: forNon ? Math.round(Number(nonPrice) * 100) : 0, planRules,
  }));

  const STEPS = ["Basic details", "Pricing & plans", "Review"];
  return (
    <Modal open={open} onClose={onClose} title="New service" description="Basic details, then pricing and plans, then a review before it is created.">
      <ol className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", i <= step ? "text-foreground" : "text-muted-foreground")}>
            <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-semibold", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-foreground/10")}>{i + 1}</span>
            {s}{i < 2 && <span className="mx-1 hidden h-px w-5 bg-border sm:inline-block" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <FormField label="Service name" required value={name} onChange={(e) => setName(e.target.value)} error={nameTaken ? "Service name already exists. Please enter a different service name." : undefined} placeholder="Dry Cleaning" maxLength={80} />
          <FormField as="textarea" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What this service is." />
          <fieldset>
            <legend className="mb-1.5 block text-xs font-medium text-muted-foreground">Customer type <span className="text-danger">*</span></legend>
            <div className="flex gap-5">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={forSub} onChange={(e) => setForSub(e.target.checked)} className="size-4 rounded border-border" /> Subscriber</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={forNon} onChange={(e) => setForNon(e.target.checked)} className="size-4 rounded border-border" /> Non-subscriber</label>
            </div>
          </fieldset>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={() => setStep(1)} disabled={!step1Ready} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          {forSub && (
            <section className="space-y-3">
              <div><h4 className="font-display text-sm font-bold">Subscriber pricing</h4><p className="text-xs text-muted-foreground">Choose the plans this service applies to, and how each includes it.</p></div>
              {plans.loading && <p className="text-xs text-muted-foreground">Loading plans…</p>}
              <div className="space-y-2">
                {planList.map((p) => {
                  const c = cfg[p.id] ?? { on: false, included: true, bookings: "", extra: "" };
                  return (
                    <div key={p.id} className="rounded-xl border border-border p-3">
                      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={c.on} onChange={(e) => setCfg(p.id, { on: e.target.checked })} className="size-4 rounded border-border" /> {p.name ?? p.tier}</label>
                      {c.on && (
                        <div className="mt-3 space-y-3 pl-6">
                          <div className="flex gap-4 text-sm">
                            <label className="flex items-center gap-1.5"><input type="radio" name={`inc-${p.id}`} checked={c.included} onChange={() => setCfg(p.id, { included: true })} /> Service included</label>
                            <label className="flex items-center gap-1.5"><input type="radio" name={`inc-${p.id}`} checked={!c.included} onChange={() => setCfg(p.id, { included: false })} /> Not included</label>
                          </div>
                          {c.included && (
                            <div className="grid grid-cols-2 gap-3">
                              <FormField label="Included bookings / month" required type="number" min="1" value={c.bookings} onChange={(e) => setCfg(p.id, { bookings: e.target.value })} />
                              <FormField label="Additional booking price (₹)" required type="number" min="0" value={c.extra} onChange={(e) => setCfg(p.id, { extra: e.target.value })} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {forNon && (
            <section className="space-y-2">
              <h4 className="font-display text-sm font-bold">Non-subscriber pricing</h4>
              <FormField label="Price per booking (₹)" required type="number" min="1" value={nonPrice} onChange={(e) => setNonPrice(e.target.value)} />
            </section>
          )}
          <div className="flex justify-between gap-2 pt-2">
            <button onClick={() => setStep(0)} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground">← Back</button>
            <button onClick={() => setStep(2)} disabled={!step2Ready} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border p-4 text-sm">
            <h4 className="mb-2 font-display font-bold">Service details</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Name</dt><dd>{name}</dd>
              <dt className="text-muted-foreground">Description</dt><dd>{description || "—"}</dd>
              <dt className="text-muted-foreground">Customer type</dt><dd>{[forSub && "Subscriber", forNon && "Non-subscriber"].filter(Boolean).join(", ")}</dd>
            </dl>
          </section>
          {forSub && (
            <section className="rounded-xl border border-border p-4 text-sm">
              <h4 className="mb-2 font-display font-bold">Subscriber pricing</h4>
              {selectedPlans.length === 0 ? <p className="text-muted-foreground">No plans selected.</p> :
                selectedPlans.map((p) => { const c = cfg[p.id]!; return (
                  <div key={p.id} className="flex justify-between border-b border-border/60 py-1 last:border-0">
                    <span>{p.name ?? p.tier}</span>
                    <span className="text-muted-foreground">{c.included ? `Included · ${c.bookings}/mo · extra ${rupees(Math.round((Number(c.extra) || 0) * 100))}` : "Not included"}</span>
                  </div>
                ); })}
            </section>
          )}
          {forNon && (
            <section className="flex justify-between rounded-xl border border-border p-4 text-sm">
              <span className="font-display font-bold">Price per booking</span><span>{rupees(Math.round((Number(nonPrice) || 0) * 100))}</span>
            </section>
          )}
          {create.error && <p className="text-sm text-danger">{create.error}</p>}
          <div className="flex justify-between gap-2 pt-2">
            <button onClick={() => setStep(1)} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground">← Back</button>
            <button onClick={() => create.run().then(onCreated).catch(() => {})} disabled={create.busy || nameTaken}
              className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              {create.busy ? "Creating…" : "Create service"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
