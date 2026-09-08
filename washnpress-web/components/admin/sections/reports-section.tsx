"use client";

import * as React from "react";
import { Panel } from "@/components/portal/panel";
import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { DatePicker } from "@/components/portal/date-picker";
import { useAsync } from "@/lib/use-async";
import { adminApi, type ReportFilter } from "@/lib/api/admin";
import { formatDate, rupees, stateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IndianRupee, Package, Droplets, ShieldAlert, Users2 } from "lucide-react";

type SubTab = "overview" | "subscriptions" | "revenue" | "operations" | "sustainability" | "garment-risk";

export function ReportsSection() {
  const societies = useAsync(() => adminApi.societies.list(), []);
  // A single filter bar drives every tab. Edits stay in the draft until Apply.
  const [draftFrom, setDraftFrom] = React.useState<string | null>(null);
  const [draftTo, setDraftTo] = React.useState<string | null>(null);
  const [draftSociety, setDraftSociety] = React.useState("");
  const [applied, setApplied] = React.useState<ReportFilter>({});
  const [tab, setTab] = React.useState<SubTab>("overview");

  const rangeError = draftFrom && draftTo && draftFrom > draftTo ? "The from date must be on or before the to date." : "";
  const apply = () => { if (rangeError) return; setApplied({ from: draftFrom ?? undefined, to: draftTo ?? undefined, societyId: draftSociety || undefined }); };
  const reset = () => { setDraftFrom(null); setDraftTo(null); setDraftSociety(""); setApplied({}); };

  const tabs: { id: SubTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "subscriptions", label: "Subscriptions" },
    { id: "revenue", label: "Revenue" },
    { id: "operations", label: "Operations" },
    { id: "sustainability", label: "Sustainability" },
    { id: "garment-risk", label: "Garment risk" },
  ];

  return (
    <div className="space-y-5">
      {/* Shared filter — from / to / society — applied to whichever tab is open. */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl glass p-4">
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">From date</span>
          <DatePicker value={draftFrom} onChange={setDraftFrom} placeholder="Any date" ariaLabel="From date" className="w-44" /></label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">To date</span>
          <DatePicker value={draftTo} onChange={setDraftTo} min={draftFrom ?? undefined} placeholder="Any date" ariaLabel="To date" className="w-44" /></label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Society</span>
          <select value={draftSociety} onChange={(e) => setDraftSociety(e.target.value)} className="block rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">All societies</option>
            {(societies.data?.societies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <button onClick={apply} disabled={!!rangeError} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">Apply</button>
        <button onClick={reset} className="rounded-xl glass px-4 py-2.5 text-sm hover:ring-1 hover:ring-primary/40">Reset</button>
        {rangeError && <p className="w-full text-xs text-danger">{rangeError}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium", tab === t.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab filter={applied} />}
      {tab === "subscriptions" && <SubscriptionsReportTab filter={applied} />}
      {tab === "revenue" && <RevenueReportTab filter={applied} />}
      {tab === "operations" && <OperationsReportTab filter={applied} />}
      {tab === "sustainability" && <SustainabilityReportTab filter={applied} />}
      {tab === "garment-risk" && <GarmentRiskReportTab filter={applied} />}
    </div>
  );
}

function OverviewTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.overview(filter), [filter]);
  const recent = useAsync(() => adminApi.orders.list({ ...filter, limit: "8" }), [filter]);

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={IndianRupee} label="Total revenue" value={rupees(data.revenue.totalRevenuePaise)} tint="success" />
            <StatCard icon={Users2} label="Residents onboarded" value={`${data.residents.onboarded}/${data.residents.residents}`} tint="primary" />
            <StatCard icon={Package} label="Active subscriptions" value={String(data.residents.withActiveSubscription)} tint="accent" />
            <StatCard icon={ShieldAlert} label="Open issues" value={String(data.issues.open)} tint={data.issues.open > 0 ? "warning" : "success"} />
          </div>

          <ReportTable title="By society" rows={data.bySociety} idKey="societyId"
            columns={[["societyName", "Society"], ["residents", "Residents"], ["orders", "Orders"], ["delivered", "Completed"], ["delayed", "Delayed"]]} />
          <ReportTable title="By supervisor" rows={data.bySupervisor} idKey="societyId"
            columns={[["societyName", "Society"], ["supervisorName", "Supervisor"], ["orders", "Orders"], ["delivered", "Completed"], ["delayed", "Delayed"]]} />

          <div>
            <h3 className="mb-2 font-display text-base font-bold">Recent orders</h3>
            {recent.loading ? <div className="h-24 animate-pulse rounded-2xl glass" />
              : (recent.data?.orders.length ?? 0) === 0 ? <EmptyState title="No orders found" description="No orders in this period." />
              : (
                <div className="overflow-x-auto rounded-2xl glass">
                  <table className="w-full min-w-[36rem] border-collapse text-sm">
                    <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      {["Order", "Society", "Status", "Date"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {recent.data!.orders.slice(0, 8).map((o) => (
                        <tr key={o.id} className="border-b border-white/5 last:border-0">
                          <td className="px-4 py-3 font-medium">{o.orderCode ?? o.id.slice(0, 8)}</td>
                          <td className="px-4 py-3">{o.societyName ?? "—"}</td>
                          <td className="px-4 py-3">{stateLabel(o.state)}</td>
                          <td className="px-4 py-3">{o.createdAt ? formatDate(o.createdAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ReportTable({ title, rows, idKey, columns }: { title: string; rows: Array<Record<string, unknown>>; idKey: string; columns: [string, string][] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 font-display text-base font-bold">{title}</h3>
      <div className="overflow-x-auto rounded-2xl glass">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map(([, label]) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row[idKey])} className="border-b border-white/5 last:border-0">
                {columns.map(([key]) => (
                  <td key={key} className="px-4 py-3 tabular-nums">{row[key] == null ? "—" : String(row[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubscriptionsReportTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.subscriptions(filter), [filter]);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Package} label="Total" value={String(data.total)} tint="primary" />
          <StatCard icon={Package} label="Active" value={String(data.active)} tint="success" />
          <StatCard icon={Package} label="Paused" value={String(data.paused)} tint="warning" />
          <StatCard icon={Package} label="Cancelled" value={String(data.cancelled)} tint="danger" />
        </div>
      )}
    </Panel>
  );
}

function RevenueReportTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.revenue(filter), [filter]);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard icon={IndianRupee} label="Subscription revenue" value={rupees(data.subscriptionRevenuePaise)} tint="success" />
          <StatCard icon={IndianRupee} label="Add-on revenue" value={rupees(data.addonRevenuePaise)} tint="primary" />
        </div>
      )}
    </Panel>
  );
}

function OperationsReportTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.operations(filter), [filter]);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-4">
          <StatCard icon={Package} label="Total orders" value={String(data.totalOrders)} tint="primary" />
          {Object.keys(data.byState).length === 0 ? <EmptyState title="No orders found" description="No orders in this period." /> : (
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {Object.entries(data.byState).map(([state, count]) => (
                <div key={state} className="rounded-xl glass p-3">
                  <p className="font-display text-lg font-bold tabular-nums">{count}</p>
                  <p className="text-xs text-muted-foreground">{stateLabel(state)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function SustainabilityReportTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.sustainability(filter), [filter]);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        (data.litersUsed === 0 && data.litersSaved === 0) ? (
          <EmptyState icon={Droplets} title="No sustainability data available" description="No water usage was recorded for this period." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard icon={Droplets} label="Water used (liters)" value={data.litersUsed.toLocaleString("en-IN")} tint="primary" />
            <StatCard icon={Droplets} label="Water saved (liters)" value={data.litersSaved.toLocaleString("en-IN")} tint="success" />
          </div>
        )
      )}
    </Panel>
  );
}

function GarmentRiskReportTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.garmentRisk(filter), [filter]);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard icon={ShieldAlert} label="Risk incidents" value={String(data.incidents)} tint={data.incidents > 0 ? "warning" : "success"} />
          <StatCard icon={Package} label="Orders processed" value={String(data.ordersProcessed)} tint="primary" />
        </div>
      )}
    </Panel>
  );
}
