"use client";

import { motion } from "framer-motion";
import {
  Building2, Users, HardHat, Home, IndianRupee, PackageSearch,
  LifeBuoy, ShieldAlert, AlertTriangle, Info, MapPinOff,
} from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { useAsync } from "@/lib/use-async";
import { rupees, formatDateTime, stateLabel } from "@/lib/format";
import { adminApi } from "@/lib/api/admin";
import { listV, itemV } from "../motion";

const SEVERITY_TINT = { critical: "danger", warning: "warning", notice: "primary" } as const;

export function DashboardSection({ onNavigate }: { onNavigate: (tab: "societies" | "people" | "issues") => void }) {
  const dash = useAsync(() => adminApi.dashboard(), []);
  const cov = useAsync(() => adminApi.coverage(), []);

  return (
    <div className="space-y-6">
      <Panel loading={dash.loading} error={dash.error} onRetry={dash.reload}>
        {dash.data && (
          <>
            {dash.data.alerts.length > 0 && (
              <motion.div variants={listV} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {dash.data.alerts.map((a) => (
                  <motion.div
                    key={a.kind}
                    variants={itemV}
                    className="flex items-center gap-3 rounded-2xl p-4 glass ring-1 ring-danger/20"
                  >
                    <span
                      className={
                        a.severity === "critical"
                          ? "grid size-9 place-items-center rounded-xl bg-danger/15 text-danger"
                          : a.severity === "warning"
                          ? "grid size-9 place-items-center rounded-xl bg-warning/15 text-warning"
                          : "grid size-9 place-items-center rounded-xl bg-primary/15 text-primary"
                      }
                    >
                      {a.severity === "critical" ? <ShieldAlert className="size-4" /> : a.severity === "warning" ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
                    </span>
                    <div>
                      <p className="font-display text-lg font-bold tabular-nums">{a.count}</p>
                      <p className="text-xs text-muted-foreground">{a.label}</p>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}

            <motion.div variants={listV} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <motion.div variants={itemV}><StatCard icon={Building2} label="Societies active" value={`${dash.data.societies.active}/${dash.data.societies.total}`} tint="primary" /></motion.div>
              <motion.div variants={itemV}><StatCard icon={Users} label="Supervisors active" value={`${dash.data.supervisors.active}/${dash.data.supervisors.total}`} tint="accent" /></motion.div>
              <motion.div variants={itemV}><StatCard icon={HardHat} label="Operations staff active" value={`${dash.data.operationsStaff.active}/${dash.data.operationsStaff.total}`} tint="success" /></motion.div>
              <motion.div variants={itemV}><StatCard icon={Home} label="Residents onboarded" value={`${dash.data.residents.onboarded}/${dash.data.residents.total}`} tint="primary" /></motion.div>
              <motion.div variants={itemV}><StatCard icon={IndianRupee} label="Total revenue" value={rupees(dash.data.revenue.totalRevenuePaise)} tint="success" /></motion.div>
              <motion.div variants={itemV}><StatCard icon={PackageSearch} label="Orders active" value={String(dash.data.orders.active)} tint="accent" /></motion.div>
              <motion.div variants={itemV}><StatCard icon={LifeBuoy} label="Issues pending" value={String(dash.data.issues.pending)} tint={dash.data.issues.pending > 0 ? "warning" : "success"} /></motion.div>
              <motion.div variants={itemV}><StatCard icon={PackageSearch} label="Subscriptions active" value={String(dash.data.subscriptions.active)} tint="primary" /></motion.div>
            </motion.div>

            <div>
              <h2 className="mb-3 font-display text-lg font-bold">Society performance</h2>
              {dash.data.societyPerformance.length === 0 ? (
                <EmptyState title="No societies yet" description="Add a society to see it here." action={{ label: "Go to Societies", onClick: () => onNavigate("societies") }} />
              ) : (
                <div className="overflow-x-auto rounded-2xl glass">
                  <table className="w-full min-w-[48rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Society</th>
                        <th className="px-4 py-3 font-medium">Supervisor</th>
                        <th className="px-4 py-3 text-right font-medium">Residents</th>
                        <th className="px-4 py-3 text-right font-medium">Operators</th>
                        <th className="px-4 py-3 text-right font-medium">Orders</th>
                        <th className="px-4 py-3 text-right font-medium">Delivered</th>
                        <th className="px-4 py-3 text-right font-medium">Delayed</th>
                        <th className="px-4 py-3 text-right font-medium">Open issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.data.societyPerformance.map((s) => (
                        <tr key={s.societyId} className="border-b border-white/5 last:border-0">
                          <td className="px-4 py-3 font-medium">{s.name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{s.supervisorName ?? "Unassigned"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{s.residents}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{s.operators}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{s.totalOrders}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{s.deliveredOrders}</td>
                          <td className={`px-4 py-3 text-right tabular-nums ${s.delayedOrders > 0 ? "text-danger" : ""}`}>{s.delayedOrders}</td>
                          <td className={`px-4 py-3 text-right tabular-nums ${s.openIssues > 0 ? "text-warning" : ""}`}>{s.openIssues}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h2 className="mb-3 font-display text-lg font-bold">Recent activity</h2>
              {dash.data.recentActivity.length === 0 ? (
                <EmptyState title="Nothing recorded yet" description="Actions taken across the platform will show up here." />
              ) : (
                <div className="space-y-2">
                  {dash.data.recentActivity.map((a, i) => (
                    <div key={a.id ?? i} className="flex items-center justify-between rounded-2xl glass px-4 py-3 text-sm">
                      <div>
                        <span className="font-medium">{stateLabel(a.action)}</span>
                        <span className="text-muted-foreground"> · {a.resource}{a.resourceId ? ` #${a.resourceId.slice(0, 8)}` : ""}</span>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{a.actor}{a.role ? ` (${a.role})` : ""}</div>
                        <div>{formatDateTime(a.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Panel>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <MapPinOff className="size-4 text-warning" />
          <h2 className="font-display text-lg font-bold">Supervisor coverage</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Societies whose supervisor is unavailable right now — the admin covers these directly.
        </p>
        <Panel loading={cov.loading} error={cov.error} onRetry={cov.reload}>
          {cov.data && (
            cov.data.needingCover.length === 0 ? (
              <EmptyState title="Every society is covered" description="All societies currently have an active supervisor." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {cov.data.needingCover.map((c) => (
                  <div key={c.societyId} className="rounded-2xl p-4 glass ring-1 ring-warning/30">
                    <p className="font-medium">{c.societyName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.supervisorName ? `${c.supervisorName} is ${stateLabel(c.supervisorStatus ?? "unavailable")}` : "No supervisor assigned"}
                    </p>
                  </div>
                ))}
              </div>
            )
          )}
        </Panel>
      </div>
    </div>
  );
}
