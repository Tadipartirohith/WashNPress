"use client";

import { useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { EmptyState } from "@/components/portal/empty-state";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync } from "@/lib/use-async";
import { formatDate, formatDateTime, rupees, stateLabel } from "@/lib/format";
import { supervisorApi, type BlockDetailResident, type MySocietyResponse } from "@/lib/api/supervisor";
import { bareFlatNumber, formatUnit, towerLabel } from "@/lib/unit";

type Block = MySocietyResponse["blocks"][number];

// I-99 / I-112: the Society tab's tower cards and the residents inside them used to
// go nowhere. A tower card was a div, so clicking one did nothing at all; the
// Residents list opened but each row was a plain <li>, so the supervisor could see
// that Anusha lives in A-402 and could not find out anything else about her without
// going to Orders and searching by name.
//
// These three drawers stack: Tower → Resident → Order. Each one loads from a
// supervisor endpoint and shows a spinner, an error with a retry, or an empty state
// — never a blank panel, which is what "no blank drawers" in the issue is about.

const money = (o: { servicesPaise: number; additionalChargePaise: number | null }) =>
  rupees(o.servicesPaise + (o.additionalChargePaise ?? 0));

/** Tower details: what the tower is, who covers it, and everybody living in it. */
export function TowerDrawer({ block, onClose }: { block: Block; onClose: () => void }) {
  const detail = useAsync(() => supervisorApi.blockDetail(block.blockId), [block.blockId]);
  const [resident, setResident] = useState<BlockDetailResident | null>(null);

  return (
    <Modal open onClose={onClose} variant="drawer" title={towerLabel(block.blockName)} description="Tower details and the residents living in it.">
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <StatusBadge status={detail.data.block.status} toneMap={{ active: "success", inactive: "muted" }} />
              <span className="text-xs text-muted-foreground">{detail.data.block.societyName}</span>
            </div>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Flats", detail.data.block.flatCount],
                ["Floors", detail.data.block.floorCount],
                ["Residents", detail.data.block.residentCount],
                ["Active orders", detail.data.block.activeOrderCount],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl glass p-3">
                  <dd className="font-display text-xl font-bold tabular-nums">{value}</dd>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>

            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operators</h3>
              <p className="text-sm">
                {detail.data.block.operators.length
                  ? detail.data.block.operators.map((o) => o.fullName ?? o.phone).join(", ")
                  : "None assigned"}
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Users className="size-3.5" /> Residents ({detail.data.residents.length})
              </h3>
              <ResidentList residents={detail.data.residents} towerName={block.blockName} onOpen={setResident} />
            </section>
          </div>
        )}
      </Panel>
      {resident && (
        <ResidentDrawer resident={resident} towerName={block.blockName} blockId={block.blockId} onClose={() => setResident(null)} />
      )}
    </Modal>
  );
}

