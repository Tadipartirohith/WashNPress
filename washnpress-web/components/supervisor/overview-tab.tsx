"use client";

import { motion } from "framer-motion";
import {
  PackageSearch, Truck, Shirt, Wind, ShieldCheck, AlertTriangle, LifeBuoy, Users, Building2, ArrowRight,
} from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { useAsync } from "@/lib/use-async";
import { supervisorApi } from "@/lib/api/supervisor";
import type { TabId } from "./types";

const listV = { show: { transition: { staggerChildren: 0.05 } } };
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

// The single area this supervisor runs, summarised. No area picker — everything
// here comes straight from GET /v1/supervisor/dashboard, which the backend already
// derives from the session.
export function OverviewTab({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  const dash = useAsync(() => supervisorApi.dashboard(), []);
  const delayed = useAsync(() => supervisorApi.delayed(), []);

  return (
    <Panel loading={dash.loading} error={dash.error} onRetry={dash.reload}>
      {dash.data && (
        <div className="space-y-8">
          {!dash.data.society && (
            <EmptyState
              tone="danger"
              icon={Building2}
              title="No society assigned yet"
              description="Your account has no society assigned. An admin needs to give you one before you can manage anything here."
            />
          )}

          {dash.data.society && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl glass-strong p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your society</p>
              <h2 className="mt-1 font-display text-2xl font-bold">{dash.data.society.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{dash.data.society.addressLine}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {dash.data.blocks.map((b) => (
                  <span key={b.id} className="rounded-full bg-foreground/5 px-3 py-1 text-xs text-muted-foreground">
                    Tower {b.name} · {b.flatCount} flats
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          <motion.div variants={listV} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <motion.div variants={itemV}><StatCard icon={PackageSearch} label="Orders today" value={String(dash.data.orders.today)} tint="primary" /></motion.div>
            <motion.div variants={itemV}><StatCard icon={Truck} label="Pickups pending" value={String(dash.data.pickups.pending)} tint="accent" /></motion.div>
            <motion.div variants={itemV}><StatCard icon={Shirt} label="In wash" value={String(dash.data.orders.washing)} tint="primary" /></motion.div>
            <motion.div variants={itemV}><StatCard icon={Wind} label="Ironing" value={String(dash.data.orders.ironing)} tint="primary" /></motion.div>
            <motion.div variants={itemV}><StatCard icon={ShieldCheck} label="QC pending" value={String(dash.data.orders.qcPending)} tint="warning" /></motion.div>
            <motion.div variants={itemV}><StatCard icon={AlertTriangle} label="QC failed" value={String(dash.data.orders.qcFailed)} tint="danger" /></motion.div>
            <motion.div variants={itemV}><StatCard icon={Users} label="Active operators" value={`${dash.data.operationsStaff.active}/${dash.data.operationsStaff.total}`} tint="accent" /></motion.div>
            <motion.div variants={itemV}><StatCard icon={LifeBuoy} label="Open issues" value={String(dash.data.issues.pending)} tint={dash.data.issues.emergency > 0 ? "danger" : "warning"} /></motion.div>
          </motion.div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl glass p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold">Processing breakdown</h3>
                <button onClick={() => onNavigate("orders")} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Open orders <ArrowRight className="size-3" />
                </button>
              </div>
              {dash.data.processing.stages.length === 0 && dash.data.processing.ironing === 0 && dash.data.processing.qcPending === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing is mid-process right now.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {dash.data.processing.stages.map((s) => (
                    <li key={s.key} className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2">
                      <span>{s.label}</span><span className="font-semibold tabular-nums">{s.count}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2">
                    <span>Ironing</span><span className="font-semibold tabular-nums">{dash.data.processing.ironing}</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2">
                    <span>Waiting for QC</span><span className="font-semibold tabular-nums">{dash.data.processing.qcPending}</span>
                  </li>
                  {dash.data.processing.qcFailed > 0 && (
                    <li className="flex items-center justify-between rounded-xl bg-danger/10 px-3 py-2 text-danger">
                      <span>QC failed, held for rework</span><span className="font-semibold tabular-nums">{dash.data.processing.qcFailed}</span>
                    </li>
                  )}
                </ul>
              )}
            </section>

            <section className="rounded-2xl glass p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold">Support tickets</h3>
                <button onClick={() => onNavigate("issues")} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Open issues <ArrowRight className="size-3" />
                </button>
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2"><span>Waiting on resident</span><span className="font-semibold tabular-nums">{dash.data.issues.waitingResident}</span></li>
                <li className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2"><span>Waiting on operator</span><span className="font-semibold tabular-nums">{dash.data.issues.waitingOperator}</span></li>
                <li className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2"><span>Escalated to you</span><span className="font-semibold tabular-nums">{dash.data.issues.escalatedSupervisor}</span></li>
                {dash.data.issues.emergency > 0 && (
                  <li className="flex items-center justify-between rounded-xl bg-danger/10 px-3 py-2 text-danger"><span>Emergency priority</span><span className="font-semibold tabular-nums">{dash.data.issues.emergency}</span></li>
                )}
              </ul>
            </section>
          </div>

          <section className="rounded-2xl glass p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Delayed orders</h3>
              <button onClick={() => onNavigate("orders")} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                View all <ArrowRight className="size-3" />
              </button>
            </div>
            <Panel loading={delayed.loading} error={delayed.error} onRetry={delayed.reload}>
              {(delayed.data?.orders.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No order is running behind schedule.</p>
              ) : (
                <ul className="space-y-2">
                  {delayed.data!.orders.slice(0, 5).map((o) => (
                    <li key={o.id} className="flex items-center justify-between rounded-xl bg-danger/10 px-3 py-2.5 text-sm">
                      <div>
                        <p className="font-medium">{o.orderCode}</p>
                        <p className="text-xs text-muted-foreground">{o.residentName ?? "Resident"} · {o.blockName ?? o.societyName}</p>
                      </div>
                      <span className="text-xs font-semibold text-danger">{o.delayMinutes} min late</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </div>
      )}
    </Panel>
  );
}
