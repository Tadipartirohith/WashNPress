"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { DataTable, type Column } from "@/components/portal/data-table";
import { Modal } from "@/components/portal/modal";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type OrderSummary, type SubscriptionSummary } from "@/lib/api/admin";
import { rupees, formatDateTime, stateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { itemV, listV } from "../motion";

export function OrdersSection() {
  const [tab, setTab] = React.useState<"orders" | "subscriptions">("orders");
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(["orders", "subscriptions"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-full px-4 py-2 text-sm font-medium capitalize", tab === t ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground hover:text-foreground")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "orders" ? <OrdersTab /> : <SubscriptionsTab />}
    </div>
  );
}

function OrdersTab() {
  const [state, setState] = React.useState("");
  const [unassigned, setUnassigned] = React.useState(false);
  const [delayed, setDelayed] = React.useState(false);
  const [orderCode, setOrderCode] = React.useState("");
  const { data, loading, error, reload } = useAsync(
    () => adminApi.orders.list({ state: state || undefined, unassigned: unassigned ? "true" : undefined, delayed: delayed ? "true" : undefined, orderCode: orderCode || undefined }),
    [state, unassigned, delayed, orderCode],
  );
  const [openId, setOpenId] = React.useState<string | null>(null);

  const columns: Column<OrderSummary>[] = [
    { header: "Order", cell: (r) => <span className="font-medium">{r.orderCode}</span> },
    { header: "Resident", cell: (r) => <div><p>{r.residentName ?? "—"}</p><p className="text-xs text-muted-foreground">{r.societyName}{r.blockName ? ` · ${r.blockName}` : ""}</p></div> },
    { header: "State", cell: (r) => <StatusBadge status={r.state} label={(data?.stateLabels ?? {})[r.state]} /> },
    { header: "Operator", cell: (r) => r.operatorName ?? <span className="text-muted-foreground">Unassigned</span> },
    { header: "Amount", align: "right", cell: (r) => rupees(r.servicesPaise + (r.additionalChargePaise ?? 0)) },
    { header: "Created", cell: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:max-w-xs">
          <Search className="size-4 shrink-0" />
          <input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="Order code" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={state} onChange={(e) => setState(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All states</option>
          {Object.entries(data?.stateLabels ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} className="size-4 rounded border-border" /> Unassigned
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={delayed} onChange={(e) => setDelayed(e.target.checked)} className="size-4 rounded border-border" /> Delayed
        </label>
      </div>

      <motion.div variants={listV} initial="hidden" animate="show">
        <motion.div variants={itemV}>
          <DataTable columns={columns} rows={data?.orders ?? []} keyField={(r) => r.id} loading={loading} error={error}
            onRowClick={(r) => setOpenId(r.id)} emptyTitle="No orders match" emptyDescription="Try clearing a filter." />
        </motion.div>
      </motion.div>
      {data && <p className="text-xs text-muted-foreground">{data.page.total} order{data.page.total === 1 ? "" : "s"} total</p>}

      {openId && <OrderDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function OrderDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => adminApi.orders.get(id), [id]);
  const operators = useAsync(() => adminApi.operators.list({}), []);
  const toast = useToast();
  const [operatorUserId, setOperatorUserId] = React.useState("");
  const assign = useAction(() => adminApi.orders.assign(id, { operatorUserId: operatorUserId || null }));

  React.useEffect(() => { setOperatorUserId(detail.data?.order.assignedOperatorUserId ?? ""); }, [detail.data]);

  return (
    <Modal open onClose={onClose} variant="drawer" title={detail.data?.order.orderCode ?? "Order"} description={detail.data?.order.societyName ?? undefined}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-5">
            <StatusBadge status={detail.data.order.state} />

            <section className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Resident</p><p>{detail.data.order.residentName ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><p>{detail.data.order.residentPhone ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Society / block</p><p>{detail.data.order.societyName} {detail.data.order.blockName ? `· ${detail.data.order.blockName}` : ""}</p></div>
              <div><p className="text-xs text-muted-foreground">Created</p><p>{formatDateTime(detail.data.order.createdAt)}</p></div>
            </section>

            <section className="rounded-2xl glass p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Charges</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Covered by plan</span><span className="tabular-nums">{detail.data.order.subscriptionCoveredCount ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Additional garments</span><span className="tabular-nums">{detail.data.order.additionalCount ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Service charge</span><span className="tabular-nums">{rupees(detail.data.order.servicesPaise)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Additional charge</span><span className="tabular-nums">{rupees(detail.data.order.additionalChargePaise ?? 0)}</span></div>
              </div>
              {detail.data.order.additionalChargeStatus && (
                <div className="mt-2"><StatusBadge status={detail.data.order.additionalChargeStatus} toneMap={{ paid: "success", pending: "warning", failed: "danger" }} /></div>
              )}
            </section>

            {detail.data.order.nextActions.length > 0 && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next in processing</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.data.order.nextActions.map((a) => (
                    <span key={a.to} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary ring-1 ring-primary/25">{a.label}</span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Carried out from the operations portal.</p>
              </section>
            )}

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assign operator</p>
              <div className="flex gap-2">
                <select value={operatorUserId} onChange={(e) => setOperatorUserId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Unassigned</option>
                  {(operators.data?.operators ?? []).map((o) => <option key={o.id} value={o.id}>{o.fullName} {o.societyName ? `— ${o.societyName}` : ""}</option>)}
                </select>
                <button onClick={() => assign.run().then(() => { toast.push("Order reassigned"); detail.reload(); onChanged(); }).catch(() => {})}
                  disabled={assign.busy} className="shrink-0 rounded-xl glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40 disabled:opacity-50">
                  Save
                </button>
              </div>
              {assign.error && <p className="text-xs text-danger">{assign.error}</p>}
            </section>

            {detail.data.order.timeline?.length > 0 && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</p>
                <ol className="space-y-2">
                  {detail.data.order.timeline.map((t, i) => (
                    <li key={i} className="flex justify-between rounded-xl glass px-3 py-2 text-xs">
                      <span>{stateLabel(t.state)}{t.note ? ` — ${t.note}` : ""}</span>
                      <span className="text-muted-foreground">{formatDateTime(t.at)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </Panel>
    </Modal>
  );
}

function SubscriptionsTab() {
  const [status, setStatus] = React.useState("");
  const { data, loading, error } = useAsync(() => adminApi.subscriptions.list({ status: status || undefined }), [status]);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const columns: Column<SubscriptionSummary>[] = [
    { header: "Resident", cell: (r) => <div><p className="font-medium">{r.residentName ?? "—"}</p><p className="text-xs text-muted-foreground">{r.societyName}</p></div> },
    { header: "Plan", cell: (r) => r.planTier ?? "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} toneMap={{ active: "success", paused: "warning", cancelled: "danger", expired: "muted" }} /> },
    { header: "Used / allowance", align: "right", cell: (r) => `${r.garmentsUsed} / ${r.allowance ?? "—"}` },
    { header: "Monthly", align: "right", cell: (r) => r.monthlyPaise != null ? rupees(r.monthlyPaise) : "—" },
  ];

  return (
    <div className="space-y-4">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="cancelled">Cancelled</option>
        <option value="expired">Expired</option>
      </select>
      <DataTable columns={columns} rows={data?.subscriptions ?? []} keyField={(r) => r.id} loading={loading} error={error}
        onRowClick={(r) => setOpenId(r.id)} emptyTitle="No subscriptions match" />
      {openId && <SubscriptionDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SubscriptionDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAsync(() => adminApi.subscriptions.get(id), [id]);
  return (
    <Modal open onClose={onClose} variant="drawer" title={detail.data?.resident?.fullName as string ?? "Subscription"} description={detail.data?.subscription.planTier ?? undefined}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-5">
            <StatusBadge status={detail.data.subscription.status} toneMap={{ active: "success", paused: "warning", cancelled: "danger", expired: "muted" }} />
            <section className="rounded-2xl glass p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Garments used</span>
                <span className="tabular-nums">{detail.data.subscription.garmentsUsed} / {detail.data.subscription.allowance ?? "—"}</span>
              </div>
              {detail.data.subscription.usagePercent != null && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, detail.data.subscription.usagePercent)}%` }} />
                </div>
              )}
            </section>

            {detail.data.previousSubscriptions.length > 0 && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previous subscriptions</p>
                <div className="space-y-2">
                  {detail.data.previousSubscriptions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl glass px-3 py-2 text-xs">
                      <span>{String(s.planTier)}</span>
                      <span className="text-muted-foreground">{String(s.status)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {detail.data.activity.length > 0 && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</p>
                <div className="space-y-2">
                  {detail.data.activity.map((a, i) => (
                    <div key={i} className="rounded-xl glass px-3 py-2 text-xs">
                      <div className="flex justify-between"><span className="font-medium">{stateLabel(a.action)}</span><span className="text-muted-foreground">{formatDateTime(a.at)}</span></div>
                      <p className="text-muted-foreground">{a.actor}{a.role ? ` (${a.role})` : ""}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </Panel>
    </Modal>
  );
}
