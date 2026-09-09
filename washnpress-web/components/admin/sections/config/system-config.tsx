"use client";

import * as React from "react";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type SystemConfig } from "@/lib/api/admin";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

type GarmentService = SystemConfig["garmentServices"][number];
const UNITS = ["kg", "piece", "hour", "job", "vehicle", "room", "sqft", "pair", "item"] as const;
const CLEAN_STAGES: { value: "wash" | "dry_clean" | "premium"; label: string }[] = [
  { value: "wash", label: "Wash" },
  { value: "dry_clean", label: "Dry clean" },
  { value: "premium", label: "Premium" },
];

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl glass p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

// System Configuration — GST, operational toggles, the pay-as-you-go garment rates,
// and the garment-service catalogue (including each service's processing steps).
// Parity with the mobile ConfigScreen. Every save goes through adminApi.config.*.
export function SystemConfigSection() {
  const { data, loading, error, reload } = useAsync(() => adminApi.config.get(), []);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="mx-auto max-w-2xl space-y-4">
          <GstConfig config={data.config} onSaved={reload} />
          <OperationalToggles config={data.config} onSaved={reload} />
          <GarmentRates config={data.config} onSaved={reload} />
          <GarmentServices config={data.config} onChanged={reload} />
        </div>
      )}
    </Panel>
  );
}

function GstConfig({ config, onSaved }: { config: SystemConfig; onSaved: () => void }) {
  const toast = useToast();
  const [enabled, setEnabled] = React.useState(config.gstEnabled);
  const [rate, setRate] = React.useState(String(config.gstRatePercent ?? 0));
  const rateNum = Number(rate);
  const rateError = enabled && (!(rateNum >= 0) || rateNum > 50) ? "Enter a rate between 0 and 50." : "";
  const save = useAction(() => adminApi.config.update({ gstEnabled: enabled, gstRatePercent: rateNum }));
  const dirty = enabled !== config.gstEnabled || rateNum !== (config.gstRatePercent ?? 0);

  return (
    <Section title="GST" description="Charge GST on orders, and the rate applied. Tax is reported beside revenue, never folded into it.">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 rounded border-border" />
          Charge GST on orders
        </label>
        {enabled && <FormField label="GST rate (%)" type="number" min="0" max="50" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} error={rateError} />}
        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button type="button" disabled={save.busy || !dirty || !!rateError}
          onClick={() => save.run().then(() => { toast.push("GST settings updated"); onSaved(); }).catch(() => {})}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : "Save GST settings"}
        </button>
      </div>
    </Section>
  );
}

function OperationalToggles({ config, onSaved }: { config: SystemConfig; onSaved: () => void }) {
  const toast = useToast();
  const qc = useAction((v: boolean) => adminApi.config.update({ qcRequired: v }));
  const notif = useAction((v: boolean) => adminApi.config.update({ notificationsEnabled: v }));

  const Toggle = ({ label, hint, value, onChange, busy }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; busy: boolean }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2.5">
      <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
      <button type="button" disabled={busy} onClick={() => onChange(!value)}
        className={cn("rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50", value ? "bg-success/15 text-success" : "bg-foreground/10 text-muted-foreground")}>
        {value ? "ON" : "OFF"}
      </button>
    </div>
  );

  return (
    <Section title="Operations">
      <div className="space-y-2">
        <Toggle label="Quality check required" hint="Orders must pass QC before delivery." value={config.qcRequired} busy={qc.busy}
          onChange={(v) => qc.run(v).then(() => { toast.push("Updated"); onSaved(); }).catch(() => toast.push(qc.error ?? "Failed", "danger"))} />
        <Toggle label="Notifications enabled" hint="Send residents and staff push/SMS updates." value={config.notificationsEnabled} busy={notif.busy}
          onChange={(v) => notif.run(v).then(() => { toast.push("Updated"); onSaved(); }).catch(() => toast.push(notif.error ?? "Failed", "danger"))} />
      </div>
    </Section>
  );
}

