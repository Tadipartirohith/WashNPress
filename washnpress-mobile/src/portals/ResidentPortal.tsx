import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api, ApiError } from "../api/client";
import type { OrderDetail, OrderSummary, ResidentDashboard, ResidentProfile, Slot, SubscriptionUsage, Plan, Notification, SupportTicket, WalletTransaction } from "../api/types";
import { theme, rupees, shortDate, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Meter, Pill, BackLink, Counter, ChoiceChips,
} from "../components/ui";
import { OrderCard, OrderDetailBody } from "../components/order";

type Tab = "home" | "book" | "orders" | "plan" | "wallet" | "support" | "alerts" | "profile";

export function ResidentPortal({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(async () => {
    try { setUnread((await api.notifications(token, true)).notifications.length); } catch { /* badge only */ }
  }, [token]);

  useEffect(() => { refreshUnread(); }, [refreshUnread]);

  if (openOrderId) {
    return <ResidentOrderScreen token={token} orderId={openOrderId} onBack={() => setOpenOrderId(null)} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={(next) => setTab(next)}
        options={[
          { key: "home", label: "Home" },
          { key: "book", label: "Book" },
          { key: "orders", label: "Orders" },
          { key: "plan", label: "Plan" },
          { key: "wallet", label: "Wallet" },
          { key: "support", label: "Support" },
          { key: "alerts", label: "Alerts", badge: unread },
          { key: "profile", label: "Profile" },
        ]}
      />
      {tab === "home" && <ResidentHome token={token} onOpenOrder={setOpenOrderId} onBook={() => setTab("book")} onAlerts={() => setTab("alerts")} />}
      {tab === "book" && <BookPickupScreen token={token} onBooked={(id) => { setOpenOrderId(id); }} />}
      {tab === "orders" && <ResidentOrdersScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "plan" && <SubscriptionScreen token={token} />}
      {tab === "wallet" && <WalletScreen token={token} />}
      {tab === "support" && <SupportScreen token={token} />}
      {tab === "alerts" && <NotificationsScreen token={token} onChanged={refreshUnread} onOpenOrder={setOpenOrderId} />}
      {tab === "profile" && <ProfileScreen token={token} onLogout={onLogout} />}
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function ResidentHome({ token, onOpenOrder, onBook, onAlerts }: { token: string; onOpenOrder: (id: string) => void; onBook: () => void; onAlerts: () => void }) {
  const [data, setData] = useState<ResidentDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.residentDashboard(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !data) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title={`Welcome back${data?.residentName ? `, ${data.residentName}` : ""}`} subtitle="Your account at a glance" />
      <ErrorText error={error} />

      {data?.pendingAdditionalChargesPaise ? (
        <Notice tone="warn" text={`You have ${rupees(data.pendingAdditionalChargesPaise)} of additional garment charges pending. Top up your wallet to settle them.`} />
      ) : null}

      {data?.subscription ? (
        <>
          <SectionTitle>Current plan</SectionTitle>
          <Card>
            <View style={styles.planHead}>
              <Text style={styles.planTier}>{data.subscription.planTier.toUpperCase()}</Text>
              <Pill text={titleCase(data.subscription.status)} color={theme.success} />
            </View>
            <Text style={styles.planPrice}>{rupees(data.subscription.monthlyPaise)} / month</Text>
            <Text style={styles.planMeta}>{data.subscription.allowance} garments · {data.subscription.turnaroundHours}h turnaround</Text>
            <Meter percent={data.subscription.usedPercent} />
            <Row label="Used" value={data.subscription.used} />
            <Row label="Remaining" value={data.subscription.remaining} />
            <Row label="Next renewal" value={shortDate(data.subscription.renewalDate)} />
          </Card>
        </>
      ) : (
        <Notice text="You do not have an active plan. Every garment collected will be billed as additional." />
      )}

      {data?.upcomingPickup ? (
        <>
          <SectionTitle>Upcoming pickup</SectionTitle>
          <Card onPress={data.upcomingPickup.orderId ? () => onOpenOrder(data.upcomingPickup!.orderId!) : undefined}>
            <Row label="Order" value={data.upcomingPickup.orderCode} />
            <Row label="Society" value={data.upcomingPickup.societyName} />
            <Row label="Date" value={shortDate(data.upcomingPickup.date)} />
            <Row label="Time" value={data.upcomingPickup.startTime ? `${data.upcomingPickup.startTime} – ${data.upcomingPickup.endTime}` : "—"} />
            <Row label="Status" value={titleCase(data.upcomingPickup.status)} />
          </Card>
        </>
      ) : null}

      <SectionTitle>Current order</SectionTitle>
      {data?.currentOrder
        ? <OrderCard order={data.currentOrder} showSociety={false} onPress={() => onOpenOrder(data.currentOrder!.id)} />
        : <Empty text="No order is being processed right now." />}

      <Button label="Schedule a pickup" onPress={onBook} />

      <SectionTitle>Wallet</SectionTitle>
      <Card><Row label="Balance" value={rupees(data?.walletBalancePaise ?? 0)} /></Card>

      <SectionTitle action={data?.unreadNotifications ? <Pill text={`${data.unreadNotifications} new`} color={theme.amber} /> : undefined}>Notifications</SectionTitle>
      {data?.notifications?.length
        ? data.notifications.slice(0, 4).map((n) => <NotificationCard key={n.id} notification={n} onPress={onAlerts} />)
        : <Empty text="Nothing new." />}

      <SectionTitle>Recent orders</SectionTitle>
      {data?.recentOrders?.length
        ? data.recentOrders.map((o) => <OrderCard key={o.id} order={o} showSociety={false} onPress={() => onOpenOrder(o.id)} />)
        : <Empty text="No orders yet." />}
    </Screen>
  );
}

// ------------------------------------------------------------------- booking

function BookPickupScreen({ token, onBooked }: { token: string; onBooked: (orderId: string) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [estimate, setEstimate] = useState(0);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.bookingPreview>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError(null); setSelected(null); setPreview(null);
    try { setSlots((await api.getSlots(date, token)).slots); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [date, token]);
  useEffect(() => { load(); }, [load]);

  const choose = async (slot: Slot) => {
    setSelected(slot); setError(null);
    try { setPreview(await api.bookingPreview(slot.id, estimate || undefined, token)); }
    catch (e) { setError((e as Error).message); }
  };

  const confirm = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const r = await api.bookPickup({ slotId: selected.id, estimatedCount: estimate || undefined, specialInstructions: instructions || undefined }, token);
      onBooked(r.order.id);
    } catch (e) {
      // A slot can fill up between loading the page and confirming. The booking
      // fails cleanly and the list is reloaded rather than overselling capacity.
      setError((e as ApiError).code === "slot_unavailable" ? "That slot just filled up. Please choose another." : (e as Error).message);
      await load();
    } finally { setBusy(false); }
  };

  // The confirmation step, shown before the booking is committed.
  if (selected && preview) {
    return (
      <Screen>
        <BackLink label="Slots" onPress={() => { setSelected(null); setPreview(null); }} />
        <PageTitle title="Confirm pickup" subtitle="Check the details before booking" />
        <Card>
          <Row label="Society" value={preview.society.name} />
          <Row label="Pickup address" value={preview.pickupAddress} />
          <Row label="Date" value={shortDate(preview.slot.date)} />
          <Row label="Slot" value={`${preview.slot.startTime} – ${preview.slot.endTime}`} />
          <Row label="Slots available" value={preview.slot.available} />
        </Card>

        <SectionTitle>Your plan</SectionTitle>
        <Card>
          <Row label="Current plan" value={preview.subscription?.planTier ?? "No active plan"} />
          <Row label="Remaining allowance" value={preview.subscription ? `${preview.subscription.remaining} garments` : "0"} />
          <Row label="Estimated garments" value={estimate || "Not given"} />
          <Row label="Additional garment rate" value={rupees(preview.additionalGarmentRatePaise)} />
        </Card>
        <Notice text={preview.note} />

        <Field label="Special instructions (optional)" value={instructions} onChangeText={setInstructions} placeholder="Doorbell not working, call on arrival" />
        <Button label="Confirm booking" onPress={confirm} disabled={busy} />
        <Button label="Change slot" variant="secondary" onPress={() => { setSelected(null); setPreview(null); }} />
        <ErrorText error={error} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Schedule a pickup" subtitle="Slots for your society only" />
      <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      <SectionTitle>Estimated garments (optional)</SectionTitle>
      <Counter label="Garments" value={estimate} onChange={setEstimate} />
      <Notice text="The final quantity is recorded by the operator at pickup, and your plan usage is calculated from that." />

      <SectionTitle>Available slots</SectionTitle>
      {busy && !slots.length ? <Loading /> : null}
      {!busy && !slots.length ? <Empty text="No slots available for this date." /> : null}
      {slots.map((slot) => (
        <Card key={slot.id} onPress={slot.capacityRemaining > 0 ? () => choose(slot) : undefined}>
          <View style={styles.slotRow}>
            <View>
              <Text style={styles.slotTime}>{slot.startTime} – {slot.endTime}</Text>
              <Text style={styles.slotMeta}>{slot.window}</Text>
            </View>
            {slot.capacityRemaining > 0
              ? <Pill text={`${slot.capacityRemaining} available`} color={theme.success} />
              : <Pill text="FULL" color={theme.danger} />}
          </View>
        </Card>
      ))}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------------- orders

function ResidentOrdersScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [group, setGroup] = useState<"current" | "upcoming" | "previous">("current");
  const [data, setData] = useState<{ current: OrderSummary[]; upcoming: OrderSummary[]; previous: OrderSummary[] } | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.residentOrders(token, { orderCode: search || undefined });
      setData({ current: r.current ?? [], upcoming: r.upcoming ?? [], previous: r.previous ?? [] });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, search]);
  useEffect(() => { load(); }, [load]);

  const orders = data ? data[group] : [];
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="My orders" subtitle="Current, upcoming and previous" />
      <Field label="Search by order id" value={search} onChangeText={setSearch} placeholder="ORD-756272" />
      <View style={styles.groupRow}>
        {(["current", "upcoming", "previous"] as const).map((key) => (
          <Pill key={key} text={`${titleCase(key)} (${data ? data[key].length : 0})`} color={group === key ? theme.aqua : theme.muted} />
        ))}
      </View>
      <Tabs
        value={group}
        onChange={setGroup}
        options={[
          { key: "current", label: "Current / Active" },
          { key: "upcoming", label: "Upcoming" },
          { key: "previous", label: "Previous" },
        ]}
      />
      <View style={{ height: 12 }} />
      {orders.length ? orders.map((o) => <OrderCard key={o.id} order={o} showSociety={false} onPress={() => onOpenOrder(o.id)} />) : <Empty text="Nothing in this group." />}
      <ErrorText error={error} />
    </Screen>
  );
}

