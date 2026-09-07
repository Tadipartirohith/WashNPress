"use client";

import * as React from "react";
import { Plus, ChevronRight } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type AdditionalCharge, type ChargingType } from "@/lib/api/admin";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<ChargingType, string> = {
  per_order: "Per Order",
  per_kg: "Per KG",
  per_piece: "Per Piece",
};
// The unit that trails an amount for each charging type. A per-order charge applies
// once, so it has no per-unit suffix.
const TYPE_SUFFIX: Record<ChargingType, string> = {
  per_order: "",
  per_kg: "/ KG",
  per_piece: "/ piece",
};

function amountLabel(c: Pick<AdditionalCharge, "chargingType" | "amountPaise">): string {
  const suffix = TYPE_SUFFIX[c.chargingType];
  return `${rupees(c.amountPaise)}${suffix ? ` ${suffix}` : ""}`;
}

export function AdditionalChargesConfig() {
  const { data, loading, error, reload } = useAsync(() => adminApi.config.get(), []);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AdditionalCharge | null>(null);

  const charges = data?.config.additionalCharges ?? [];

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Manage extra charges applicable to bookings. All amounts are GST-inclusive.</p>
          <button onClick={() => setAddOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
            <Plus className="size-4" /> Add Charge
          </button>
        </div>

        {charges.length === 0 ? (
          <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
            No additional charges yet. Add one like Express Service or Heavy Load Charge.
          </div>
        ) : (
          <div className="space-y-2.5">
            {charges.map((c) => (
              <button key={c.id} onClick={() => setEditing(c)}
                className="flex w-full items-center gap-4 rounded-2xl glass p-4 text-left transition-colors hover:ring-1 hover:ring-primary/30">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{c.name}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{TYPE_LABEL[c.chargingType]}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="font-display text-base font-semibold">{amountLabel(c)}</span>
                    <span className="text-xs text-muted-foreground">GST included</span>
                  </span>
                </span>
                <StatusBadge status={c.isActive ? "active" : "inactive"} toneMap={{ active: "success", inactive: "muted" }} />
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>

      {addOpen && <ChargeModal existingNames={charges.map((c) => c.name)} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload(); }} />}
      {editing && <ChargeModal charge={editing} existingNames={charges.filter((c) => c.id !== editing.id).map((c) => c.name)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Panel>
  );
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function ChargeModal({ charge, existingNames, onClose, onSaved }: {
  charge?: AdditionalCharge;
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(charge?.name ?? "");
  const [chargingType, setChargingType] = React.useState<ChargingType>(charge?.chargingType ?? "per_order");
  const [amountRupees, setAmountRupees] = React.useState(charge ? String(charge.amountPaise / 100) : "");
  const [isActive, setIsActive] = React.useState(charge?.isActive ?? true);

  const trimmed = name.trim();
  const nameTaken = trimmed.length > 0 && existingNames.some((n) => norm(n) === norm(name));
  const amountNum = Number(amountRupees);
  const amountValid = amountRupees !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const nameError = trimmed.length === 0 ? undefined : nameTaken ? "A charge with this name already exists." : undefined;

  const save = useAction(() => {
    const body = { name: trimmed, chargingType, amountPaise: Math.round(amountNum * 100), isActive };
    return charge ? adminApi.charges.update(charge.id, body) : adminApi.charges.create(body);
  });

  const canSave = trimmed.length > 0 && !nameTaken && amountValid;

  return (
    <Modal open onClose={onClose} title={charge ? "Edit Charge" : "Add Charge"}>
      <form onSubmit={(e) => { e.preventDefault(); if (!canSave) return; save.run().then(() => { toast.push(charge ? "Charge updated" : "Charge added"); onSaved(); }).catch(() => {}); }} className="space-y-4">
        <FormField label="Charge Name" required value={name} onChange={(e) => setName(e.target.value)} error={nameError} placeholder="e.g. Express Service" />

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">Charging Type <span className="text-danger">*</span></span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_LABEL) as ChargingType[]).map((t) => (
              <button key={t} type="button" onClick={() => setChargingType(t)}
                className={cn("rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors",
                  chargingType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <FormField label={`Amount (₹${TYPE_SUFFIX[chargingType] ? ` ${TYPE_SUFFIX[chargingType]}` : ""})`} required type="number" min="0" step="0.01"
          value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)}
          error={amountRupees !== "" && !amountValid ? "Enter an amount greater than 0." : undefined}
          hint="GST included — this is the final customer-facing amount." />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 rounded border-border" />
          Active — available for applicable new orders
        </label>

        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <button type="submit" disabled={save.busy || !canSave}
          className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {save.busy ? "Saving…" : charge ? "Save Changes" : "Add Charge"}
        </button>
      </form>
    </Modal>
  );
}
