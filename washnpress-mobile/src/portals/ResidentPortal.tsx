import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api, ApiError } from "../api/client";
import { Dropdown } from "../components/filters";
import { CenteredModal } from "../components/modal";
import { DateField } from "../components/calendar";
import type {
  OrderDetail, OrderSummary, ResidentDashboard, ResidentProfile, Slot, SubscriptionUsage, Plan,
  Notification, SupportTicket, WalletTransaction, GarmentService, LineRequest, IssuePriority, PriceList,
  BookingOptions, ConversationView,
  PlanChangeQuote,
} from "../api/types";
import { theme, rupees, shortDate, dateTime, titleCase } from "../theme";
import { unitOf, isMeasured, formatQuantity, perUnitLabel, measurementLabel, parseMeasurement } from "../api/units";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Meter, Pill, BackLink, Counter,
} from "../components/ui";
import { OrderCard, OrderDetailBody } from "../components/order";
import { IssueRow, TicketDetail, ReplyBox } from "../components/support";
import { usePolling, POLL } from "../hooks";
import { SchedulesScreen, ServicesScreen } from "./resident-extras";

type Tab = "home" | "book" | "services" | "orders" | "plan" | "wallet" | "support" | "alerts" | "profile";

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

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={(next) => setTab(next)}
        options={[
          { key: "home", label: "Home" },
          { key: "book", label: "Booking" },
          { key: "services", label: "Services" },
          { key: "orders", label: "Orders" },
          { key: "plan", label: "Plan" },
          { key: "wallet", label: "Wallet" },
          { key: "support", label: "Support" },
          { key: "alerts", label: "Alerts", badge: unread },
          { key: "profile", label: "Profile" },
        ]}
      />
      {tab === "home" && <ResidentHome token={token} onOpenOrder={setOpenOrderId} onBook={() => setTab("book")} onAlerts={() => setTab("alerts")} onPlans={() => setTab("plan")} />}
      {tab === "book" && <BookPickupScreen token={token} onBooked={(id) => { setOpenOrderId(id); }} />}
      {tab === "services" && <ServicesScreen token={token} />}
      {tab === "orders" && <ResidentOrdersScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "plan" && <SubscriptionScreen token={token} />}
      {tab === "wallet" && <WalletScreen token={token} />}
      {tab === "support" && <SupportScreen token={token} orders={recentOrders} />}
      {tab === "alerts" && <NotificationsScreen token={token} onChanged={refreshUnread} onOpenOrder={setOpenOrderId} />}
      {tab === "profile" && <ProfileScreen token={token} onLogout={onLogout} />}
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function ResidentHome({ token, onOpenOrder, onBook, onAlerts, onPlans }: { token: string; onOpenOrder: (id: string) => void; onBook: () => void; onAlerts: () => void; onPlans: () => void }) {
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
          : `Welcome back${data?.residentName ? `, ${data.residentName}` : ""}`}
        subtitle={firstLogin ? "Let's get you started" : "Your account at a glance"}
      />
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
        <>
          <SectionTitle>Subscription</SectionTitle>
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

// The categories come from the configuration the admin actually set, read from the
// price list the backend already sends. They used to be a copy in this file, so
// adding or renaming a category in Configuration left the booking screen offering
// the old list — and a booking for a category that no longer existed.
const FALLBACK_CATEGORIES = ["Shirts", "T-Shirts", "Trousers", "Jeans", "Sarees", "Bedsheets", "Towels", "Jackets", "Other"];