function ResidentOrderScreen({ token, orderId, onBack }: { token: string; orderId: string; onBack: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setOrder((await api.residentOrder(orderId, token)).order); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  const pay = async () => {
    setNote(null);
    try {
      const r = await api.payAdditionalCharge(orderId, token);
      setOrder(r.order);
      setNote("Additional charge settled from your wallet.");
    } catch (e) {
      setNote((e as ApiError).code === "insufficient_balance" ? "Not enough wallet balance. Top up and try again." : (e as Error).message);
    }
  };

  if (busy && !order) return <Loading />;
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Back" onPress={onBack} />
      <ErrorText error={error} />
      {order ? (
        <>
          <OrderDetailBody order={order} audience="resident" />
          {order.additionalChargeStatus === "pending" || order.additionalChargeStatus === "failed" ? (
            <Button label={`Pay ${rupees(order.additionalChargePaise)} from wallet`} onPress={pay} />
          ) : null}
          {note ? <Notice text={note} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

// -------------------------------------------------------------- subscription

function SubscriptionScreen({ token }: { token: string }) {
  const [current, setCurrent] = useState<SubscriptionUsage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.residentSubscription(token);
      setCurrent(r.current); setPlans(r.availablePlans);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const act = async (plan: Plan) => {
    setNote(null); setError(null);
    try {
      if (!current) { await api.subscribe(plan.id, "monthly", token); setNote(`Subscribed to ${plan.tier}.`); }
      else { const r = await api.changePlan(plan.id, token); setNote(`${r.note}. Proration ${rupees(r.prorationPaise)}.`); }
      await load();
    } catch (e) {
      setError((e as ApiError).code === "insufficient_balance" ? "Top up your wallet to subscribe." : (e as Error).message);
    }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Subscription" subtitle="Your plan and usage" />
      <SectionTitle>Current plan</SectionTitle>
      {current ? (
        <Card>
          <View style={styles.planHead}>
            <Text style={styles.planTier}>{current.planTier.toUpperCase()}</Text>
            <Pill text={titleCase(current.status)} color={theme.success} />
          </View>
          <Text style={styles.planPrice}>{rupees(current.monthlyPaise)} / month</Text>
          <Row label="Garment allowance" value={current.allowance} />
          <Row label="Turnaround time" value={`${current.turnaroundHours} hours`} />
          <Row label="Used garments" value={current.used} />
          <Row label="Remaining garments" value={current.remaining} />
          <Meter percent={current.usedPercent} />
          <Text style={styles.meterText}>{current.usedPercent}% used</Text>
          <Row label="Start date" value={shortDate(current.cycleStart)} />
          <Row label="Renewal date" value={shortDate(current.renewalDate)} />
          <Row label="Expiry date" value={shortDate(current.expiryDate)} />
          {current.pendingPlanId ? <Notice text="A plan change is scheduled for your next cycle." /> : null}
        </Card>
      ) : <Empty text="No active plan." />}

      <SectionTitle>Available plans</SectionTitle>
      {plans.map((plan) => (
        <Card key={plan.id}>
          <View style={styles.planHead}>
            <Text style={styles.planTier}>{plan.tier}</Text>
            {plan.isCurrent ? <Pill text="✓ CURRENT PLAN" color={theme.success} /> : null}
          </View>
          <Text style={styles.planMeta}>{plan.garmentCap} garments · {plan.turnaroundHours}h turnaround</Text>
          <Text style={styles.planPrice}>{rupees(plan.monthlyPaise)} / month</Text>
          {!plan.isCurrent ? (
            <Button
              label={!current ? "Subscribe" : (current.monthlyPaise < plan.monthlyPaise ? "Upgrade" : "Downgrade")}
              variant="secondary"
              onPress={() => act(plan)}
            />
          ) : null}
        </Card>
      ))}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------------- wallet

function WalletScreen({ token }: { token: string }) {
  const [balance, setBalance] = useState("—");
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [w, t] = await Promise.all([api.getWallet(token), api.walletTransactions(token)]);
      setBalance(w.balanceFormatted);
      setTransactions(t.transactions);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const topUp = async () => {
    setNote(null);
    try {
      const r = await api.startTopUp(Math.round(Number(amount) * 100), token);
      setNote(`Payment order ${r.paymentOrder.providerOrderId} created for ${rupees(r.paymentOrder.amountPaise)}. Complete it in your payment app; the wallet is credited by the verified webhook.`);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Wallet" subtitle="Balance, credits, debits and refunds" />
      <Card style={{ backgroundColor: theme.deepTeal }}>
        <Text style={styles.walletLabel}>Wallet balance</Text>
        <Text style={styles.walletValue}>{balance}</Text>
      </Card>
      <Field label="Top up amount (rupees)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
      <Button label="Start top up" onPress={topUp} disabled={!amount} />
      {note ? <Notice text={note} /> : null}

      <SectionTitle>Transactions</SectionTitle>
      {transactions.length ? transactions.map((t, i) => (
        <Card key={`${t.reference}-${i}`}>
          <View style={styles.txnRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.txnRef}>{describeReference(t.reference)}</Text>
              <Text style={styles.txnAt}>{dateTime(t.at)}</Text>
            </View>
            <Text style={[styles.txnAmount, { color: t.direction === "credit" ? theme.success : theme.danger }]}>
              {t.direction === "credit" ? "+" : "−"} {rupees(t.amountPaise)}
            </Text>
          </View>
        </Card>
      )) : <Empty text="No transactions yet." />}
      <ErrorText error={error} />
    </Screen>
  );
}

function describeReference(reference: string): string {
  if (reference.startsWith("addl-garments-")) return "Additional garment charge";
  if (reference.startsWith("sub-")) return "Subscription payment";
  if (reference.startsWith("evt")) return "Wallet credit";
  return reference;
}

// ------------------------------------------------------------------- support

const RESIDENT_ISSUE_TYPES: string[] = [
  "pickup_failed", "missing_garment", "damaged_garment", "garment_quantity_mismatch",
  "delivery_issue", "payment_issue", "subscription_issue", "resident_complaint",
];

function SupportScreen({ token }: { token: string }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [type, setType] = useState(RESIDENT_ISSUE_TYPES[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setTickets((await api.listTickets(token)).tickets); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setError(null);
    try { await api.createTicket(type, description, undefined, token); setDescription(""); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Support" subtitle="Raise and track your issues" />
      <SectionTitle>Raise an issue</SectionTitle>
      <ChoiceChips options={RESIDENT_ISSUE_TYPES} value={type} onChange={setType} labelOf={titleCase} />
      <Field label="What happened?" value={description} onChangeText={setDescription} placeholder="Describe the issue" />
      <Button label="Submit issue" onPress={submit} disabled={!description.trim()} />

      <SectionTitle>My tickets</SectionTitle>
      {tickets.length ? tickets.map((t) => (
        <Card key={t.id}>
          <View style={styles.planHead}>
            <Text style={styles.ticketType}>{titleCase(t.category)}</Text>
            <Pill text={titleCase(t.status)} color={t.status === "resolved" ? theme.success : theme.amber} />
          </View>
          <Text style={styles.ticketBody}>{t.description}</Text>
          <Text style={styles.txnAt}>Ticket {t.id.slice(0, 8)} · {dateTime(t.createdAt)}</Text>
        </Card>
      )) : <Empty text="No tickets raised." />}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------- notifications

function NotificationCard({ notification, onPress }: { notification: Notification; onPress?: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.planHead}>
        <Text style={styles.notifTitle}>{notification.title}</Text>
        {!notification.read ? <Pill text="NEW" color={theme.amber} /> : null}
      </View>
      <Text style={styles.notifBody}>{notification.body}</Text>
      <Text style={styles.txnAt}>{dateTime(notification.createdAt)}</Text>
    </Card>
  );
}

function NotificationsScreen({ token, onChanged, onOpenOrder }: { token: string; onChanged: () => void; onOpenOrder: (id: string) => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await api.notifications(token)).notifications); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const open = async (n: Notification) => {
    if (!n.read) { await api.markNotificationRead(n.id, token); onChanged(); await load(); }
    if (n.orderId) onOpenOrder(n.orderId);
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Notifications"
        right={<Button label="Mark all read" variant="secondary" onPress={async () => { await api.markAllNotificationsRead(token); onChanged(); await load(); }} />}
      />
      {items.length ? items.map((n) => <NotificationCard key={n.id} notification={n} onPress={() => open(n)} />) : <Empty text="No notifications." />}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------- profile

function ProfileScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<ResidentProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.residentProfile(token);
      setProfile(r.profile);
      setFullName(r.profile.fullName ?? "");
      setEmail(r.profile.email ?? "");
      setPickupAddress(r.profile.pickupAddress ?? "");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setNote(null); setError(null);
    try { await api.updateResidentProfile({ fullName, email, pickupAddress }, token); setNote("Profile updated."); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Profile" />
      <Card>
        <Row label="Phone" value={profile?.phone} />
        <Row label="Society" value={profile?.societyName} />
        <Row label="Flat / unit" value={profile?.unitNumber} />
        <Row label="Account status" value={profile ? titleCase(profile.accountStatus ?? "") : "—"} />
        <Row label="Onboarding" value={profile?.onboardingCompleted ? "Completed" : "Pending"} />
      </Card>
      <Notice text="Your society and flat are managed by the Wash N Press team. Contact support if they need to change." />
      <Field label="Full name" value={fullName} onChangeText={setFullName} />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Pickup address" value={pickupAddress} onChangeText={setPickupAddress} />
      <Button label="Save changes" onPress={save} />
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
      <Button label="Sign out" variant="danger" onPress={onLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  planHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  planTier: { fontSize: 17, fontWeight: "800", color: theme.deepTeal },
  planPrice: { fontSize: 20, fontWeight: "800", color: theme.aqua, marginTop: 4 },
  planMeta: { fontSize: 12, color: theme.muted, marginTop: 2 },
  meterText: { fontSize: 11, color: theme.muted, marginTop: 4, textAlign: "right" },
  slotRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  slotTime: { fontSize: 16, fontWeight: "700", color: theme.deepTeal },
  slotMeta: { fontSize: 12, color: theme.muted, marginTop: 2 },
  groupRow: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 4 },
  walletLabel: { color: theme.ice, fontSize: 12 },
  walletValue: { color: theme.white, fontSize: 28, fontWeight: "800", marginTop: 2 },
  txnRow: { flexDirection: "row", alignItems: "center" },
  txnRef: { fontSize: 14, fontWeight: "600", color: theme.slate },
  txnAt: { fontSize: 11, color: theme.muted, marginTop: 2 },
  txnAmount: { fontSize: 15, fontWeight: "800" },
  ticketType: { fontSize: 14, fontWeight: "700", color: theme.deepTeal },
  ticketBody: { fontSize: 13, color: theme.slate, marginTop: 6 },
  notifTitle: { fontSize: 14, fontWeight: "700", color: theme.deepTeal, flex: 1 },
  notifBody: { fontSize: 13, color: theme.slate, marginTop: 4 },
});
