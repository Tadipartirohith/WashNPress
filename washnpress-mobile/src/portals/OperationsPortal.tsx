import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  BlockAllocation,
  ConversationView, GarmentItem, GarmentSummary, Issue, IssueStatus, OperationsDashboard, OrderDetail, OrderSummary, PickupQueueItem, StaffUser } from "../api/types";
import { ISSUE_STATUS_LABEL, ISSUE_STATUS_COLOR } from "../components/support";
import type { OfflineQueue } from "../offline/queue";
import { font, theme, space, type, border, size, rupees, shortDate, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, StatePill, BackLink, Counter, Stat, StatGrid, CardGrid,
} from "../components/ui";
import { ReplyBox, TicketDetail } from "../components/support";
import { EscalateBox, EscalationNote } from "../components/escalate";
import { OrderCard, OrderList, OrderDetailBody, IssueCard } from "../components/order";
import { orDash } from "../components/records";
import { usePolling, POLL } from "../hooks";
import { DateField } from "../components/calendar";
import { DataTable, Dropdown, FilterRow } from "../components/filters";
import { ReconcileScreen, BatchesScreen, ServiceJobsScreen } from "./operations-batches";

// Processing has gone. It was the Active list filtered to five of its eight
// groups, in a tab of its own, so the same order appeared under two headings and
// neither said anything the other did not. The work itself is unchanged: an order
// is moved through washing, ironing and QC from the order, which is where an
// operator already is when they have it in their hands.
type Tab = "home" | "pickups" | "active" | "services" | "history" | "issues" | "profile";

const PICKUP_FAILURE_REASONS = [
  "Resident unavailable", "Resident cancelled", "Wrong address",
  "Pickup postponed", "Garment quantity issue", "Other issue",
];

const QC_FAILURE_REASONS = [
  "Stain remaining", "Improper washing", "Improper ironing",
  "Damaged garment", "Missing garment", "Wrong garment", "Other",
];

