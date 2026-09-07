"use client";

import * as React from "react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { useAsync, useAction } from "@/lib/use-async";

type Named = { id: string; name: string };
type Window = "Morning" | "Afternoon" | "Evening";

// The Create New Slot wizard, shared by Admin → Services and Supervisor → Services.
// A slot is one additional service on a date and window at a society, with a
// capacity. Only the three fixed windows are offered — no custom times — and the
// backend enforces uniqueness on society + date + service + window.
export function CreateSlotModal({ onClose, onCreated, loadSocieties, loadServices, createSlot }: {
  onClose: () => void;
  onCreated: () => void;
  loadSocieties: () => Promise<Named[]>;
  loadServices: () => Promise<Named[]>;
  createSlot: (body: { societyId: string; date: string; offeringId: string; window: Window; capacity: number }) => Promise<unknown>;
}) {
  const societies = useAsync(loadSocieties, []);
  const services = useAsync(loadServices, []);
  const [societyId, setSocietyId] = React.useState("");
  const [date, setDate] = React.useState("");
  const [offeringId, setOfferingId] = React.useState("");
  const [window, setWindow] = React.useState<Window>("Morning");
  const [capacity, setCapacity] = React.useState("");

  const today = new Date().toISOString().slice(0, 10);
  const capacityNum = Number(capacity);
  const capacityValid = capacity !== "" && Number.isInteger(capacityNum) && capacityNum >= 1;
  const canSave = societyId && date && offeringId && window && capacityValid;

  const save = useAction(() => createSlot({ societyId, date, offeringId, window, capacity: capacityNum }));

  return (
    <Modal open onClose={onClose} title="Create New Slot">
      <form onSubmit={(e) => { e.preventDefault(); if (!canSave) return; save.run().then(onCreated).catch(() => {}); }} className="space-y-4">
        <FormField as="select" label="Society" required value={societyId} onChange={(e) => setSocietyId(e.target.value)}>
          <option value="">Select Society</option>
          {(societies.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormField>

        <FormField label="Date" required type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />

        <FormField as="select" label="Additional Service" required value={offeringId} onChange={(e) => setOfferingId(e.target.value)}
          hint={services.data && services.data.length === 0 ? "No active additional services. Add one first." : undefined}>
          <option value="">Select Service</option>
          {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </FormField>

        <FormField as="select" label="Slot" required value={window} onChange={(e) => setWindow(e.target.value as Window)}>
          <option value="Morning">Morning</option>
          <option value="Afternoon">Afternoon</option>
          <option value="Evening">Evening</option>
        </FormField>

        <FormField label="Capacity" required type="number" min="1" step="1" value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          error={capacity !== "" && !capacityValid ? "Enter a whole number of at least 1." : undefined}
          placeholder="Enter capacity" />

        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl glass py-3 text-sm font-medium">Cancel</button>
          <button type="submit" disabled={save.busy || !canSave}
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
            {save.busy ? "Creating…" : "Create Slot"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
