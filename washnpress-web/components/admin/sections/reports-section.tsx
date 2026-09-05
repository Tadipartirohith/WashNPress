"use client";

import * as React from "react";
import { Panel } from "@/components/portal/panel";
import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { useAsync } from "@/lib/use-async";
import { adminApi } from "@/lib/api/admin";
import { rupees, stateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IndianRupee, Package, Droplets, ShieldAlert, Users2 } from "lucide-react";

type SubTab = "overview" | "subscriptions" | "revenue" | "operations" | "sustainability" | "garment-risk";

export function ReportsSection() {
  const [tab, setTab] = React.useState<SubTab>("overview");
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
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium", tab === t.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "subscriptions" && <SubscriptionsReportTab />}
      {tab === "revenue" && <RevenueReportTab />}
      {tab === "operations" && <OperationsReportTab />}
      {tab === "sustainability" && <SustainabilityReportTab />}
      {tab === "garment-risk" && <GarmentRiskReportTab />}
    </div>
  );
}

function OverviewTab() {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const societies = useAsync(() => adminApi.societies.list(), []);
  const [societyId, setSocietyId] = React.useState("");
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.overview({ from: from || undefined, to: to || undefined, societyId: societyId || undefined }), [from, to, societyId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All societies</option>
          {(societies.data?.societies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
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
              columns={[["societyName", "Society"], ["residents", "Residents"], ["total", "Orders"], ["completed", "Completed"], ["delayed", "Delayed"]]} />
            <ReportTable title="By supervisor" rows={data.bySupervisor} idKey="societyId"
              columns={[["societyName", "Society"], ["supervisorName", "Supervisor"], ["total", "Orders"], ["completed", "Completed"], ["delayed", "Delayed"]]} />
            <ReportTable title="By operator" rows={data.byOperator} idKey="operatorUserId"
              columns={[["operatorName", "Operator"], ["total", "Orders"], ["completed", "Completed"], ["delayed", "Delayed"]]} />
          </div>
        )}
      </Panel>
    </div>
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

function SubscriptionsReportTab() {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.subscriptions(), []);
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

function RevenueReportTab() {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.revenue(), []);
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

function OperationsReportTab() {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.operations(), []);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-4">
          <StatCard icon={Package} label="Total orders" value={String(data.totalOrders)} tint="primary" />
          {Object.keys(data.byState).length === 0 ? <EmptyState title="No orders yet" /> : (
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

function SustainabilityReportTab() {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.sustainability(), []);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard icon={Droplets} label="Water used (liters)" value={data.litersUsed.toLocaleString("en-IN")} tint="primary" />
          <StatCard icon={Droplets} label="Water saved (liters)" value={data.litersSaved.toLocaleString("en-IN")} tint="success" />
        </div>
      )}
    </Panel>
  );
}

function GarmentRiskReportTab() {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.garmentRisk(), []);
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
