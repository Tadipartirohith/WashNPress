import { useCallback, useEffect, useState } from "react";
import { themed } from "../components/themed";
import { AppearanceIcons } from "../components/appearance-setting";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { api, ApiError } from "../api/client";
import { Dropdown } from "../components/filters";
import { CenteredModal } from "../components/modal";
import { DateField, todayIso } from "../components/calendar";
import type {
  OrderDetail, OrderSummary, ResidentDashboard, ResidentProfile, Slot, SubscriptionUsage, Plan,
  Notification, SupportTicket, WalletTransaction, IssuePriority, ConversationView,
  PlanChangeQuote, ServiceRequestView, ServiceOffering, ServiceDateSlot,
} from "../api/types";
import { font, theme, rupees, shortDate, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, BackLink, Counter,
} from "../components/ui";
import { BottomTabBar, MoreMenu, type BottomTabItem, type MoreMenuSection } from "../components/bottom-nav";
import { StepIndicator } from "../components/modal";
import { OrderCard, OrderDetailBody } from "../components/order";
import { IssueRow, TicketDetail, TicketPhotos, ReplyBox, ComposeAttachments, type PickedPhoto } from "../components/support";
import { summaryLine, expectedBack, lineCoverage, totalQuantity, hasCostToShow } from "./booking-summary-rules";
import { usePolling, POLL } from "../hooks";
import { SchedulesScreen, ServicesScreen } from "./resident-extras";
import { pushUnavailableReason } from "../push";
import { MetaStrip } from "../components/dashboard";

type Tab = "home" | "book" | "services" | "orders" | "plan" | "wallet" | "support" | "alerts" | "profile" | "more";

// The four a resident reaches for most — booking, tracking, and paying — plus
// the catch-all fifth slot. Everything else (services, plan, support, alerts,
// profile) lives one tap further in, behind "More".
const RESIDENT_PRIMARY: readonly Tab[] = ["home", "book", "orders", "wallet"];

export function ResidentPortal({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  // Kept here so the support screen can offer the resident's own orders to attach.
  const [recentOrders, setRecentOrders] = useState<OrderSummary[]>([]);

  const refreshUnread = useCallback(async () => {
    try { setUnread((await api.notifications(token, true)).notifications.length); } catch { /* badge only */ }
  }, [token]);

  useEffect(() => { refreshUnread(); }, [refreshUnread]);
  usePolling(refreshUnread, POLL.dashboard);

  useEffect(() => {
    api.residentOrders(token)
      .then((r) => setRecentOrders([...(r.current ?? []), ...(r.upcoming ?? []), ...(r.previous ?? [])].slice(0, 12)))
      .catch(() => setRecentOrders([]));
  }, [token]);

  if (openOrderId) {
    return <ResidentOrderScreen token={token} orderId={openOrderId} onBack={() => setOpenOrderId(null)} />;
  }

  const primaryItems: BottomTabItem<Tab>[] = [
    { key: "home", label: "Home", icon: "home" },
    { key: "book", label: "Book", icon: "calendarPlus" },
    { key: "orders", label: "Orders", icon: "package" },
    { key: "wallet", label: "Wallet", icon: "wallet" },
    { key: "more", label: "More", icon: "moreHorizontal", badge: unread },
  ];
  const moreSections: MoreMenuSection[] = [{
    items: [
      { key: "services", label: "Services", icon: "sparkles", onPress: () => setTab("services") },
      { key: "plan", label: "Plan", icon: "fileText", onPress: () => setTab("plan") },
      { key: "support", label: "Support", icon: "lifeBuoy", onPress: () => setTab("support") },
      { key: "alerts", label: "Alerts", icon: "bell", badge: unread, onPress: () => setTab("alerts") },
      { key: "profile", label: "Profile", icon: "user", onPress: () => setTab("profile") },
    ],
  }];
  const barValue: Tab = RESIDENT_PRIMARY.includes(tab) ? tab : "more";

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === "home" && <ResidentHome token={token} onOpenOrder={setOpenOrderId} onBook={() => setTab("book")} onAlerts={() => setTab("alerts")} onPlans={() => setTab("plan")} onServices={() => setTab("services")} />}
        {tab === "book" && <BookingWizard token={token} onViewOrders={() => setTab("orders")} onClose={() => setTab("home")} />}
        {tab === "services" && <ServicesScreen token={token} />}
        {tab === "orders" && <ResidentOrdersScreen token={token} onOpenOrder={setOpenOrderId} />}
        {tab === "plan" && <SubscriptionScreen token={token} />}
        {tab === "wallet" && <WalletScreen token={token} />}
        {tab === "support" && <SupportScreen token={token} orders={recentOrders} />}
        {tab === "alerts" && <NotificationsScreen token={token} onChanged={refreshUnread} onOpenOrder={setOpenOrderId} />}
        {tab === "profile" && <ProfileScreen token={token} onLogout={onLogout} />}
        {tab === "more" && <MoreMenu sections={moreSections} />}
      </View>
      <BottomTabBar items={primaryItems} value={barValue} onChange={setTab} />
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

// I-80: the resident Order Progress — a compact horizontal stepper driven by the
// real order state, matching the web. Booked → Pickup → Processing → Ready →
// Delivered; the operator's internal stages collapse into Processing, out-for-delivery
// into Ready. Completed/current dots take the brand colour, upcoming stay subtle.
const PROGRESS_STAGES = ["Booked", "Pickup", "Processing", "Ready", "Delivered"];
function orderStageIndex(state: string): number {
  switch (state) {
    case "scheduled": return 0;
    case "picked_up": return 1;
    case "in_wash": case "washing": case "ironing":
    case "qc": case "qc_hold": case "qc_failed": case "disputed": return 2;
    case "ready_for_delivery": case "out_for_delivery": return 3;
    case "delivered": return 4;
    default: return 0;
  }
}
const STAGE_CAPTION = [
  "Your pickup is booked.",
  "Your laundry has been collected.",
  "Your laundry is being processed.",
  "Your laundry is ready for delivery.",
  "Your laundry has been delivered.",
];
function OrderProgress({ state }: { state: string }) {
  const current = orderStageIndex(state);
  const last = PROGRESS_STAGES.length - 1;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        {PROGRESS_STAGES.map((label, i) => {
          const done = i <= current;
          return (
            <View key={label} style={{ flex: 1, alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
                <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? "transparent" : (i <= current ? theme.aqua : theme.border) }} />
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: done ? theme.aqua : theme.border }} />
                <View style={{ flex: 1, height: 2, backgroundColor: i === last ? "transparent" : (i < current ? theme.aqua : theme.border) }} />
              </View>
              <Text style={{ fontSize: 10, marginTop: 4, textAlign: "center", color: done ? theme.slate : theme.muted }}>{label}</Text>
            </View>
          );
        })}
      </View>
      <Text style={[styles.planMeta, { marginTop: 8 }]}>{STAGE_CAPTION[current]}</Text>
    </Card>
  );
}

// Matching the web: a time-of-day greeting rather than a flat "Welcome back".
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
// The status the resident sees, collapsing the operator-internal stages (washing,
// ironing, qc, batches) into the plain lifecycle a customer follows — the same
// mapping the web dashboard uses.
const DASH_STATUS: Record<string, string> = {
  scheduled: "Scheduled", picked_up: "Picked Up",
  in_wash: "Processing", washing: "Processing", ironing: "Processing",
  qc: "Quality Check", qc_hold: "Quality Check", qc_failed: "Quality Check", disputed: "Quality Check",
  ready_for_delivery: "Ready for Delivery", out_for_delivery: "Out for Delivery",
  delivered: "Delivered", pickup_failed: "Pickup Failed", cancelled: "Cancelled",
};
function dashStatus(state: string): string {
  return DASH_STATUS[state] ?? titleCase(state.replace(/_/g, " "));
}
function dashStatusColor(state: string): string {
  if (/cancel|fail|reject/.test(state)) return theme.danger;
  if (/deliver|complete|ready/.test(state)) return theme.success;
  if (/scheduled|upcoming|request/.test(state)) return theme.amber;
  return theme.aqua;
}