/** The residents of one tower, each row opening that resident. */
export function ResidentList({ residents, towerName, onOpen }: { residents: BlockDetailResident[]; towerName: string; onOpen: (r: BlockDetailResident) => void }) {
  if (residents.length === 0) {
    return <EmptyState title="No residents yet" description="Nobody has onboarded into this tower yet." />;
  }
  return (
    <ul className="space-y-2">
      {residents.map((r) => (
        <li key={r.id}>
          <button
            onClick={() => onOpen(r)}
            className="flex w-full items-center gap-3 rounded-xl glass p-3.5 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{r.fullName ?? "Unnamed resident"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">Flat {bareFlatNumber(r.unitNumber, r.blockName ?? towerName)}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {r.phone ?? "No phone on file"}{r.planName ? ` · ${r.planName}` : ""}
              </span>
              {r.activeOrderCount > 0 && (
                <span className="mt-1 block text-xs text-primary">{r.activeOrderCount} active order(s) · {stateLabel(r.orderState ?? "")}</span>
              )}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One resident: who they are, where they live, what they are subscribed to, and
 * every order they have placed.
 *
 * The floor comes from the tower's own flat structure rather than being stored on
 * the resident — the flats endpoint is what knows which floor flat 402 is on, and
 * guessing it from the number would be wrong for any society whose naming
 * convention is not tower-floor-unit.
 *
 * The joined date is when the resident's account was created, which the tower detail
 * sends. It is deliberately not a subscription start date, which would say something
 * else and be wrong for anybody who joined without subscribing.
 */
function ResidentDrawer({ resident, towerName, blockId, onClose }: {
  resident: BlockDetailResident; towerName: string; blockId: string; onClose: () => void;
}) {
  const orders = useAsync(() => supervisorApi.orders({ residentId: resident.id }), [resident.id]);
  const subs = useAsync(() => supervisorApi.subscriptions(), []);
  const flats = useAsync(() => supervisorApi.blockFlats(blockId), [blockId]);
  const [orderId, setOrderId] = useState<string | null>(null);

  const subscription = (subs.data?.subscriptions ?? []).find((s) => s.residentId === resident.id) ?? null;
  // The API reads the floor from the tower's layout and sends it. The lookup below is
  // only for an older API that does not. Both sides are compared bare, so a unit still
  // stored with its tower in front ("A-402") finds flat "402" in the layout.
  const flatNumber = bareFlatNumber(resident.unitNumber, towerName);
  const floor = resident.floor
    ?? (flats.data?.floors ?? []).find((f) => f.flats.some((flat) => bareFlatNumber(flat.number, towerName) === flatNumber))?.floor;
  const rows = orders.data?.orders ?? [];
  const activeCount = resident.activeOrderCount;

  return (
    <Modal open onClose={onClose} variant="drawer" title={resident.fullName ?? "Resident"} description={resident.phone ?? undefined}>
      <div className="space-y-5">
        <section className="rounded-2xl glass p-3">
          <Row label="Phone" value={resident.phone ?? "—"} />
          <Row label="Tower" value={towerLabel(towerName)} />
          <Row label="Floor" value={floor !== undefined ? String(floor) : flats.loading ? "…" : "—"} />
          <Row label="Flat" value={flatNumber} />
          <Row label="Plan" value={subscription?.planName ?? resident.planName ?? "No subscription"} />
          <Row
            label="Subscription"
            value={subscription ? <StatusBadge status={subscription.status} toneMap={{ active: "success", expired: "muted", cancelled: "danger" }} /> : "—"}
          />
          {subscription && <Row label="Renews / ends" value={formatDate(subscription.endDate)} />}
          <Row label="Joined on" value={resident.joinedAt ? formatDate(resident.joinedAt) : "—"} />
          <Row label="Total orders" value={orders.loading ? "…" : String(rows.length)} />
          <Row label="Active orders" value={String(activeCount)} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order history</h3>
          <Panel loading={orders.loading} error={orders.error} onRetry={orders.reload}>
            {rows.length === 0 ? (
              <EmptyState title="No orders yet" description="This resident has not placed an order." />
            ) : (
              <ul className="space-y-2">
                {rows.map((o) => (
                  <li key={o.id}>
                    <button
                      onClick={() => setOrderId(o.id)}
                      className="flex w-full items-center gap-3 rounded-xl glass p-3 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-medium">{o.orderCode}</span>
                          <StatusBadge status={o.state} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {formatDate(o.createdAt)} · {(o.serviceNames ?? []).join(", ") || "—"} · {money(o)}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      </div>
      {orderId && <OrderDrawer orderId={orderId} onClose={() => setOrderId(null)} />}
    </Modal>
  );
}

/** One order, opened from a resident's history. */
function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const detail = useAsync(() => supervisorApi.orderDetail(orderId), [orderId]);
  const o = detail.data?.order;

  return (
    <Modal open onClose={onClose} variant="drawer" title={o?.orderCode ?? "Order"} description={o ? stateLabel(o.state) : undefined}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {o && (
          <div className="space-y-4">
            <section className="rounded-2xl glass p-3">
              <Row label="Status" value={<StatusBadge status={o.state} />} />
              <Row label="Placed" value={formatDateTime(o.createdAt)} />
              <Row label="Resident" value={o.residentName ?? "—"} />
              <Row label="Tower / flat" value={formatUnit(o.blockName, o.unitNumber) || "—"} />
              <Row label="Services" value={(o.serviceNames ?? []).join(", ") || "—"} />
              <Row label="Garments accepted" value={o.acceptedCount ?? "—"} />
              <Row label="Amount" value={money(o)} />
              <Row label="Operator" value={o.operatorName ?? "Unassigned"} />
              <Row label="Scheduled pickup" value={formatDateTime(o.scheduledPickupAt)} />
              <Row label="Delivered" value={formatDateTime(o.deliveredAt)} />
            </section>
            {(o.lines ?? []).length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h3>
                <ul className="space-y-1 rounded-2xl glass p-3 text-sm">
                  {(o.lines ?? []).map((l) => (
                    <li key={l.id} className="flex justify-between gap-4">
                      <span>{stateLabel(l.category)}</span>
                      <span className="tabular-nums">{l.acceptedQuantity ?? l.quantity}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Panel>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** The Residents button on a tower card: the same list, without the tower summary. */
export function BlockResidentsDrawer({ block, onClose }: { block: Block; onClose: () => void }) {
  const detail = useAsync(() => supervisorApi.blockDetail(block.blockId), [block.blockId]);
  const [resident, setResident] = useState<BlockDetailResident | null>(null);

  return (
    <Modal open onClose={onClose} variant="drawer" title={towerLabel(block.blockName)} description="Residents living in this tower.">
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && <ResidentList residents={detail.data.residents} towerName={block.blockName} onOpen={setResident} />}
      </Panel>
      {resident && (
        <ResidentDrawer resident={resident} towerName={block.blockName} blockId={block.blockId} onClose={() => setResident(null)} />
      )}
    </Modal>
  );
}
