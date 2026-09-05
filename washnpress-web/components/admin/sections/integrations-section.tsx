"use client";

import { CheckCircle2, XCircle, AlertTriangle, MessageSquare, CreditCard, LifeBuoy } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { useAsync } from "@/lib/use-async";
import { adminApi } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

export function IntegrationsSection() {
  const { data, loading, error, reload } = useAsync(() => adminApi.integrations.get(), []);

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><MessageSquare className="size-4 text-primary" /> Notifications</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.notifications.map((ch) => (
                <div key={ch.name} className="rounded-2xl glass p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium uppercase">{ch.name}</p>
                    {ch.live ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success ring-1 ring-success/30"><CheckCircle2 className="size-3.5" /> Live</span>
                    ) : ch.enabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning ring-1 ring-warning/30"><AlertTriangle className="size-3.5" /> Incomplete</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-foreground/10"><XCircle className="size-3.5" /> Disabled</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Provider: {ch.provider}</p>
                  {ch.missing.length > 0 && (
                    <p className="mt-1 text-xs text-warning">Missing: {ch.missing.join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><CreditCard className="size-4 text-primary" /> Payments</h2>
            <div className="rounded-2xl glass p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">Provider: <span className="font-medium">{data.payments.provider}</span> · Currency: <span className="font-medium">{data.payments.currency}</span></p>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1",
                  data.payments.gatewayConfigured ? "bg-success/15 text-success ring-success/30" : "bg-foreground/5 text-muted-foreground ring-foreground/10")}>
                  {data.payments.gatewayConfigured ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {data.payments.gatewayConfigured ? "Gateway configured" : "Gateway not configured"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.payments.methods.map((m) => (
                  <div key={m.method} className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2 text-sm">
                    <span className="capitalize">{m.method.replace(/_/g, " ")}</span>
                    <span className={cn("text-xs font-medium", m.offered ? "text-success" : "text-muted-foreground")}>
                      {m.offered ? "Offered" : m.blockedBy ?? "Off"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><LifeBuoy className="size-4 text-primary" /> Support channels published</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["phone", "whatsapp", "email", "hours"] as const).map((k) => (
                <div key={k} className="rounded-2xl glass p-3 text-center">
                  <p className="text-xs capitalize text-muted-foreground">{k}</p>
                  <p className={cn("mt-1 text-sm font-semibold", data.support[k] ? "text-success" : "text-muted-foreground")}>
                    {data.support[k] ? "Set" : "Not set"}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Panel>
  );
}