// The resident's Current Order card, matching the web: the order code, its status,
// how many garments were collected, and a way in — not the operator/quantity detail
// the generic order card carries for staff.
function CurrentOrderCard({ order, onPress }: { order: OrderSummary; onPress: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.planHead}>
        <Text style={styles.planTier}>{order.orderCode}</Text>
        <Pill text={dashStatus(order.state)} color={dashStatusColor(order.state)} />
      </View>
      {order.acceptedCount ? <Text style={styles.planMeta}>{order.acceptedCount} garments collected</Text> : null}
      {order.delayed ? <Text style={styles.planMeta}>Running {order.delayMinutes} min late</Text> : null}
      <Text style={styles.viewLink}>View order ›</Text>
    </Card>
  );
}

function ResidentHome({ token, onOpenOrder, onBook, onAlerts, onPlans, onServices }: { token: string; onOpenOrder: (id: string) => void; onBook: () => void; onAlerts: () => void; onPlans: () => void; onServices: () => void }) {
  const [data, setData] = useState<ResidentDashboard | null>(null);
  // Whether this account has ever finished signing in before. Somebody arriving for
  // the first time should not be greeted as though they were coming back.
  const [firstLogin, setFirstLogin] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [dashboard, me] = await Promise.all([api.residentDashboard(token), api.me(token)]);
      setData(dashboard);
      setFirstLogin(Boolean(me.firstLogin));
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // The dashboard keeps itself current, so an order an operator just advanced does
  // not sit here looking stale until the resident pulls to refresh.
  usePolling(load, POLL.dashboard);

  if (busy && !data) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title={firstLogin
          ? "Welcome to WashNPress"
          : `${greeting()}, ${data?.residentName ?? "there"} 👋`}
        subtitle={firstLogin ? "Let's get you started" : "Here's what's happening with your laundry."}
      />
      <ErrorText error={error} />

      {data?.pendingAdditionalChargesPaise ? (
        <Notice tone="warn" text={`You have ${rupees(data.pendingAdditionalChargesPaise)} of additional garment charges pending. Top up your wallet to settle them.`} />
      ) : null}

      {/* Where my clothes are, first.
          The page used to open on the plan — a monthly price and an allowance
          meter — then the upcoming pickup, and only third the order actually in
          progress. A resident opening this app is asking one question, and it is
          not how much of their allowance is left. */}
      <SectionTitle>Current Order</SectionTitle>
      {data?.currentOrder
        ? <CurrentOrderCard order={data.currentOrder} onPress={() => onOpenOrder(data.currentOrder!.id)} />
        : data?.upcomingOrders?.length ? (
          // A booked-but-not-yet-collected order (currentOrder excludes the scheduled
          // state); shown with the same card so Home always leads with the order.
          data.upcomingOrders.map((order) => (
            <CurrentOrderCard key={order.id} order={order} onPress={() => onOpenOrder(order.id)} />
          ))
        ) : data?.upcomingPickup ? (
          <Card onPress={data.upcomingPickup.orderId ? () => onOpenOrder(data.upcomingPickup!.orderId!) : undefined}>
            <View style={styles.planHead}>
              <Text style={styles.planTier}>{data.upcomingPickup.orderCode ?? "Pickup"}</Text>
              <Pill text="Scheduled" color={theme.amber} />
            </View>
            <Text style={styles.planMeta}>
              Pickup {shortDate(data.upcomingPickup.date)}
              {data.upcomingPickup.startTime ? ` · ${data.upcomingPickup.startTime} – ${data.upcomingPickup.endTime}` : ""}
            </Text>
            <Text style={styles.viewLink}>View order ›</Text>
          </Card>
        ) : (
          <Card>
            <Text style={styles.planMeta}>No active orders. Book a pickup from the navigation to get started.</Text>
          </Card>
        )}

      {/* Order Progress — a compact stepper, only while an order is in flight. The
          Schedule Pickup CTA and the Additional Services block are intentionally
          gone from Home (I-80/I-85); Book and Services live in the navigation. */}
      {data?.currentOrder || data?.upcomingOrders?.length || data?.upcomingPickup ? (
        <>
          <SectionTitle>Order Progress</SectionTitle>
          <OrderProgress state={data?.currentOrder?.state ?? data?.upcomingOrders?.[0]?.state ?? "scheduled"} />
        </>
      ) : null}

      {/* A collection already booked, when there is also an order in progress —
          two different things, and a resident with both needs to see both. */}
      {data?.currentOrder && data?.upcomingPickup ? (
        <>
          <SectionTitle>Next collection</SectionTitle>
          <Card onPress={data.upcomingPickup.orderId ? () => onOpenOrder(data.upcomingPickup!.orderId!) : undefined}>
            <Row label="Date" value={shortDate(data.upcomingPickup.date)} />
            <Row label="Time" value={data.upcomingPickup.startTime ? `${data.upcomingPickup.startTime} – ${data.upcomingPickup.endTime}` : "—"} />
            <Row label="Status" value={titleCase(data.upcomingPickup.status)} />
          </Card>
        </>
      ) : null}

      {data?.notifications?.length ? (
        <>
          <SectionTitle action={data?.unreadNotifications ? <Pill text={`${data.unreadNotifications} new`} color={theme.amber} /> : undefined}>
            Recent Updates
          </SectionTitle>
          {data.notifications.slice(0, 3).map((n) => <NotificationCard key={n.id} notification={n} onPress={onAlerts} />)}
        </>
      ) : null}

      {/* The arrangement, below the thing it pays for. It changes once a month. */}
      {data?.subscription ? (
        <>
          <SectionTitle>Your Plan</SectionTitle>
          <Card onPress={onPlans}>
            <View style={styles.planHead}>
              <Text style={styles.planTier}>{data.subscription.planTier.toUpperCase()}</Text>
              <Pill text={titleCase(data.subscription.status)} color={theme.success} />
            </View>
            <Text style={styles.planPrice}>{rupees(data.subscription.monthlyPaise)} / month</Text>
            <Text style={styles.planMeta}>{data.subscription.used} of {data.subscription.allowance} garments used</Text>
            <Text style={styles.planMeta}>{data.subscription.remaining} garments remaining</Text>
            <Row label="Manage Plan" value="›" />
          </Card>
        </>
      ) : (
        <>
          <SectionTitle>Your Plan</SectionTitle>
          <Card>
            <Text style={styles.planTier}>NO ACTIVE SUBSCRIPTION</Text>
            <Text style={styles.planMeta}>
              A plan is optional. You can book a pickup any time and pay per garment,
              or subscribe for an included allowance and a faster turnaround.
            </Text>
            <Button label="View plans" variant="secondary" onPress={onPlans} />
          </Card>
        </>
      )}

      <SectionTitle>Recent orders</SectionTitle>
      {data?.recentOrders?.length
        ? data.recentOrders.map((o) => <OrderCard key={o.id} order={o} showSociety={false} onPress={() => onOpenOrder(o.id)} />)
        : <Empty text="No orders yet." />}
    </Screen>
  );
}