function GarmentRates({ config, onSaved }: { config: SystemConfig; onSaved: () => void }) {
  const toast = useToast();
  const [sub, setSub] = React.useState(String((config.additionalGarmentRatePaise ?? 0) / 100));
  const [non, setNon] = React.useState(String((config.nonSubscriberGarmentRatePaise ?? 0) / 100));
  const subPaise = Math.round(Number(sub) * 100);
  const nonPaise = Math.round(Number(non) * 100);
  const invalid = !(Number(sub) >= 0) || !(Number(non) >= 0);
  const dirty = subPaise !== (config.additionalGarmentRatePaise ?? 0) || nonPaise !== (config.nonSubscriberGarmentRatePaise ?? 0);
  const save = useAction(() => adminApi.config.update({ additionalGarmentRatePaise: subPaise, nonSubscriberGarmentRatePaise: nonPaise }));

  return (
    <Section title="Additional garment rates" description="What one extra garment costs beyond a plan's allowance. GST-inclusive.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Subscriber rate (₹)" type="number" min="0" step="0.01" value={sub} onChange={(e) => setSub(e.target.value)} hint="charged to residents on a plan" />
        <FormField label="Non-subscriber rate (₹)" type="number" min="0" step="0.01" value={non} onChange={(e) => setNon(e.target.value)} hint="charged to pay-per-order residents" />
      </div>
      {save.error && <p className="mt-2 text-sm text-danger">{save.error}</p>}
      <button type="button" disabled={save.busy || !dirty || invalid}
        onClick={() => save.run().then(() => { toast.push("Rates updated"); onSaved(); }).catch(() => {})}
        className="mt-3 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
        {save.busy ? "Saving…" : "Save rates"}
      </button>
    </Section>
  );
}

function processingSummary(s: GarmentService): string {
  const parts: string[] = [];
  if (s.requiresClean !== false) parts.push(CLEAN_STAGES.find((c) => c.value === (s.cleanStage ?? "wash"))?.label ?? "Wash");
  if (s.requiresPress !== false) parts.push("Press");
  return parts.length ? parts.join(" + ") : "No processing";
}

function GarmentServices({ config, onChanged }: { config: SystemConfig; onChanged: () => void }) {
  const [editing, setEditing] = React.useState<GarmentService | null>(null);
  const [creating, setCreating] = React.useState(false);
  const services = config.garmentServices ?? [];

  return (
    <Section title="Garment services & pricing" description="Each service, its unit and price, and what physically happens to a garment sent for it — which decides the stages its order goes through.">
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
          <Plus className="size-4" /> Add service
        </button>
      </div>
      <div className="space-y-2.5">
        {services.map((s) => (
          <button key={s.id} onClick={() => setEditing(s)}
            className="flex w-full items-center gap-3 rounded-2xl bg-foreground/5 p-4 text-left transition-colors hover:ring-1 hover:ring-primary/30">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {(s.unit ?? "piece") === "kg" ? `${rupees(s.unitPricePaise)} / KG` : (s.unit ?? "piece") === "piece" ? "Per piece · garment prices" : `${rupees(s.unitPricePaise)} / ${s.unit}`}
                {" · "}{processingSummary(s)}
              </span>
            </span>
            <StatusBadge status={s.isActive === false ? "inactive" : "active"} toneMap={{ active: "success", inactive: "muted" }} />
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
          </button>
        ))}
        {services.length === 0 && <p className="rounded-2xl bg-foreground/5 p-6 text-center text-sm text-muted-foreground">No garment services yet. Add one to get started.</p>}
      </div>

      {creating && <GarmentServiceDrawer existingNames={services.map((s) => s.name)} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); onChanged(); }} />}
      {editing && <GarmentServiceDrawer service={editing} existingNames={services.filter((s) => s.id !== editing.id).map((s) => s.name)}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} onRetired={() => { setEditing(null); onChanged(); }} />}
    </Section>
  );
}

