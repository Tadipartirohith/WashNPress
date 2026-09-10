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
import { IndianRupee, Package, Droplets, ShieldAlert, Users2, CheckCircle2, Clock } from "lucide-react";

type SubTab = "overview" | "subscriptions" | "revenue" | "operations" | "sustainability" | "garment-risk";

export function ReportsSection({ onViewOrders }: { onViewOrders?: () => void }) {
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
      {tab === "overview" && <OverviewTab filter={applied} onViewOrders={onViewOrders} />}
      {tab === "subscriptions" && <SubscriptionsReportTab filter={applied} />}
      {tab === "revenue" && <RevenueReportTab filter={applied} />}
      {tab === "operations" && <OperationsReportTab filter={applied} />}
      {tab === "sustainability" && <SustainabilityReportTab filter={applied} />}
      {tab === "garment-risk" && <GarmentRiskReportTab filter={applied} />}
    </div>
  );
}

function OverviewTab({ filter, onViewOrders }: { filter: ReportFilter; onViewOrders?: () => void }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.overview(filter), [filter]);
  const recent = useAsync(() => adminApi.orders.list({ ...filter, limit: "8" }), [filter]);
  const ops = useAsync(() => adminApi.reports.operations(filter), [filter]);

  const totals = (data?.bySociety ?? []).reduce(
    (acc, row) => ({
      orders: acc.orders + Number(row.orders ?? 0),
      delivered: acc.delivered + Number(row.delivered ?? 0),
      delayed: acc.delayed + Number(row.delayed ?? 0),
    }),
    { orders: 0, delivered: 0, delayed: 0 },
  );

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-6">
          {/* Orders were absent from the summary entirely — an admin could see what
              was earned and not how much work it took. Summed from the per-society
              rows the same call already returns, so the KPI and the table below it
              cannot disagree. */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={IndianRupee} label="Total revenue" value={rupees(data.revenue.totalRevenuePaise)} tint="success" />
            <StatCard icon={Users2} label="Residents onboarded" value={`${data.residents.onboarded}/${data.residents.residents}`} tint="primary" />
            <StatCard icon={Package} label="Active subscriptions" value={String(data.residents.withActiveSubscription)} tint="accent" />
            <StatCard icon={Package} label="Total orders" value={String(totals.orders)} tint="primary" />
            <StatCard icon={CheckCircle2} label="Completed orders" value={String(totals.delivered)} tint="success" />
            <StatCard icon={Clock} label="Delayed orders" value={String(totals.delayed)} tint={totals.delayed > 0 ? "warning" : "success"} />
            <StatCard icon={ShieldAlert} label="Open issues" value={String(data.issues.open)} tint={data.issues.open > 0 ? "warning" : "success"} />
          </div>

          <OrdersTrend days={ops.data?.trend ?? []} loading={ops.loading} />

          <ReportTable title="By society" rows={data.bySociety} idKey="societyId"
            columns={[["societyName", "Society"], ["residents", "Residents"], ["orders", "Orders"], ["delivered", "Completed"], ["delayed", "Delayed"]]} />
          <ReportTable title="By supervisor" rows={data.bySupervisor} idKey="societyId"
            columns={[["societyName", "Society"], ["supervisorName", "Supervisor"], ["orders", "Orders"], ["delivered", "Completed"], ["delayed", "Delayed"]]} />

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-display text-base font-bold">Recent orders</h3>
              {onViewOrders && (
                <button onClick={onViewOrders} className="text-sm font-medium text-primary hover:underline">View all</button>
              )}
            </div>
            {recent.loading ? <div className="h-24 animate-pulse rounded-2xl glass" />
              : (recent.data?.orders.length ?? 0) === 0 ? <EmptyState title="No orders found" description="No orders in this period." />
              : (
                <div className="overflow-x-auto rounded-2xl glass">
                  <table className="w-full min-w-[36rem] border-collapse text-sm">
                    <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      {["Order", "Society", "Service", "Status", "Date"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {recent.data!.orders.slice(0, 8).map((o) => (
                        <tr key={o.id} className="border-b border-white/5 last:border-0">
                          <td className="px-4 py-3 font-medium">{o.orderCode ?? o.id.slice(0, 8)}</td>
                          <td className="px-4 py-3">{o.societyName ?? "—"}</td>
                          {/* What was actually asked for. An order row without it is
                              a code and a status, which is not a report. */}
                          <td className="px-4 py-3">{serviceNamesOf(o)}</td>
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


// The services on an order, in a cell. Multiple services on one order are joined
// rather than truncated, because "Wash and Iron" and "Wash and Iron, Dry Clean" are
// different jobs and the shorter one is not a summary of the longer.
function serviceNamesOf(order: { serviceNames?: string[] }): string {
  const names = order.serviceNames ?? [];
  return names.length ? names.join(", ") : "—";
}

// Orders over the period, drawn as bars rather than described in a paragraph.
//
// Deliberately hand-rolled: three counts a day over a few weeks does not need a
// charting library, and one would be a dependency loaded on a page that already
// waits on six report calls.
function OrdersTrend({ days, loading }: {
  days: Array<{ day: string; completed: number; delayed: number; cancelled: number; total: number }>;
  loading: boolean;
}) {
  if (loading) return <div className="h-40 animate-pulse rounded-2xl glass" />;
  if (days.length === 0) {
    return (
      <div>
        <h3 className="mb-2 font-display text-base font-bold">Orders trend</h3>
        <EmptyState title="No orders found" description="Orders for the selected period will appear here." />
      </div>
    );
  }
  // Scaled to the busiest day rather than to a fixed ceiling, so a quiet week is
  // still readable instead of a row of slivers.
  const peak = Math.max(...days.map((d) => d.total), 1);

  return (
    <div>
      <h3 className="mb-2 font-display text-base font-bold">Orders trend</h3>
      <div className="rounded-2xl glass p-4">
        <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: "9rem" }}>
          {days.map((d) => {
            const other = Math.max(0, d.total - d.completed - d.cancelled);
            const seg = (n: number) => `${(n / peak) * 100}%`;
            return (
              <div key={d.day} className="flex min-w-[1.25rem] flex-1 flex-col items-center justify-end gap-1"
                title={`${formatDate(d.day)} · ${d.total} order${d.total === 1 ? "" : "s"} · ${d.completed} completed · ${d.delayed} delayed · ${d.cancelled} cancelled`}>
                <div className="flex w-full flex-col justify-end" style={{ height: "100%" }}>
                  {d.cancelled > 0 && <div className="w-full rounded-t bg-danger/70" style={{ height: seg(d.cancelled) }} />}
                  {other > 0 && <div className="w-full bg-primary/40" style={{ height: seg(other) }} />}
                  {d.completed > 0 && <div className="w-full rounded-b bg-success/80" style={{ height: seg(d.completed) }} />}
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground">{d.day.slice(8)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success/80" /> Completed</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/40" /> In progress</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-danger/70" /> Cancelled</span>
        </div>
      </div>
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

function SubscriptionsReportTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.subscriptions(filter), [filter]);
  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Package} label="Total" value={String(data.total)} tint="primary" />
            <StatCard icon={Package} label="Active" value={String(data.active)} tint="success" />
            <StatCard icon={Package} label="Paused" value={String(data.paused)} tint="warning" />
            <StatCard icon={Package} label="Cancelled" value={String(data.cancelled)} tint="danger" />
            <StatCard icon={Package} label="Expired" value={String(data.expired)} tint="primary" />
            {/* A change the resident has booked and not yet received. It is the number
                that says what next month looks like. */}
            <StatCard icon={Package} label="Changing plan" value={String(data.changing)} tint="accent" />
            <StatCard icon={IndianRupee} label="Subscription revenue" value={rupees(data.subscriptionRevenuePaise)} tint="success" />
          </div>

          {/* Which plans people are actually on, and which of them earns anything.
              Revenue is what the ledger recorded, not the plan price multiplied by
              subscribers — an active subscription is not a payment. */}
          {data.byPlan.length === 0
            ? <EmptyState title="No subscriptions yet" description="Plan distribution appears once residents subscribe." />
            : (
              <ReportTable
                title="By plan"
                rows={data.byPlan.map((p) => ({ ...p, revenue: rupees(p.revenuePaise) }))}
                idKey="planId"
                columns={[["planName", "Plan"], ["subscribers", "Subscribers"], ["active", "Active"], ["revenue", "Revenue"]]}
              />
            )}
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
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={IndianRupee} label="Gross revenue" value={rupees(data.grossPaise)} tint="primary" />
            <StatCard icon={IndianRupee} label="Refunded" value={rupees(data.refundedPaise)} tint={data.refundedPaise > 0 ? "warning" : "primary"} />
            <StatCard icon={IndianRupee} label="Net revenue" value={rupees(data.netPaise)} tint="success" />
            {/* Held on behalf of the tax authority. Shown apart from revenue so a
                total cannot be mistaken for what the platform earned. */}
            <StatCard icon={IndianRupee} label="GST collected" value={rupees(data.taxCollectedPaise)} tint="primary" />
          </div>

          <ReportTable
            title="Where it came from"
            idKey="source"
            rows={[
              { source: "Subscriptions", amount: rupees(data.subscriptionRevenuePaise) },
              { source: "Pay as you go", amount: rupees(data.addonRevenuePaise) },
              { source: "Cancellation fees", amount: rupees(data.cancellationFeePaise) },
              { source: "Rescheduling fees", amount: rupees(data.reschedulingFeePaise) },
            ]}
            columns={[["source", "Source"], ["amount", "Amount"]]}
          />
          <p className="text-xs text-muted-foreground">
            Revenue is read from settled transactions, not from catalogue prices. A ledger entry
            carries no society, so the society filter does not narrow these figures — the date range does.
          </p>
        </div>
      )}
    </Panel>
  );
}

function OperationsReportTab({ filter }: { filter: ReportFilter }) {
  const { data, loading, error, reload } = useAsync(() => adminApi.reports.operations(filter), [filter]);
  const overview = useAsync(() => adminApi.reports.overview(filter), [filter]);
  // A rate of null means the period had no orders at all. "0% completed" reads as a
  // failure, and an empty week is not one.
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Package} label="Total orders" value={String(data.totalOrders)} tint="primary" />
            <StatCard icon={CheckCircle2} label="Completed" value={String(data.completed)} tint="success" />
            <StatCard icon={Package} label="In progress" value={String(data.inProgress)} tint="accent" />
            <StatCard icon={Clock} label="Delayed" value={String(data.delayed)} tint={data.delayed > 0 ? "warning" : "success"} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={CheckCircle2} label="Completion rate" value={pct(data.completionRate)} tint="success" />
            <StatCard icon={Clock} label="Delay rate" value={pct(data.delayRate)} tint={(data.delayRate ?? 0) > 0 ? "warning" : "success"} />
            <StatCard icon={ShieldAlert} label="Cancellation rate" value={pct(data.cancellationRate)} tint={(data.cancellationRate ?? 0) > 0 ? "warning" : "primary"} />
          </div>

          <OrdersTrend days={data.trend} loading={false} />

          {Object.keys(data.byState).length === 0 ? <EmptyState title="No orders found" description="No orders in this period." /> : (
            <div>
              <h3 className="mb-2 font-display text-base font-bold">By stage</h3>
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {Object.entries(data.byState).map(([state, count]) => (
                  <div key={state} className="rounded-xl glass p-3">
                    <p className="font-display text-lg font-bold tabular-nums">{count}</p>
                    <p className="text-xs text-muted-foreground">{stateLabel(state)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Who the work sat with. The same rows the Overview shows, because an
              operations question is usually "which society" or "which supervisor". */}
          {overview.data && (
            <>
              <ReportTable title="By society" rows={overview.data.bySociety} idKey="societyId"
                columns={[["societyName", "Society"], ["orders", "Orders"], ["delivered", "Completed"], ["delayed", "Delayed"]]} />
              <ReportTable title="By supervisor" rows={overview.data.bySupervisor} idKey="societyId"
                columns={[["societyName", "Society"], ["supervisorName", "Supervisor"], ["orders", "Orders"], ["delivered", "Completed"], ["delayed", "Delayed"]]} />
            </>
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
