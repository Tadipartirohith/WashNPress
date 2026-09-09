"use client";

import * as React from "react";
import { IndianRupee, Wallet, Clock, AlertTriangle, Undo2, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { DatePicker } from "@/components/portal/date-picker";
import { DataTable, type Column } from "@/components/portal/data-table";
import { useAsync } from "@/lib/use-async";
import { adminApi, type RevenueBucket, type RevenueTransaction } from "@/lib/api/admin";
import { formatDate, formatDateTime, rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

// The full Revenue view — the money side of the platform, parity with the mobile
// RevenueScreen. A filter bar (preset / date range / society / payment status) drives
// a Summary tab (headline figures, GST split, funding by method, six breakdowns and
// the overdue list) and a Transactions tab (the paged ledger the totals are made of).

type RevTab = "summary" | "transactions";
const PAGE_SIZE = 25;

export function RevenueSection() {
  const [preset, setPreset] = React.useState("this_month");
  const [from, setFrom] = React.useState<string | null>(null);
  const [to, setTo] = React.useState<string | null>(null);
  const [societyId, setSocietyId] = React.useState("");
  const [paymentStatus, setPaymentStatus] = React.useState("");
  const [tab, setTab] = React.useState<RevTab>("summary");

  // A custom range overrides the preset; sending both lets the backend decide.
  const query = React.useMemo(() => ({
    preset: from || to ? undefined : preset,
    from: from || undefined, to: to || undefined,
    societyId: societyId || undefined, paymentStatus: paymentStatus || undefined,
  }), [preset, from, to, societyId, paymentStatus]);

  const report = useAsync(() => adminApi.revenue.report(query), [query]);
  const data = report.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl glass p-4">
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Period</span>
          <select value={from || to ? "custom" : preset} onChange={(e) => { if (e.target.value !== "custom") { setPreset(e.target.value); setFrom(null); setTo(null); } }}
            className="block rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            {(data?.presets ?? [{ value: "this_month", label: "This month" }]).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            {(from || to) && <option value="custom">Custom range</option>}
          </select></label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">From</span>
          <DatePicker value={from} onChange={setFrom} placeholder="Any date" ariaLabel="From date" className="w-44" /></label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">To</span>
          <DatePicker value={to} onChange={setTo} min={from ?? undefined} placeholder="Any date" ariaLabel="To date" className="w-44" /></label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Society</span>
          <select value={societyId} onChange={(e) => setSocietyId(e.target.value)} className="block rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">All societies</option>
            {(data?.filters.societies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Payment status</span>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="block rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">Any status</option>
            {(data?.paymentStatuses ?? []).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select></label>
        {(from || to || societyId || paymentStatus) && (
          <button onClick={() => { setFrom(null); setTo(null); setSocietyId(""); setPaymentStatus(""); setPreset("this_month"); }}
            className="rounded-xl glass px-4 py-2.5 text-sm hover:ring-1 hover:ring-primary/40">Reset</button>
        )}
        {data && <span className="ml-auto self-center text-xs text-muted-foreground">{data.range.label}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {([["summary", "Summary"], ["transactions", "Transactions"]] as [RevTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium", tab === id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <Panel loading={report.loading} error={report.error} onRetry={report.reload}>
          {data && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard icon={IndianRupee} label="Total revenue" value={rupees(data.summary.totalRevenuePaise)} tint="success" />
                <StatCard icon={Wallet} label="Subscription revenue" value={rupees(data.summary.subscriptionRevenuePaise)} tint="primary" />
                <StatCard icon={TrendingUp} label="Order revenue" value={rupees(data.summary.orderRevenuePaise)} tint="accent" />
                <StatCard icon={IndianRupee} label="Net revenue" value={rupees(data.summary.netRevenuePaise)} tint="success" />
                <StatCard icon={Clock} label="Pending" value={rupees(data.summary.pendingPaise)} tint="warning" />
                <StatCard icon={AlertTriangle} label="Overdue" value={rupees(data.summary.overduePaise)} tint={data.summary.overduePaise > 0 ? "danger" : "primary"} />
                <StatCard icon={Undo2} label="Refunded" value={rupees(data.summary.refundedPaise)} tint="danger" />
                <StatCard icon={TrendingUp} label="Charged orders" value={String(data.summary.chargedOrders)} tint="primary" />
              </div>

              {/* GST reported beside the revenue, never folded into it. */}
              <div>
                <h3 className="mb-2 font-display text-base font-bold">GST collected</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatCard icon={IndianRupee} label="Tax collected" value={rupees(data.summary.taxCollectedPaise)} tint="primary" />
                  <StatCard icon={IndianRupee} label="CGST" value={rupees(data.summary.cgstPaise)} tint="accent" />
                  <StatCard icon={IndianRupee} label="SGST" value={rupees(data.summary.sgstPaise)} tint="accent" />
                </div>
              </div>

              <div>
                <h3 className="mb-2 font-display text-base font-bold">Funding by method</h3>
                {data.topUpsByMethod.length === 0 ? <EmptyState title="No top-ups" description="No wallet funding was recorded in this period." /> : (
                  <div className="overflow-x-auto rounded-2xl glass">
                    <table className="w-full min-w-[28rem] border-collapse text-sm">
                      <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Method</th><th className="px-4 py-3 text-right font-medium">Count</th><th className="px-4 py-3 text-right font-medium">Amount</th>
                      </tr></thead>
                      <tbody>
                        {data.topUpsByMethod.map((m) => (
                          <tr key={m.method} className="border-b border-white/5 last:border-0">
                            <td className="px-4 py-3">{m.label}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{m.count}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{rupees(m.amountPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <BucketTable title="By society" rows={data.bySociety} />
              <BucketTable title="By block" rows={data.byBlock} />
              <BucketTable title="By supervisor" rows={data.bySupervisor} />
              <BucketTable title="By operator" rows={data.byOperator} />
              <BucketTable title="By plan" rows={data.byPlan} showSubscribers />

              <div>
                <h3 className="mb-2 font-display text-base font-bold">By service</h3>
                {data.byService.length === 0 ? <EmptyState title="No service revenue" description="No services earned in this period." /> : (
                  <div className="overflow-x-auto rounded-2xl glass">
                    <table className="w-full min-w-[28rem] border-collapse text-sm">
                      <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Service</th><th className="px-4 py-3 text-right font-medium">Orders</th><th className="px-4 py-3 text-right font-medium">Revenue</th><th className="px-4 py-3 text-right font-medium">Share</th>
                      </tr></thead>
                      <tbody>
                        {data.byService.map((s) => (
                          <tr key={s.id} className="border-b border-white/5 last:border-0">
                            <td className="px-4 py-3">{s.name}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{s.orders}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{rupees(s.revenuePaise)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{s.sharePercent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {data.overdueCharges.length > 0 && (
                <div>
                  <h3 className="mb-2 font-display text-base font-bold text-danger">Overdue charges</h3>
                  <div className="overflow-x-auto rounded-2xl glass">
                    <table className="w-full min-w-[36rem] border-collapse text-sm">
                      <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Order</th><th className="px-4 py-3 font-medium">Resident</th><th className="px-4 py-3 font-medium">Society</th><th className="px-4 py-3 font-medium">Due</th><th className="px-4 py-3 text-right font-medium">Amount</th>
                      </tr></thead>
                      <tbody>
                        {data.overdueCharges.map((o) => (
                          <tr key={o.id} className="border-b border-white/5 last:border-0">
                            <td className="px-4 py-3 font-medium">{o.orderCode}</td>
                            <td className="px-4 py-3">{o.residentName ?? "—"}{o.unitNumber ? ` · ${o.unitNumber}` : ""}</td>
                            <td className="px-4 py-3">{o.societyName ?? "—"}</td>
                            <td className="px-4 py-3 text-danger">{formatDate(o.dueDate)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{rupees(o.totalPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      ) : (
        <TransactionsTab query={query} />
      )}
    </div>
  );
}

function BucketTable({ title, rows, showSubscribers }: { title: string; rows: RevenueBucket[]; showSubscribers?: boolean }) {
  return (
    <div>
      <h3 className="mb-2 font-display text-base font-bold">{title}</h3>
      {rows.length === 0 ? <EmptyState title="No data" description="Nothing recorded in this period." /> : (
        <div className="overflow-x-auto rounded-2xl glass">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 text-right font-medium">Orders</th>
              {showSubscribers && <th className="px-4 py-3 text-right font-medium">Subscribers</th>}
              <th className="px-4 py-3 text-right font-medium">Garment charge</th>
              <th className="px-4 py-3 text-right font-medium">Services</th>
              <th className="px-4 py-3 text-right font-medium">Revenue</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? `row-${i}`} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.orders}</td>
                  {showSubscribers && <td className="px-4 py-3 text-right tabular-nums">{r.activeSubscribers ?? 0}</td>}
                  <td className="px-4 py-3 text-right tabular-nums">{rupees(r.garmentChargePaise)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{rupees(r.servicesPaise)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{rupees(r.revenuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TransactionsTab({ query }: { query: Record<string, string | undefined> }) {
  const [type, setType] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => { setOffset(0); }, [type, status, query]);

  const { data, loading, error, reload } = useAsync(
    () => adminApi.revenue.transactions({ ...query, type: type || undefined, status: status || undefined, limit: String(PAGE_SIZE), offset: String(offset) }),
    [query, type, status, offset],
  );

  const columns: Column<RevenueTransaction>[] = [
    { header: "When", cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.at)}</span> },
    { header: "Order", cell: (r) => r.orderCode ?? "—" },
    { header: "Customer", cell: (r) => <div><p>{r.customerName ?? "—"}</p>{r.societyName && <p className="text-xs text-muted-foreground">{r.societyName}</p>}</div> },
    { header: "Type", cell: (r) => <span className="capitalize">{r.type.replace(/_/g, " ")}</span> },
    { header: "Method", cell: (r) => r.paymentMethod ? <span className="capitalize">{r.paymentMethod.replace(/_/g, " ")}</span> : "—" },
    { header: "Status", cell: (r) => <span className="capitalize">{r.status.replace(/_/g, " ")}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="tabular-nums">{rupees(r.amountPaise)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className="block rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">All types</option>
            {(data?.types ?? []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="block rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">All statuses</option>
            {(data?.statuses ?? []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select></label>
        {data && (
          <div className="ml-auto flex flex-wrap gap-4 self-center text-xs text-muted-foreground">
            <span>{data.tally.count} transactions</span>
            <span className="text-success">Settled {rupees(data.tally.settledPaise)}</span>
            <span className="text-warning">Pending {rupees(data.tally.pendingPaise)}</span>
            <span className="text-danger">Refunded {rupees(data.tally.refundedPaise)}</span>
          </div>
        )}
      </div>

      <DataTable columns={columns} rows={data?.transactions ?? []} keyField={(r) => r.id} loading={loading} error={error}
        emptyTitle="No transactions" emptyDescription="No money moved for this filter." />

      {data && data.page.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, data.page.total)} of {data.page.total}</span>
          <div className="flex gap-2">
            <button onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}
              className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <button onClick={() => setOffset((o) => o + PAGE_SIZE)} disabled={!data.page.hasMore}
              className="grid size-8 place-items-center rounded-lg glass disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}
      {error && <button onClick={reload} className="text-xs text-primary underline">Retry</button>}
    </div>
  );
}