function GarmentServiceDrawer({ service, existingNames, onClose, onSaved, onRetired }: {
  service?: GarmentService; existingNames: string[]; onClose: () => void; onSaved: () => void; onRetired?: () => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [name, setName] = React.useState(service?.name ?? "");
  const [unit, setUnit] = React.useState<string>(service?.unit ?? "piece");
  const [price, setPrice] = React.useState(String((service?.unitPricePaise ?? 0) / 100));
  const [active, setActive] = React.useState(service ? service.isActive !== false : true);
  const [requiresClean, setRequiresClean] = React.useState(service ? service.requiresClean !== false : true);
  const [cleanStage, setCleanStage] = React.useState<string>(service?.cleanStage ?? "wash");
  const [requiresPress, setRequiresPress] = React.useState(service ? service.requiresPress !== false : true);

  const perPiece = unit === "piece";
  const nameTaken = name.trim().length > 0 && existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());
  const priceError = !perPiece && !(Number(price) >= 0) ? "Enter a valid price." : "";
  const canSave = name.trim().length >= 2 && !nameTaken && !priceError;

  const save = useAction(() => {
    const body = {
      name: name.trim(), unit,
      unitPricePaise: perPiece ? 0 : Math.round(Number(price) * 100),
      requiresClean, cleanStage, requiresPress, isActive: active,
    };
    return service ? adminApi.config.updateService(service.id, body) : adminApi.config.addService(body);
  });
  const retire = useAction(() => adminApi.config.retireService(service!.id));

  const onRetire = async () => {
    if (!service) return;
    const ok = await confirm({ title: `Retire "${service.name}"?`, description: "It stops being offered for new orders. Orders already in flight keep it.", confirmLabel: "Retire", danger: true });
    if (!ok) return;
    retire.run().then(() => { toast.push("Service retired"); onRetired?.(); }).catch((e) => toast.push(e?.message ?? "Could not retire", "danger"));
  };

  return (
    <Modal open onClose={onClose} variant="drawer" title={service ? "Edit garment service" : "Add garment service"}>
      <div className="space-y-4">
        <FormField label="Service name" required value={name} onChange={(e) => setName(e.target.value)}
          error={nameTaken ? "A service with this name already exists." : undefined} placeholder="e.g. Wash & Fold" />
        <FormField as="select" label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} hint="Per-piece services are priced against garment categories.">
          {UNITS.map((u) => <option key={u} value={u}>{u === "kg" ? "Per KG" : u === "piece" ? "Per Piece" : `Per ${u}`}</option>)}
        </FormField>
        {!perPiece && <FormField label="Price (₹)" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} error={priceError} hint="GST included" />}

        <div className="space-y-2.5 rounded-xl border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Processing steps</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresClean} onChange={(e) => setRequiresClean(e.target.checked)} className="size-4 rounded border-border" /> Needs cleaning
          </label>
          {requiresClean && (
            <FormField as="select" label="Cleaning stage" value={cleanStage} onChange={(e) => setCleanStage(e.target.value)}>
              {CLEAN_STAGES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresPress} onChange={(e) => setRequiresPress(e.target.checked)} className="size-4 rounded border-border" /> Needs ironing / pressing
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 rounded border-border" /> Active — offered for new orders
        </label>

        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {service && (
            <button type="button" onClick={onRetire} disabled={retire.busy}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50">
              <Trash2 className="size-4" /> {retire.busy ? "Retiring…" : "Retire"}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl glass px-4 py-2.5 text-sm font-medium hover:ring-1 hover:ring-border">Cancel</button>
            <button type="button" disabled={!canSave || save.busy}
              onClick={() => save.run().then(() => { toast.push(service ? "Service updated" : "Service created"); onSaved(); }).catch(() => {})}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              {save.busy ? "Saving…" : service ? "Save Changes" : "Create Service"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
