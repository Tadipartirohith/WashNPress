"use client";

import { motion } from "framer-motion";
import { Package, Layers3, AlertTriangle, Truck } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { StatCard } from "@/components/portal/stat-card";
import { EmptyState } from "@/components/portal/empty-state";
import { formatDateTime } from "@/lib/format";
import type { OperationsDashboard } from "@/lib/api/operations";

const listV = { show: { transition: { staggerChildren: 0.05 } } };
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

type Destination = "pickups" | "active" | "queue" | "issues";

export function DashboardTab({
  dashboard, loading, error, onRetry, onGo,
}: {
  dashboard: OperationsDashboard | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onGo: (tab: Destination) => void;
}) {
  return (
    <Panel loading={loading} error={error} onRetry={onRetry}>
      {dashboard && (
        <motion.div variants={listV} initial="hidden" animate="show" className="space-y-6">
          <motion.div variants={itemV} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Package} label="Pending pickups" value={String(dashboard.pickups.pending)} tint="primary" />
            <StatCard icon={Layers3} label="Active orders" value={String(dashboard.orders.active)} tint="accent" />
            <StatCard
              icon={AlertTriangle}
              label="QC failed"
              value={String(dashboard.orders.qcFailed)}
              tint={dashboard.orders.qcFailed > 0 ? "danger" : "success"}
            />
            <StatCard icon={Truck} label="Ready for delivery" value={String(dashboard.orders.readyForDelivery)} tint="success" />
          </motion.div>

          <motion.div variants={itemV} className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl glass p-5">
              <h2 className="font-display text-lg font-bold">Needs your attention</h2>
              <p className="text-sm text-muted-foreground">Work waiting on you right now, most urgent first.</p>
              <div className="mt-4 space-y-1">
                {dashboard.actionRequired.length === 0 ? (
                  <EmptyState title="Nothing waiting on you" description="Pending pickups, QC failures and ready orders show up here as they happen." />
                ) : (
                  dashboard.actionRequired.map((item, i) => (
                    <button
                      key={`${item.orderId}-${i}`}
                      onClick={() => onGo(item.kind === "pending_pickup" ? "pickups" : "active")}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-focus"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{item.orderCode} · {item.residentName ?? "Resident"}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.society ?? ""}{item.unit ? ` · ${item.unit}` : ""}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning ring-1 ring-warning/30">{item.label}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl glass p-5">
              <h2 className="font-display text-lg font-bold">Upcoming pickups</h2>
              <p className="text-sm text-muted-foreground">Next collections across your blocks.</p>
              <div className="mt-4 space-y-1">
                {dashboard.upcomingPickups.length === 0 ? (
                  <EmptyState title="No pickups scheduled" />
                ) : (
                  dashboard.upcomingPickups.slice(0, 8).map((p) => (
                    <div key={p.pickupId} className="flex items-center justify-between gap-3 rounded-xl px-3 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.residentName ?? "Resident"} · {p.unit ?? ""}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.society ?? ""}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(p.scheduledFor)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </Panel>
  );
}