// How close to the pickup a resident may still change or cancel it. This mirrors the
// backend's booking cutoff, which is the real gate — this only decides whether the
// screen offers the action or explains why it cannot.
const PICKUP_CHANGE_CUTOFF_HOURS = 2;
// Whether a scheduled pickup is still far enough off to change. A missing time is
// treated as not changeable rather than guessed at.
function canChangePickup(scheduledPickupAt: string | null | undefined): boolean {
  if (!scheduledPickupAt) return false;
  return Date.now() < new Date(scheduledPickupAt).getTime() - PICKUP_CHANGE_CUTOFF_HOURS * 3600 * 1000;
}

// Free for a while after booking, then a flat fee — this only mirrors the policy
// for display before acting; the real decision and amount come back from the
// cancel/reschedule call itself.
const FREE_CHANGE_WINDOW_MINUTES = 60;
const CANCELLATION_FEE_RUPEES = 99;
const RESCHEDULE_FEE_RUPEES = 49;
function feeAppliesNow(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  return (Date.now() - new Date(createdAt).getTime()) / 60_000 >= FREE_CHANGE_WINDOW_MINUTES;
}
function describeFeeOutcome(result: { feeChargedPaise: number; feePending: boolean }): string {
  if (result.feeChargedPaise > 0) return `Done — a ${rupees(result.feeChargedPaise)} fee was charged since it's past the free window.`;
  if (result.feePending) return "Done — a fee applies but your wallet balance was too low, so it's still outstanding.";
  return "Done — free, within the hour.";
}

// -------------------------------------------------------------------- booking