function BookPickupScreen({ token, onBooked }: { token: string; onBooked: (orderId: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [pricing, setPricing] = useState<PriceList | null>(null);
  // Who this resident is and what therefore applies to them. One Booking module
  // serves subscribers and everybody else; the difference comes from here rather
  // than from two separate screens.
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [showStanding, setShowStanding] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [services, setServices] = useState<GarmentService[]>([]);
  const [lines, setLines] = useState<LineRequest[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.bookingPreview>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  // Draft for the "add garments" row.
  const [draftCategory, setDraftCategory] = useState<string | null>(null);
  const [draftService, setDraftService] = useState<string | null>(null);
  const [draftQuantity, setDraftQuantity] = useState(0);
  // What the resident weighs or times, for a service that is not simply counted.
  // Typed rather than counted, because 4.5 kg is a real answer and a counter cannot
  // give it.
  const [draftMeasurement, setDraftMeasurement] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError(null); setSelected(null); setPreview(null);
    try {
      const [slotRes, serviceRes, priceRes, optionRes] = await Promise.all([
        api.getSlots(date, token), api.getServices(), api.getPricing(token), api.bookingOptions(token),
      ]);
      setPricing(priceRes);
      setOptions(optionRes);
      setSlots(slotRes.slots);
      setServices(serviceRes.services);
      // Whatever the admin has configured, not a copy kept in this file.
      setDraftCategory((current) => current ?? priceRes.garments[0]?.category ?? FALLBACK_CATEGORIES[0]);
      setDraftService((current) => current ?? serviceRes.services.find((x) => x.isBase)?.id ?? serviceRes.services[0]?.id ?? null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [date, token]);
  useEffect(() => { load(); }, [load]);

  const totalGarments = lines.reduce((sum, l) => sum + l.quantity, 0);

  const serviceOf = (id: string | null) => services.find((x) => x.id === id) ?? null;
  const optionOf = (id: string | null) => options?.services.find((x) => x.id === id) ?? null;
  // 0 is Sunday. The chosen date decides which services the plan will collect.
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const collectsOn = (id: string) => {
    const option = optionOf(id);
    return !option || option.allowedDays.length === 0 || option.allowedDays.includes(weekday);
  };
  // Why a service cannot be chosen today, said in a sentence rather than by simply
  // not appearing.
  const unavailableBecause = (id: string): string | null => {
    const option = optionOf(id);
    if (!option) return null;
    if (!collectsOn(id)) return option.frequencyLabel ? `Collected ${option.frequencyLabel.toLowerCase()}` : "Not collected on this day";
    if (option.includedInPlan && option.additionalUsage === "block" && (option.allowance?.remaining ?? 0) <= 0) {
      return "Your plan allowance for this is used up";
    }
    return null;
  };
  const draftUnit = unitOf(serviceOf(draftService));
  // A weighed or timed service needs its own measurement; a counted one is fully
  // described by the garment count already being collected.
  const draftMeasured = isMeasured(draftUnit) ? parseMeasurement(draftMeasurement, draftUnit) : null;
  const draftReady = Boolean(draftCategory && draftService)
    && draftQuantity > 0
    && (!isMeasured(draftUnit) || draftMeasured !== null);

  const addLine = () => {
    // No category chosen yet means the configuration has not loaded, and there is
    // nothing sensible to add.
    if (!draftCategory || !draftService || !draftReady) return;
    setLines((current) => {
      // The same category and service is one line, so adding twice adds up rather
      // than producing two rows that mean the same thing.
      const match = current.findIndex((l) => l.category === draftCategory && l.serviceId === draftService);
      if (match >= 0) {
        const next = [...current];
        next[match] = {
          ...next[match],
          quantity: next[match].quantity + draftQuantity,
          // Two bags of washing added separately weigh what they weigh together.
          ...(draftMeasured !== null
            ? { measuredQuantity: (next[match].measuredQuantity ?? 0) + draftMeasured }
            : {}),
        };
        return next;
      }
      return [...current, {
        category: draftCategory, quantity: draftQuantity, serviceId: draftService,
        ...(draftMeasured !== null ? { measuredQuantity: draftMeasured } : {}),
      }];
    });
    setDraftQuantity(0);
    setDraftMeasurement("");
  };

  const choose = async (slot: Slot) => {
    setSelected(slot); setError(null);
    try { setPreview(await api.bookingPreview(slot.id, totalGarments || undefined, lines.length ? lines : undefined, token)); }
    catch (e) { setError((e as Error).message); }
  };

  const confirm = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const r = await api.bookPickup({
        slotId: selected.id,
        estimatedCount: totalGarments || undefined,
        specialInstructions: instructions || undefined,
        lines: lines.length ? lines : undefined,
      }, token);
      onBooked(r.order.id);
    } catch (e) {
      // A slot can fill up between loading the page and confirming. The booking
      // fails cleanly and the list is reloaded rather than overselling capacity.
      const code = (e as ApiError).code;
      setError(
        code === "slot_unavailable" ? "That slot just filled up. Please choose another."
          : code === "subscribers_only_slot" ? "That slot is kept for residents on a plan."
          // The plan refusing the order is a different thing from the slot refusing
          // it: the resident has to change what they asked for, not when.
          : code === "plan_does_not_allow" || code === "needs_approval" ? (e as Error).message
          : (e as Error).message,
      );
      await load();
    } finally { setBusy(false); }
  };

  const serviceName = (id: string) => services.find((x) => x.id === id)?.name ?? id;

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

        {preview.lines.length ? (
          <>
            <SectionTitle>Garments and services</SectionTitle>
            <Card>
              {preview.lines.map((line) => {
                const unit = line.unit ?? "piece";
                // Said in the service's own unit, and split the way the plan splits
                // it: what the allowance absorbs and what falls outside it.
                const measured = unit === "piece" ? null : line.measuredQuantity ?? null;
                const covered = line.coveredQuantity ?? 0;
                const extra = line.additionalQuantity ?? 0;
                return (
                  <Row
                    key={line.id}
                    label={[
                      `${line.category} × ${line.quantity} · ${line.serviceName}`,
                      measured ? formatQuantity(unit, measured) : null,
                      covered > 0 && extra > 0
                        ? `${formatQuantity(unit, covered)} in your plan, ${formatQuantity(unit, extra)} beyond it`
                        : covered > 0 && extra === 0 ? "Within your plan" : null,
                    ].filter(Boolean).join(" · ")}
                    value={line.linePricePaise ? rupees(line.linePricePaise) : "Included"}
                  />
                );
              })}
              <Row label="Service charges" value={rupees(preview.servicesPaise)} />
            </Card>
          </>
        ) : null}

        <SectionTitle>Pricing</SectionTitle>
        <Card>
          <Row label="Current plan" value={preview.subscription?.planTier ?? "No active plan"} />
          <Row label="Estimated garments" value={preview.estimatedCount ?? "Not given"} />
          {preview.hasSubscription ? <Row label="Covered by your plan" value={preview.estimatedCoveredCount} /> : null}
          <Row
            label={preview.hasSubscription ? "Rate beyond the allowance" : "Beyond your selection"}
            value={`${rupees(preview.perGarmentRatePaise)} each`}
          />
          <Row label="Estimated total" value={rupees(preview.estimatedChargeablePaise)} />
        </Card>

        {preview.hasSubscription && preview.subscription?.services?.length ? (
          <>
            {/* Each service has its own allowance in its own unit. A single figure
                for the whole plan could not say "40 kg of washing and 30 pieces of
                ironing", and hid the fact that one was spending the other. */}
            <SectionTitle>What your plan includes</SectionTitle>
            <Card>
              {preview.subscription.services.map((a) => (
                <Row
                  key={a.serviceId}
                  label={a.serviceName}
                  value={a.remainingLabel}
                />
              ))}
            </Card>
            <Notice text="Each service has its own allowance. Using one never reduces another." />
          </>
        ) : preview.hasSubscription ? (
          <Card>
            <Row label="Allowance" value={`${preview.subscription?.allowance ?? 0} garments`} />
            <Row label="Used" value={preview.subscription?.used ?? 0} />
            <Row label="Remaining" value={`${preview.subscription?.remaining ?? 0} garments`} />
          </Card>
        ) : null}

        {/* What each garment actually costs, rather than one rate that matches
            nothing. The resident sees this before confirming, so there is no
            ambiguity about how the order will be charged. */}
        <SectionTitle>Garment prices</SectionTitle>
        {pricing?.garments?.length ? (
          <Card>
            {pricing.garments.map((g) => (
              <Row key={g.category} label={g.category} value={`${rupees(g.payAsYouGoPaise)} each`} />
            ))}
          </Card>
        ) : <Empty text="Prices are loading." />}

        {preview.hasSubscription ? (
          <Notice text={`Garments sent for a service your ${preview.subscription?.planTier} plan covers come out of your allowance. Anything else, or anything beyond the allowance, is charged at the prices above.`} />
        ) : (
          <Notice text="You are booking without a subscription. You will be charged according to the price of each garment category." />
        )}
        <Notice text={preview.note} />

        {/* What the plan will not allow, said before the resident commits rather
            than as an error afterwards. */}
        {preview.blockedBy ? (
          <Notice
            tone="warn"
            text={preview.blockedBy.reason ?? `Your plan does not allow that much ${preview.blockedBy.serviceName}.`}
          />
        ) : null}

        <Field label="Special instructions (optional)" value={instructions} onChangeText={setInstructions} placeholder="Doorbell not working, call on arrival" />
        <Button label="Confirm booking" onPress={confirm} disabled={busy || preview.canBook === false} />
        <Button label="Change slot" variant="secondary" onPress={() => { setSelected(null); setPreview(null); }} />
        <ErrorText error={error} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Schedule a pickup" subtitle="Slots for your society only" />
      {/* A calendar that cannot offer a day already gone, so an unbookable date is
          not something the resident has to be told about after the fact. */}
      <DateField
        label="Date"
        value={date}
        onChange={(next) => setDate(next ?? today)}
        minDate={today}
        clearable={false}
      />

      {/* Who is booking, and what that means. One module serves both, so the screen
          says which of the two experiences applies rather than hiding it. */}
      {options?.subscriber ? (
        <>
          <SectionTitle action={<Pill text={options.plan?.tier ?? "Plan"} color={theme.aqua} />}>Your plan</SectionTitle>
          <Card>
            <Row label="Plan" value={options.plan?.name ?? options.plan?.tier ?? null} />
            {options.plan?.description ? <Row label="About" value={options.plan.description} /> : null}
            <Row label="Turnaround" value={`${options.turnaroundHours} hours`} />
            {options.plan?.renewalDate ? <Row label="Renews" value={shortDate(options.plan.renewalDate)} /> : null}
            {options.preferredWindows.length
              ? <Row label="Preferred windows" value={options.preferredWindows.join(", ")} />
              : null}
          </Card>
          <SectionTitle>What your plan includes</SectionTitle>
          <Card>
            {options.services.filter((x) => x.includedInPlan).map((x) => (
              <Row
                key={x.id}
                label={x.frequencyLabel ? `${x.name} · ${x.frequencyLabel}` : x.name}
                value={x.allowance?.remainingLabel ?? null}
              />
            ))}
          </Card>
          <Notice text="Each service has its own allowance in its own unit. Using one never reduces another." />
        </>
      ) : options ? (
        <>
          <SectionTitle>Booking without a plan</SectionTitle>
          <Notice text="You are booking as a pay-as-you-go customer. Each service is charged at its own price, shown beside it." />
          <Card>
            {options.services.map((x) => (
              <Row key={x.id} label={x.name} value={`${rupees(x.pricePaise)} ${perUnitLabel(x.unit)}`} />
            ))}
          </Card>
        </>
      ) : null}

      {/* The standing arrangement used to be a separate Regular section. It is part
          of booking, so it lives here rather than in a tab of its own. */}
      <SectionTitle
        action={<Button label={showStanding ? "Hide" : "Manage"} variant="secondary" onPress={() => setShowStanding((v) => !v)} />}
      >
        Standing arrangement
      </SectionTitle>
      {showStanding
        ? <SchedulesScreen token={token} />
        : <Notice text="Set up a repeating collection so you do not have to book each time." />}

      <SectionTitle>What are you sending? (optional)</SectionTitle>
      <Notice text="Different garments of the same type can go for different services. Add a row for each, for example four shirts for dry cleaning and six for a normal wash." />
      <Card>
        <Dropdown
          label="Garment"
          value={draftCategory ?? undefined}
          allLabel="Choose a garment"
          options={(pricing?.garments.length ? pricing.garments.map((g) => g.category) : FALLBACK_CATEGORIES)
            .map((category) => ({ value: category, label: category }))}
          onChange={(v) => setDraftCategory(v ?? null)}
        />
        <Dropdown
          label="Service"
          value={draftService ?? undefined}
          allLabel="Choose a service"
          options={services.map((service) => {
            const option = optionOf(service.id);
            const unit = option?.unit ?? unitOf(service);
            // Unavailable today is said on the row itself, so the reason is where
            // the resident is looking rather than in an error after they commit.
            const blocked = unavailableBecause(service.id);
            if (blocked) return { value: service.id, label: `${service.name} — ${blocked}` };
            // What the plan has left of it, for a subscriber, or what it costs for
            // anybody else. The price is said with what it is per, because "80.00"
            // means one thing per kilogram and quite another per shirt.
            if (option?.includedInPlan && option.allowance) {
              return {
                value: service.id,
                label: `${service.name} (${formatQuantity(unit, option.allowance.remaining)} left)`,
              };
            }
            const price = option?.pricePaise ?? service.unitPricePaise;
            return {
              value: service.id,
              label: price ? `${service.name} (${rupees(price)} ${perUnitLabel(unit)})` : service.name,
            };
          })}
          onChange={(v) => setDraftService(v ?? null)}
        />
        <Counter label="How many garments" value={draftQuantity} onChange={setDraftQuantity} />
        {isMeasured(draftUnit) ? (
          <>
            {/* Weighed rather than counted, so the resident is asked for the
                measurement the bill is actually worked out from. The operator
                weighs it again at collection and that is what finally applies. */}
            <Field
              label={measurementLabel(draftUnit)}
              value={draftMeasurement}
              onChangeText={setDraftMeasurement}
              placeholder={draftUnit === "kg" ? "4.5" : "2"}
              keyboardType="number-pad"
            />
            <Notice text={`${serviceOf(draftService)?.name ?? "This service"} is charged ${perUnitLabel(draftUnit)}. Your estimate is confirmed against the scale when it is collected.`} />
          </>
        ) : null}
        <Button
          label="Add to order"
          variant="secondary"
          onPress={addLine}
          disabled={!draftReady || Boolean(draftService && unavailableBecause(draftService))}
        />
        {draftService && unavailableBecause(draftService)
          ? <Notice tone="warn" text={`${serviceOf(draftService)?.name}: ${unavailableBecause(draftService)}. Choose another day or another service.`} />
          : null}
      </Card>

      {lines.length ? (
        <>
          <SectionTitle action={<Pill text={`${totalGarments} garments`} color={theme.aqua} />}>Your order</SectionTitle>
          {lines.map((line, index) => (
            <Card key={`${line.category}-${line.serviceId}`}>
              <View style={styles.slotRow}>
                <View>
                  <Text style={styles.slotTime}>{line.category} × {line.quantity}</Text>
                  <Text style={styles.slotMeta}>
                    {serviceName(line.serviceId)}
                    {line.measuredQuantity
                      ? ` · ${formatQuantity(unitOf(serviceOf(line.serviceId)), line.measuredQuantity)}`
                      : ""}
                  </Text>
                </View>
                <Button label="Remove" variant="danger" onPress={() => setLines((c) => c.filter((_, i) => i !== index))} />
              </View>
            </Card>
          ))}
        </>
      ) : null}

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
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.residentOrders(token, { orderCode: search || undefined });
      setData({ current: r.current ?? [], upcoming: r.upcoming ?? [], previous: r.previous ?? [] });
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
      {orders.length
        ? orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              showSociety={false}
              onPress={() => onOpenOrder(o.id)}
              onPay={() => pay(o)}
            />
          ))
        : <Empty text="Nothing in this group." />}
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

  if (busy && !order) return <Loading />;
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
            {plan.isCurrent ? <Pill text="✓ CURRENT PLAN" color={theme.success} /> : null}
          </View>
          <Text style={styles.planMeta}>{plan.garmentCap} garments · {plan.turnaroundHours}h turnaround</Text>
          {plan.coveredServiceIds?.length ? (
            <Text style={styles.planMeta}>Included: {plan.coveredServiceIds.length} service{plan.coveredServiceIds.length === 1 ? "" : "s"} at no extra charge</Text>
          ) : null}
          <Text style={styles.planPrice}>{rupees(plan.monthlyPaise)} / month</Text>
          {/* The plan they are on is not something to buy again, so it says so and
              offers nothing. A scheduled change says when it starts, and can be
              called off from here. */}
          {plan.isCurrent ? (
            <Button label="Current plan" variant="secondary" disabled onPress={() => {}} />
          ) : current?.pendingPlan?.planId === plan.id ? (
            <>
              <Text style={styles.planMeta}>
                Scheduled to start {shortDate(current.pendingPlan.effectiveFrom)}
              </Text>
              <Button label="Cancel change" variant="secondary" onPress={cancelChange} />
            </>
          ) : (
            <Button
              label={!current ? "Subscribe" : (current.monthlyPaise < plan.monthlyPaise ? "Upgrade" : "Downgrade")}
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
      await api.createTicket({ category: type, description, orderId: orderId ?? undefined, priority }, token);
      setDescription(""); setOrderId(null); setPriority("normal"); setComposing(false);
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
        title="Help and support"
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
        {/* One conversation section. The label on the box says who is actually being
            written to — the operator, the supervisor or the admin — rather than a
            fixed "Message" that says nothing about where it is going. */}
        <ReplyBox conversation={conversation} onSend={send} />
        {current.status === "resolved" ? (
          <>
            <Notice tone="good" text="This was marked resolved. Close it if you are satisfied, or reply above if the problem is still there — replying reopens it." />
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
  confirmRow: { flexDirection: "row" },
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