export function OperationsPortal({ token, queue, onLogout }: { token: string; queue: OfflineQueue; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  // Opening an order shows it in the shape it is actually being worked in. An order
  // that has batches opens on its batches; one that has not been collected yet has
  // none, and opens on its detail.
  const openOrder = useCallback((id: string, batchCount?: number) => {
    setOpenOrderId(id);
    setOrderView((batchCount ?? 0) > 0 ? "batches" : "detail");
  }, []);
  // Which view an order opens in.
  //
  // This used to reset to "detail" every time an order was opened, so an order being
  // worked as batches showed a generic order timeline the moment somebody went back
  // and opened it again. The processing view follows the order's saved batches now:
  // an order that has them is a batch-wise order for good.
  const [orderView, setOrderView] = useState<"detail" | "reconcile" | "batches">("detail");
  const [pendingSync, setPendingSync] = useState(0);
  const [offline, setOffline] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [issueTypes, setIssueTypes] = useState<string[]>([]);

  const refreshPending = useCallback(async () => setPendingSync(await queue.pendingCount()), [queue]);

  useEffect(() => {
    api.opsConfig(token)
      .then((r) => { setCategories(r.garmentCategories); setIssueTypes(r.issueTypes); })
      .catch(() => setCategories(["Shirts", "Trousers", "Bedsheets", "Other"]));
    refreshPending();
  }, [token, refreshPending]);

  const sync = useCallback(async () => {
    const r = await queue.sync();
    setOffline(r.failed > 0);
    await refreshPending();
  }, [queue, refreshPending]);

  // Confirming what turned up, and then working the batches, are their own screens
  // rather than sections of an already long order page.
  if (openOrderId && orderView === "reconcile") {
    return (
      <ReconcileScreen
        token={token} orderId={openOrderId}
        onDone={() => setOrderView("batches")}
        onBack={() => setOrderView("detail")}
      />
    );
  }
  if (openOrderId && orderView === "batches") {
    // Back from the batch view goes back to the list, not to a generic order page
    // that shows the same work in a shape it is not being done in.
    return <BatchesScreen token={token} orderId={openOrderId} onBack={() => { setOpenOrderId(null); setOrderView("detail"); }} />;
  }
  if (openOrderId) {
    return (
      <OperationsOrderScreen
        token={token} orderId={openOrderId} categories={categories} issueTypes={issueTypes}
        queue={queue} onQueued={refreshPending}
        onReconcile={() => setOrderView("reconcile")}
        onBatches={() => setOrderView("batches")}
        onBack={() => { setOpenOrderId(null); setOrderView("detail"); }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {offline || pendingSync > 0 ? (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineText}>
            {pendingSync} action{pendingSync === 1 ? "" : "s"} queued offline.
          </Text>
          <Text style={styles.offlineSync} onPress={sync}>Sync now</Text>
        </View>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: "home", label: "Dashboard" },
          { key: "pickups", label: "Pickups" },
          { key: "active", label: "Active" },
          { key: "services", label: "Services" },
          { key: "history", label: "History" },
          { key: "issues", label: "Issues" },
          { key: "profile", label: "Profile" },
        ]}
      />
      {tab === "home" && <OperationsHome token={token} onGoto={setTab} />}
      {tab === "pickups" && <PickupQueueScreen token={token} onOpenOrder={openOrder} />}
      {tab === "services" && <ServiceJobsScreen token={token} />}
      {tab === "active" && <ActiveOrdersScreen token={token} onOpenOrder={openOrder} />}
      {tab === "history" && <HistoryScreen token={token} onOpenOrder={openOrder} />}
      {tab === "issues" && <OperationsIssuesScreen token={token} issueTypes={issueTypes} />}
      {tab === "profile" && <OperationsProfileScreen token={token} onLogout={onLogout} />}
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function OperationsHome({ token, onGoto }: { token: string; onGoto: (tab: Tab) => void }) {
  const [data, setData] = useState<OperationsDashboard | null>(null);
  const [blocks, setBlocks] = useState<BlockAllocation[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [dashboard, mine] = await Promise.all([api.opsDashboard(token), api.opsBlocks(token)]);
      setData(dashboard);
      setBlocks(mine.blocks);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.worklist);

  if (busy && !data) return <Loading />;
  const o = data?.orders;
  const issues = data?.issues;
  // Only the stages this operator's batches actually need. An operator whose
  // societies sent nothing for dry cleaning today has no dry cleaning row.
  const stages = data?.processing?.stages ?? [];
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Operations Dashboard"
        subtitle={data?.blocks?.length
          ? `${data.societies.map((s) => s.name).join(", ")} · ${data.blocks.map((b) => b.name).join(", ")}`
          : "No blocks assigned yet"}
      />
      <ErrorText error={error} />

      <SectionTitle>Today&apos;s work</SectionTitle>
      <StatGrid>
        <Stat label="Today's pickups" value={data?.todaysPickups ?? 0} onPress={() => onGoto("pickups")} />
        <Stat label="Pending pickups" value={data?.pickups?.pending ?? 0} onPress={() => onGoto("pickups")} />
        <Stat label="Picked up" value={o?.pickedUp ?? 0} onPress={() => onGoto("active")} />
        <Stat label="Processing orders" value={(o?.washing ?? 0) + (o?.ironing ?? 0) + (o?.ironingPending ?? 0)} onPress={() => onGoto("active")} />
        <Stat label="Ready for delivery" value={o?.readyForDelivery ?? 0} tone="good" onPress={() => onGoto("active")} />
        <Stat label="Out for delivery" value={o?.outForDelivery ?? 0} onPress={() => onGoto("active")} />
        <Stat label="Delivered today" value={o?.deliveredToday ?? 0} tone="good" onPress={() => onGoto("history")} />
      </StatGrid>

      {/* The towers this operator actually covers. Work used to be handed out by
          society — three towers and a hundred and twenty flats — and there was no
          way to see which part of it was yours, because there was no such thing as
          a part of it. */}
      <SectionTitle>My blocks</SectionTitle>
      {blocks.length ? (
        <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
          {blocks.map((block) => (
            <Card key={block.blockId}>
              <View style={styles.headRow}>
                <Text style={styles.code}>{block.blockName}</Text>
                {block.activeOrderCount > 0
                  ? <Pill text={`${block.activeOrderCount} active`} color={theme.aqua} />
                  : null}
              </View>
              <Text style={styles.meta}>{block.societyName}</Text>
              <Row label="Flats" value={block.flatCount} />
              <Row label="Residents" value={block.residentCount} />
              <Row label="Active orders" value={block.activeOrderCount} />
            </Card>
          ))}
        </CardGrid>
      ) : (
        <Empty text="No blocks are assigned to you yet. Your supervisor assigns them from their own society page." />
      )}

      <SectionTitle>Action required</SectionTitle>
      {data?.actionRequired?.length ? data.actionRequired.map((item) => (
        <Card key={`${item.kind}-${item.orderId}`} onPress={() => onGoto(item.kind === "pending_pickup" ? "pickups" : "active")}>
          <View style={styles.headRow}>
            <Text style={styles.code}>{item.label}</Text>
            <Pill text={item.action} color={item.kind === "qc_failed" ? theme.danger : theme.amber} />
          </View>
          <Text style={styles.muted}>
            {item.orderCode}{item.residentName ? ` · ${item.residentName}` : ""}
          </Text>
          <Text style={styles.muted}>
            {[item.society, item.unit].filter(Boolean).join(" · ")}
            {item.items ? ` · ${item.items} item${item.items === 1 ? "" : "s"}` : ""}
          </Text>
        </Card>
      )) : <Empty text="No urgent actions." />}

      <SectionTitle>Upcoming pickups</SectionTitle>
      {data?.upcomingPickups?.length ? data.upcomingPickups.map((pickup) => (
        <Card key={pickup.pickupId} onPress={() => onGoto("pickups")}>
          <View style={styles.headRow}>
            <Text style={styles.code}>{dateTime(pickup.scheduledFor)}</Text>
            <Pill text={titleCase(pickup.status)} color={theme.aqua} />
          </View>
          <Text style={styles.muted}>
            {pickup.orderCode ?? "Not yet ordered"}{pickup.residentName ? ` · ${pickup.residentName}` : ""}
          </Text>
          <Text style={styles.muted}>
            {[pickup.society, pickup.unit].filter(Boolean).join(" · ")}
            {pickup.items ? ` · ${pickup.items} item${pickup.items === 1 ? "" : "s"}` : ""}
          </Text>
        </Card>
      )) : <Empty text="No pending pickups." />}

      <SectionTitle>Processing overview</SectionTitle>
      {stages.length || data?.processing?.ironing || data?.processing?.qcPending || data?.processing?.qcFailed ? (
        <StatGrid>
          {stages.map((stage) => (
            <Stat key={stage.key} label={stage.label} value={stage.count} onPress={() => onGoto("active")} />
          ))}
          <Stat label="Ironing" value={data?.processing?.ironing ?? 0} onPress={() => onGoto("active")} />
          <Stat label="QC pending" value={data?.processing?.qcPending ?? 0} tone="warn" onPress={() => onGoto("active")} />
          <Stat label="QC failed" value={data?.processing?.qcFailed ?? 0} tone="danger" onPress={() => onGoto("active")} />
        </StatGrid>
      ) : <Empty text="No orders currently processing." />}

      <SectionTitle>Delivery overview</SectionTitle>
      <StatGrid>
        <Stat label="Ready for delivery" value={o?.readyForDelivery ?? 0} tone="good" onPress={() => onGoto("active")} />
        <Stat label="Out for delivery" value={o?.outForDelivery ?? 0} onPress={() => onGoto("active")} />
        <Stat label="Delivered today" value={o?.deliveredToday ?? 0} tone="good" onPress={() => onGoto("history")} />
      </StatGrid>

      <SectionTitle>Issues</SectionTitle>
      <StatGrid>
        <Stat label="Requiring action" value={(issues?.open ?? 0) + (issues?.waitingOperator ?? 0)} tone="danger" onPress={() => onGoto("issues")} />
        <Stat label="Waiting for supervisor" value={issues?.escalatedSupervisor ?? 0} tone="warn" onPress={() => onGoto("issues")} />
        <Stat label="Resolved" value={issues?.resolved ?? 0} tone="good" onPress={() => onGoto("issues")} />
      </StatGrid>
    </Screen>
  );
}

// ------------------------------------------------------ per garment processing

// What each line in the order has to go through. Four shirts can be dry cleaned
// and pressed while six others are only ironed, and the operator has to see that.
function ProcessingChecklist({ order }: { order: OrderDetail }) {
  const processing = order.processing;
  if (!processing || !processing.lines.length) return null;
  return (
    <>
      <SectionTitle>Processing required</SectionTitle>
      <Card>
        <Row label="This batch" value={[
          processing.requiresClean ? processing.cleanLabel : null,
          processing.requiresPress ? "Ironing" : null,
        ].filter(Boolean).join(" then ") || "No processing"} />
        {processing.lines.map((line) => (
          <View key={line.id} style={styles.headRow}>
            <Text style={styles.code}>{line.quantity} x {line.category}</Text>
            <Text style={styles.muted}>
              {line.serviceName}: {line.stages.map((stage) => stage.label).join(" then ")}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}

// -------------------------------------------------------------- pickup queue

function PickupQueueScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string, batchCount?: number) => void }) {
  // Empty means everything still waiting to be collected, including work that was
  // missed on an earlier day. A missed pickup is exactly what must not disappear
  // behind a date filter, so it takes an explicit date to narrow the view.
  const [date, setDate] = useState("");
  const [pickups, setPickups] = useState<PickupQueueItem[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await api.opsPickups(token, date || undefined);
      setPickups(response.pickups);
      setOverdueCount(response.overdueCount ?? 0);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, date]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Pending pickups"
        subtitle={date ? `Bookings for ${date}` : "Everything still waiting to be collected"}
      />
      {overdueCount ? (
        <Notice text={`${overdueCount} pickup${overdueCount === 1 ? " was" : "s were"} missed on an earlier day and still need collecting.`} />
      ) : null}
      {/* A calendar, not a format to memorise. Leaving it empty means everything
          still waiting, which is the view an operator wants most mornings. */}
      <DateField label="Date" value={date || null} onChange={(next) => setDate(next ?? "")} placeholder="All pending pickups" />
      <View style={{ height: 8 }} />
      {pickups.length ? pickups.map((p) => (
        <Card key={p.pickupId} onPress={p.orderId ? () => onOpenOrder(p.orderId!) : undefined}>
          {/* Past its window and still waiting is not "Scheduled" any more. The
              backend marks it Due and sorts it to the top; the row says so. */}
          {p.due ? <Pill text="DUE" color={theme.danger} /> : null}
          <View style={styles.headRow}>
            <Text style={styles.code}>{p.orderCode ?? "No order"}</Text>
            {p.overdue ? <StatePill state="overdue" /> : <StatePill state={p.status} />}
          </View>
          <Row label="Resident" value={p.residentName} />
          <Row label="Society" value={p.societyName} />
          <Row label="Flat / unit" value={p.unitNumber} />
          <Row label="Pickup date" value={shortDate(p.pickupDate)} />
          <Row label="Pickup slot" value={p.slot} />
          <Row label="Pickup address" value={p.pickupAddress} />
          <Row label="Assigned operator" value={p.operatorName ?? "Unassigned"} />
          {p.estimatedCount ? <Row label="Resident estimate" value={`${p.estimatedCount} garments`} /> : null}
          {p.specialInstructions ? <Notice text={p.specialInstructions} /> : null}
        </Card>
      )) : <Empty text={date ? "No bookings on that date." : "Nothing waiting for pickup."} />}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------- shared queue

// Work that nobody is holding. When a colleague goes on leave their orders come
// The Unassigned section is gone. Work reaches an operator through Pickups — either
// because it was assigned to them or because they took it there — rather than through
// a separate page listing work nobody owns.

function SharedQueueScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string, batchCount?: number) => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setOrders((await api.opsQueue(token)).orders); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.worklist);

  const claim = async (order: OrderSummary) => {
    setError(null); setNote(null);
    try {
      await api.claimOrder(order.id, token);
      setNote(`${order.orderCode} is yours. It carries on from where it was.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Unassigned work" subtitle="Anyone in your area can pick these up" />
      {note ? <Notice tone="good" text={note} /> : null}
      {orders.length ? orders.map((order) => (
        <View key={order.id}>
          <OrderCard order={order} onPress={() => onOpenOrder(order.id, order.batchCount)} />
          <View style={styles.claimRow}>
            <Button label="Take this order" variant="secondary" onPress={() => claim(order)} />
          </View>
        </View>
      )) : <Empty text="Nothing waiting. Everything has an owner." />}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------- order screen

function OperationsOrderScreen({ token, orderId, categories, issueTypes, queue, onQueued, onReconcile, onBatches, onBack }: {
  token: string; orderId: string; categories: string[]; issueTypes: string[];
  queue: OfflineQueue; onQueued: () => void;
  onReconcile: () => void; onBatches: () => void; onBack: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<GarmentSummary | null>(null);
  const [deliveryCount, setDeliveryCount] = useState("");
  const [discrepancy, setDiscrepancy] = useState("");
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [qcReason, setQcReason] = useState<string | null>(null);
  const [issueType, setIssueType] = useState<string | null>(null);
  const [issueText, setIssueText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setOrder((await api.opsOrder(orderId, token)).order); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  const items: GarmentItem[] = useMemo(
    () => categories.filter((c) => (counts[c] ?? 0) > 0).map((c) => ({ category: c, quantity: counts[c] })),
    [categories, counts],
  );
  const enteredTotal = items.reduce((sum, i) => sum + i.quantity, 0);

  // Every action goes through here so an offline failure is queued instead of lost.
  const perform = async (kind: string, run: () => Promise<{ order: OrderDetail }>, payload: Record<string, unknown>) => {
    setBusy(true); setNote(null); setError(null);
    try {
      const r = await run();
      setOrder(r.order);
      setNote("Saved.");
    } catch (e) {
      const message = (e as Error).message;
      if (/network|failed to fetch|timeout/i.test(message)) {
        await queue.enqueue(kind, payload);
        onQueued();
        setNote("Offline. The action is queued and will sync automatically.");
      } else {
        setError(message);
      }
    } finally { setBusy(false); }
  };

  const preview = async () => {
    setError(null);
    try { setSummary((await api.opsPreviewGarments(orderId, items, token)).summary); }
    catch (e) { setError((e as Error).message); }
  };

  const raiseIssue = async () => {
    if (!issueType || !issueText.trim()) return;
    setError(null);
    try {
      await api.opsCreateIssue({ orderId, type: issueType, description: issueText }, token);
      setIssueText(""); setIssueType(null); setNote("Issue reported to the supervisor.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  if (busy && !order) return <Loading />;
  if (!order) return <Screen><BackLink label="Back" onPress={onBack} /><ErrorText error={error} /></Screen>;

  const state = order.state;
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Back" onPress={onBack} />

      {/* Garment entry. The operator enters only the actual accepted quantity. */}
      {state === "scheduled" ? (
        <>
          <PageTitle title={order.orderCode} subtitle={`${order.residentName ?? ""} · ${order.unitNumber ?? ""} · ${order.societyName ?? ""}`} />
          <Card>
            <Row label="Pickup address" value={order.pickupAddress} />
            <Row label="Pickup slot" value={order.slot ? `${order.slot.startTime} – ${order.slot.endTime}` : "—"} />
            <Row label="Subscription plan" value={order.planTier ?? "No active plan"} />
            <Row label="Remaining allowance" value={`${order.remainingAllowance} garments`} />
            {order.estimatedCount ? <Row label="Resident estimate" value={order.estimatedCount} /> : null}
          </Card>

          {order.lines?.length ? (
            <>
              <SectionTitle>Requested services</SectionTitle>
              <Notice text="Each garment and service is its own batch. Confirm what you actually received for each one." />
              <Card>
                {order.lines.map((line) => (
                  <Row key={line.id} label={`${line.category} × ${line.quantity}`} value={line.serviceName} />
                ))}
              </Card>
              {order.state === "scheduled" ? (
                <Button label="Confirm quantities and collect" onPress={onReconcile} />
              ) : (
                <Button label="Open processing batches" variant="secondary" onPress={onBatches} />
              )}
            </>
          ) : null}

          {/* The per-category entry below is for orders booked before services were
              chosen per garment. An order with lines is confirmed per combination. */}
          {order.lines?.length ? null : (
            <>
              <SectionTitle>Garment entry</SectionTitle>
              <Notice text="Enter the actual garments received. The subscription split and any additional charge are calculated by the system." />
              {categories.map((category) => (
                <Counter key={category} label={category} value={counts[category] ?? 0} onChange={(next) => setCounts((s) => ({ ...s, [category]: next }))} />
              ))}
            </>
          )}
          <Card>
            <Row label="Total entered" value={enteredTotal} />
          </Card>
          <Button label="Check quantity summary" variant="secondary" onPress={preview} disabled={enteredTotal === 0} />

          {summary ? (
            <>
              <SectionTitle>Garment summary</SectionTitle>
              <Card>
                <Row label="Actual garments" value={summary.acceptedCount} />
                <Row label="Subscription covered" value={summary.subscriptionCoveredCount} />
                <Row label="Additional garments" value={summary.additionalCount} />
                <Row label="Rate per additional" value={rupees(summary.additionalRatePaise)} />
                <Row label="Additional charge" value={rupees(summary.additionalChargePaise)} />
              </Card>
              <Button
                label="Confirm quantity and mark picked up"
                disabled={busy || enteredTotal === 0}
                onPress={() => perform("markPickedUp", () => api.markPickedUp(orderId, items, token), { orderId, items })}
              />
              <Button label="Cancel" variant="secondary" onPress={() => setSummary(null)} />
            </>
          ) : null}

          <SectionTitle>Pickup exception</SectionTitle>
          <Dropdown
            label="Reason"
            value={failureReason ?? undefined}
            allLabel="Choose a reason"
            options={PICKUP_FAILURE_REASONS.map((r) => ({ value: r, label: r }))}
            onChange={(v) => setFailureReason(v ?? null)}
          />
          <Button
            label="Record failed pickup"
            variant="danger"
            disabled={!failureReason || busy}
            onPress={() => perform("failPickup", () => api.failPickup(orderId, failureReason!, token), { orderId, reason: failureReason })}
          />
        </>
      ) : (
        <>
          <OrderDetailBody order={order} audience="staff" />

          <ProcessingChecklist order={order} />

          <SectionTitle>Next action</SectionTitle>
          {/* The stages an order goes through depend on the services its own
              garments were sent for, so the backend decides which actions exist.
              An Iron Only order never shows a washing button. */}
          {state === "ironing" && !order.ironingStarted ? (
            <Button label="Start ironing" disabled={busy} onPress={() => perform("startIroning", () => api.startIroning(orderId, token), { orderId })} />
          ) : (order.nextActions ?? []).map((action) => (
            <Button
              key={action.to}
              label={action.label}
              disabled={busy}
              onPress={() => perform("advanceStage", () => api.advanceStage(orderId, action.to as "in_wash" | "ironing" | "qc", token), { orderId, to: action.to })}
            />
          ))}
          {!(order.nextActions ?? []).length && state !== "ironing" && !["qc", "qc_hold", "ready_for_delivery", "out_for_delivery", "delivered"].includes(state) ? (
            <Empty text="Nothing to do on this order right now." />
          ) : null}

          {state === "qc" ? (
            <>
              <Button label="Pass QC" disabled={busy} onPress={() => perform("qcPass", () => api.submitQc(orderId, true, undefined, token), { orderId, pass: true })} />
              <SectionTitle>Fail QC</SectionTitle>
              <Dropdown
                label="Reason"
                value={qcReason ?? undefined}
                allLabel="Choose a reason"
                options={QC_FAILURE_REASONS.map((r) => ({ value: r, label: r }))}
                onChange={(v) => setQcReason(v ?? null)}
              />
              <Button
                label="Fail QC with this reason"
                variant="danger"
                disabled={!qcReason || busy}
                onPress={() => perform("qcFail", () => api.submitQc(orderId, false, qcReason!, token), { orderId, pass: false, reason: qcReason })}
              />
            </>
          ) : null}

          {state === "qc_hold" ? (
            <>
              <Notice tone="warn" text={`QC failed: ${order.qcReason ?? "reason not recorded"}. Reprocess the batch; it must pass QC again before it can be delivered.`} />
              <Button label="Send back to washing" disabled={busy} onPress={() => perform("reprocessWash", () => api.reprocess(orderId, "in_wash", token), { orderId, to: "in_wash" })} />
              <Button label="Send back to ironing" variant="secondary" disabled={busy} onPress={() => perform("reprocessIron", () => api.reprocess(orderId, "ironing", token), { orderId, to: "ironing" })} />
            </>
          ) : null}

          {state === "ready_for_delivery" ? (
            <Button label="Out for delivery" disabled={busy} onPress={() => perform("outForDelivery", () => api.outForDelivery(orderId, token), { orderId })} />
          ) : null}

          {state === "out_for_delivery" ? (
            <>
              <Notice text={`Collected count: ${order.acceptedCount ?? "—"}. A different delivered count needs a documented reason.`} />
              <Field label="Delivered count" value={deliveryCount} onChangeText={setDeliveryCount} keyboardType="number-pad" />
              <Field label="Discrepancy reason (only if counts differ)" value={discrepancy} onChangeText={setDiscrepancy} />
              <Button
                label="Mark delivered"
                disabled={busy || !deliveryCount}
                onPress={() => perform("deliver", () => api.deliver(orderId, Number(deliveryCount), discrepancy || undefined, token), { orderId, deliveryCount: Number(deliveryCount), discrepancyReason: discrepancy || undefined })}
              />
            </>
          ) : null}

          <SectionTitle>Report an issue</SectionTitle>
          <Dropdown
            label="Issue type"
            value={issueType ?? undefined}
            allLabel="Choose a type"
            options={issueTypes.map((t) => ({ value: t, label: titleCase(t) }))}
            onChange={(v) => setIssueType(v ?? null)}
          />
          <Field label="Description" value={issueText} onChangeText={setIssueText} placeholder="What went wrong?" />
          <Button label="Report to supervisor" variant="secondary" disabled={!issueType || !issueText.trim()} onPress={raiseIssue} />
        </>
      )}

      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------- active work

const ACTIVE_GROUPS: { key: string; label: string }[] = [
  { key: "pickedUp", label: "Picked Up" },
  { key: "washing", label: "Washing" },
  { key: "ironingPending", label: "Ironing Pending" },
  { key: "ironing", label: "Ironing" },
  { key: "qc", label: "QC" },
  { key: "qcFailed", label: "QC Failed" },
  { key: "readyForDelivery", label: "Ready" },
  { key: "outForDelivery", label: "Out for Delivery" },
];

// Every stage an order can be at, in one place. There used to be a Processing tab
// as well, showing five of these eight; the same order appeared under two headings
// and neither said anything the other did not.
function ActiveOrdersScreen({ token, onOpenOrder }: {
  token: string; onOpenOrder: (id: string, batchCount?: number) => void;
}) {
  const [groups, setGroups] = useState<Record<string, OrderSummary[]>>({});
  const [group, setGroup] = useState<string>(ACTIVE_GROUPS[0].key);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setGroups(await api.opsActive(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const orders = Array.isArray(groups[group]) ? groups[group] : [];
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={group}
        onChange={setGroup}
        options={ACTIVE_GROUPS.map((g) => ({ key: g.key, label: g.label, badge: Array.isArray(groups[g.key]) ? groups[g.key].length : 0 }))}
      />
      <Screen refreshing={busy} onRefresh={load}>
        <PageTitle title="Active orders" subtitle="Everything currently in the facility" />
        <OrderList orders={orders} onOpen={(o) => onOpenOrder(o.id, o.batchCount)} emptyText="Nothing at this stage." />
        <ErrorText error={error} />
      </Screen>
    </View>
  );
}

// ------------------------------------------------------------------ history

function HistoryScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string, batchCount?: number) => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = search.trim()
        ? await api.opsSearch(token, { q: search.trim(), state: state ?? undefined })
        : await api.opsHistory(token, { state: state ?? undefined });
      setOrders(r.orders);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, search, state]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Order history" subtitle="Completed orders stay searchable" />
      <FilterRow
        specs={[{
          key: "state", label: "Order status", allLabel: "All statuses",
          options: ["delivered", "cancelled", "pickup_failed", "disputed"]
            .map((v) => ({ value: v, label: titleCase(v) })),
        }]}
        values={{ state: state ?? undefined }}
        onChange={(next) => setState(next.state ?? null)}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Order ID, resident name or phone"
      />
      <View style={{ height: 8 }} />
      {/* A table rather than a wall of cards. History is a list you scan for one
          order among hundreds, and every card was six lines of mostly whitespace
          for a row that has seven values in it. */}
      <DataTable
        rows={orders}
        keyOf={(o) => o.id}
        onPress={(o) => onOpenOrder(o.id, o.batchCount)}
        empty="No matching orders."
        columns={[
          { key: "code", label: "Order ID", width: 118, render: (o) => <Text style={styles.cell}>{o.orderCode}</Text> },
          { key: "resident", label: "Resident", width: 130, render: (o) => orDash(o.residentName) },
          { key: "unit", label: "Flat / unit", width: 90, render: (o) => orDash(o.unitNumber) },
          { key: "society", label: "Society", width: 140, render: (o) => orDash(o.societyName) },
          { key: "garments", label: "Garments", width: 80, render: (o) => orDash(o.acceptedCount) },
          { key: "operator", label: "Operator", width: 130, render: (o) => orDash(o.operatorName) },
          { key: "state", label: "Status", width: 130, render: (o) => <StatePill state={o.state} /> },
        ]}
      />
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------- issues

function OperationsIssuesScreen({ token, issueTypes }: { token: string; issueTypes: string[] }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await api.opsIssues(token, {
        status: status === "all" ? undefined : status,
        type: typeFilter ?? undefined,
        from: date ?? undefined,
        to: date ?? undefined,
        mine: mine || undefined,
      });
      setIssues(response.issues);
      setStatuses(response.statuses ?? []);
      setCounts(response.counts ?? {});
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, typeFilter, date, mine]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!type || !description.trim()) return;
    setError(null);
    try {
      await api.opsCreateIssue({ type, description }, token);
      setDescription(""); setType(null); setReporting(false);
      await load();
    }
    catch (e) { setError((e as Error).message); }
  };

  if (openId) {
    return <OperationsTicketScreen token={token} issueId={openId} onBack={() => setOpenId(null)} onChanged={load} />;
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Support tickets"
        subtitle="Take one, answer the resident, resolve it"
        right={<Button label={reporting ? "Close" : "Report"} variant="secondary" onPress={() => setReporting(!reporting)} />}
      />

      {reporting ? (
        <Card>
          <SectionTitle>Report an issue</SectionTitle>
          <Dropdown
            label="Issue type"
            value={type ?? undefined}
            allLabel="Choose a type"
            options={issueTypes.map((t) => ({ value: t, label: titleCase(t) }))}
            onChange={(v) => setType(v ?? null)}
          />
          <Field label="Description" value={description} onChangeText={setDescription} placeholder="Describe the problem" />
          <Button label="Report to supervisor" onPress={submit} disabled={!type || !description.trim()} />
        </Card>
      ) : null}

      {/* Counts are taken before the filter, so they hold still as it narrows. */}
      <FilterRow
        specs={[
          {
            key: "status", label: "Issue status", allLabel: `All${counts.all != null ? ` (${counts.all})` : ""}`,
            options: statuses.map((v) => ({ value: v, label: issueStatusLabel(v), count: counts[v] })),
          },
          {
            key: "type", label: "Issue type", allLabel: "Any type",
            options: issueTypes.map((t) => ({ value: t, label: titleCase(t) })),
          },
          {
            key: "mine", label: "Ownership", allLabel: "Everybody's",
            options: [{ value: "mine", label: "Tickets I have taken" }],
          },
        ]}
        values={{
          status: status === "all" ? undefined : status,
          type: typeFilter ?? undefined,
          mine: mine ? "mine" : undefined,
        }}
        onChange={(next) => {
          setStatus(next.status ?? "all");
          setTypeFilter(next.type ?? null);
          setMine(next.mine === "mine");
        }}
        onClear={() => setDate(null)}
        extra={<DateField label="Raised on" value={date} onChange={setDate} placeholder="Any date" />}
      />

      <View style={{ height: 8 }} />
      {issues.length
        ? issues.map((i) => (
            <Card key={i.id} onPress={() => setOpenId(i.id)}>
              <View style={styles.headRow}>
                <Text style={styles.code}>{titleCase(i.category)}</Text>
                <Pill text={issueStatusLabel(i.status)} color={issueStatusColour(i.status)} />
              </View>
              <Text style={styles.muted}>{i.description}</Text>
              <Row label="Order" value={i.order?.orderCode ?? "-"} />
              <Row label="Resident" value={i.residentName ?? "-"} />
              <Row label="Raised" value={shortDate(i.createdAt)} />
            </Card>
          ))
        : <Empty text={status === "all" && !typeFilter && !date && !mine ? "No tickets." : "No tickets match that filter."} />}
      <ErrorText error={error} />
    </Screen>
  );
}

// Working one ticket: what it is about, the whole conversation, and the actions the
// operator may take on it.
// The ticket, and the one thing anybody does with it.
//
// Take this ticket, Start working on it, Ask the resident for more, a Resolve box,
// "Cannot resolve it?" with an escalation reason, Close ticket — seven buttons for
// one conversation, six of them bookkeeping somebody had to remember to do, and the
// escalation ones asking an operator to explain themselves in a text field before
// anything moved. What reaches the resident is the reply. The status follows the
// conversation, and escalation is a supervisor's or an admin's workflow, not six
// buttons on the screen where the work is.
function OperationsTicketScreen({ token, issueId, onBack, onChanged }: {
  token: string; issueId: string; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const [issue, setIssue] = useState<Issue | null>(null);
  // The conversation as this operator sees it. After escalating they keep the whole
  // thread and lose the reply box, which the backend decides rather than the screen.
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [detail, thread] = await Promise.all([
        api.opsIssue(issueId, token),
        api.issueConversation(issueId, token),
      ]);
      setIssue(detail.issue);
      setConversation(thread.conversation);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, issueId]);
  useEffect(() => { load(); }, [load]);

  const reply = async (body: string) => {
    setError(null); setNote(null);
    try {
      const result = await api.opsReplyToIssue(issueId, body, token);
      setIssue(result.issue);
      setNote("Reply sent.");
      await load();
      await onChanged();
    }
    catch (e) { setError((e as Error).message); }
  };

  // Handing it on. The backend records who escalated it and when, moves the issue
  // to the supervisor, and takes the reply box away from this operator on the next
  // load — none of which the screen decides.
  const escalate = async (why: string) => {
    setError(null); setNote(null);
    try {
      const result = await api.opsEscalateIssue(issueId, why, token);
      setIssue(result.issue);
      setNote("Escalated. The supervisor answers the resident from here.");
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
      // Rethrown so the dialog stays open with the reason showing, rather than
      // closing as though the issue had moved.
      throw e;
    }
  };

  if (busy && !issue) return <Loading />;
  if (!issue) return <Screen><BackLink label="Tickets" onPress={onBack} /><ErrorText error={error} /></Screen>;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Tickets" onPress={onBack} />
      <TicketDetail issue={issue} audience="staff" conversation={conversation}>
        <EscalationNote issue={issue} />
        {issue.status !== "closed"
          ? <ReplyBox conversation={conversation} onSend={reply} />
          : <Notice text="This ticket is closed. Nothing further can be added to it." />}
        {/* Beside the reply rather than instead of it: an operator who can still
            help should still be able to, and the two are different acts. */}
        <EscalateBox issue={issue} onEscalate={escalate} />
      </TicketDetail>
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

function issueStatusLabel(status: string): string {
  if (status === "all") return "All";
  return ISSUE_STATUS_LABEL[status as IssueStatus] ?? titleCase(status);
}

function issueStatusColour(status: string): string {
  return ISSUE_STATUS_COLOR[status as IssueStatus] ?? theme.danger;
}

// ------------------------------------------------------------------ profile

function OperationsProfileScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<StaffUser | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setProfile((await api.opsProfile(token)).profile); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Operations profile" />
      <Card>
        <Row label="Name" value={profile?.fullName} />
        <Row label="Employee ID" value={profile?.employeeId} />
        <Row label="Phone" value={profile?.phone} />
        <Row label="Role" value="Operations" />
        <Row label="Assigned society" value={profile?.societyName ?? "No society assigned"} />
        {/* An empty assignment used to render as a bare dash, which does not say
            whether it is missing or still loading. Blocks are the assignment now,
            so none means no work rather than all of it. */}
        <Row
          label="Assigned blocks"
          value={profile?.blockNames?.length ? profile.blockNames.join(", ") : "No blocks assigned"}
        />
        <Row label="Assigned supervisor" value={profile?.supervisorName ?? "Not assigned"} />
        <Row label="Account status" value={profile ? titleCase(profile.status) : "—"} />
        <Row label="Verification" value={profile?.verificationStatus ? titleCase(profile.verificationStatus) : "Approved"} />
        <Row label="Assignment last updated" value={dateTime(profile?.assignmentUpdatedAt)} />
        <Row label="Last login" value={dateTime(profile?.lastLoginAt)} />
      </Card>
      <Notice text="Your area and society assignment is managed by your supervisor. Ask them if something here is wrong." />
      <ErrorText error={error} />
      <Button label="Sign out" variant="danger" onPress={onLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  offlineBar: {
    backgroundColor: theme.feedback.warningTint,
    borderBottomWidth: border.hairline,
    borderBottomColor: theme.feedback.warningText,
    paddingVertical: space.snug,
    paddingHorizontal: space.page,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  offlineText: { ...type.caption, color: theme.feedback.warningText, fontFamily: font.semi },
  offlineSync: {
    ...type.caption, color: theme.feedback.warningText, fontFamily: font.black,
    textDecorationLine: "underline",
    minHeight: size.control.sm, textAlignVertical: "center",
  },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  muted: { fontSize: 12, color: theme.muted, flexShrink: 1, textAlign: "right" },
  code: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal },
  claimRow: { marginTop: -6, marginBottom: 12 },
  meta: { fontSize: 12, color: theme.muted, marginBottom: 4 },
  cell: { fontSize: 13, color: theme.slate },
});
