import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { GarmentItem, GarmentSummary, Issue, OperationsDashboard, OrderDetail, OrderSummary, PickupQueueItem, StaffUser } from "../api/types";
import type { OfflineQueue } from "../offline/queue";
import { theme, rupees, shortDate, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, StatePill, BackLink, Counter, Stat, StatGrid, ChoiceChips,
} from "../components/ui";
import { OrderCard, OrderList, OrderDetailBody, IssueCard } from "../components/order";
import { usePolling, POLL } from "../hooks";

type Tab = "home" | "pickups" | "queue" | "active" | "history" | "issues" | "profile";

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

  if (openOrderId) {
    return (
      <OperationsOrderScreen
        token={token} orderId={openOrderId} categories={categories} issueTypes={issueTypes}
        queue={queue} onQueued={refreshPending} onBack={() => setOpenOrderId(null)}
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
          { key: "queue", label: "Unassigned" },
          { key: "active", label: "Active" },
          { key: "history", label: "History" },
          { key: "issues", label: "Issues" },
          { key: "profile", label: "Profile" },
        ]}
      />
      {tab === "home" && <OperationsHome token={token} onGoto={setTab} />}
      {tab === "pickups" && <PickupQueueScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "queue" && <SharedQueueScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "active" && <ActiveOrdersScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "history" && <HistoryScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "issues" && <OperationsIssuesScreen token={token} issueTypes={issueTypes} />}
      {tab === "profile" && <OperationsProfileScreen token={token} onLogout={onLogout} />}
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function OperationsHome({ token, onGoto }: { token: string; onGoto: (tab: Tab) => void }) {
  const [data, setData] = useState<OperationsDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.opsDashboard(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.worklist);

  if (busy && !data) return <Loading />;
  const o = data?.orders;
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Operations"
        subtitle={data?.area ? `${data.area.name} · ${data.societies.map((s) => s.name).join(", ")}` : "No area assigned"}
      />
      <ErrorText error={error} />
      <SectionTitle>Pickups</SectionTitle>
      <StatGrid>
        <Stat label="Today's pickups" value={data?.todaysPickups ?? 0} onPress={() => onGoto("pickups")} />
        <Stat label="Pending pickup" value={o?.scheduled ?? 0} onPress={() => onGoto("pickups")} />
        <Stat label="Picked up" value={o?.pickedUp ?? 0} onPress={() => onGoto("active")} />
      </StatGrid>

      <SectionTitle>Processing</SectionTitle>
      <StatGrid>
        <Stat label="Washing pending" value={o?.washingPending ?? 0} onPress={() => onGoto("active")} />
        <Stat label="Washing" value={o?.washing ?? 0} onPress={() => onGoto("active")} />
        <Stat label="Ironing pending" value={o?.ironingPending ?? 0} onPress={() => onGoto("active")} />
        <Stat label="Ironing" value={o?.ironing ?? 0} onPress={() => onGoto("active")} />
        <Stat label="QC pending" value={o?.qcPending ?? 0} tone="warn" onPress={() => onGoto("active")} />
        <Stat label="QC failed" value={o?.qcFailed ?? 0} tone="danger" onPress={() => onGoto("active")} />
      </StatGrid>

      <SectionTitle>Delivery</SectionTitle>
      <StatGrid>
        <Stat label="Ready for delivery" value={o?.readyForDelivery ?? 0} tone="good" onPress={() => onGoto("active")} />
        <Stat label="Out for delivery" value={o?.outForDelivery ?? 0} onPress={() => onGoto("active")} />
        <Stat label="Delivered" value={o?.delivered ?? 0} tone="good" onPress={() => onGoto("history")} />
      </StatGrid>

      <SectionTitle>Attention</SectionTitle>
      <StatGrid>
        <Stat label="Delayed orders" value={o?.delayed ?? 0} tone="danger" onPress={() => onGoto("active")} />
        <Stat label="Failed pickups" value={o?.failedPickups ?? 0} tone="danger" onPress={() => onGoto("history")} />
        <Stat label="Open issues" value={data?.openIssues ?? 0} tone="warn" onPress={() => onGoto("issues")} />
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

function PickupQueueScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
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
      <Field label="Date (leave empty for everything pending)" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      {date ? <Button label="Show everything pending" variant="secondary" onPress={() => setDate("")} /> : null}
      <View style={{ height: 8 }} />
      {pickups.length ? pickups.map((p) => (
        <Card key={p.pickupId} onPress={p.orderId ? () => onOpenOrder(p.orderId!) : undefined}>
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
// back here, so a batch is never stuck behind one person being unavailable.
function SharedQueueScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
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
          <OrderCard order={order} onPress={() => onOpenOrder(order.id)} />
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

function OperationsOrderScreen({ token, orderId, categories, issueTypes, queue, onQueued, onBack }: {
  token: string; orderId: string; categories: string[]; issueTypes: string[];
  queue: OfflineQueue; onQueued: () => void; onBack: () => void;
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
              <Notice text="Process each split as the resident asked. The quantities below are what they expected; enter what you actually receive." />
              <Card>
                {order.lines.map((line) => (
                  <Row key={line.id} label={`${line.category} × ${line.quantity}`} value={line.serviceName} />
                ))}
              </Card>
            </>
          ) : null}

          <SectionTitle>Garment entry</SectionTitle>
          <Notice text="Enter the actual garments received. The subscription split and any additional charge are calculated by the system." />
          {categories.map((category) => (
            <Counter key={category} label={category} value={counts[category] ?? 0} onChange={(next) => setCounts((s) => ({ ...s, [category]: next }))} />
          ))}
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
          <ChoiceChips options={PICKUP_FAILURE_REASONS} value={failureReason} onChange={setFailureReason} />
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
              <ChoiceChips options={QC_FAILURE_REASONS} value={qcReason} onChange={setQcReason} />
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
          <ChoiceChips options={issueTypes} value={issueType} onChange={setIssueType} labelOf={titleCase} />
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

function ActiveOrdersScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [groups, setGroups] = useState<Record<string, OrderSummary[]>>({});
  const [group, setGroup] = useState<string>("pickedUp");
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
        <OrderList orders={orders} onOpen={(o) => onOpenOrder(o.id)} emptyText="Nothing at this stage." />
        <ErrorText error={error} />
      </Screen>
    </View>
  );
}

// ------------------------------------------------------------------ history

function HistoryScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
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
      <Field label="Search by order id, resident name or phone" value={search} onChangeText={setSearch} placeholder="ORD-756272" />
      <ChoiceChips
        options={["delivered", "cancelled", "pickup_failed", "disputed"]}
        value={state}
        onChange={(next) => setState(next === state ? null : next)}
        labelOf={titleCase}
      />
      <View style={{ height: 8 }} />
      <OrderList orders={orders} onOpen={(o) => onOpenOrder(o.id)} emptyText="No matching orders." />
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------- issues

function OperationsIssuesScreen({ token, issueTypes }: { token: string; issueTypes: string[] }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setIssues((await api.opsIssues(token, status ?? undefined)).issues); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!type || !description.trim()) return;
    setError(null);
    try { await api.opsCreateIssue({ type, description }, token); setDescription(""); setType(null); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Issues and exceptions" subtitle="Reported to your supervisor" />
      <SectionTitle>Report an issue</SectionTitle>
      <ChoiceChips options={issueTypes} value={type} onChange={setType} labelOf={titleCase} />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Describe the problem" />
      <Button label="Report" onPress={submit} disabled={!type || !description.trim()} />

      <SectionTitle>Open and recent</SectionTitle>
      <ChoiceChips options={["open", "under_review", "resolved"]} value={status} onChange={(next) => setStatus(next === status ? null : next)} labelOf={titleCase} />
      <View style={{ height: 8 }} />
      {issues.length ? issues.map((i) => <IssueCard key={i.id} issue={i} />) : <Empty text="No issues." />}
      <ErrorText error={error} />
    </Screen>
  );
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
        <Row label="Assigned area" value={profile?.areaName} />
        <Row label="Assigned societies" value={profile?.societyNames?.join(", ")} />
        <Row label="Account status" value={profile ? titleCase(profile.status) : "—"} />
        <Row label="Last login" value={dateTime(profile?.lastLoginAt)} />
      </Card>
      <Notice text="Your area and society assignment is managed by your supervisor." />
      <ErrorText error={error} />
      <Button label="Sign out" variant="danger" onPress={onLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  offlineBar: { backgroundColor: theme.amber, paddingVertical: 8, paddingHorizontal: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  offlineText: { color: "#3a2a00", fontWeight: "600", fontSize: 12 },
  offlineSync: { color: "#3a2a00", fontWeight: "800", fontSize: 12, textDecorationLine: "underline" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  muted: { fontSize: 12, color: theme.muted, flexShrink: 1, textAlign: "right" },
  code: { fontSize: 15, fontWeight: "800", color: theme.deepTeal },
  claimRow: { marginTop: -6, marginBottom: 12 },
});
