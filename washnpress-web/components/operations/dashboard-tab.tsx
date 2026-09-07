"use client";

import { AlertTriangle, PackageCheck, Truck, ChevronRight } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { EmptyState } from "@/components/portal/empty-state";
import type { OperationsDashboard } from "@/lib/api/operations";

type Destination = "pickups" | "active" | "queue" | "history" | "services" | "issues";

// A single "needs attention" / stat row: a count, a label, and where it goes.
function CountRow({ label, value, tint, onClick }: { label: string; value: number; tint?: "danger" | "warning" | "primary" | "success"; onClick?: () => void }) {
  const toneClass = tint === "danger" ? "text-danger" : tint === "warning" ? "text-warning" : tint === "success" ? "text-success" : "text-primary";
  const inner = (
    <>
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-1">
        <span className={`font-display text-lg font-bold tabular-nums ${value > 0 ? toneClass : "text-muted-foreground"}`}>{value}</span>
        {onClick && <ChevronRight className="size-4 text-muted-foreground" />}
      </span>
    </>
  );
  return onClick
    ? <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-foreground/5">{inner}</button>
    : <div className="flex items-center justify-between gap-3 px-3 py-2.5">{inner}</div>;
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl glass p-3 text-center">
      <p className="font-display text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

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
        <div className="space-y-6">
          {/* Header: the society and blocks this operator covers */}
          <div>
            <h2 className="font-display text-lg font-bold">{dashboard.societies.map((s) => s.name).join(", ") || "Your area"}</h2>
            {dashboard.blocks.length > 0 && (
              <p className="mt-0.5 text-sm text-muted-foreground">Blocks: {dashboard.blocks.map((b) => b.name).join(" · ")}</p>
            )}
          </div>

          {/* Needs Your Attention */}
          <section className="rounded-2xl glass p-4">
            <h3 className="mb-1 text-sm font-semibold">Needs Your Attention</h3>
            <div className="space-y-0.5">
              <CountRow label="Issues need attention" value={dashboard.issues.pending} tint="danger" onClick={() => onGo("issues")} />
              <CountRow label="Pickups to collect" value={dashboard.pickups.pending} tint="warning" onClick={() => onGo("pickups")} />
              <CountRow label="Ready for delivery" value={dashboard.orders.readyForDelivery} tint="success" onClick={() => onGo("active")} />
            </div>
          </section>

          {/* Today's Work — service-aware order counts */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Today&apos;s Work</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <button onClick={() => onGo("pickups")} className="contents"><Tile label="Scheduled" value={dashboard.orders.scheduled} /></button>
              <Tile label="Picked Up" value={dashboard.orders.pickedUp} />
              <Tile label="Processing" value={dashboard.orders.washing + dashboard.orders.ironing} />
              <Tile label="QC" value={dashboard.orders.qcPending} />
              <Tile label="QC Failed" value={dashboard.orders.qcFailed} />
              <Tile label="Ready" value={dashboard.orders.readyForDelivery} />
              <Tile label="Out for Delivery" value={dashboard.orders.outForDelivery} />
            </div>
          </section>

          {/* Do Next — the most urgent items */}
          <section className="rounded-2xl glass p-4">
            <h3 className="mb-1 text-sm font-semibold">Do Next</h3>
            {dashboard.actionRequired.length === 0 ? (
              <EmptyState title="Nothing waiting on you" description="Pending pickups, QC failures and ready orders show up here." />
            ) : (
              <div className="space-y-0.5">
                {dashboard.actionRequired.slice(0, 5).map((item, i) => (
                  <button key={`${item.orderId}-${i}`} onClick={() => onGo(item.kind === "pending_pickup" ? "pickups" : "active")}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-foreground/5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.orderCode} · {item.residentName ?? "Resident"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.society ?? ""}{item.unit ? ` · ${item.unit}` : ""}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning ring-1 ring-warning/30">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Additional Services */}
          <section className="rounded-2xl glass p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Additional Services</h3>
              <button onClick={() => onGo("services")} className="text-xs font-medium text-primary">Open ›</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Pending" value={dashboard.additionalServices.pending} />
              <Tile label="In Progress" value={dashboard.additionalServices.inProgress} />
            </div>
            {dashboard.additionalServices.byKind.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {dashboard.additionalServices.byKind.map((k) => <CountRow key={k.kind} label={k.label} value={k.active} />)}
              </div>
            )}
          </section>

          {/* Today's Summary */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Today&apos;s Summary</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="flex items-center gap-2 rounded-xl glass p-3"><PackageCheck className="size-4 text-primary" /><div><p className="font-display text-lg font-bold tabular-nums">{dashboard.todaySummary.pickupsCompletedToday}</p><p className="text-[11px] text-muted-foreground">Pickups completed</p></div></div>
              <div className="flex items-center gap-2 rounded-xl glass p-3"><Truck className="size-4 text-success" /><div><p className="font-display text-lg font-bold tabular-nums">{dashboard.todaySummary.ordersDeliveredToday}</p><p className="text-[11px] text-muted-foreground">Delivered</p></div></div>
              <div className="flex items-center gap-2 rounded-xl glass p-3"><AlertTriangle className="size-4 text-warning" /><div><p className="font-display text-lg font-bold tabular-nums">{dashboard.todaySummary.issuesResolvedToday}</p><p className="text-[11px] text-muted-foreground">Issues resolved</p></div></div>
              <div className="flex items-center gap-2 rounded-xl glass p-3"><PackageCheck className="size-4 text-primary" /><div><p className="font-display text-lg font-bold tabular-nums">{dashboard.todaySummary.additionalServicesCompletedToday}</p><p className="text-[11px] text-muted-foreground">Services done</p></div></div>
            </div>
          </section>
        </div>
      )}
    </Panel>
  );
}
