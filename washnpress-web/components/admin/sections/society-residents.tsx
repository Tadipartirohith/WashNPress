"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { EmptyState } from "@/components/portal/empty-state";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync } from "@/lib/use-async";
import { formatDate, formatDateTime, rupees, stateLabel } from "@/lib/format";
import { adminApi, type SocietyResidentRow } from "@/lib/api/admin";
import { bareFlatNumber, formatUnit, towerLabel } from "@/lib/unit";

// I-110 / I-112: the Society drawer used to show "Residents: 12" as a dead number.
// An admin asking "which twelve, and how is any of them getting on?" had to leave
// the society, go to People → All users, and search — and the answer, when they got
// there, was one person at a time with no way back to the society.
//
// So the count opens the list, a resident in the list opens their profile, and an
// order in the profile opens the order. All three follow the drawer pattern the rest
// of the admin console already uses, and all three show a spinner, a real error, or
// an empty state rather than a blank panel.

const money = (o: { servicesPaise: number; additionalChargePaise: number | null }) =>
  rupees(o.servicesPaise + (o.additionalChargePaise ?? 0));

const towerOf = (r: SocietyResidentRow) => r.blockName ?? r.towerBlock ?? null;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** Everybody living in one society, each row opening that resident. */
export function SocietyResidentsDrawer({ societyName, residents, onClose }: {
  societyName: string; residents: SocietyResidentRow[]; onClose: () => void;
}) {
  const [open, setOpen] = React.useState<SocietyResidentRow | null>(null);

  return (
    <Modal open onClose={onClose} variant="drawer" title={`Residents · ${societyName}`} description={`${residents.length} resident${residents.length === 1 ? "" : "s"} onboarded.`}>
      {residents.length === 0 ? (
        <EmptyState title="No residents yet" description="Nobody has onboarded into this society." />
      ) : (
        <ul className="space-y-2">
          {residents.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setOpen(r)}
                className="flex w-full items-center gap-3 rounded-xl glass p-3.5 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{r.fullName ?? "Unnamed resident"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatUnit(towerOf(r), r.unitNumber)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {r.phone ?? "No phone on file"}
                    {r.onboardingCompleted ? "" : " · onboarding incomplete"}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <ResidentDrawer resident={open} onClose={() => setOpen(null)} />}
    </Modal>
  );
}

/**
 * One resident: who they are, where they live, what they pay for, and every order
 * they have placed. GET /v1/admin/users/:id answers all four in one call — it
 * returns the user, their resident record, their orders and their subscription — so
 * nothing here is stitched together on the client.
 *
 * The floor comes from the resident's tower, whose flat structure knows which floor
 * each flat is on. A resident record stores only the flat and the tower.
 */
function ResidentDrawer({ resident, onClose }: { resident: SocietyResidentRow; onClose: () => void }) {
  const detail = useAsync(() => adminApi.users.get(resident.userId), [resident.userId]);
  const [orderId, setOrderId] = React.useState<string | null>(null);

  const orders = detail.data?.orders ?? [];
  const active = orders.filter((o) => o.state !== "delivered" && o.state !== "cancelled").length;
  const sub = detail.data?.subscription ?? null;

  return (
    <Modal open onClose={onClose} variant="drawer" title={resident.fullName ?? "Resident"} description={resident.phone ?? undefined}>
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-5">
            <section className="rounded-2xl glass p-3">
              <Row label="Phone" value={resident.phone ?? "—"} />
              <Row label="Tower" value={towerLabel(towerOf(resident)) || "—"} />
              <Row label="Floor" value={detail.data.resident?.floor != null ? String(detail.data.resident.floor) : "—"} />
              <Row label="Flat" value={bareFlatNumber(resident.unitNumber, towerOf(resident))} />
              <Row label="Plan" value={(sub?.planName as string) ?? (sub?.planTier ? stateLabel(sub.planTier) : "No subscription")} />
              <Row label="Subscription" value={sub?.status ? <StatusBadge status={String(sub.status)} toneMap={{ active: "success", expired: "muted", cancelled: "danger" }} /> : "—"} />
              <Row label="Renews on" value={sub?.renewalDate ? formatDate(String(sub.renewalDate)) : null} />
              <Row label="Joined on" value={formatDate(resident.onboardedAt ?? detail.data.user.createdAt)} />
              <Row label="Total orders" value={String(orders.length)} />
              <Row label="Active orders" value={String(active)} />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order history</h3>
              {orders.length === 0 ? (
                <EmptyState title="No orders yet" description="This resident has not placed an order." />
              ) : (
                <ul className="space-y-2">
                  {orders.map((o) => (
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
            </section>
          </div>
        )}
      </Panel>
      {orderId && <OrderDrawer orderId={orderId} onClose={() => setOrderId(null)} />}
    </Modal>
  );
}

/** One order, opened from a resident's history. */
function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const detail = useAsync(() => adminApi.orders.get(orderId), [orderId]);
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
            </section>
            {(o.timeline ?? []).length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
                <ol className="space-y-2 border-l border-border pl-4">
                  {o.timeline.map((t, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" />
                      <p className="text-sm font-medium">{stateLabel(t.state)}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(t.at)}</p>
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
