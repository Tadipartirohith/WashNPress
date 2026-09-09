"use client";

import { useState } from "react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { DatePicker } from "@/components/portal/date-picker";
import { useAsync } from "@/lib/use-async";
import { rupees, stateLabel } from "@/lib/format";
import { supervisorApi, type ReportRow } from "@/lib/api/supervisor";

// The supervisor's own area, reported: residents, revenue, per-society and
// per-operator performance, issues and subscription usage. The web supervisor had
// the reports API (lib/api/supervisor.ts) but no screen for it — this mirrors the
// mobile SupervisorReportsScreen.
export function ReportsTab() {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  const report = useAsync(
    () => supervisorApi.reports({ from: from ?? undefined, to: to ?? undefined }),
    [from, to],
  );

  const data = report.data;
  const rangeInvalid = !!from && !!to && to < from;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-44 space-y-1.5">
          <span className="text-sm font-medium text-muted-foreground">From</span>
          <DatePicker value={from} ariaLabel="Report from date" onChange={setFrom} />
        </label>
        <label className="block w-44 space-y-1.5">
          <span className="text-sm font-medium text-muted-foreground">To</span>
          <DatePicker value={to} ariaLabel="Report to date" min={from ?? undefined} onChange={setTo} />
        </label>
      </div>
      {rangeInvalid && <p className="text-sm text-danger">The end date is before the start date, so no report can be generated.</p>}

      <Panel loading={report.loading} error={report.error} onRetry={report.reload}>
        {data && (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Residents</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Residents" value={String(data.residents.residents)} />
                <Kpi label="Onboarded" value={String(data.residents.onboarded)} />
                <Kpi label="Pending onboarding" value={String(data.residents.pendingOnboarding)} />
                <Kpi label="With active plan" value={String(data.residents.withActiveSubscription)} />
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Revenue</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Subscriptions" value={rupees(data.revenue.subscriptionRevenuePaise)} />
                <Kpi label="Additional garments" value={rupees(data.revenue.additionalGarmentRevenuePaise)} />
                <Kpi label="Pending charges" value={rupees(data.revenue.pendingAdditionalChargesPaise)} />
                <Kpi label="Total" value={rupees(data.revenue.totalRevenuePaise)} tint="primary" />
              </div>
            </section>

            <ReportTable title="Society performance" rows={data.bySociety} nameOf={(r) => r.societyName ?? "Unknown"} keyOf={(r) => r.societyId ?? r.societyName ?? "unknown"} />
            <ReportTable title="Operator performance" rows={data.byOperator} nameOf={(r) => r.operatorName ?? "Unassigned"} keyOf={(r) => r.operatorUserId ?? "unassigned"} />

            <section>
              <h3 className="mb-2 text-sm font-semibold">Issues</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Total" value={String(data.issues.total)} />
                <Kpi label="Open" value={String(data.issues.open)} />
                <Kpi label="In progress" value={String(data.issues.inProgress)} />
                <Kpi label="Resolved" value={String(data.issues.resolved)} />
              </div>
              {data.issues.byType.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {data.issues.byType.map((t) => (
                    <li key={t.type} className="flex items-center justify-between rounded-lg bg-foreground/5 px-3 py-1.5 text-sm">
                      <span>{stateLabel(t.type)}</span>
                      <span className="tabular-nums font-medium">{t.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Subscription usage</h3>
              {data.subscriptions.byPlan.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subscription activity in this period.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.subscriptions.byPlan.map((plan) => (
                    <div key={plan.tier} className="rounded-xl glass p-4">
                      <p className="font-semibold">{plan.name ?? plan.tier}</p>
                      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <Row label="Active subscribers" value={String(plan.activeSubscribers)} />
                        <Row label="Allowance" value={String(plan.allowance)} />
                        <Row label="Garments used" value={String(plan.garmentsUsed)} />
                        <Row label="Revenue" value={rupees(plan.revenuePaise)} />
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </Panel>
    </div>
  );
}

// A comparison table, with the two things the mobile report also does: rows the
// platform could not attribute (no operator, no society) are pulled out of the
// performance figures into their own section, because "Unassigned" is a gap in the
// assignment rather than somebody doing badly; and rows with no activity fold away
// so a page of zeroes does not bury the rows that say something.
function ReportTable({ title, rows, nameOf, keyOf }: {
  title: string; rows: ReportRow[]; nameOf: (r: ReportRow) => string; keyOf: (r: ReportRow) => string;
}) {
  const [showQuiet, setShowQuiet] = useState(false);
  const assigned = rows.filter((r) => !r.unassigned);
  const unassigned = rows.filter((r) => r.unassigned);
  const busy = assigned.filter((r) => r.orders > 0);
  const quiet = assigned.filter((r) => r.orders === 0);
  const shown = showQuiet ? assigned : busy;

  const columns: Column<ReportRow>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{nameOf(r)}</span> },
    { header: "Orders", align: "right", cell: (r) => <span className="tabular-nums">{r.orders}</span> },
    { header: "Delivered", align: "right", cell: (r) => <span className="tabular-nums">{r.delivered}</span> },
    { header: "Cancelled", align: "right", cell: (r) => <span className="tabular-nums">{r.cancelled}</span> },
    { header: "Failed pickups", align: "right", cell: (r) => <span className="tabular-nums">{r.failedPickups}</span> },
    { header: "QC failures", align: "right", cell: (r) => <span className="tabular-nums">{r.qcFailures}</span> },
    { header: "Delayed", align: "right", cell: (r) => <span className="tabular-nums">{r.delayed}</span> },
    { header: "Garments", align: "right", cell: (r) => <span className="tabular-nums">{r.garments}</span> },
    { header: "Additional", align: "right", cell: (r) => <span className="tabular-nums">{r.additionalQuantity}</span> },
    { header: "Additional revenue", align: "right", cell: (r) => <span className="tabular-nums">{rupees(r.additionalRevenuePaise)}</span> },
  ];

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <DataTable columns={columns} rows={shown} keyField={keyOf} emptyTitle="Nothing in this period" />
      {quiet.length > 0 && (
        <button onClick={() => setShowQuiet((v) => !v)} className="mt-2 rounded-full glass px-4 py-2 text-xs font-medium hover:ring-1 hover:ring-primary/40">
          {showQuiet ? `Hide ${quiet.length} with no activity` : `Show ${quiet.length} with no activity`}
        </button>
      )}
      {unassigned.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 text-sm font-semibold">{title} — unassigned</h4>
          <p className="mb-2 text-[11px] text-muted-foreground">These are not people or towers. They are orders the platform could not attribute — a gap in the assignment rather than a performance figure.</p>
          <DataTable columns={columns} rows={unassigned} keyField={keyOf} emptyTitle="Nothing unattributed" />
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, tint }: { label: string; value: string; tint?: "primary" }) {
  return (
    <div className="rounded-xl glass p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tint === "primary" ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>;
}
