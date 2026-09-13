"use client";

import * as React from "react";
import { Panel } from "@/components/portal/panel";
import { FormField } from "@/components/portal/form-field";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi } from "@/lib/api/admin";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// I-133: Admin → Configuration. GST and notification settings, kept apart from Slot
// Settings, which is scheduling only. Both save through PATCH /v1/admin/config, which
// validates them, writes the change to the audit log, and is what order charges,
// subscription charges and every notification read.

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl glass p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <p className="mb-3.5 mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn("rounded-full px-3 py-1 text-xs font-semibold", on ? "bg-success/15 text-success" : "bg-foreground/10 text-muted-foreground")}>
      {on ? "ON" : "OFF"}
    </button>
  );
}

// Mirrors the server's rule so the admin is told before saving; the server still
// decides, and its message is shown if it disagrees.
function gstRateProblem(raw: string): string | undefined {
  if (raw.trim() === "") return "GST rate is required.";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Enter a valid GST rate.";
  if (n < 0) return "GST rate cannot be negative.";
  if (n > 50) return "GST rate cannot exceed 50%.";
  if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) return "GST rate can have at most 2 decimal places.";
  return undefined;
}

export function ConfigurationSection() {
  const { data, loading, error, reload } = useAsync(() => adminApi.config.get(), []);
  const toast = useToast();

  const [gstEnabled, setGstEnabled] = React.useState(false);
  const [gstRate, setGstRate] = React.useState("");
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [flags, setFlags] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!data) return;
    setGstEnabled(Boolean(data.config.gstEnabled));
    setGstRate(String(data.config.gstRatePercent ?? ""));
    setNotificationsEnabled(data.config.notificationsEnabled !== false);
    setFlags(data.config.notificationFlags ?? {});
  }, [data]);

  const categories = data?.notificationCategories ?? Object.keys(flags).map((key) => ({ key, label: key }));
  const rateError = gstRateProblem(gstRate);

  const saveGst = useAction(() => adminApi.config.update({ gstEnabled, gstRatePercent: Number(gstRate) }));
  const saveNotifications = useAction(() => adminApi.config.update({
    notificationsEnabled,
    notificationFlags: Object.fromEntries(categories.map((c) => [c.key, flags[c.key] !== false])),
  }));

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h2 className="font-display text-xl font-bold">Configuration</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform-wide tax and notification settings. Every change is recorded in the audit log.
            {data?.config.updatedAt ? ` Last changed ${formatDateTime(data.config.updatedAt as string)}.` : ""}
          </p>
        </div>

        <Section title="GST Settings" description="Applied to additional garment charges and subscription charges from the next charge onwards. Charges already taken are not changed.">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2.5">
              <span className="text-sm font-medium">Charge GST</span>
              <Toggle on={gstEnabled} onChange={setGstEnabled} label="Charge GST" />
            </div>
            <FormField label="GST rate (%)" required type="number" min="0" max="50" step="0.01" value={gstRate}
              onChange={(e) => setGstRate(e.target.value)} error={rateError} hint="0 to 50, up to two decimal places" />
            {saveGst.error && <p role="alert" className="text-sm text-danger">{saveGst.error}</p>}
            <button onClick={() => saveGst.run().then(() => { toast.push("GST settings saved"); reload(); }).catch(() => {})}
              disabled={saveGst.busy || !!rateError}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              {saveGst.busy ? "Saving…" : "Save GST settings"}
            </button>
          </div>
        </Section>

        <Section title="Notification Settings" description="Switch a kind of notification off to stop it being sent or shown in anybody's notifications. Sign-in codes are always sent.">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2.5">
              <span className="text-sm font-medium">All notifications</span>
              <Toggle on={notificationsEnabled} onChange={setNotificationsEnabled} label="All notifications" />
            </div>
            {categories.map((c) => (
              <div key={c.key} className={cn("flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2.5", !notificationsEnabled && "opacity-50")}>
                <span className="text-sm">{c.label}</span>
                <Toggle on={flags[c.key] !== false} onChange={(next) => setFlags((f) => ({ ...f, [c.key]: next }))} label={c.label} />
              </div>
            ))}
            {!notificationsEnabled && <p className="text-xs text-muted-foreground">With all notifications off, none of the kinds above are sent.</p>}
            {saveNotifications.error && <p role="alert" className="text-sm text-danger">{saveNotifications.error}</p>}
            <div className="pt-2">
              <button onClick={() => saveNotifications.run().then(() => { toast.push("Notification settings saved"); reload(); }).catch(() => {})}
                disabled={saveNotifications.busy}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
                {saveNotifications.busy ? "Saving…" : "Save notification settings"}
              </button>
            </div>
          </div>
        </Section>
      </div>
    </Panel>
  );
}
