"use client";

import { slotCapacityProblem } from "@/lib/slot-capacity";
import * as React from "react";
import { Panel } from "@/components/portal/panel";
import { FormField } from "@/components/portal/form-field";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type Weekday, type WorkingHours, type WorkingHoursDay } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

const DAYS: { key: Weekday; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const DEFAULT_DAY: WorkingHoursDay = { enabled: true, start: "08:00", end: "20:00" };

function fullWorkingHours(partial?: WorkingHours): WorkingHours {
  const out = {} as WorkingHours;
  for (const { key } of DAYS) out[key] = partial?.[key] ?? { ...DEFAULT_DAY, enabled: key !== "sun" };
  return out;
}

// Platform defaults, mirrored from the backend defaultSystemConfig(). Used by the
// "Reset to Default" action so a stuck configuration can be restored in one click.
const PLATFORM_DEFAULTS = {
  capacity: "20",
  duration: "60",
  advanceDays: "7",
  cancelHours: "2",
  autoClose: true,
  turnaround: "48",
  graceHours: "2",
} as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl glass p-5">
      <h3 className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

// Rendered inside the Slots → Slot Settings drawer (I-67). When `onClose` is
// supplied (drawer mode), a Reset / Cancel / Save footer replaces the standalone
// save button and the drawer closes after a successful save.
export function SlotsSchedulingConfig({ onClose }: { onClose?: () => void } = {}) {
  const { data, loading, error, reload } = useAsync(() => adminApi.config.get(), []);
  const toast = useToast();
  const { confirm } = useConfirm();

  const [capacity, setCapacity] = React.useState("");
  const [duration, setDuration] = React.useState("60");
  const [hours, setHours] = React.useState<WorkingHours>(() => fullWorkingHours());
  const [advanceDays, setAdvanceDays] = React.useState("");
  const [cancelHours, setCancelHours] = React.useState("");
  const [autoClose, setAutoClose] = React.useState(true);
  const [turnaround, setTurnaround] = React.useState("");
  const [graceHours, setGraceHours] = React.useState("");

  React.useEffect(() => {
    if (!data) return;
    const c = data.config;
    setCapacity(String(c.defaultSlotCapacity));
    setDuration(String(c.slotDurationMinutes ?? 60));
    setHours(fullWorkingHours(c.workingHours));
    setAdvanceDays(String(c.advanceBookingDays ?? 7));
    setCancelHours(String(c.cancellationWindowHours ?? 2));
    setAutoClose(c.autoClosePastSlots ?? true);
    setTurnaround(String(c.defaultTurnaroundHours));
    setGraceHours(String(c.delayGraceHours));
  }, [data]);

  const setDay = (key: Weekday, patch: Partial<WorkingHoursDay>) =>
    setHours((h) => ({ ...h, [key]: { ...h[key], ...patch } }));

  // Restore every field to the platform defaults (does not persist until Save).
  const resetToDefault = async () => {
    const ok = await confirm({
      title: "Reset to default settings?",
      description: "This restores the standard scheduling rules in the form. Nothing is saved until you click Save Changes.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    setCapacity(PLATFORM_DEFAULTS.capacity);
    setDuration(PLATFORM_DEFAULTS.duration);
    setHours(fullWorkingHours());
    setAdvanceDays(PLATFORM_DEFAULTS.advanceDays);
    setCancelHours(PLATFORM_DEFAULTS.cancelHours);
    setAutoClose(PLATFORM_DEFAULTS.autoClose);
    setTurnaround(PLATFORM_DEFAULTS.turnaround);
    setGraceHours(PLATFORM_DEFAULTS.graceHours);
  };

  // Validation. The default capacity is held to the same 2-30 range as every slot it
  // becomes, and a turnaround above zero is required; each enabled day
  // must start before it ends; the two windows must be zero or more.
  const capacityNum = Number(capacity);
  const turnaroundNum = Number(turnaround);
  const badDay = DAYS.find(({ key }) => hours[key].enabled && !(hours[key].start < hours[key].end));
  const errors = {
    capacity: capacity !== "" ? slotCapacityProblem(capacity) ?? undefined : undefined,
    turnaround: turnaround !== "" && !(turnaroundNum > 0) ? "Must be greater than 0." : undefined,
    advance: Number(advanceDays) < 0 ? "Must be 0 or greater." : undefined,
    cancel: Number(cancelHours) < 0 ? "Must be 0 or greater." : undefined,
    grace: Number(graceHours) < 0 ? "Must be 0 or greater." : undefined,
  };
  const valid = capacity !== "" && !errors.capacity && turnaround !== "" && !errors.turnaround
    && !errors.advance && !errors.cancel && !errors.grace && !badDay;

  const save = useAction(() => adminApi.config.update({
    defaultSlotCapacity: capacityNum,
    slotDurationMinutes: Number(duration),
    workingHours: hours,
    advanceBookingDays: Number(advanceDays),
    cancellationWindowHours: Number(cancelHours),
    autoClosePastSlots: autoClose,
    defaultTurnaroundHours: turnaroundNum,
    delayGraceHours: Number(graceHours),
  }));

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      <div className="mx-auto max-w-xl space-y-4">
        <p className="text-sm text-muted-foreground">Configure pickup &amp; delivery slots, working hours and booking rules for all societies. Changes apply to new slots and orders only.</p>

        <Section title="Slot Settings">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default Slot Capacity" required type="number" min="2" max="30" value={capacity}
              onChange={(e) => setCapacity(e.target.value)} error={errors.capacity} hint="bookings per new slot" />
            <FormField as="select" label="Slot Duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[30, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </FormField>
          </div>
        </Section>

        <Section title="Working Hours">
          <div className="space-y-2">
            {DAYS.map(({ key, label }) => {
              const d = hours[key];
              const dayInvalid = d.enabled && !(d.start < d.end);
              return (
                <div key={key} className="flex flex-wrap items-center gap-3 rounded-xl bg-foreground/5 px-3 py-2.5">
                  <span className="w-24 text-sm font-medium">{label}</span>
                  <button type="button" onClick={() => setDay(key, { enabled: !d.enabled })}
                    className={cn("rounded-full px-3 py-1 text-xs font-semibold", d.enabled ? "bg-success/15 text-success" : "bg-foreground/10 text-muted-foreground")}>
                    {d.enabled ? "ON" : "OFF"}
                  </button>
                  {d.enabled ? (
                    <div className="flex items-center gap-2">
                      <input type="time" value={d.start} onChange={(e) => setDay(key, { start: e.target.value })}
                        className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                      <span className="text-muted-foreground">—</span>
                      <input type="time" value={d.end} onChange={(e) => setDay(key, { end: e.target.value })}
                        className={cn("rounded-lg border bg-background/60 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring", dayInvalid ? "border-danger" : "border-border")} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              );
            })}
          </div>
          {badDay && <p className="mt-2 text-xs text-danger">{badDay.label}: start time must be earlier than end time.</p>}
        </Section>

        <Section title="Booking Rules">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Advance Booking" type="number" min="0" value={advanceDays}
              onChange={(e) => setAdvanceDays(e.target.value)} error={errors.advance} hint="days ahead a resident can book" />
            <FormField label="Cancellation Window" type="number" min="0" value={cancelHours}
              onChange={(e) => setCancelHours(e.target.value)} error={errors.cancel} hint="hours before slot" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoClose} onChange={(e) => setAutoClose(e.target.checked)} className="size-4 rounded border-border" />
            Auto-close past slots
          </label>
        </Section>

        <Section title="Order Timing">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Default Turnaround" required type="number" min="1" value={turnaround}
              onChange={(e) => setTurnaround(e.target.value)} error={errors.turnaround} hint="hours" />
            <FormField label="Delay Grace Period" type="number" min="0" value={graceHours}
              onChange={(e) => setGraceHours(e.target.value)} error={errors.grace} hint="hours" />
          </div>
        </Section>

        {save.error && <p className="text-sm text-danger">{save.error}</p>}

        {onClose ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={resetToDefault}
              className="rounded-xl glass px-4 py-2.5 text-sm font-medium hover:ring-1 hover:ring-primary/40">Reset to Default</button>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose}
                className="rounded-xl glass px-4 py-2.5 text-sm font-medium hover:ring-1 hover:ring-border">Cancel</button>
              <button type="button" onClick={() => { if (!valid) return; save.run().then(() => { toast.push("Slot settings updated successfully."); reload(); onClose(); }).catch(() => {}); }}
                disabled={save.busy || !valid}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
                {save.busy ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => { if (!valid) return; save.run().then(() => { toast.push("Slot settings updated successfully."); reload(); }).catch(() => {}); }}
            disabled={save.busy || !valid}
            className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
            {save.busy ? "Saving…" : "Save Scheduling Settings"}
          </button>
        )}
      </div>
    </Panel>
  );
}