// I-82: one booking wizard for a laundry pickup, an additional service, or both
// together — the same flow as the web app. The steps adapt to the choice: choose →
// (laundry schedule) → (service schedule) → review → success. The resident only ever
// picks a date and a slot; garments, services and quantities are recorded by the
// operator at collection. Slots inside the two-hour cutoff are refused by the backend
// and never offered here.
function BookingWizard({ token, onViewOrders, onClose }: {
  token: string; onViewOrders: () => void; onClose: () => void;
}) {
  const today = todayIso();
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [wantLaundry, setWantLaundry] = useState(true);
  const [service, setService] = useState<ServiceOffering | null>(null);
  const [lDate, setLDate] = useState(today);
  const [lSlots, setLSlots] = useState<Slot[]>([]);
  const [lSlot, setLSlot] = useState<string | null>(null);
  const [sDate, setSDate] = useState(today);
  const [sSlots, setSSlots] = useState<ServiceDateSlot[]>([]);
  const [sSlot, setSSlot] = useState<string | null>(null);
  const [servicePaise, setServicePaise] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ laundry: string | null; service: string | null } | null>(null);

  useEffect(() => {
    api.serviceOfferings().then((r) => setOfferings(r.offerings.filter((o) => o.isActive))).catch(() => setOfferings([]));
  }, []);

  // The ordered steps for the current selection, so the indicator and Back/Continue
  // always match what was actually chosen.
  const flow: string[] = ["choose", ...(wantLaundry ? ["laundry"] : []), ...(service ? ["service"] : []), "review"];
  const stepKey = flow[Math.min(step, flow.length - 1)];
  const isReview = stepKey === "review";
  const stepLabels = flow.map((k) => (k === "choose" ? "Book" : k === "laundry" ? "Pickup" : k === "service" ? "Service" : "Review"));

  useEffect(() => {
    if (!wantLaundry) return;
    setSlotsBusy(true); setLSlot(null);
    api.getSlots(lDate, token).then((r) => setLSlots(r.slots)).catch(() => setLSlots([])).finally(() => setSlotsBusy(false));
  }, [wantLaundry, lDate, token]);

  useEffect(() => {
    if (!service) return;
    setSlotsBusy(true); setSSlot(null);
    api.serviceDateSlots(service.id, sDate, token).then((r) => setSSlots(r.slots)).catch(() => setSSlots([])).finally(() => setSlotsBusy(false));
  }, [service?.id, sDate, token]);

  useEffect(() => {
    if (!isReview || !service) return;
    api.serviceQuote(service.id, undefined, token).then((r) => setServicePaise(r.quote.quotedPaise)).catch(() => setServicePaise(service.unitPricePaise));
  }, [isReview, service?.id, token]);

  const lChosen = lSlots.find((s) => s.id === lSlot) ?? null;
  const sChosen = sSlots.find((s) => s.id === sSlot) ?? null;
  const price = servicePaise ?? (service ? service.unitPricePaise : 0);

  const canContinue = stepKey === "choose" ? (wantLaundry || Boolean(service))
    : stepKey === "laundry" ? Boolean(lSlot)
      : stepKey === "service" ? Boolean(sSlot) : true;

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      let laundry: string | null = null;
      let svc: string | null = null;
      // Laundry first, then the service; each is persisted the moment it succeeds, so
      // a failure on the second does not undo the first.
      if (wantLaundry && lSlot) { const r = await api.bookPickup({ slotId: lSlot }, token); laundry = r.order.orderCode; }
      if (service && sSlot) { await api.bookServiceSlot({ serviceSlotId: sSlot }, token); svc = service.name; }
      setDone({ laundry, service: svc });
    } catch (e) {
      setError((e as ApiError).code === "slot_unavailable" ? "A slot just filled up — go back and choose another." : (e as Error).message);
    } finally { setBusy(false); }
  };

  const cont = () => (isReview ? confirm() : setStep((s) => Math.min(flow.length - 1, s + 1)));
  const slotLabel = (s: { window: string; startTime: string; endTime: string } | null) => (s ? `${s.window} · ${s.startTime}–${s.endTime}` : "—");

  if (done) {
    return (
      <Screen>
        <PageTitle title="Booking confirmed" subtitle="Your booking has been confirmed" />
        {done.laundry ? (
          <Card>
            <Text style={styles.planTier}>Laundry Pickup</Text>
            <Text style={styles.planMeta}>{done.laundry} · {shortDate(lDate)} · {slotLabel(lChosen)}</Text>
          </Card>
        ) : null}
        {done.service ? (
          <Card>
            <Text style={styles.planTier}>{done.service}</Text>
            <Text style={styles.planMeta}>{shortDate(sDate)} · {slotLabel(sChosen)}</Text>
          </Card>
        ) : null}
        <Button label="View my orders" onPress={onViewOrders} />
        <Button label="Done" variant="secondary" onPress={onClose} />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageTitle title="Book" subtitle="A laundry pickup, an additional service, or both" />
      <StepIndicator steps={stepLabels} current={step} />

      {stepKey === "choose" ? (
        <>
          <SectionTitle>What would you like to book?</SectionTitle>
          <Pressable onPress={() => setWantLaundry((v) => !v)} style={[styles.chooseCard, wantLaundry && styles.chooseCardOn]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.chooseTitle}>Laundry Pickup</Text>
              <Text style={styles.planMeta}>We collect and return your clothes. Priced at collection.</Text>
            </View>
            {wantLaundry ? <Pill text="Selected" color={theme.aqua} /> : null}
          </Pressable>
          {offerings.length ? <SectionTitle>Additional services</SectionTitle> : null}
          {offerings.map((o) => {
            const on = service?.id === o.id;
            return (
              <Pressable key={o.id} onPress={() => setService((cur) => (cur?.id === o.id ? null : o))} style={[styles.chooseCard, on && styles.chooseCardOn]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chooseTitle}>{o.name}</Text>
                  <Text style={styles.planMeta}>from {rupees(o.unitPricePaise)} / {o.pricingBasis === "per_hour" ? "hour" : "job"}</Text>
                </View>
                {on ? <Pill text="Selected" color={theme.aqua} /> : null}
              </Pressable>
            );
          })}
        </>
      ) : null}

      {stepKey === "laundry" ? (
        <>
          <SectionTitle>Pickup day</SectionTitle>
          <DateField label="Date" value={lDate} onChange={(next) => setLDate(next ?? today)} minDate={today} clearable={false} />
          <SectionTitle>Available slots</SectionTitle>
          {slotsBusy && !lSlots.length ? <Loading /> : null}
          {!slotsBusy && !lSlots.length ? <Empty text="No slots available. Slots close two hours before pickup — try another day." /> : null}
          <View style={styles.slotWrap}>
            {lSlots.map((slot) => {
              const full = slot.capacityRemaining <= 0;
              const picked = slot.id === lSlot;
              return (
                <Pressable key={slot.id} disabled={full} onPress={() => setLSlot((c) => (c === slot.id ? null : slot.id))}
                  accessibilityRole="button" accessibilityState={{ disabled: full, selected: picked }}
                  style={[styles.slotChip, picked && styles.slotChipPicked, full && styles.slotChipFull]}>
                  <Text style={[styles.slotChipTime, full && styles.slotChipMuted]}>{slot.startTime} – {slot.endTime}</Text>
                  <Text style={[styles.slotChipMeta, full && styles.slotChipMuted]}>{full ? "Full" : slot.window}</Text>
                  {!full ? <Text style={styles.slotChipMeta}>{slot.capacityRemaining} left</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {stepKey === "service" ? (
        <>
          <SectionTitle>{service?.name}</SectionTitle>
          <DateField label="Service day" value={sDate} onChange={(next) => setSDate(next ?? today)} minDate={today} clearable={false} />
          <SectionTitle>Available slots</SectionTitle>
          {slotsBusy && !sSlots.length ? <Loading /> : null}
          {!slotsBusy && !sSlots.length ? <Empty text={`No slots offered for ${service?.name} on this day. Try another day.`} /> : null}
          <View style={styles.slotWrap}>
            {sSlots.map((slot) => {
              const picked = slot.id === sSlot;
              return (
                <Pressable key={slot.id} disabled={slot.full} onPress={() => setSSlot((c) => (c === slot.id ? null : slot.id))}
                  accessibilityRole="button" accessibilityState={{ disabled: slot.full, selected: picked }}
                  style={[styles.slotChip, picked && styles.slotChipPicked, slot.full && styles.slotChipFull]}>
                  <Text style={[styles.slotChipTime, slot.full && styles.slotChipMuted]}>{slot.startTime} – {slot.endTime}</Text>
                  <Text style={[styles.slotChipMeta, slot.full && styles.slotChipMuted]}>{slot.full ? "Full" : slot.window}</Text>
                  {!slot.full ? <Text style={styles.slotChipMeta}>{slot.capacityRemaining} left</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {isReview ? (
        <>
          <SectionTitle>Booking summary</SectionTitle>
          <Card>
            {wantLaundry ? <Row label="Laundry Pickup" value={`${shortDate(lDate)} · ${slotLabel(lChosen)}`} /> : null}
            {wantLaundry ? <Row label="Laundry" value="Priced at collection" /> : null}
            {service ? <Row label={service.name} value={`${shortDate(sDate)} · ${slotLabel(sChosen)}`} /> : null}
            {service ? <Row label="Total now" value={rupees(price)} figure /> : null}
          </Card>
        </>
      ) : null}

      <ErrorText error={error} />

      <View style={styles.slotRow}>
        {step > 0
          ? <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} disabled={busy} />
          : <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />}
        <Button label={isReview ? "Confirm booking" : "Continue"} onPress={cont} disabled={busy || !canContinue} />
      </View>
    </Screen>
  );
}

// -------------------------------------------------------------------- orders

// Which of the three groups an additional-service booking belongs in, by its status:
// finished/cancelled bookings are previous, a not-yet-taken request is upcoming, and
// anything in between (assigned, in progress) is current.
function serviceGroupOf(status: string): "current" | "upcoming" | "previous" {
  if (status === "completed" || status === "cancelled") return "previous";
  if (status === "requested") return "upcoming";
  return "current";
}

function ResidentOrdersScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [group, setGroup] = useState<"current" | "upcoming" | "previous">("current");
  const [kind, setKind] = useState<"all" | "laundry" | "service">("all");
  const [data, setData] = useState<{ current: OrderSummary[]; upcoming: OrderSummary[]; previous: OrderSummary[] } | null>(null);
  const [services, setServices] = useState<ServiceRequestView[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // Laundry orders and additional-service bookings, shown together. The order
      // search box narrows laundry by code; services are matched on their name.
      const [orderRes, serviceRes] = await Promise.all([
        api.residentOrders(token, { orderCode: search || undefined }),
        api.myServiceRequests(token),
      ]);
      setData({ current: orderRes.current ?? [], upcoming: orderRes.upcoming ?? [], previous: orderRes.previous ?? [] });
      setServices(serviceRes.requests ?? []);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, search]);
  useEffect(() => { load(); }, [load]);

  // Settling what is owed on a finished order. Its lifecycle is over — it belongs in
  // Previous Orders — and paying for it should not mean opening it first.
  const pay = async (order: OrderSummary) => {
    setError(null); setNote(null);
    try {
      const r = await api.payAdditionalCharge(order.id, token);
      setNote(r.order.additionalChargeStatus === "paid"
        ? `Paid. ${order.orderCode} is settled.`
        : "That did not go through. Top up your wallet and try again.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const q = search.trim().toLowerCase();
  const laundry = (data ? data[group] : []).filter(() => kind !== "service");
  const serviceRows = kind === "laundry" ? [] : services.filter((s) =>
    serviceGroupOf(s.status) === group && (!q || s.offeringName.toLowerCase().includes(q)));
  const groupCount = (g: "current" | "upcoming" | "previous") => {
    const l = kind === "service" ? 0 : (data ? data[g].length : 0);
    const s = kind === "laundry" ? 0 : services.filter((x) => serviceGroupOf(x.status) === g).length;
    return l + s;
  };
  const empty = laundry.length === 0 && serviceRows.length === 0;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="My Orders" subtitle="Track your laundry pickups and additional-service bookings." />
      <Field label="Search by order id" value={search} onChangeText={setSearch} placeholder="ORD-756272" />
      <View style={styles.groupRow}>
        {(["current", "upcoming", "previous"] as const).map((key) => (
          <Pill key={key} text={`${titleCase(key)} (${groupCount(key)})`} color={group === key ? theme.aqua : theme.muted} />
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
      {/* Secondary filter: laundry orders, additional-service bookings, or both. */}
      <View style={{ height: 8 }} />
      <Tabs
        value={kind}
        onChange={setKind}
        options={[
          { key: "all", label: "All" },
          { key: "laundry", label: "Laundry" },
          { key: "service", label: "Additional services" },
        ]}
      />
      <View style={{ height: 12 }} />
      {laundry.map((o) => (
        <OrderCard key={o.id} order={o} showSociety={false} onPress={() => onOpenOrder(o.id)} onPay={() => pay(o)} />
      ))}
      {serviceRows.map((s) => (
        <Card key={s.id}>
          <View style={styles.planHead}>
            <Text style={styles.planTier}>{s.offeringName}</Text>
            <Pill text="Additional service" color={theme.aqua} />
          </View>
          <Row label="When" value={shortDate(s.scheduledFor)} />
          <Row label="Status" value={s.statusLabel} />
          <Row label="Price" value={s.payablePaise > 0 ? rupees(s.payablePaise) : "Included with plan"} />
          {s.cancelledReason ? <Row label="Reason" value={s.cancelledReason} /> : null}
        </Card>
      ))}
      {empty ? <Empty text="Nothing in this group." /> : null}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

function ResidentOrderScreen({ token, orderId, onBack }: { token: string; orderId: string; onBack: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Whether the reschedule wizard is open, and whether the cancel confirmation is
  // showing. `acting` guards the confirm buttons against a double tap.
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setOrder((await api.residentOrder(orderId, token)).order); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);
  // The specification calls this out directly: when operations marks an order
  // delivered, the resident should see it without reloading the page.
  usePolling(load, POLL.tracking);

  // The resident's answer to a quantity discrepancy. Either way it stays on the
  // record: acknowledging one does not erase it, and disputing one does not change
  // the count that was verified.
  const answerDiscrepancy = async (answer: "acknowledged" | "disputed") => {
    setNote(null); setError(null);
    try {
      const r = await api.answerDiscrepancy(orderId, answer, token,
        answer === "disputed" ? "The quantity collected does not match what I handed over." : undefined);
      setOrder(r.order);
      setNote(answer === "acknowledged"
        ? "Thank you. The difference is on the record."
        : "We have passed this to the supervisor for your area.");
    } catch (e) { setError((e as Error).message); }
  };

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

  // Calling off an upcoming pickup. The backend refuses one inside the cutoff even if
  // the button somehow shows, so a stale screen cannot cancel something it should not.
  const cancelBooking = async () => {
    if (!order?.pickupId) return;
    setActing(true); setError(null); setNote(null);
    try {
      const result = await api.cancelPickup(order.pickupId, token);
      setConfirmCancel(false);
      setNote(describeFeeOutcome(result));
      await load();
    } catch (e) {
      setConfirmCancel(false);
      setError((e as ApiError).code === "cutoff_passed"
        ? "Cancellation and rescheduling are unavailable within 2 hours of the pickup time."
        : (e as Error).message);
    } finally { setActing(false); }
  };

  // An upcoming pickup, still far enough off to move or call off. Only a scheduled
  // order has a pickup to change; a collected one is already on its way.
  const changeable = order?.state === "scheduled" && Boolean(order.pickupId);
  const withinCutoff = changeable && !canChangePickup(order?.scheduledPickupAt);

  if (busy && !order) return <Loading />;

  // The reschedule wizard takes over the screen while it is open: date, then time,
  // then a look at the old pickup beside the new one before it is committed.
  if (rescheduling && order?.pickupId) {
    return (
      <RescheduleWizard
        token={token}
        pickupId={order.pickupId}
        current={order.slot ? { date: order.slot.date, startTime: order.slot.startTime, endTime: order.slot.endTime } : null}
        onCancel={() => setRescheduling(false)}
        onDone={async (message) => { setRescheduling(false); setNote(message); await load(); }}
      />
    );
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Back" onPress={onBack} />
      <ErrorText error={error} />
      {order ? (
        <>
          <OrderDetailBody order={order} audience="resident" onAnswerDiscrepancy={answerDiscrepancy} />
          {order.additionalChargeStatus === "pending" || order.additionalChargeStatus === "failed" ? (
            <Button label={`Pay ${rupees(order.additionalChargePaise)} from wallet`} onPress={pay} />
          ) : null}

          {/* An upcoming booking can be moved or called off up to two hours before
              the pickup. Inside that window the actions are replaced by the reason
              they are gone rather than left as buttons that only fail when pressed. */}
          {changeable ? (
            withinCutoff ? (
              <Notice tone="warn" text="Cancellation and rescheduling are unavailable within 2 hours of the pickup time." />
            ) : (
              <>
                <SectionTitle>Change this booking</SectionTitle>
                <Text style={styles.changeHint}>
                  {feeAppliesNow(order.createdAt)
                    ? `A ₹${CANCELLATION_FEE_RUPEES} cancellation fee or ₹${RESCHEDULE_FEE_RUPEES} reschedule fee applies now — it's been over an hour since booking.`
                    : "Free to cancel or reschedule for the next while — no charge yet."}
                </Text>
                <Button label="Reschedule booking" variant="secondary" onPress={() => { setError(null); setRescheduling(true); }} />
                <Button label="Cancel booking" variant="danger" onPress={() => setConfirmCancel(true)} />
              </>
            )
          ) : null}

          {note ? <Notice tone="good" text={note} /> : null}
        </>
      ) : null}

      {/* A cancellation is confirmed before it is made: it releases the slot and ends
          the order, and a mis-tap should not do that silently. */}
      <CenteredModal
        visible={confirmCancel}
        title="Cancel this booking?"
        subtitle={order?.slot ? `${shortDate(order.slot.date)} · ${order.slot.startTime} – ${order.slot.endTime}` : undefined}
        onClose={() => setConfirmCancel(false)}
        footer={(
          <View style={styles.slotRow}>
            <Button label="Keep booking" variant="secondary" onPress={() => setConfirmCancel(false)} disabled={acting} />
            <Button label="Cancel booking" variant="danger" onPress={cancelBooking} disabled={acting} />
          </View>
        )}
      >
        <Text style={styles.slotMeta}>
          Are you sure you want to cancel this booking? The pickup slot is released and this cannot be undone.
        </Text>
      </CenteredModal>
    </Screen>
  );
}

// Moving a booked pickup to another day and time, one decision at a time: choose a
// day, choose a slot on it, then check the old pickup against the new one before it
// is committed. The slots come from the same list the booking screen uses, so a full
// or past window is shown and marked rather than silently missing.
function RescheduleWizard({ token, pickupId, current, onDone, onCancel }: {
  token: string;
  pickupId: string;
  current: { date: string; startTime: string; endTime: string } | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const today = todayIso();
  const [step, setStep] = useState(0);
  const [date, setDate] = useState(current?.date && current.date >= today ? current.date : today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null); setSelectedSlotId(null);
    try { setSlots((await api.getSlots(date, token)).slots); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [date, token]);
  useEffect(() => { load(); }, [load]);

  const chosen = slots.find((s) => s.id === selectedSlotId) ?? null;

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      const result = await api.reschedulePickup(pickupId, chosen.id, token);
      onDone(describeFeeOutcome(result));
    } catch (e) {
      const code = (e as ApiError).code;
      setError(
        code === "cutoff_passed" ? "Cancellation and rescheduling are unavailable within 2 hours of the pickup time."
          : code === "slot_unavailable" ? "That slot just filled up. Please choose another."
          : (e as Error).message,
      );
      await load();
    } finally { setBusy(false); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Back to booking" onPress={onCancel} />
      <PageTitle title="Reschedule booking" subtitle="Move this pickup to another day and time" />
      <StepIndicator steps={["Date", "Time", "Review"]} current={step} />

      {step === 0 ? (
        <>
          <SectionTitle>Choose a new day</SectionTitle>
          <DateField label="Date" value={date} onChange={(next) => setDate(next ?? today)} minDate={today} clearable={false} />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <SectionTitle>Choose a new time</SectionTitle>
          {busy && !slots.length ? <Loading /> : null}
          {!busy && !slots.length ? <Empty text="No slots available for this date." /> : null}
          <View style={styles.slotWrap}>
            {slots.map((slot) => {
              const full = slot.capacityRemaining <= 0;
              const picked = slot.id === selectedSlotId;
              return (
                <Pressable
                  key={slot.id}
                  onPress={full ? undefined : () => setSelectedSlotId((cur) => (cur === slot.id ? null : slot.id))}
                  disabled={full}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: full, selected: picked }}
                  accessibilityLabel={`${slot.startTime} to ${slot.endTime}, ${slot.window}, ${full ? "fully booked" : `${slot.capacityRemaining} available`}`}
                  style={[styles.slotChip, picked && styles.slotChipPicked, full && styles.slotChipFull]}
                >
                  <Text style={[styles.slotChipTime, full && styles.slotChipMuted]}>{slot.startTime} – {slot.endTime}</Text>
                  <Text style={[styles.slotChipMeta, full && styles.slotChipMuted]}>{full ? "Full" : slot.window}</Text>
                  {!full ? <Text style={styles.slotChipMeta}>{slot.capacityRemaining} left</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SectionTitle>Review</SectionTitle>
          <Card>
            <Row label="Current pickup" value={current ? `${shortDate(current.date)} · ${current.startTime} – ${current.endTime}` : "—"} />
            <Row label="New pickup" value={chosen ? `${shortDate(date)} · ${chosen.startTime} – ${chosen.endTime}` : "—"} figure />
          </Card>
          <Notice text="Your clothes and services stay the same — only the pickup day and time change." />
        </>
      ) : null}

      <ErrorText error={error} />

      <View style={styles.slotRow}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} />
        {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} disabled={busy} /> : null}
        {step < 2 ? (
          <Button label="Next" onPress={() => setStep(step + 1)} disabled={busy || (step === 1 && !chosen)} />
        ) : (
          <Button label="Confirm reschedule" onPress={confirm} disabled={busy || !chosen} />
        )}
      </View>
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
  // The change being considered, before it is agreed to.
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.residentSubscription(token);
      setCurrent(r.current); setPlans(r.availablePlans);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const cancelChange = async () => {
    setNote(null); setError(null);
    try {
      await api.cancelPlanChange(token);
      setNote("The scheduled plan change was cancelled. You stay on your current plan.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  // Subscribing from nothing is a straight purchase. Changing plan is not: it is
  // shown in full and agreed to before anything moves.
  const subscribe = async (plan: Plan) => {
    setNote(null); setError(null);
    try {
      await api.subscribe(plan.id, "monthly", token);
      setNote(`Subscribed to ${plan.tier}.`);
      await load();
    } catch (e) {
      setError((e as ApiError).code === "insufficient_balance" ? "Top up your wallet to subscribe." : (e as Error).message);
    }
  };

  // Asking what a change would cost. Nothing is written by asking.
  const review = async (plan: Plan) => {
    setNote(null); setError(null); setQuote(null);
    setQuoting(plan.id);
    try {
      const r = await api.quotePlanChange(plan.id, token);
      setQuote(r.quote);
    } catch (e) { setError((e as Error).message); }
    finally { setQuoting(null); }
  };

  // Agreeing to it. The plan moves only if the payment goes through.
  const confirmChange = async () => {
    if (!quote) return;
    setConfirming(true); setError(null);
    try {
      const r = await api.changePlan(quote.newPlanId, token);
      setQuote(null);
      setNote(r.note);
      await load();
    } catch (e) {
      const failure = e as ApiError;
      // The plan is exactly where it was. Said in those words, because the old
      // flow left the resident unable to tell whether anything had happened.
      setError(failure.code === "payment_failed"
        ? `${failure.message} Top up your wallet and try again.`
        : failure.message);
    } finally { setConfirming(false); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="My Plan" subtitle="Your plan and usage" />
      <SectionTitle>Current plan</SectionTitle>
      {current ? (
        <Card>
          <View style={styles.planHead}>
            <Text style={styles.planTier}>{current.planTier.toUpperCase()}</Text>
            <Pill text={titleCase(current.status)} color={theme.success} />
          </View>
          {/* Plan Amount is the plan's price, not something consumed by usage — no
              progress bar. Garment Usage is shown as "X of Y used · N% used" with the
              remaining count beneath it (I-83). */}
          {plans.find((p) => p.isCurrent)?.description
            ? <Text style={styles.planMeta}>{plans.find((p) => p.isCurrent)!.description}</Text>
            : null}
          <Row label="Plan amount" value={`${rupees(current.monthlyPaise)} / month`} />
          <Row
            label="Garment usage"
            value={`${current.used} of ${current.allowance} used · ${current.allowance > 0 ? Math.round((current.used / current.allowance) * 100) : 0}% used`}
            hint={`${current.remaining} garments remaining`}
          />
          <Row label="Turnaround time" value={`${current.turnaroundHours} hours`} />
          <Row label="Start date" value={shortDate(current.cycleStart)} />
          <Row label="Next renewal" value={shortDate(current.renewalDate)} />
        </Card>
      ) : <Empty text="No active plan." />}

      {current?.pendingPlan ? (
        <>
          <SectionTitle>Scheduled plan change</SectionTitle>
          <Card>
            <View style={styles.planHead}>
              <Text style={styles.planTier}>{current.pendingPlan.tier.toUpperCase()}</Text>
              <Pill
                text={current.pendingPlan.direction === "downgrade" ? "DOWNGRADE" : current.pendingPlan.direction === "upgrade" ? "UPGRADE" : "CHANGE"}
                color={current.pendingPlan.direction === "downgrade" ? theme.amber : theme.aqua}
              />
            </View>
            {/* Which plan, what it costs and when it starts. A resident cannot act
                on "a change is pending" without being told what the change is. */}
            <Text style={styles.planPrice}>{rupees(current.pendingPlan.monthlyPaise)} / month</Text>
            <Row label="New allowance" value={`${current.pendingPlan.allowance} garments`} />
            <Row label="New turnaround" value={`${current.pendingPlan.turnaroundHours} hours`} />
            <Row label="Takes effect" value={shortDate(current.pendingPlan.effectiveFrom)} />
            <Row label="Until then" value={`You stay on ${current.planTier}`} />
            {current.pendingPlan.canCancel ? (
              <Button label="Cancel this change" variant="secondary" onPress={cancelChange} />
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>Available plans</SectionTitle>
      {plans.map((plan) => (
        <Card key={plan.id}>
          <View style={styles.planHead}>
            <Text style={styles.planTier}>{plan.tier}</Text>
            {plan.isCurrent ? <Pill text="Current plan" color={theme.feedback.successText} /> : null}
          </View>
          <Text style={styles.planMeta}>{plan.garmentCap} garments / month · {plan.turnaroundHours}h turnaround</Text>
          <Text style={styles.planPrice}>{rupees(plan.monthlyPaise)} / month</Text>
          {/* The plan they are on is not something to buy again, so it says so and
              offers nothing. A scheduled change says when it starts, and can be
              called off from here. Whether another plan is an upgrade or a downgrade
              is the backend's call by tier hierarchy — not a price comparison here. */}
          {plan.isCurrent ? (
            <Button label="Current plan" variant="secondary" disabled onPress={() => {}} />
          ) : current?.pendingPlan?.planId === plan.id ? (
            <>
              <Text style={styles.planMeta}>
                Scheduled to start {shortDate(current.pendingPlan.effectiveFrom)}
              </Text>
              <Button label="Cancel change" variant="secondary" onPress={cancelChange} />
            </>
          ) : current && plan.canChange === false ? (
            // A change is already scheduled, and only one may be pending at a time.
            <Button label="Change scheduled" variant="secondary" disabled onPress={() => {}} />
          ) : (
            <Button
              label={!current ? "Subscribe"
                : plan.direction === "downgrade" ? "Downgrade"
                : plan.direction === "upgrade" ? "Upgrade" : "Switch"}
              variant="secondary"
              onPress={() => (current ? review(plan) : subscribe(plan))}
              disabled={quoting === plan.id}
            />
          )}
        </Card>
      ))}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />

      {/* ------------------------------------------------ the confirmation */}
      {/* What they are on, what they would move to, what each costs, the
          difference, when it starts and what they pay now. Clicking Upgrade used
          to change the plan and quote a figure back, leaving the resident unable
          to tell whether it was a bill, a receipt, or something already done. */}
      <CenteredModal
        visible={Boolean(quote)}
        title={quote ? `Change to ${quote.newPlanTier}?` : "Change plan"}
        subtitle={quote?.immediate ? "Takes effect straight away" : "Starts at the end of this cycle"}
        onClose={() => setQuote(null)}
        footer={quote ? (
          <View style={styles.confirmRow}>
            <View style={{ flex: 1, marginRight: 6 }}>
              <Button label="Cancel" variant="secondary" onPress={() => setQuote(null)} />
            </View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <Button
                label={confirming ? "Working…"
                  : quote.amountDuePaise > 0 ? `Pay ${rupees(quote.amountDuePaise)}` : "Confirm change"}
                onPress={confirmChange}
                disabled={confirming}
              />
            </View>
          </View>
        ) : null}
      >
        {quote ? (
          <>
            <Row label="Current plan" value={quote.currentPlanTier} />
            <Row label="Current price" value={`${rupees(quote.currentCyclePaise)} / ${quote.cycle === "annual" ? "year" : "month"}`} />
            <Row label="New plan" value={quote.newPlanTier} />
            <Row label="New price" value={`${rupees(quote.newCyclePaise)} / ${quote.cycle === "annual" ? "year" : "month"}`} />
            <Row
              label="Proration"
              value={`${rupees(Math.abs(quote.prorationPaise))} for the ${quote.daysRemaining} day${quote.daysRemaining === 1 ? "" : "s"} left${quote.prorationPaise < 0 ? " (in your favour)" : ""}`}
            />
            <Row label="Effective date" value={shortDate(quote.effectiveFrom)} />
            <Row label="To pay now" value={quote.amountDuePaise > 0 ? rupees(quote.amountDuePaise) : "Nothing"} />
            {quote.immediate ? (
              <Notice text="Paying moves you to the new plan now, with its own allowance from today." />
            ) : (
              <Notice text={`You stay on ${quote.currentPlanTier} until ${shortDate(quote.effectiveFrom)}. Nothing is charged today, and you can call this off before then.`} />
            )}
            <ErrorText error={error} />
          </>
        ) : null}
      </CenteredModal>
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
  "general_query", "delivery_issue", "pickup_failed", "missing_garment", "damaged_garment",
  "garment_quantity_mismatch", "payment_issue", "additional_charge_dispute",
  "subscription_issue", "operator_issue", "resident_complaint",
];

const RESIDENT_PRIORITIES: IssuePriority[] = ["normal", "high", "emergency"];

// Customer support. The resident raises the issue here rather than settling it with
// the operator directly, follows the conversation, and closes it when satisfied.
function SupportScreen({ token, orders }: { token: string; orders: OrderSummary[] }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [type, setType] = useState<string>(RESIDENT_ISSUE_TYPES[0]);
  const [priority, setPriority] = useState<IssuePriority>("normal");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setTickets((await api.listTickets(token)).tickets); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // A supervisor reply should appear without the resident having to reload.
  usePolling(load, POLL.dashboard);

  const submit = async () => {
    setError(null);
    try {
      const { ticket } = await api.createTicket({ category: type, description, orderId: orderId ?? undefined, priority }, token);
      // The photographs were chosen before the ticket existed; now that it has an
      // id they are uploaded onto it, so they travel with the ticket the support
      // team opens rather than being left behind on submit.
      for (const photo of photos) {
        await api.attachToTicket(ticket.id, photo, token);
      }
      setDescription(""); setOrderId(null); setPriority("normal"); setPhotos([]); setComposing(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const open = tickets.find((t) => t.id === openId) ?? null;
  if (open) {
    return (
      <TicketScreen
        token={token}
        ticket={open}
        onBack={() => setOpenId(null)}
        onChanged={async () => { await load(); }}
      />
    );
  }

  const active = tickets.filter((t) => t.status !== "closed");
  const closed = tickets.filter((t) => t.status === "closed");

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Help & Support"
        subtitle="Ask a question or report a problem"
        right={<Button label={composing ? "Close" : "+ Raise an issue"} variant="secondary" onPress={() => setComposing(!composing)} />}
      />

      {composing ? (
        <Card>
          <Dropdown
            label="Category"
            value={type ?? undefined}
            allLabel="Choose a category"
            options={RESIDENT_ISSUE_TYPES.map((t) => ({ value: t, label: titleCase(t) }))}
            // A category is required, so clearing it puts the first one back rather
            // than leaving the form in a state it cannot be submitted from.
            onChange={(v) => setType(v ?? RESIDENT_ISSUE_TYPES[0])}
          />
          <Dropdown
            label="Related order (optional)"
            value={orderId ?? undefined}
            allLabel="Not about one order"
            options={orders.slice(0, 20).map((o) => ({ value: o.id, label: o.orderCode }))}
            onChange={(v) => setOrderId(v ?? null)}
          />
          <Dropdown
            label="Priority"
            value={priority ?? undefined}
            allLabel="Normal"
            options={RESIDENT_PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))}
            onChange={(v) => setPriority((v ?? "normal") as IssuePriority)}
          />
          {priority === "emergency"
            ? <Notice tone="warn" text="Emergencies are shown to your supervisor first. Please use this only when something is genuinely urgent." />
            : null}
          <Field label="What happened?" value={description} onChangeText={setDescription} placeholder="Describe the issue" />
          <ComposeAttachments photos={photos} onChange={setPhotos} />
          <Button label="Submit" onPress={submit} disabled={!description.trim()} />
        </Card>
      ) : null}

      <SectionTitle>Open tickets</SectionTitle>
      {active.length ? active.map((t) => <IssueRow key={t.id} issue={t} onPress={() => setOpenId(t.id)} />) : <Empty text="Nothing open." />}

      {closed.length ? (
        <>
          <SectionTitle>Closed</SectionTitle>
          {closed.map((t) => <IssueRow key={t.id} issue={t} onPress={() => setOpenId(t.id)} />)}
        </>
      ) : null}

      <ErrorText error={error} />
    </Screen>
  );
}

function TicketScreen({ token, ticket, onBack, onChanged }: { token: string; ticket: SupportTicket; onBack: () => void; onChanged: () => Promise<void> }) {
  const [current, setCurrent] = useState(ticket);
  // The conversation as the resident sees it: who they are writing to, and what has
  // arrived since they last looked.
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [detail, thread] = await Promise.all([
        api.getTicket(ticket.id, token),
        api.issueConversation(ticket.id, token),
      ]);
      setCurrent(detail.ticket);
      setConversation(thread.conversation);
    }
    catch { /* the ticket stays as it was until the next poll */ }
  }, [ticket.id, token]);
  useEffect(() => { refresh(); }, [refresh]);
  usePolling(refresh, POLL.dashboard);

  const send = async (body: string) => {
    setError(null);
    try {
      const r = await api.replyToTicket(current.id, body, token);
      setCurrent(r.ticket);
      await refresh();
      await onChanged();
    } catch (e) { setError((e as Error).message); }
  };

  const close = async () => {
    setError(null);
    try {
      const r = await api.closeTicket(current.id, token);
      setCurrent(r.ticket);
      setNote("Ticket closed. Thank you.");
      await onChanged();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen>
      <BackLink label="Support" onPress={onBack} />
      <TicketDetail issue={current} audience="resident" conversation={conversation}>
        {/* A photograph of the tear is the same complaint with the argument already
            settled. A resident may add and remove their own. */}
        <TicketPhotos ticketId={current.id} token={token} canAdd canRemoveOwn />
        {/* One conversation section. The label on the box says who is actually being
            written to — the operator, the supervisor or the admin — rather than a
            fixed "Message" that says nothing about where it is going. */}
        <ReplyBox conversation={conversation} onSend={send} />
        {current.status === "resolved" ? (
          <>
            <Notice tone="good" text="This was marked resolved. Close it if you are satisfied, or reply above if the problem is still there. Replying reopens it." />
            <Button label="Close this ticket" onPress={close} />
          </>
        ) : null}
      </TicketDetail>
      {note ? <Notice tone="good" text={note} /> : null}
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
      {/* Why nothing is arriving on the handset, where that is the case. Expo Go
          stopped delivering remote push at SDK 53, so a tester sees no
          notifications and nothing to explain it — the app looks broken when it is
          the container that is the limitation. The list below is the app's own and
          is unaffected either way. */}
      {pushUnavailableReason() ? <Notice text={pushUnavailableReason()!} /> : null}
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
  // Read-only until the person asks to edit. A profile is something you look at far
  // more often than you change, and a screen full of live text fields invites edits
  // nobody meant to make.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // What is currently saved, so Cancel can put the fields back to it.
  const resetFields = useCallback((p: ResidentProfile | null) => {
    setFullName(p?.fullName ?? "");
    setEmail(p?.email ?? "");
    setPickupAddress(p?.pickupAddress ?? "");
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.residentProfile(token);
      setProfile(r.profile);
      resetFields(r.profile);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, resetFields]);
  useEffect(() => { load(); }, [load]);

  const startEditing = () => { setNote(null); setError(null); setEditing(true); };
  const cancelEditing = () => { resetFields(profile); setError(null); setEditing(false); };

  const save = async () => {
    setNote(null); setError(null); setSaving(true);
    try {
      await api.updateResidentProfile({ fullName, email, pickupAddress }, token);
      setNote("Profile updated.");
      setEditing(false);
      await load();
    }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  return (
    <Screen refreshing={busy} onRefresh={load}>
      {/* Light and dark are one tap from the header; the full control with its
          wording still lives further down. Compact, so appearance no longer opens
          the page with a section the size of the profile itself. */}
      <PageTitle title="Profile" right={<AppearanceIcons />} />

      <Card>
        <Row label="Phone" value={profile?.phone} />
        <Row label="Society" value={profile?.societyName} />
        <Row label="Flat / unit" value={profile?.unitNumber} />
        <Row label="Account status" value={profile ? titleCase(profile.accountStatus ?? "") : "—"} />
        <Row label="Onboarding" value={profile?.onboardingCompleted ? "Completed" : "Pending"} />
      </Card>
      <Notice text="Your society and flat are managed by the Wash N Press team. Contact support if they need to change." />

      <SectionTitle
        action={editing ? undefined : <Button label="Edit profile" variant="secondary" onPress={startEditing} />}
      >
        Personal details
      </SectionTitle>
      {editing ? (
        <>
          <Field label="Full name" value={fullName} onChangeText={setFullName} />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          {!emailValid ? <Notice tone="warn" text="Enter a valid email address, such as name@example.com." /> : null}
          <Field label="Pickup address" value={pickupAddress} onChangeText={setPickupAddress} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label={saving ? "Saving…" : "Save changes"} onPress={save} disabled={saving || !emailValid} />
            <Button label="Cancel" variant="secondary" onPress={cancelEditing} disabled={saving} />
          </View>
        </>
      ) : (
        <Card>
          <Row label="Full name" value={profile?.fullName || "—"} />
          <Row label="Email" value={profile?.email || "—"} />
          <Row label="Pickup address" value={profile?.pickupAddress || "—"} />
        </Card>
      )}

      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />

      {/* Light and dark are chosen with the sun/moon icons in the header above. The
          separate Appearance section, and its follow-the-system option, are gone. */}
      <Button label="Sign out" variant="danger" onPress={onLogout} />
    </Screen>
  );
}

const styles = themed((theme) => ({
  // The one sentence a summary exists to deliver, set large enough that somebody who
  // reads nothing else on the screen still knows what they are agreeing to.
  // Times as chips rather than as a card each. Six windows were four hundred points
  // of page; they are one wrap now.
  slotWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  changeHint: { fontSize: 12, color: theme.muted, marginBottom: 8 },
  slotChip: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, minWidth: 116,
    backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border,
  },
  slotChipPicked: { backgroundColor: theme.ice, borderColor: theme.deepTeal },
  slotChipFull: { borderStyle: "dashed" },

  // I-82: the selectable cards on the booking wizard's first step — laundry and each
  // additional service. A chosen one takes the brand tint and border, the same way a
  // picked slot chip does.
  chooseCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, marginBottom: 8,
    backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border,
  },
  chooseCardOn: { backgroundColor: theme.ice, borderColor: theme.deepTeal },
  chooseTitle: { fontSize: 15, fontFamily: font.bold, color: theme.deepTeal },
  slotChipTime: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal },
  slotChipMeta: { fontSize: 11, color: theme.muted, marginTop: 2 },
  slotChipMuted: { color: theme.muted },

  summaryLead: { fontSize: 16, fontFamily: font.bold, color: theme.deepTeal },
  summaryBack: { fontSize: 13, color: theme.muted, marginTop: 4 },

  // The booking action, held above the page rather than at the end of it.
  stickyBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: theme.border,
    backgroundColor: theme.white,
  },
  stickySummary: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal },
  stickyProblem: { fontSize: 12, color: theme.amber, marginTop: 2 },
  stickyAction: { marginLeft: 12, minWidth: 150 },

  confirmRow: { flexDirection: "row" },
  planHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  planTier: { fontSize: 17, fontFamily: font.black, color: theme.deepTeal },
  planPrice: { fontSize: 20, fontFamily: font.black, color: theme.aqua, marginTop: 4 },
  planMeta: { fontSize: 12, color: theme.muted, marginTop: 2 },
  viewLink: { fontSize: 13, fontFamily: font.semi, color: theme.aqua, marginTop: 8 },
  meterText: { fontSize: 11, color: theme.muted, marginTop: 4, textAlign: "right" },
  slotRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  slotChosen: { borderColor: theme.aqua, borderWidth: 2 },
  slotTime: { fontSize: 16, fontFamily: font.bold, color: theme.deepTeal },
  slotMeta: { fontSize: 12, color: theme.muted, marginTop: 2 },
  groupRow: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 4 },
  walletLabel: { color: theme.ice, fontSize: 12 },
  walletValue: { color: theme.white, fontSize: 28, fontFamily: font.black, marginTop: 2 },
  txnRow: { flexDirection: "row", alignItems: "center" },
  txnRef: { fontSize: 14, fontFamily: font.semi, color: theme.slate },
  txnAt: { fontSize: 11, color: theme.muted, marginTop: 2 },
  txnAmount: { fontSize: 15, fontFamily: font.black },
  ticketType: { fontSize: 14, fontFamily: font.bold, color: theme.deepTeal },
  ticketBody: { fontSize: 13, color: theme.slate, marginTop: 6 },
  notifTitle: { fontSize: 14, fontFamily: font.bold, color: theme.deepTeal, flex: 1 },
  notifBody: { fontSize: 13, color: theme.slate, marginTop: 4 },
}));
