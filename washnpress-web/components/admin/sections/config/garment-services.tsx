"use client";

import * as React from "react";
import { Plus, ChevronRight, Search } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type SystemConfig } from "@/lib/api/admin";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

type GarmentService = SystemConfig["garmentServices"][number];
type PricingType = "kg" | "piece";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function GarmentServicesConfig() {
  const { data, loading, error, reload } = useAsync(() => adminApi.config.get(), []);
  const [tab, setTab] = React.useState<"services" | "garments">("services");

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="mx-auto max-w-xl space-y-4">
          <p className="text-sm text-muted-foreground">The single source of truth for service pricing. All prices are GST-inclusive.</p>
          <div className="flex gap-2">
            {(["services", "garments"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn("rounded-full px-4 py-2 text-sm font-medium", tab === t ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
                {t === "services" ? "Services" : "Garment Categories"}
              </button>
            ))}
          </div>
          {tab === "services" ? <ServicesList config={data.config} reload={reload} /> : <GarmentCategories config={data.config} reload={reload} />}
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------- services

function ServicesList({ config, reload }: { config: SystemConfig; reload: () => void }) {
  const toast = useToast();
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<GarmentService | null>(null);
  const toggle = useAction((id: string, isActive: boolean) => adminApi.config.updateService(id, { isActive }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> Add Service
        </button>
      </div>
      <div className="space-y-2.5">
        {config.garmentServices.map((s) => {
          const perKg = (s.unit ?? "piece") === "kg";
          return (
            <div key={s.id} className="flex items-center gap-3 rounded-2xl glass p-4">
              <button onClick={() => setEditing(s)} className="min-w-0 flex-1 text-left">
                <span className="block font-medium">{s.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{perKg ? "Per KG" : "Per Piece"}</span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="font-display text-base font-semibold">
                    {perKg ? `${rupees(s.unitPricePaise)} / KG` : "View garment prices"}
                  </span>
                  <span className="text-xs text-muted-foreground">GST included</span>
                </span>
              </button>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={s.isActive === false ? "inactive" : "active"} toneMap={{ active: "success", inactive: "muted" }} />
                <button onClick={() => toggle.run(s.id, s.isActive === false).then(() => { toast.push("Updated"); reload(); }).catch(() => {})}
                  className="rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40">
                  {s.isActive === false ? "Activate" : "Deactivate"}
                </button>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </div>
          );
        })}
      </div>
      {addOpen && <ServiceModal config={config} existingNames={config.garmentServices.map((s) => s.name)} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload(); }} />}
      {editing && <ServiceModal config={config} service={editing} existingNames={config.garmentServices.filter((s) => s.id !== editing.id).map((s) => s.name)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function ServiceModal({ config, service, existingNames, onClose, onSaved }: {
  config: SystemConfig;
  service?: GarmentService;
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(service?.name ?? "");
  const [pricingType, setPricingType] = React.useState<PricingType>(((service?.unit ?? "piece") === "kg") ? "kg" : "piece");
  const [kgRupees, setKgRupees] = React.useState(service ? String(service.unitPricePaise / 100) : "");
  // Per-piece garment prices, seeded from the service's saved map or blank for a new one.
  const [prices, setPrices] = React.useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const g of config.garmentCategories) {
      const p = service?.pricesPaise?.[g];
      seed[g] = p != null ? String(p / 100) : "";
    }
    return seed;
  });

  const trimmed = name.trim();
  const nameTaken = trimmed.length > 0 && existingNames.some((n) => norm(n) === norm(name));
  const nameError = trimmed.length === 0 ? undefined : nameTaken ? "A service with this name already exists." : undefined;

  const kgNum = Number(kgRupees);
  const kgValid = pricingType !== "kg" || (kgRupees !== "" && kgNum > 0);
  const pieceValid = pricingType !== "piece" || Object.values(prices).some((v) => v !== "" && Number(v) > 0);
  const canSave = trimmed.length > 0 && !nameTaken && kgValid && pieceValid;

  const save = useAction(() => {
    if (pricingType === "kg") {
      const body = { name: trimmed, unit: "kg", unitPricePaise: Math.round(kgNum * 100), pricesPaise: {} };
      return service ? adminApi.config.updateService(service.id, body) : adminApi.config.addService(body);
    }
    const pricesPaise: Record<string, number> = {};
    for (const [g, v] of Object.entries(prices)) if (v !== "" && Number(v) > 0) pricesPaise[g] = Math.round(Number(v) * 100);
    const body = { name: trimmed, unit: "piece", unitPricePaise: 0, pricesPaise };
    return service ? adminApi.config.updateService(service.id, body) : adminApi.config.addService(body);
  });

  return (
    <Modal open onClose={onClose} title={service ? "Edit Service" : "Add Service"}>
      <form onSubmit={(e) => { e.preventDefault(); if (!canSave) return; save.run().then(() => { toast.push(service ? "Service updated" : "Service added"); onSaved(); }).catch(() => {}); }} className="space-y-4">
        <FormField label="Service Name" required value={name} onChange={(e) => setName(e.target.value)} error={nameError} placeholder="e.g. Wash Only" />

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">Pricing Type <span className="text-danger">*</span></span>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPricingType("kg")}
              className={cn("rounded-xl border px-3 py-2.5 text-sm font-medium", pricingType === "kg" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              Per KG <span className="block text-xs font-normal opacity-80">Weight based</span>
            </button>
            <button type="button" onClick={() => setPricingType("piece")}
              className={cn("rounded-xl border px-3 py-2.5 text-sm font-medium", pricingType === "piece" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              Per Piece <span className="block text-xs font-normal opacity-80">Garment based</span>
            </button>
          </div>
        </div>

        {pricingType === "kg" ? (
          <FormField label="Price per KG (₹)" required type="number" min="0" step="0.01" value={kgRupees}
            onChange={(e) => setKgRupees(e.target.value)} hint="Price per KG · GST included"
            error={kgRupees !== "" && !(kgNum > 0) ? "Enter a price greater than 0." : undefined} />
        ) : (
          <div className="space-y-2">
            <span className="block text-xs font-medium text-muted-foreground">Garment Prices (₹ / piece)</span>
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {config.garmentCategories.map((g) => (
                <div key={g} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm">{g}</span>
                  <input type="number" min="0" step="0.01" value={prices[g] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [g]: e.target.value }))}
                    placeholder="—" className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">GST included. A garment left blank falls back to no per-piece price.</p>
            {!pieceValid && <p className="text-xs text-danger">Set a price for at least one garment.</p>}
          </div>
        )}

        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button type="submit" disabled={save.busy || !canSave}
          className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : service ? "Save Changes" : "Add Service"}
        </button>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------- garment categories

function GarmentCategories({ config, reload }: { config: SystemConfig; reload: () => void }) {
  const toast = useToast();
  const [query, setQuery] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const status = config.garmentCategoryStatus ?? {};
  const prices = config.garmentPricesPaise ?? {};

  const filtered = config.garmentCategories.filter((g) => g.toLowerCase().includes(query.trim().toLowerCase()));

  const savePrice = useAction((g: string, rupeesVal: string) =>
    adminApi.config.update({ garmentPricesPaise: { ...prices, [g]: Math.round(Number(rupeesVal) * 100) } }));
  const toggle = useAction((g: string, active: boolean) =>
    adminApi.config.update({ garmentCategoryStatus: { ...status, [g]: active } }));
  const add = useAction((g: string) =>
    adminApi.config.update({ garmentCategories: [...config.garmentCategories, g] }));

  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const draftOf = (g: string) => drafts[g] ?? (prices[g] != null ? String(prices[g] / 100) : "");

  const addTaken = newName.trim().length > 0 && config.garmentCategories.some((g) => norm(g) === norm(newName));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3">
        <Search className="size-4 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search garments"
          className="w-full bg-transparent py-2.5 text-sm outline-none" />
      </div>

      <div className="space-y-2">
        {filtered.map((g) => {
          const active = status[g] !== false;
          return (
            <div key={g} className="flex flex-wrap items-center gap-3 rounded-xl bg-foreground/5 px-3 py-2.5">
              <span className="w-24 text-sm font-medium">{g}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">₹</span>
                <input type="number" min="0" step="0.01" value={draftOf(g)} onChange={(e) => setDrafts((d) => ({ ...d, [g]: e.target.value }))}
                  className="w-24 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={() => savePrice.run(g, draftOf(g)).then(() => { toast.push("Price saved"); reload(); }).catch(() => {})}
                  className="rounded-lg glass px-2.5 py-1.5 text-xs hover:ring-1 hover:ring-primary/40">Save</button>
              </div>
              <button onClick={() => toggle.run(g, !active).then(() => { toast.push("Updated"); reload(); }).catch(() => {})}
                className={cn("ml-auto rounded-full px-2.5 py-1 text-xs font-medium", active ? "bg-success/15 text-success" : "bg-foreground/10 text-muted-foreground")}>
                {active ? "Active" : "Inactive"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-end gap-2 pt-1">
        <FormField label="Add garment" value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1"
          error={addTaken ? "That garment already exists." : undefined} placeholder="e.g. Curtains" />
        <button onClick={() => add.run(newName.trim()).then(() => { setNewName(""); toast.push("Garment added"); reload(); }).catch(() => {})}
          disabled={add.busy || newName.trim().length === 0 || addTaken}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">Add</button>
      </div>
    </div>
  );
}
