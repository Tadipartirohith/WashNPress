"use client";

import * as React from "react";
import { Plus, ChevronRight, Search, Trash2 } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type Plan, type SystemConfig } from "@/lib/api/admin";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

type BillingPeriod = "monthly" | "quarterly" | "half_yearly" | "yearly";
const PERIODS: { value: BillingPeriod; label: string; suffix: string }[] = [
  { value: "monthly", label: "Monthly", suffix: "month" },
  { value: "quarterly", label: "Quarterly", suffix: "quarter" },
  { value: "half_yearly", label: "Half-Yearly", suffix: "half-year" },
  { value: "yearly", label: "Yearly", suffix: "year" },
];
const suffixOf = (p?: string) => PERIODS.find((x) => x.value === p)?.suffix ?? "month";

type GarmentService = SystemConfig["garmentServices"][number];
type PlanService = {
  serviceId: string; serviceName: string; unit: string; includedQuantity: number;
  // What this plan charges for going past the allowance, per unit of this service.
  // Optional because plans written before the field existed do not carry one.
  additionalRatePaise?: number;
};

// Whether an additional booking price can be charged, or what is wrong with it.
//
// Number() alone accepts "1e3", " 12 " and "0x10" and rejects nothing a person would
// recognise as wrong. Paise are the smallest unit there is, so a third decimal place
// is not a price.
const NUMERIC = /^\d+(\.\d{1,2})?$/;
function extraProblem(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return "Enter an additional booking price.";
  // A minus sign is a recognisable attempt at a negative number, so it is answered
  // as one rather than lumped in with "abc".
  if (value.startsWith("-")) return "The additional booking price cannot be negative.";
  if (!NUMERIC.test(value)) return "Enter a number, such as 100 or 99.50.";
  if (Number(value) <= 0) return "The additional booking price must be more than zero.";
  return null;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function SubscriptionPlansConfig() {
  const plansQ = useAsync(() => adminApi.plans.list(), []);
  const configQ = useAsync(() => adminApi.config.get(), []);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"all" | "active" | "inactive">("all");

  const activeServices = (configQ.data?.config.garmentServices ?? []).filter((s) => s.isActive !== false);

  const allPlans = plansQ.data?.plans ?? [];
  const plans = allPlans.filter((p) => {
    if (status === "active" && !p.isActive) return false;
    if (status === "inactive" && p.isActive) return false;
    if (q.trim() && !p.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <Panel loading={plansQ.loading || configQ.loading} error={plansQ.error || configQ.error} onRetry={() => { plansQ.reload(); configQ.reload(); }}>
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Create and manage subscription plans using configured services. All prices are GST-inclusive.</p>
          <button onClick={() => setCreateOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
            <Plus className="size-4" /> Create Plan
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm">
            <Search className="size-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plans" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="space-y-2.5">
          {plans.map((p) => {
            const services = (p.services ?? []) as PlanService[];
            return (
              <button key={p.id} onClick={() => setEditing(p)}
                className="flex w-full items-start gap-3 rounded-2xl glass p-4 text-left transition-colors hover:ring-1 hover:ring-primary/30">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.name}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="font-display text-base font-semibold">{rupees(p.monthlyPaise)} / {suffixOf(p.billingPeriod as string)}</span>
                    <span className="text-xs text-muted-foreground">GST included</span>
                  </span>
                  {services.length > 0 && (
                    <span className="mt-1.5 block space-y-0.5">
                      {services.map((s) => (
                        <span key={s.serviceId} className="block text-xs text-muted-foreground">
                          {s.serviceName} — {s.includedQuantity} {s.unit === "kg" ? "KG" : "pieces"}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <StatusBadge status={p.isActive ? "active" : "inactive"} toneMap={{ active: "success", inactive: "muted" }} />
                <ChevronRight className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
          {plans.length === 0 && (
            <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
              {allPlans.length === 0 ? "No plans yet. Create one to get started." : "No plans match your search or filter."}
            </div>
          )}
        </div>
      </div>

      {createOpen && <PlanWizard services={activeServices} defaultTurnaround={configQ.data?.config.defaultTurnaroundHours ?? 48}
        existingNames={allPlans.map((p) => p.name)} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); plansQ.reload(); }} />}
      {editing && <PlanWizard plan={editing} services={activeServices} defaultTurnaround={configQ.data?.config.defaultTurnaroundHours ?? 48}
        existingNames={allPlans.filter((p) => p.id !== editing.id).map((p) => p.name)} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); plansQ.reload(); }} onDeleted={() => { setEditing(null); plansQ.reload(); }} />}
    </Panel>
  );
}

function PlanWizard({ plan, services, defaultTurnaround, existingNames, onClose, onSaved, onDeleted }: {
  plan?: Plan;
  services: GarmentService[];
  defaultTurnaround: number;
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [step, setStep] = React.useState(1);
  const [name, setName] = React.useState(plan?.name ?? "");
  const [billingPeriod, setBillingPeriod] = React.useState<BillingPeriod>((plan?.billingPeriod as BillingPeriod) ?? "monthly");
  const [priceRupees, setPriceRupees] = React.useState(plan ? String(plan.monthlyPaise / 100) : "");

  // Which services are included, and the allowance per service, seeded from the plan.
  const seeded = React.useMemo(() => {
    const on: Record<string, boolean> = {};
    const qty: Record<string, string> = {};
    // An existing plan's rate is shown so an edit is an edit rather than a retype.
    // A new plan starts empty, which is the point of the field.
    const extraRate: Record<string, string> = {};
    for (const s of (plan?.services ?? []) as PlanService[]) {
      on[s.serviceId] = true;
      qty[s.serviceId] = String(s.includedQuantity);
      if (s.additionalRatePaise) extraRate[s.serviceId] = String(s.additionalRatePaise / 100);
    }
    return { on, qty, extraRate };
  }, [plan]);
  const [included, setIncluded] = React.useState<Record<string, boolean>>(seeded.on);
  const [allowance, setAllowance] = React.useState<Record<string, string>>(seeded.qty);
  const [isActive, setIsActive] = React.useState(plan?.isActive ?? true);
  // What a plan holder pays for going past their allowance, per service.
  //
  // This was never asked for: the rate was taken from the catalogue for weighed
  // services and set to zero for per-piece ones, so every piece-based plan shipped
  // giving overage away free. It is a different question from the service price —
  // that is what somebody with no plan pays — so it is typed, and starts empty.
  const [extra, setExtra] = React.useState<Record<string, string>>(seeded.extraRate);

  const trimmed = name.trim();
  const nameTaken = trimmed.length > 0 && existingNames.some((n) => norm(n) === norm(name));
  const priceNum = Number(priceRupees);
  const step1Valid = trimmed.length > 0 && !nameTaken && priceRupees !== "" && priceNum > 0;
  const chosen = services.filter((s) => included[s.id]);
  const step2Valid = chosen.length > 0
    && chosen.every((s) => allowance[s.id] !== "" && Number(allowance[s.id]) > 0)
    && chosen.every((s) => extraProblem(extra[s.id] ?? "") === null);

  const buildServices = (): PlanService[] => chosen.map((s) => ({
    serviceId: s.id, serviceName: s.name, unit: (s.unit ?? "piece"),
    includedQuantity: Number(allowance[s.id]),
    additionalRatePaise: Math.round(Number(extra[s.id]) * 100),
  }));

  const save = useAction(() => {
    const planServices = chosen.map((s) => ({
      serviceId: s.id, serviceName: s.name, unit: (s.unit ?? "piece"),
      includedQuantity: Number(allowance[s.id]), frequency: "daily" as const,
      // The price the admin typed for this plan and this service, saved against the
      // pair. It is what the excess-usage charge is worked out from.
      additionalRatePaise: Math.round(Number(extra[s.id]) * 100),
      additionalUsageAllowed: true,
    }));
    const totalAllowance = Math.max(1, Math.round(chosen.reduce((n, s) => n + Number(allowance[s.id] || 0), 0)));
    const body = {
      tier: plan?.tier || slug(trimmed) || "plan",
      name: trimmed,
      billingPeriod,
      monthlyPaise: Math.round(priceNum * 100),
      garmentCap: totalAllowance,
      turnaroundHours: plan?.turnaroundHours || defaultTurnaround,
      services: planServices,
      isActive,
    };
    return plan ? adminApi.plans.update(plan.id, body) : adminApi.plans.create(body);
  });

  const unitLabel = (s: GarmentService) => ((s.unit ?? "piece") === "kg" ? "KG" : "pieces");
  const perUnit = (s: GarmentService) => ((s.unit ?? "piece") === "kg" ? "/ KG" : "/ piece");
  const priceLabel = (s: GarmentService) => ((s.unit ?? "piece") === "kg" ? `${rupees(s.unitPricePaise)} / KG` : "Per Piece · garment prices");

  const del = useAction(() => adminApi.plans.remove(plan!.id));
  const onDelete = async () => {
    if (!plan) return;
    const ok = await confirm({
      title: `Delete "${plan.name}"?`,
      description: "This permanently removes the plan. Plans with active subscriptions cannot be deleted — deactivate them instead.",
      confirmLabel: "Delete plan",
      danger: true,
    });
    if (!ok) return;
    del.run()
      .then(() => { toast.push("Plan deleted"); onDeleted?.(); })
      .catch((e) => toast.push(e?.message ?? "Could not delete plan", "danger"));
  };

  return (
    <Modal open onClose={onClose} variant="drawer" title={plan ? "Edit Plan" : "Create Plan"} description={`Step ${step} of 3`}>
      {step === 1 && (
        <div className="space-y-4">
          <FormField label="Plan Name" required value={name} onChange={(e) => setName(e.target.value)}
            error={trimmed.length > 0 && nameTaken ? "A plan with this name already exists." : undefined} placeholder="e.g. Premium Plan" />
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">Billing Period <span className="text-danger">*</span></span>
            <div className="grid grid-cols-2 gap-2">
              {PERIODS.map((p) => (
                <button key={p.value} type="button" onClick={() => setBillingPeriod(p.value)}
                  className={cn("rounded-xl border px-3 py-2.5 text-sm font-medium", billingPeriod === p.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <FormField label="Plan Price (₹)" required type="number" min="0" step="0.01" value={priceRupees}
            onChange={(e) => setPriceRupees(e.target.value)} hint={`₹${priceRupees || "—"} / ${suffixOf(billingPeriod)} · GST included`}
            error={priceRupees !== "" && !(priceNum > 0) ? "Enter a price greater than 0." : undefined} />
          <button type="button" disabled={!step1Valid} onClick={() => setStep(2)}
            className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">Next</button>
          {plan && (
            <button type="button" onClick={onDelete} disabled={del.busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50">
              <Trash2 className="size-4" /> {del.busy ? "Deleting…" : "Delete plan"}
            </button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Select included services. Prices come from Garment Services &amp; Pricing and cannot be edited here.</p>
          <div className="space-y-2">
            {services.length === 0 && <p className="text-sm text-muted-foreground">No active services configured. Add one in Garment Services &amp; Pricing first.</p>}
            {services.map((s) => {
              const on = !!included[s.id];
              return (
                <div key={s.id} className={cn("rounded-xl border p-3", on ? "border-primary/40 bg-primary/5" : "border-border")}>
                  <label className="flex items-center gap-2.5">
                    <input type="checkbox" checked={on} onChange={(e) => setIncluded((m) => ({ ...m, [s.id]: e.target.checked }))} className="size-4 rounded border-border" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{s.name}</span>
                      <span className="block text-xs text-muted-foreground">{priceLabel(s)} · GST included</span>
                    </span>
                  </label>
                  {on && (
                    <div className="mt-2.5 space-y-2 pl-7">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Included quantity</span>
                        <input type="number" min="1" value={allowance[s.id] ?? ""} onChange={(e) => setAllowance((m) => ({ ...m, [s.id]: e.target.value }))}
                          aria-label={`Included quantity for ${s.name}`}
                          className="w-20 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                        <span className="text-xs text-muted-foreground">{unitLabel(s)} / {suffixOf(billingPeriod)}</span>
                      </div>
                      {/* Typed, never inherited. The service price above is what
                          somebody with no plan pays; this is what a plan holder pays
                          for going over, and a plan may charge differently for the
                          two. Pre-filling it is why plans went out charging list
                          price — or, for per-piece services, nothing at all. */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Additional booking price <span className="text-danger">*</span>
                        </span>
                        <span className="text-xs text-muted-foreground">₹</span>
                        <input inputMode="decimal" placeholder="0.00" value={extra[s.id] ?? ""}
                          onChange={(e) => setExtra((m) => ({ ...m, [s.id]: e.target.value }))}
                          aria-label={`Additional booking price for ${s.name}`}
                          aria-invalid={Boolean(extraProblem(extra[s.id] ?? ""))}
                          className="w-24 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                        <span className="text-xs text-muted-foreground">{perUnit(s)}</span>
                      </div>
                      {extraProblem(extra[s.id] ?? "") && (
                        <p className="text-xs text-danger">{extraProblem(extra[s.id] ?? "")}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-xl glass py-3 font-medium">Back</button>
            <button type="button" disabled={!step2Valid} onClick={() => setStep(3)}
              className="flex-1 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">Review</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-2xl glass p-4">
            <p className="font-display text-lg font-bold">{trimmed}</p>
            <p className="mt-0.5 flex items-center gap-2"><span className="font-semibold">{rupees(Math.round(priceNum * 100))} / {suffixOf(billingPeriod)}</span><span className="text-xs text-muted-foreground">GST included</span></p>
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Included Services</p>
              {buildServices().map((s) => (
                <div key={s.serviceId} className="flex items-center justify-between gap-3 text-sm">
                  <span>{s.serviceName}</span>
                  {/* Both numbers, because the review is where an admin catches a
                      price they meant to change and did not. */}
                  <span className="text-right text-muted-foreground">
                    {s.includedQuantity} {s.unit === "kg" ? "KG" : "pieces"} / {suffixOf(billingPeriod)}
                    {s.additionalRatePaise ? (
                      <span className="block text-xs">then {rupees(s.additionalRatePaise)} {s.unit === "kg" ? "/ KG" : "/ piece"}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 rounded border-border" />
            Active — offered to residents
          </label>
          {save.error && <p className="text-sm text-danger">{save.error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(2)} className="flex-1 rounded-xl glass py-3 font-medium">Back</button>
            <button type="button" disabled={save.busy} onClick={() => save.run().then(() => { toast.push(plan ? "Plan updated" : "Plan created"); onSaved(); }).catch(() => {})}
              className="flex-1 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              {save.busy ? "Saving…" : plan ? "Save Changes" : "Create Plan"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
