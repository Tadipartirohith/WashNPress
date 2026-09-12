import { slotCapacityProblem } from "./slot-capacity-rules";
import { useCallback, useEffect, useState } from "react";
import { themed } from "../components/themed";
import { AppearanceIcons } from "../components/appearance-setting";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { api } from "../api/client";
import type {
  Assignee,
  ConversationView,
  Issue, OrderDetail, OrderSummary, PickupQueueItem, ReportsResponse, Slot, Society,
  StaffUser, SupervisorDashboard, Workload, HandoverPreview, SlotWindows, SocietyAssignment,
  BlockDetail, PlanUsage, GarmentService, ServiceOffering, SlotBooking,
  QcRow, SupervisorSearchResponse, SupervisorProcessing,
} from "../api/types";
import { formatQuantity, perUnitLabel } from "../api/units";
import { PlanWizard } from "./admin-plan-wizard";
import { font, theme, type, rupees, shortDate, dateTime, titleCase, stateLabel } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, FieldRow, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, StatePill, BackLink, Stat, StatGrid, CardGrid,
  SlotWindowPicker, DEFAULT_SLOT_WINDOWS, to12Hour, LegalLinks,
} from "../components/ui";
import { BottomTabBar, MoreMenu, type BottomTabItem, type MoreMenuSection } from "../components/bottom-nav";
import { OrderList, OrderDetailBody, IssueCard, PaymentPill, orderTotal } from "../components/order";
import { CardAction, Dash, orDash } from "../components/records";
import { IssueRow, TicketDetail, TicketHandling, TicketPhotos, ReplyBox } from "../components/support";
import { usePolling, useDebounced, POLL, useHardwareBack } from "../hooks";
import { backAction } from "./back-rules";
import { DateField, formatFriendly, todayIso } from "../components/calendar";
import { AssignmentPanel, supervisorAssignmentApi } from "./assignment-panel";
import { StaffWizard } from "./staff-wizard";
import { CenteredModal, StepIndicator, WizardFooter } from "../components/modal";
import { DataTable, Dropdown, FilterRow, ConfirmDialog, type FilterValues } from "../components/filters";
import { ServiceBookingsScreen } from "./service-bookings";
import { AttentionBand, Pipeline, MetaStrip } from "../components/dashboard";
import { pipelineOf } from "./dashboard-rules";
import {
  SUPERVISOR_PRIMARY, SUPERVISOR_ORDER_VIEWS,
  type SupervisorTab as Tab, type SupervisorOrderView,
} from "./supervisor-rules";
import { slotRows } from "./slot-list-rules";
import { SUBSCRIPTION_STATUSES, remainingGarments, subscriptionRows } from "./subscription-table-rules";
import type { ResidentSubscriptionRow } from "../api/types";

export function SupervisorPortal({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [openSocietyId, setOpenSocietyId] = useState<string | null>(null);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  // The order list's own filters, kept up here rather than inside the screen.
  // Opening an order unmounts that screen, so state held inside it was rebuilt
  // from nothing on the way back: no filters, no search, no scroll position.
  // Which is what made Back feel as though it had gone somewhere else entirely.
  const [orderFilters, setOrderFilters] = useState<FilterValues>({});
  // Which of the five views of the pipeline the Orders tab is showing. Pickups,
  // processing, quality checks and delayed orders were four destinations, three of
  // them behind "More"; they are one tab with a switcher now, as on the web.
  const [orderView, setOrderView] = useState<SupervisorOrderView>("orders");

  // Android's back button; see `back-rules`. Before the early returns, because a
  // hook that only runs when no record is open is not registered when one is.
  useHardwareBack(() => {
    const recordOpen = Boolean(openOrderId || openBlockId || openSocietyId);
    switch (backAction({ recordOpen, tab, homeTab: "home" })) {
      case "closeRecord":
        // Innermost first: an order opened from a society closes back to the society
        // rather than all the way out to the tab.
        if (openOrderId) setOpenOrderId(null);
        else if (openBlockId) setOpenBlockId(null);
        else setOpenSocietyId(null);
        return true;
      case "goHome": setTab("home"); return true;
      default: return false;
    }
  });

  if (openOrderId) return <SupervisorOrderScreen token={token} orderId={openOrderId} onBack={() => setOpenOrderId(null)} />;
  if (openBlockId) return <BlockDetailScreen token={token} blockId={openBlockId} onBack={() => setOpenBlockId(null)} />;
  if (openSocietyId) return <SocietyDetailScreen token={token} societyId={openSocietyId} onBack={() => setOpenSocietyId(null)} onOpenOrder={setOpenOrderId} />;

  const primaryItems: BottomTabItem<Tab>[] = [
    { key: "home", label: "Dashboard", icon: "layoutDashboard" },
    { key: "orders", label: "Orders", icon: "package" },
    { key: "mysociety", label: "Society", icon: "building" },
    { key: "issues", label: "Issues", icon: "alertCircle" },
    { key: "more", label: "More", icon: "moreHorizontal" },
  ];
  // Opening the Orders list already narrowed to one order state. Backs the
  // dashboard's pipeline drill-down: tapping a stage lands on the orders it holds
  // rather than on the whole list. Reuses the Orders screen and its own state
  // filter — there is no separate per-stage screen to keep in step.
  const openOrdersFiltered = (state: string) => {
    setOrderFilters(state ? { state } : {});
    // The tab now holds five views; a drill-down means the list, not whichever view
    // happened to be open last.
    setOrderView("orders");
    setTab("orders");
  };

  const moreSections: MoreMenuSection[] = [
    {
      title: "Find",
      items: [
        { key: "search", label: "Search", icon: "search", onPress: () => setTab("search") },
      ],
    },
    {
      title: "Area",
      items: [
        { key: "operators", label: "Operators", icon: "users", onPress: () => setTab("operators") },
        { key: "slots", label: "Slots", icon: "clock", onPress: () => setTab("slots") },
      ],
    },
    {
      title: "Catalogue & money",
      items: [
        { key: "services", label: "Additional Services", icon: "sparkles", onPress: () => setTab("services") },
        { key: "plans", label: "Plans", icon: "fileText", onPress: () => setTab("plans") },
      ],
    },
    {
      title: "Account",
      items: [{ key: "profile", label: "Profile", icon: "user", onPress: () => setTab("profile") }],
    },
  ];
  const barValue: Tab = SUPERVISOR_PRIMARY.includes(tab) ? tab : "more";

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === "home" && <SupervisorHome token={token} onGoto={setTab} onOpenStage={openOrdersFiltered} />}
        {tab === "search" && <SupervisorSearchScreen token={token} onOpenOrder={setOpenOrderId} onGoto={setTab} />}
        {tab === "mysociety" && (
          <MySocietyScreen token={token} onOpenDetail={setOpenSocietyId} onOpenBlock={setOpenBlockId} />
        )}
        {tab === "slots" && <SlotsScreen token={token} />}
        {tab === "operators" && <OperatorsScreen token={token} />}
        {/* One tab, five views of the same pipeline — the shape the web portal has
            always had. The switcher stays put while the view under it changes, so
            moving from an order to the quality check on it is one tap rather than a
            trip out to "More". */}
        {tab === "orders" && (
          <View style={{ flex: 1 }}>
            <Tabs
              value={orderView}
              onChange={setOrderView}
              options={SUPERVISOR_ORDER_VIEWS.map((v) => ({ key: v.key, label: v.label }))}
            />
            {orderView === "orders" && (
              <SupervisorOrdersScreen
                token={token}
                filters={orderFilters}
                onFilters={setOrderFilters}
                onOpenOrder={setOpenOrderId}
              />
            )}
            {orderView === "pickups" && <PickupsScreen token={token} onOpenOrder={setOpenOrderId} />}
            {orderView === "processing" && <ProcessingScreen token={token} onOpenOrder={setOpenOrderId} />}
            {orderView === "qc" && <SupervisorQcScreen token={token} onOpenOrder={setOpenOrderId} />}
            {orderView === "delayed" && <DelayedScreen token={token} onOpenOrder={setOpenOrderId} />}
          </View>
        )}
        {tab === "services" && (
          <ServiceBookingsScreen
            source={{ load: (params) => api.supServices(token, params) }}
            title="Service bookings"
            subtitle="Car washing, at-home ironing and the rest, in your society"
          />
        )}
        {tab === "plans" && <SupervisorPlansScreen token={token} />}
        {tab === "issues" && <SupervisorIssuesScreen token={token} />}
        {tab === "profile" && <SupervisorProfileScreen token={token} onLogout={onLogout} />}
        {tab === "more" && <MoreMenu sections={moreSections} />}
      </View>
      <BottomTabBar items={primaryItems} value={barValue} onChange={setTab} />
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function SupervisorHome({ token, onGoto, onOpenStage }: { token: string; onGoto: (tab: Tab) => void; onOpenStage: (state: string) => void }) {
  const [data, setData] = useState<SupervisorDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.supDashboard(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.dashboard);

  if (busy && !data) return <Loading />;
  const o = data?.orders;
  const issues = data?.issues;
  // Only the cleaning stages this society's orders actually need, so a supervisor
  // is not shown a fixed workflow that has nothing to do with what was sent in.
  const stages = data?.processing?.stages ?? [];
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Supervisor Dashboard"
        subtitle={data?.society ? data.society.addressLine : "No society assigned"}
      />
      <ErrorText error={error} />
      {!data?.society ? <Notice tone="warn" text="You have not been assigned to a society yet. Ask an admin to assign one." /> : null}

      {/* What needs the supervisor, first and alone.
          This page used to be six grids and twenty-four tiles — including a
          "Quick actions" grid of eight arrows duplicating the tab bar directly
          above it — so a failed pickup got exactly as much of the screen as the
          number of towers in the society, and neither stood out. */}
      <SectionTitle>Needs Your Attention</SectionTitle>
      <AttentionBand
        scope={data?.society?.name ?? "your society"}
        onOpen={(item) => onGoto(item.goto as Tab)}
        items={[
          { key: "failed", label: "pickups failed", count: data?.pickups.failed ?? 0, tone: "danger", goto: "pickups" },
          { key: "delayed", label: "orders running late", count: o?.delayed ?? 0, tone: "danger", goto: "delayed" },
          { key: "escalatedAdmin", label: "issues escalated to an admin", count: issues?.escalatedAdmin ?? 0, tone: "danger", goto: "issues" },
          { key: "openIssues", label: "issues open", count: issues?.open ?? 0, tone: "danger", goto: "issues" },
          { key: "qcFailed", label: "orders failed quality check", count: data?.processing?.qcFailed ?? 0, tone: "warn", goto: "orders" },
          { key: "pendingPickups", label: "pickups still to collect", count: data?.pickups.pending ?? 0, tone: "warn", goto: "pickups" },
          { key: "inProgressIssues", label: "issues in progress", count: issues?.inProgress ?? 0, tone: "warn", goto: "issues" },
        ]}
      />

      {/* Where the society's work is, as a flow rather than as four grids that
          each held part of it. */}
      <SectionTitle>Processing breakdown</SectionTitle>
      <Pipeline
        stages={pipelineOf({
          scheduled: o?.scheduled,
          pickedUp: o?.pickedUp,
          washing: o?.washing,
          ironing: o?.ironing,
          qcPending: data?.processing?.qcPending,
          qcFailed: data?.processing?.qcFailed,
          readyForDelivery: o?.readyForDelivery,
          outForDelivery: o?.outForDelivery,
        })}
        onOpen={(stage) => onOpenStage(stage.goto ?? "")}
        emptyText="Nothing is in progress in this society right now."
      />

      {/* The day, in one line. */}
      <MetaStrip
        onOpen={(key) => onGoto(key as Tab)}
        items={[
          { key: "pickups", label: "pickups today", value: data?.pickups.today ?? 0 },
          { key: "orders", label: "orders today", value: o?.today ?? 0 },
          { key: "orders", label: "delivered", value: o?.delivered ?? 0 },
          { key: "issues", label: "issues resolved", value: issues?.resolved ?? 0 },
        ]}
      />

      {/* The society itself: what it is made of. It changes when an admin changes
          it, which is not most mornings, so it reads as reference rather than as
          four tiles competing with a failed pickup. */}
      <SectionTitle>{data?.society?.name ?? "My society"}</SectionTitle>
      <Card onPress={() => onGoto("mysociety")}>
        <Row label="Towers" value={data?.blocks?.length ? data.blocks.map((b) => b.name).join(", ") : "None yet"} />
        <Row label="Flats" value={data?.blocks?.reduce((total, b) => total + b.flatCount, 0) ?? 0} figure />
        <Row label="Residents" value={data?.residents.total ?? 0} figure />
        <Row label="Operations staff" value={`${data?.operationsStaff.active ?? 0} active of ${data?.operationsStaff.total ?? 0}`} />
      </Card>
    </Screen>
  );
}

// ----------------------------------------------------------------- societies

// The one society this supervisor runs, and how its towers are covered.
//
// A supervisor used to answer for an area — every society in it — and had no screen
// that said which society was theirs, because none of them was. What they can change
// here is who covers which block; which society is theirs is an admin's decision, and
// the panel says so rather than offering a dropdown that would be refused.
function MySocietyScreen({ token, onOpenDetail, onOpenBlock }: {
  token: string;
  onOpenDetail: (id: string) => void;
  onOpenBlock: (blockId: string) => void;
}) {
  const [mine, setMine] = useState<SocietyAssignment | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setMine(await api.supMySociety(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !mine) return <Loading />;
  const society = mine?.society ?? null;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title={society ? society.name : "My society"}
        subtitle={society ? society.addressLine : "Waiting to be assigned"}
      />
      <ErrorText error={error} />
      {society ? (
        <Card>
          <View style={styles.headRow}>
            <Text style={styles.title}>{society.name}</Text>
            <Pill text={titleCase(society.status)} color={society.status === "active" ? theme.success : theme.muted} />
          </View>
          <Row label="Address" value={society.addressLine} />
          <Row label="Blocks" value={society.blockNames?.length ? society.blockNames.join(", ") : "None yet"} />
          <Row label="Residents" value={society.residentCount ?? 0} />
          <Row label="Operations staff" value={society.operationsStaffCount ?? 0} />
          <Row label="Active orders" value={society.activeOrderCount ?? 0} />
          <Row label="Available slots" value={society.availableSlots ?? 0} />
        </Card>
      ) : null}
      {society ? (
        <View style={styles.detailLink}>
          <Button label="Residents, slots, orders and issues" variant="secondary" onPress={() => onOpenDetail(society.id)} />
        </View>
      ) : null}
      {society ? (
        <AssignmentPanel
          source={supervisorAssignmentApi(society.id, token)}
          title="Blocks and operators"
          subtitle="Who covers which tower. An operator sees and handles only the blocks assigned to them."
          onOpenBlock={onOpenBlock}
        />
      ) : (
        <Notice
          tone="warn"
          text="No society is assigned to you yet. An admin assigns one from Societies, and this page fills in as soon as they do."
        />
      )}
    </Screen>
  );
}

// Every state an order can be in, in the order it passes through them.
const SUPERVISOR_ORDER_STATES = [
  "scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold",
  "ready_for_delivery", "out_for_delivery", "delivered", "cancelled", "pickup_failed",
];

function SocietyDetailScreen({ token, societyId, onBack, onOpenOrder }: { token: string; societyId: string; onBack: () => void; onOpenOrder: (id: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.supSociety>> | null>(null);
  const [section, setSection] = useState<"overview" | "residents" | "operations" | "slots" | "orders" | "issues">("overview");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.supSociety(societyId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [societyId, token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !data) return <Loading />;
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={section}
        onChange={setSection}
        options={[
          { key: "overview", label: "Overview" },
          { key: "residents", label: "Residents", badge: data?.residents.length },
          { key: "operations", label: "Operations", badge: data?.operators.length },
          { key: "slots", label: "Slots", badge: data?.slots.length },
          { key: "orders", label: "Orders", badge: data?.orders.length },
          { key: "issues", label: "Issues", badge: data?.issues.length },
        ]}
      />
      <Screen refreshing={busy} onRefresh={load} resetOn={section}>
        <BackLink label="My society" onPress={onBack} />
        <PageTitle title={data?.society.name ?? "Society"} subtitle={data?.society.addressLine} />
        <ErrorText error={error} />

        {section === "overview" ? (
          <Card>
            <Row label="Address" value={data?.society.addressLine} />
            <Row label="Blocks" value={data?.society.blockNames?.length ? data.society.blockNames.join(", ") : "None yet"} />
            <Row label="Status" value={data ? titleCase(data.society.status) : "—"} />
            <Row label="Supervisor" value={data?.society.supervisorName} />
            <Row label="Residents" value={data?.society.residentCount ?? 0} />
            <Row label="Operations staff" value={data?.society.operationsStaffCount ?? 0} />
            <Row label="Active orders" value={data?.society.activeOrderCount ?? 0} />
            <Row label="Available slots" value={data?.society.availableSlots ?? 0} />
          </Card>
        ) : null}

        {section === "residents" ? (
          data?.residents.length ? data.residents.map((r) => (
            <Card key={r.id}>
              <View style={styles.headRow}>
                <Text style={styles.title}>{r.fullName ?? "Unnamed"}</Text>
                <Pill text={r.onboardingCompleted ? "Onboarded" : "Pending"} color={r.onboardingCompleted ? theme.success : theme.amber} />
              </View>
              <Row label="Phone" value={r.phone} />
              <Row label="Flat / unit" value={r.unitNumber} />
              <Row label="Account" value={r.status ? titleCase(r.status) : "—"} />
              <Row label="Plan" value={r.planId ?? "No active plan"} />
            </Card>
          )) : <Empty text="No residents." />
        ) : null}

        {section === "operations" ? (
          data?.operators.length ? data.operators.map((op) => (
            <Card key={op.id}>
              <Text style={styles.title}>{op.fullName}</Text>
              <Row label="Employee ID" value={op.employeeId} />
              <Row label="Phone" value={op.phone} />
              <Row label="Status" value={titleCase(op.status)} />
            </Card>
          )) : <Empty text="No operations staff assigned." />
        ) : null}

        {section === "slots" ? <SlotList slots={data?.slots ?? []} /> : null}
        {section === "orders" ? <OrderList orders={data?.orders ?? []} onOpen={(o) => onOpenOrder(o.id)} showSociety={false} /> : null}
        {section === "issues" ? (
          data?.issues.length ? data.issues.map((i) => <IssueCard key={i.id} issue={i} />) : <Empty text="No issues." />
        ) : null}
      </Screen>
    </View>
  );
}

// One tower, and everybody who lives in it.
//
// A block card was a set of management actions and nothing else, so the ordinary
// question — who lives in Tower B — had nowhere to be asked. Seeing a block and
// changing it are different things: the actions are still here, but they are no
// longer the only reason the card exists.
function BlockDetailScreen({ token, blockId, onBack }: {
  token: string; blockId: string; onBack: () => void;
}) {
  const [data, setData] = useState<BlockDetail | null>(null);
  // I-74: the Floor → Flat structure of this tower, with live occupancy.
  const [flatFloors, setFlatFloors] = useState<{ floor: number; flats: { number: string; status: "available" | "occupied" | "inactive"; residentName: string | null }[] }[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [detail, flats] = await Promise.all([api.supBlock(blockId, token), api.supBlockFlats(blockId, token)]);
      setData(detail); setFlatFloors(flats.floors);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [blockId, token]);
  useEffect(() => { load(); }, [load]);

  const toggleFlat = async (f: { number: string; status: string }) => {
    setError(null); setNote(null);
    if (f.status === "occupied") { setNote("That flat is occupied — move the resident before changing it."); return; }
    const next = f.status === "inactive" ? "available" : "inactive";
    try { await api.supSetFlatStatus(blockId, f.number, next, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  if (busy && !data) return <Loading />;
  const block = data?.block;
  const residents = data?.residents ?? [];
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="My society" onPress={onBack} />
      <PageTitle title={block?.name ?? "Block"} subtitle={block?.societyName} />
      <ErrorText error={error} />
      {block ? (
        <Card>
          <View style={styles.headRow}>
            <Text style={styles.title}>{block.name}</Text>
            <Pill
              text={block.status === "active" ? "Active" : "Inactive"}
              color={block.status === "active" ? theme.success : theme.muted}
            />
          </View>
          <Row label="Floors" value={block.floorCount || "—"} />
          <Row label="Flats" value={block.flatCount} />
          <Row label="Residents" value={block.residentCount} />
          <Row label="Active orders" value={block.activeOrderCount} />
          <Row
            label="Assigned operators"
            value={block.operators.length ? block.operators.map((o) => o.fullName ?? o.id).join(", ") : "Unassigned"}
          />
        </Card>
      ) : null}

      {/* I-74: Manage Flats — floors and their flats, each tappable to toggle
          available/inactive. An occupied flat is protected. */}
      <SectionTitle>Manage flats</SectionTitle>
      {note ? <Notice text={note} /> : null}
      {flatFloors.length === 0 ? (
        <Empty text="No flats configured. Set floors and flats per floor when editing this tower." />
      ) : (
        <>
          <Text style={styles.meta}>Available · Occupied · Inactive — tap a flat to toggle it.</Text>
          {flatFloors.map((fl) => (
            <Card key={fl.floor}>
              <Text style={styles.title}>Floor {fl.floor}</Text>
              <View style={styles.flatWrap}>
                {fl.flats.map((f) => (
                  <Pressable key={f.number} onPress={() => toggleFlat(f)}>
                    <Pill
                      text={f.number}
                      color={f.status === "occupied" ? theme.aqua : f.status === "inactive" ? theme.muted : theme.success}
                    />
                  </Pressable>
                ))}
              </View>
            </Card>
          ))}
        </>
      )}

      {/* Straight away, with no second search. If there are many, they page. */}
      <SectionTitle>Residents ({residents.length})</SectionTitle>
      <DataTable
        rows={residents}
        keyOf={(r) => r.id}
        empty="Nobody in this tower has recorded a flat here yet."
        columns={[
          { key: "name", label: "Resident", width: 150, render: (r) => orDash(r.fullName) },
          { key: "unit", label: "Flat", width: 80, render: (r) => orDash(r.unitNumber) },
          { key: "phone", label: "Phone", width: 120, render: (r) => orDash(r.phone) },
          { key: "plan", label: "Plan", width: 130, render: (r) => orDash(r.planName ?? "No active plan") },
          { key: "orders", label: "Active orders", width: 100, render: (r) => orDash(r.activeOrderCount) },
          {
            key: "state", label: "Order status", width: 140,
            render: (r) => (r.orderState ? <StatePill state={r.orderState} /> : <Dash />),
          },
        ]}
      />
      <Notice text="Operators, editing and deactivation stay on the block card in My society, beside the other towers." />
    </Screen>
  );
}

// --------------------------------------------------------------------- slots

function SlotList({ slots }: { slots: Slot[] }) {
  if (!slots.length) return <Empty text="No slots." />;
  return (
    <>
      {slots.map((slot) => (
        <Card key={slot.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{shortDate(slot.date)} · {to12Hour(slot.startTime)} – {to12Hour(slot.endTime)}</Text>
            <Pill
              text={slot.isActive === false ? "Cancelled" : slot.full ? "Full" : "Open"}
              color={slot.isActive === false ? theme.muted : slot.full ? theme.danger : theme.success}
            />
          </View>
          <Text style={styles.meta}>{slot.societyName ?? ""} · {slot.window}</Text>
          <Row label="Capacity" value={slot.capacityTotal ?? "—"} />
          <Row label="Booked" value={slot.bookedCount ?? "—"} />
          <Row label="Available" value={slot.capacityRemaining} />
        </Card>
      ))}
    </>
  );
}

// Creating a slot, in the middle of the screen rather than as another section of it.
//
// "New slot" used to open a full-width panel above the list, with the fields
// stacked down the page and most of each row empty beside them. It is four
// questions — which society, which day, which window, how many — and it now asks
// them the way the Admin portal's New Supervisor flow asks its own: a compact step
// in a panel, with the list behind it out of reach so a half-filled form cannot be
// lost by tapping something underneath it.
function NewSlotWizard({
  visible, token, societies, slotWindows, offerings, onClose, onCreated,
}: {
  visible: boolean;
  token: string;
  societies: Society[];
  slotWindows: SlotWindows;
  offerings: ServiceOffering[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const today = todayIso();
  // A pickup slot, or a slot for one of the admin-configured additional services.
  const [mode, setMode] = useState<"pickup" | "service">("pickup");
  const [societyId, setSocietyId] = useState<string | undefined>(undefined);
  const [offeringId, setOfferingId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(today);
  const [window, setWindow] = useState("Morning");
  const [capacity, setCapacity] = useState("10");
  const [subscribersOnly, setSubscribersOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening it again starts from an empty form rather than from whatever was left
  // behind the last time it was closed. A supervisor runs one society, so that one
  // is filled in rather than asked for.
  useEffect(() => {
    if (!visible) return;
    setMode("pickup");
    setSocietyId(societies.length ? societies[0].id : undefined);
    setOfferingId(offerings.length ? offerings[0].id : undefined);
    setDate(today); setWindow("Morning"); setCapacity("10"); setSubscribersOnly(false);
    setError(null); setBusy(false);
  }, [visible, societies, offerings, today]);

  const count = Number(capacity);
  // Capacity is checked when Create is pressed rather than folded into `ready`: a
  // button that is merely disabled never says it wants 2 to 30.
  const ready = Boolean(societyId) && date >= today
    && (mode === "pickup" || Boolean(offeringId));

  const create = async () => {
    if (!societyId) return;
    const capacityProblem = slotCapacityProblem(capacity);
    if (capacityProblem) { setError(capacityProblem); return; }
    setBusy(true); setError(null);
    try {
      if (mode === "service") {
        if (!offeringId) return;
        await api.supCreateServiceSlot({ societyId, date, offeringId, window, capacity: count }, token);
      } else {
        await api.supCreateSlot({ societyId, date, window, capacityTotal: count, subscribersOnly: subscribersOnly || undefined }, token);
      }
      await onCreated();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <CenteredModal
      visible={visible}
      title="Create slot"
      subtitle="Slot details"
      onClose={onClose}
      dirty={date !== today || window !== "Morning" || capacity !== "10" || mode !== "pickup" || subscribersOnly}
      discardMessage="Are you sure you want to discard this slot?"
      footer={<WizardFooter onNext={create} nextLabel={mode === "service" ? "Create Additional Service Slot" : "Create Laundry Slot"} nextDisabled={!ready} busy={busy} />}
    >
      <StepIndicator steps={["Slot details"]} current={0} />
      {/* One form, two kinds — named as the web names them, because a button reading
          "New slot" told a supervisor nothing about which of the two it would make. */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label="Laundry Slot" variant="secondary" selected={mode === "pickup"} onPress={() => setMode("pickup")} />
        <Button label="Additional Service Slot" variant="secondary" selected={mode === "service"} onPress={() => setMode("service")} disabled={offerings.length === 0} />
      </View>
      <Dropdown
        label="Society"
        value={societyId}
        allLabel="Choose a society"
        options={societies.map((sc) => ({ value: sc.id, label: sc.name }))}
        onChange={setSocietyId}
        width="full"
        disabled={societies.length <= 1}
      />
      {mode === "service" ? (
        <Dropdown
          label="Service"
          value={offeringId}
          allLabel="Choose a service"
          options={offerings.map((o) => ({ value: o.id, label: o.name }))}
          onChange={setOfferingId}
          width="full"
        />
      ) : null}
      {/* The same calendar the rest of the application uses. A day that has gone
          cannot be worked, so it cannot be chosen. */}
      <DateField
        label="Date"
        value={date}
        onChange={(next) => setDate(next ?? today)}
        minDate={today}
        clearable={false}
      />
      {/* The hours belong to the window, and the backend says what they are. Nobody
          types a time: a Morning slot is the same three hours everywhere. */}
      <SlotWindowPicker windows={slotWindows} value={window} onChange={setWindow} />
      <Field label="Capacity" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" width="small" />
      {mode === "pickup" ? (
        <Button
          label={subscribersOnly ? "✓ Reserved for plan subscribers" : "Reserve for plan subscribers only"}
          variant="secondary"
          selected={subscribersOnly}
          onPress={() => setSubscribersOnly((v) => !v)}
        />
      ) : null}
      <ErrorText error={error} />
    </CenteredModal>
  );
}

function SlotsScreen({ token }: { token: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [serviceSlots, setServiceSlots] = useState<Slot[]>([]);
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  // A from/to range rather than a single day, defaulting to the week ahead.
  const today = todayIso();
  const weekAhead = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState<string | null>(today);
  const [toDate, setToDate] = useState<string | null>(weekAhead);
  const [slotWindows, setSlotWindows] = useState<SlotWindows>(DEFAULT_SLOT_WINDOWS);
  // Both kinds in one list, held to the dates on screen. See slot-list-rules.
  const rows = slotRows(slots, serviceSlots, { from: fromDate, to: toDate }, slotWindows);
  const [creating, setCreating] = useState(false);
  // Editing an existing slot — its window, capacity, status and reservation.
  const [editing, setEditing] = useState<Slot | null>(null);
  const [editWindow, setEditWindow] = useState("Morning");
  const [editCapacity, setEditCapacity] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editSub, setEditSub] = useState(false);
  // Slot Details bookings view (I-76): the slot being inspected and its booking list.
  const [bookingsSlot, setBookingsSlot] = useState<Slot | null>(null);
  const [bookings, setBookings] = useState<SlotBooking[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const openBookings = async (slot: Slot) => {
    setBookingsSlot(slot); setBookings(null); setError(null);
    try { const r = await api.supSlotBookings(slot.id, token); setBookings(r.bookings); }
    catch (e) { setError((e as Error).message); setBookingsSlot(null); }
  };

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [slotRes, societyRes, serviceRes, offeringRes] = await Promise.all([
        api.supSlots(token, { from: fromDate ?? undefined, to: toDate ?? undefined }),
        api.supSocieties(token),
        api.supServiceSlots(token, {}),
        api.serviceOfferings(),
      ]);
      setSlots(slotRes.slots);
      if (slotRes.slotWindows) setSlotWindows(slotRes.slotWindows);
      setSocieties(societyRes.societies);
      setServiceSlots(serviceRes.slots);
      setOfferings(offeringRes.offerings.filter((o) => o.isActive !== false));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, fromDate, toDate]);
  useEffect(() => { load(); }, [load]);

  const cancel = async (slot: Slot) => {
    setError(null); setNote(null);
    try {
      const r = await api.supCancelSlot(slot.id, token);
      setNote(`Slot cancelled. ${r.cancelledPickups} booking(s) were cancelled and the residents notified.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const changeCapacity = async (slot: Slot, delta: number) => {
    const problem = slotCapacityProblem(String((slot.capacityTotal ?? 0) + delta));
    if (problem) { setError(problem); return; }
    setError(null);
    try { await api.supUpdateSlot(slot.id, { capacityTotal: (slot.capacityTotal ?? 0) + delta }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const openEdit = (slot: Slot) => {
    setEditing(slot);
    setEditWindow(slot.window);
    setEditCapacity(String(slot.capacityTotal ?? ""));
    setEditActive(slot.isActive !== false);
    setEditSub(Boolean(slot.subscribersOnly));
  };
  const saveEdit = async () => {
    if (!editing) return;
    const capacityProblem = slotCapacityProblem(editCapacity);
    if (capacityProblem) { setError(capacityProblem); return; }
    setError(null); setNote(null);
    try {
      await api.supUpdateSlot(editing.id, {
        window: editWindow, capacityTotal: Number(editCapacity), isActive: editActive, subscribersOnly: editSub,
      }, token);
      setNote("Slot updated.");
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Slots"
        subtitle="Laundry and additional-service slots for your society"
        right={<Button label="Create slot" variant="secondary" onPress={() => { setNote(null); setCreating(true); }} />}
      />
      <FieldRow>
        <DateField label="From" value={fromDate} onChange={setFromDate} clearable placeholder="Any day" />
        <DateField label="To" value={toDate} onChange={setToDate} clearable placeholder="Any day" />
      </FieldRow>
      <NewSlotWizard
        visible={creating}
        token={token}
        societies={societies}
        slotWindows={slotWindows}
        offerings={offerings}
        onClose={() => setCreating(false)}
        onCreated={async () => { setCreating(false); setNote("Slot created."); await load(); }}
      />
      {note ? <Notice tone="good" text={note} /> : null}

      {/* One list, both kinds.
          They were two sections, so a supervisor who had just created a car wash slot
          had to know to scroll past the pickup slots to find it — and the two headings
          gave no way to see a day's work in one place. Each card now says which kind it
          is and which service it is for, which is what the web table's Slot Type and
          Service columns say. */}
      <SectionTitle>Slots</SectionTitle>
      {/* Three across on a desktop. A slot card is a day, a window and three
          numbers; one per screen-width left the rest of the page blank. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {rows.map((row) => (
          <Card key={row.key}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{row.slot.window}</Text>
              <Pill
                text={row.slot.isActive === false ? "Cancelled" : row.slot.full ? "Full" : "Open"}
                color={row.slot.isActive === false ? theme.muted : row.slot.full ? theme.danger : theme.success}
              />
            </View>
            {/* A service slot carries no clock time of its own; the hours come from its
                window, which is what every slot in that window runs at. Only a window
                with no hours on record leaves the day standing alone. */}
            <Text style={styles.meta}>
              {shortDate(row.slot.date)}
              {row.startTime && row.endTime ? ` · ${to12Hour(row.startTime)} – ${to12Hour(row.endTime)}` : ""}
            </Text>
            {row.slot.subscribersOnly ? <Pill text="Plan only" color={theme.aqua} /> : null}
            <Row label="Slot type" value={row.kind === "laundry" ? "Laundry Slot" : "Additional Service Slot"} />
            <Row label="Service" value={row.service} />
            <Row label="Capacity" value={row.slot.capacityTotal ?? "—"} />
            <Row label="Booked" value={row.slot.bookedCount ?? "—"} />
            <Row label="Available" value={row.slot.capacityRemaining} />
            {/* Editing, cancelling and the bookings drawer are laundry-only operations
                on the backend, so a service card offers none of them rather than
                offering buttons that fail. */}
            {row.kind === "laundry" ? (
              <View style={styles.gridActions}>
                <CardAction label="View bookings" onPress={() => openBookings(row.slot)} />
                <CardAction label="Edit slot" onPress={() => openEdit(row.slot)} />
                <CardAction label="Capacity +1" onPress={() => changeCapacity(row.slot, 1)} />
                <CardAction label="Capacity -1" onPress={() => changeCapacity(row.slot, -1)} />
                {row.slot.isActive !== false ? <CardAction label="Cancel slot" tone="danger" onPress={() => cancel(row.slot)} /> : null}
              </View>
            ) : null}
          </Card>
        ))}
      </CardGrid>
      {!rows.length ? <Empty text="No slots yet." /> : null}

      {/* Full slot editing — window, capacity, active state and reservation — beyond
          the capacity +/-1 shortcuts on the card. */}
      <CenteredModal
        visible={Boolean(editing)}
        title="Edit slot"
        subtitle="Window, capacity and status"
        onClose={() => setEditing(null)}
        footer={<WizardFooter onNext={saveEdit} nextLabel="Save slot" nextDisabled={!editCapacity.trim() || Number(editCapacity) <= 0} busy={false} />}
      >
        <SlotWindowPicker windows={slotWindows} value={editWindow} onChange={setEditWindow} />
        <Field label="Capacity" value={editCapacity} onChangeText={setEditCapacity} keyboardType="number-pad" width="small" />
        <Button
          label={editActive ? "✓ Slot is active" : "Slot is cancelled"}
          variant="secondary"
          selected={editActive}
          onPress={() => setEditActive((v) => !v)}
        />
        <Button
          label={editSub ? "✓ Reserved for plan subscribers" : "Reserve for plan subscribers only"}
          variant="secondary"
          selected={editSub}
          onPress={() => setEditSub((v) => !v)}
        />
      </CenteredModal>

      {/* Slot Details bookings (I-76): the residents booked into a slot — flat, order
          and status — replacing a separate bookings screen. */}
      <CenteredModal
        visible={Boolean(bookingsSlot)}
        title="Slot bookings"
        subtitle={bookingsSlot ? `${bookingsSlot.window} · ${shortDate(bookingsSlot.date)}` : undefined}
        onClose={() => { setBookingsSlot(null); setBookings(null); }}
      >
        {bookings === null ? <Loading /> : bookings.length === 0 ? (
          <Empty text="No bookings yet." />
        ) : (
          bookings.map((b) => (
            <Card key={b.pickupId}>
              <View style={styles.headRow}>
                <Text style={styles.title} numberOfLines={1}>{b.residentName ?? "Resident"}</Text>
                <Pill text={titleCase(b.state)} color={STATUS_COLOR[b.state] ?? theme.muted} />
              </View>
              <Row label="Flat" value={b.unitNumber ?? "—"} />
              {b.blockName ? <Row label="Tower" value={b.blockName} /> : null}
              <Row label="Order" value={b.orderCode ?? "—"} />
            </Card>
          ))
        )}
      </CenteredModal>

      <ErrorText error={error} />
    </Screen>
  );
}

// ----------------------------------------------------------------- operators

const STATUS_COLOR: Record<string, string> = {
  active: theme.success,
  on_leave: theme.amber,
  blocked: theme.danger,
};

function OperatorsScreen({ token }: { token: string }) {
  const [operators, setOperators] = useState<StaffUser[]>([]);
  const [workload, setWorkload] = useState<Workload[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  // The towers of the one society this supervisor runs: what the creation form
  // offers and what the filter narrows by.
  const [blocks, setBlocks] = useState<{ id: string; name: string; flatCount: number; status: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [handoverFor, setHandoverFor] = useState<string | null>(null);
  // Finding one person should not mean reading the whole list.
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState({ all: 0, active: 0, on_leave: 0, blocked: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const query = useDebounced(search, 250);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [ops, work, socs] = await Promise.all([
        api.supOperators(token, { status: statusFilter === "all" ? undefined : statusFilter, q: query || undefined }),
        api.supWorkload(token),
        api.supSocieties(token),
      ]);
      setOperators(ops.operators); setWorkload(work.workload); setSocieties(socs.societies);
      setBlocks(ops.blocks ?? []);
      if (ops.counts) setCounts(ops.counts);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, statusFilter, query]);
  useEffect(() => { load(); }, [load]);

  // Adding or removing one tower at a time, because that is how a round is
  // actually adjusted: somebody takes over B while its usual operator is away.
  const toggleBlock = async (op: StaffUser, blockId: string) => {
    const current = op.blockIds ?? [];
    const next = current.includes(blockId)
      ? current.filter((id) => id !== blockId)
      : [...current, blockId];
    setError(null); setNote(null);
    try { await api.supUpdateOperator(op.id, { blockIds: next }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  if (handoverFor) {
    return (
      <HandoverScreen
        token={token} operatorId={handoverFor}
        onBack={() => setHandoverFor(null)}
        onDone={async (message) => { setNote(message); setHandoverFor(null); await load(); }}
      />
    );
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Operations staff"
        subtitle="Staff in your society"
        right={<Button label="New operator" variant="secondary" onPress={() => { setNote(null); setCreating(true); }} />}
      />
      {/* Counts are taken before the filter is applied, so they do not move as the
          list is narrowed. */}
      <FilterRow
        specs={[{
          key: "availability", label: "Availability", allLabel: `All (${counts.all})`,
          options: [
            { value: "active", label: "On duty", count: counts.active },
            { value: "on_leave", label: "On leave", count: counts.on_leave },
            { value: "blocked", label: "Blocked", count: counts.blocked },
          ],
        }]}
        values={{ availability: statusFilter === "all" ? undefined : statusFilter }}
        onChange={(next) => setStatusFilter((next.availability ?? "all") as typeof statusFilter)}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name or phone"
      />
      {!busy && !operators.length ? (
        <Empty text={search || statusFilter !== "all" ? "No staff match that filter." : "No operations staff yet."} />
      ) : null}
      {/* In the middle of the screen, with this page out of reach behind it. The
          society is the supervisor's own, so the assignment step says which it is
          rather than asking; what they choose there is the blocks. */}
      <StaffWizard
        visible={creating}
        role="operator"
        token={token}
        societies={societies.map((sc) => ({ id: sc.id, name: sc.name }))}
        blocks={blocks}
        fixedSocietyId={societies[0]?.id ?? null}
        fixedSocietyName={societies[0]?.name ?? null}
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          setCreating(false);
          setNote(`${created.fullName} created with employee ID ${created.employeeId}.`);
          await load();
        }}
      />
      {note ? <Notice tone="good" text={note} /> : null}

      <SectionTitle>Workload</SectionTitle>
      {/* Three across on a desktop. Workload is a name and five numbers, and the
          only reason to read it is to compare one operator with another — which a
          single column of full-width cards makes impossible. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {workload.map((w) => (
          <Card key={w.userId}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{w.name ?? "Unnamed"}</Text>
              {w.status !== "active"
                ? <Pill text={titleCase(w.status)} color={STATUS_COLOR[w.status] ?? theme.muted} />
                : w.processing > 6 ? <Pill text="Overloaded" color={theme.danger} />
                : w.pending + w.processing === 0 ? <Pill text="No work assigned" color={theme.amber} /> : null}
            </View>
            <Text style={styles.meta}>{w.societyNames.join(", ") || "No society assigned"}</Text>
            <Row label="Pending" value={w.pending} />
            <Row label="Processing" value={w.processing} />
            <Row label="Completed" value={w.completed} />
            <Row label="QC failures" value={w.qcFailures} />
            <Row label="Failed pickups" value={w.failedPickups} />
          </Card>
        ))}
      </CardGrid>
      {!workload.length ? <Empty text="No operations staff yet." /> : null}

      <SectionTitle>Staff</SectionTitle>
      {/* The same three-across grid, and the same facts about each person kept
          compact rather than spread over the width of the page. There is no area
          selector and no other society: this is the supervisor's own society, and
          an operator from anywhere else is not theirs to see. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {operators.map((op) => (
          <Card key={op.id}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{op.fullName}</Text>
              <Pill text={titleCase(op.status)} color={STATUS_COLOR[op.status] ?? theme.muted} />
            </View>
            <Row label="Employee ID" value={op.employeeId} />
            <Row label="Phone" value={op.phone} />
            <Row label="Society" value={op.societyName ?? "None"} />
            {/* Blocks are the assignment, so an operator with none has no work —
                which is what this says rather than crediting them with the lot. */}
            <Row label="Blocks" value={op.blockNames?.length ? op.blockNames.join(", ") : "None yet"} />
            <Row label="Flats covered" value={op.flatsCovered ?? 0} />
            <Row label="Duty" value={op.status === "active" ? "On duty" : "Off duty"} />
            <Dropdown
              label="Add or remove a block"
              value={undefined}
              allLabel="Choose a block"
              options={blocks.map((b) => ({
                value: b.id,
                label: (op.blockIds ?? []).includes(b.id) ? `Remove ${b.name}` : `Add ${b.name}`,
              }))}
              onChange={(id) => { if (id) toggleBlock(op, id); }}
              width="full"
            />
            <View style={styles.gridActions}>
              <CardAction label="Availability and handover" onPress={() => setHandoverFor(op.id)} />
            </View>
          </Card>
        ))}
      </CardGrid>
      <ErrorText error={error} />
    </Screen>
  );
}

// Taking somebody off duty is a handover, not a deletion. This screen shows what
// they are still holding and where it should go before anything changes.
function HandoverScreen({ token, operatorId, onBack, onDone }: {
  token: string; operatorId: string; onBack: () => void; onDone: (message: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<HandoverPreview | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setPreview(await api.supHandoverPreview(operatorId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [operatorId, token]);
  useEffect(() => { load(); }, [load]);

  const apply = async (status: string) => {
    setError(null);
    try {
      const r = await api.supSetAvailability(operatorId, { status, reassignToUserId: target, reason: reason || undefined }, token);
      const moved = r.reassigned.length;
      await onDone(
        status === "active"
          ? `${r.operator.fullName ?? "The operator"} is back on duty.`
          : moved === 0
            ? `${r.operator.fullName ?? "The operator"} is ${titleCase(status)}. They had no open work.`
            : target
              ? `${moved} order(s) moved to the replacement.`
              : `${moved} order(s) returned to the shared queue for any operator to pick up.`,
      );
    } catch (e) { setError((e as Error).message); }
  };

  if (busy && !preview) return <Loading />;
  const onDuty = preview?.operator.status === "active";
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Operations staff" onPress={onBack} />
      <PageTitle
        title={preview?.operator.fullName ?? "Operator"}
        subtitle={`Currently ${titleCase(preview?.operator.status ?? "")}`}
      />

      <Notice text="The account is never deleted. Open work is either handed to a colleague or returned to the shared queue, so nothing waits on one person." />

      <SectionTitle>Open work ({preview?.openCount ?? 0})</SectionTitle>
      <OrderList orders={preview?.openOrders ?? []} emptyText="Nothing open. This operator can be taken off duty safely." />

      {onDuty ? (
        <>
          <Dropdown
            label="Hand work to"
            value={target ?? undefined}
            allLabel="Back to the shared queue"
            options={(preview?.availableOperators ?? []).map((o) => ({ value: o.id, label: o.fullName ?? o.id }))}
            onChange={(id) => setTarget(id ?? null)}
          />
          {!target
            ? <Notice text="With nobody chosen, the work goes back to the shared queue and any operator in the area can claim it." />
            : null}
          <Field label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Annual leave" />
          <Button label="Mark on leave" onPress={() => apply("on_leave")} />
          <Button label="Deactivate the account" variant="danger" onPress={() => apply("blocked")} />
        </>
      ) : (
        <Button label="Return to duty" onPress={() => apply("active")} />
      )}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------------- orders

// Orders in the one society this supervisor runs.
//
// Two things were wrong with it. The filters were a society picker and a status
// picker, which is not how anybody looks for an order here: a supervisor knows the
// tower, or the operator, or the resident, or roughly when. And the list sat in a
// narrow column with the rest of the page empty beside it.
//
// The third thing was the Back button, and it was not a navigation bug so much as a
// consequence of one: opening an order unmounted this screen, so coming back
// rebuilt it from nothing — no filters, no search, no scroll position. The state
// lives in the portal now and is handed in, so Back returns to the list as it was.
function SupervisorOrdersScreen({ token, filters, onFilters, onOpenOrder }: {
  token: string;
  filters: FilterValues;
  onFilters: (next: FilterValues) => void;
  onOpenOrder: (id: string) => void;
}) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  // The operators of this supervisor's own society, which is what the one dropdown
  // offers. It comes back with the rows rather than from a call of its own, so the
  // filter can never name somebody who has nothing in the list.
  const [options, setOptions] = useState<{ operators: { id: string; fullName: string | null }[] }>({ operators: [] });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orderCode = filters.orderCode ?? "";
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.supOrders(token, {
        state: filters.state,
        operatorUserId: filters.operatorUserId,
        orderCode: orderCode || undefined,
      });
      setOrders(res.orders);
      setOptions({ operators: res.filters.operators });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, filters.state, filters.operatorUserId, orderCode]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Orders" subtitle="All orders in your assigned society" />
      {/* Three controls, because there were three questions. A supervisor looks for
          an order by its id, or asks what one of their operators is carrying, or
          what is sitting at a particular stage. The society filter offered a choice
          of one — theirs — and the block and resident pickers were two more ways of
          asking the same thing as the operator picker. */}
      <FilterRow
        specs={[
          {
            key: "operatorUserId", label: "Operator", allLabel: "All operators",
            options: options.operators.map((o) => ({ value: o.id, label: o.fullName ?? o.id })),
          },
          {
            key: "state", label: "Order status", allLabel: "All statuses",
            options: SUPERVISOR_ORDER_STATES.map((v) => ({ value: v, label: stateLabel[v] ?? titleCase(v) })),
          },
        ]}
        values={filters}
        onChange={(next) => onFilters({ ...next, orderCode })}
        onClear={() => onFilters({})}
        search={orderCode}
        onSearch={(next) => onFilters({ ...filters, orderCode: next })}
        searchPlaceholder="Search Order ID"
      />
      <Text style={styles.meta}>{orders.length} order{orders.length === 1 ? "" : "s"}</Text>
      {/* One row per order rather than one card per order. Forty orders as cards is
          forty screens of scrolling for a list whose whole purpose is comparison. */}
      <DataTable
        rows={orders}
        keyOf={(o) => o.id}
        onPress={(o) => onOpenOrder(o.id)}
        empty="No orders match those filters."
        columns={[
          { key: "code", label: "Order ID", width: 118, render: (o) => <Text style={styles.cell}>{o.orderCode}</Text> },
          { key: "resident", label: "Resident", width: 130, render: (o) => orDash(o.residentName) },
          { key: "unit", label: "Flat / unit", width: 90, render: (o) => orDash(o.unitNumber) },
          { key: "society", label: "Society", width: 130, render: (o) => orDash(o.societyName) },
          { key: "garments", label: "Garments", width: 80, render: (o) => orDash(o.acceptedCount) },
          { key: "amount", label: "Amount", width: 90, render: (o) => <Text style={styles.cell}>{rupees(orderTotal(o))}</Text> },
          { key: "state", label: "Status", width: 130, render: (o) => <StatePill state={o.state} /> },
          { key: "payment", label: "Payment", width: 100, render: (o) => <PaymentPill order={o} /> },
          { key: "operator", label: "Operator", width: 130, render: (o) => orDash(o.operatorName) },
          {
            key: "actions", label: "Actions", width: 110,
            render: (o) => <CardAction label="View details" onPress={() => onOpenOrder(o.id)} />,
          },
        ]}
      />
      <ErrorText error={error} />
    </Screen>
  );
}

function SupervisorOrderScreen({ token, orderId, onBack }: { token: string; orderId: string; onBack: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [operators, setOperators] = useState<StaffUser[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [o, ops] = await Promise.all([api.supOrder(orderId, token), api.supOperators(token)]);
      setOrder(o.order); setOperators(ops.operators);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  const assign = async (operatorUserId: string) => {
    setNote(null); setError(null);
    try { const r = await api.supAssignOperator(orderId, operatorUserId, token); setOrder(r.order); setNote("Operator assigned."); }
    catch (e) { setError((e as Error).message); }
  };

  if (busy && !order) return <Loading />;
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Back" onPress={onBack} />
      <ErrorText error={error} />
      {order ? (
        <>
          <OrderDetailBody order={order} audience="staff" />
          <Dropdown
            label="Assign operator"
            value={order.assignedOperatorUserId ?? undefined}
            allLabel="Unassigned"
            options={operators.map((o) => ({ value: o.id, label: o.fullName ?? o.id }))}
            onChange={(id) => { if (id) assign(id); }}
          />
          <Notice text="Supervisors monitor orders. Processing actions stay with the operations staff." />
          {note ? <Notice tone="good" text={note} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

// ------------------------------------------------------------------ pickups

function PickupsScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [pickups, setPickups] = useState<PickupQueueItem[]>([]);
  const [societies, setSocieties] = useState<{ id: string; name: string }[]>([]);
  const [date, setDate] = useState<string | null>(todayIso());
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await api.supPickups(token, {
        date: date ?? undefined,
        societyId: societyId ?? undefined,
      });
      setPickups(response.pickups);
      setSocieties(response.societies ?? []);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, date, societyId]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Pickup monitoring"
        subtitle={date ? `Pickups for ${formatFriendly(date)}` : "Every date"}
      />
      {/* A calendar rather than a format to memorise, and a society filter that
          only ever offers the societies this supervisor is responsible for. */}
      <FilterRow
        specs={[{
          key: "societyId", label: "Society", allLabel: "All societies",
          options: societies.map((sc) => ({ value: sc.id, label: sc.name })),
        }]}
        values={{ societyId: societyId ?? undefined }}
        onChange={(next) => setSocietyId(next.societyId ?? null)}
        onClear={() => setDate(null)}
        extra={<DateField label="Date" value={date} onChange={setDate} placeholder="Any date" />}
      />
      <View style={{ height: 8 }} />
      <CardGrid columns={{ desktop: 2, tablet: 2, mobile: 1 }}>
      {pickups.map((p) => (
        <Card key={p.pickupId} onPress={p.orderId ? () => onOpenOrder(p.orderId!) : undefined}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{p.orderCode ?? "No order"}</Text>
            <StatePill state={p.status} />
          </View>
          <Row label="Resident" value={p.residentName} />
          <Row label="Society" value={p.societyName} />
          <Row label="Flat / unit" value={p.unitNumber} />
          <Row label="Pickup date" value={shortDate(p.pickupDate)} />
          <Row label="Pickup slot" value={p.slot} />
          <Row label="Assigned operator" value={p.operatorName ?? "Unassigned"} />
          {p.pickupFailureReason ? <Notice tone="warn" text={`Failed: ${p.pickupFailureReason}`} /> : null}
        </Card>
      ))}
      </CardGrid>
      {!pickups.length ? (
        <Empty text={societyId || date ? "No pickups found for that date and society." : "No pickups found."} />
      ) : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// What is in the machines right now.
//
// The dashboard's pipeline drill-down answers "show me the orders at this stage".
// This answers the question you have before that one — what is at every stage — which
// on mobile previously had no answer at all unless a dashboard number happened to
// catch your eye.
//
// Eight buckets, each with its count on the switcher, so an empty stage is visibly
// empty rather than absent. A supervisor asking why nothing has been delivered today
// needs to see that "Ready for delivery" holds eleven, and a stage that hid itself
// when empty could not tell them.
const PROCESSING_BUCKETS: { key: keyof SupervisorProcessing; label: string }[] = [
  { key: "waitingForWashing", label: "To wash" },
  { key: "washing", label: "Washing" },
  { key: "ironingPending", label: "To iron" },
  { key: "ironing", label: "Ironing" },
  { key: "waitingForQc", label: "To check" },
  { key: "qcFailed", label: "QC failed" },
  { key: "readyForDelivery", label: "Ready" },
  { key: "outForDelivery", label: "Out" },
];

function ProcessingScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [data, setData] = useState<SupervisorProcessing | null>(null);
  const [bucket, setBucket] = useState<keyof SupervisorProcessing>("washing");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.supProcessing(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const orders = data?.[bucket] ?? [];
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={bucket}
        onChange={setBucket}
        options={PROCESSING_BUCKETS.map((b) => ({
          key: b.key, label: b.label, badge: data?.[b.key].length ?? 0,
        }))}
      />
      <Screen refreshing={busy} onRefresh={load}>
        <PageTitle title="Processing" subtitle="Every order in the facility, by stage" />
        <ErrorText error={error} />
        <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
          {orders.map((o) => (
            <Card key={o.id} onPress={() => onOpenOrder(o.id)}>
              <View style={styles.headRow}>
                <Text style={styles.title} numberOfLines={1}>{o.orderCode}</Text>
                <StatePill state={o.state} />
              </View>
              <Row label="Resident" value={o.residentName} />
              <Row label="Flat" value={o.unitNumber} />
              <Row label="Garments" value={o.acceptedCount} />
            </Card>
          ))}
        </CardGrid>
        {!busy && orders.length === 0 ? <Empty text="Nothing at this stage." /> : null}
      </Screen>
    </View>
  );
}

function DelayedScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setOrders((await api.supDelayed(token)).orders); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Delayed orders" subtitle="Past their expected completion time" />
      {/* Three across on a desktop, like every other card list here. A delayed
          order is seven short rows, and one of them per screen-width was a column
          of cards with the rest of the page blank beside it. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {orders.map((o) => (
          <Card key={o.id} onPress={() => onOpenOrder(o.id)}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{o.orderCode}</Text>
              <Pill text={`${Math.round(o.delayMinutes / 60)}h late`} color={theme.danger} />
            </View>
            <Row label="Resident" value={o.residentName} />
            <Row label="Society" value={o.societyName} />
            <Row label="Current status" value={titleCase(o.state)} />
            <Row label="Expected completion" value={dateTime(o.expectedCompletionAt)} />
            <Row label="Assigned operator" value={o.operatorName ?? "Unassigned"} />
          </Card>
        ))}
      </CardGrid>
      {!orders.length ? <Empty text="No delayed orders." /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------------- issues

// Subscription plans, managed by the supervisor with the identical two-step wizard
// the admin uses. Plans are system-wide rather than society-scoped, so this is the
// same list and the same create/edit flow — the issue asked for it in both portals,
// and the way to keep the two from drifting is to share the wizard rather than copy it.
// Who in this society is on which plan.
//
// This screen used to be the plan catalogue, with New plan, Edit and Activate —
// the same wizard an admin uses. Plans are priced, sold and retired by the business
// rather than by the person running one society, so none of that belonged here, and
// the routes behind it are gone rather than merely unlinked.
//
// What a supervisor is actually asked is the other direction: this resident says
// they are on Premium, are they? So the screen is that list, and it is read only.
function SupervisorPlansScreen({ token }: { token: string }) {
  const [rows, setRows] = useState<ResidentSubscriptionRow[]>([]);
  const [viewing, setViewing] = useState<ResidentSubscriptionRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setRows((await api.supSubscriptions(token)).subscriptions); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const shown = subscriptionRows(rows, { search, status });

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Subscriptions"
        subtitle="Residents in your society and the plans they hold"
      />
      <FilterRow
        specs={[{
          key: "status", label: "Status", allLabel: "All statuses",
          options: SUBSCRIPTION_STATUSES.map((value) => ({ value, label: titleCase(value) })),
        }]}
        values={{ status: status ?? undefined }}
        onChange={(next) => setStatus(next.status ?? null)}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Resident, flat or plan"
      />
      <Text style={styles.meta}>{shown.length} of {rows.length} shown</Text>

      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {shown.map((row) => (
          <Card key={row.id} onPress={() => setViewing(row)}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{row.residentName ?? "Resident"}</Text>
              <Pill text={titleCase(row.status)} color={row.status === "active" ? theme.success : row.status === "paused" ? theme.amber : theme.muted} />
            </View>
            <Text style={styles.meta}>
              {[row.towerBlock, row.unitNumber].filter(Boolean).join(" · ") || "—"}
            </Text>
            <Row label="Plan" value={row.planName ?? row.planTier ?? "—"} />
            <Row label="Society" value={row.societyName ?? "—"} />
            <Row label="Start" value={shortDate(row.startDate)} />
            <Row label="End" value={shortDate(row.endDate)} />
            {/* A change already asked for. Without it a supervisor reads today's plan
                and answers a question about next month wrongly. */}
            {row.pendingPlanName ? <Row label="Scheduled change" value={row.pendingPlanName} /> : null}
          </Card>
        ))}
      </CardGrid>
      {!shown.length && !busy ? <Empty text="No subscribed residents." /> : null}
      <ErrorText error={error} />

      <CenteredModal
        visible={Boolean(viewing)}
        title={viewing?.residentName ?? "Subscription"}
        subtitle={viewing ? [viewing.towerBlock, viewing.unitNumber].filter(Boolean).join(" · ") : undefined}
        onClose={() => setViewing(null)}
      >
        {viewing ? (
          <>
            <Row label="Plan" value={viewing.planName ?? viewing.planTier ?? "—"} />
            <Row label="Price" value={viewing.monthlyPaise === null ? "—" : `${rupees(viewing.monthlyPaise)} / month`} />
            <Row label="Status" value={titleCase(viewing.status)} />
            <Row label="Society" value={viewing.societyName ?? "—"} />
            <Row label="Billing cycle" value={titleCase(viewing.cycle)} />
            <Row label="Start date" value={shortDate(viewing.startDate)} />
            <Row label="End date" value={shortDate(viewing.endDate)} />
            <Row label="Auto renew" value={viewing.autoRenew ? "On" : "Off"} />
            {viewing.pendingPlanName ? <Row label="Scheduled change" value={viewing.pendingPlanName} /> : null}
            <SectionTitle>Allowance</SectionTitle>
            {/* Counted, not drawn. A bar says how full the month is and nothing about
                the number the resident is actually asking for. */}
            <Row label="Included" value={viewing.garmentCap === null ? "—" : `${viewing.garmentCap} garments`} />
            <Row label="Used" value={`${viewing.garmentsUsed} garments`} />
            <Row label="Remaining" value={remainingGarments(viewing) ?? "—"} />
            <Row label="Turnaround" value={viewing.turnaroundHours === null ? "—" : `${viewing.turnaroundHours} hours`} />
            <Row label="Phone" value={viewing.residentPhone ?? "—"} />
            <Notice text="Plans are managed by the Wash N Press admin team. Contact them to change a resident's subscription." />
          </>
        ) : null}
      </CenteredModal>
    </Screen>
  );
}

// The supervisor is the first line of customer support for their area. They read
// the ticket, talk to the resident on it, coordinate with operations, and either
// resolve it or escalate it to admin.
function SupervisorIssuesScreen({ token }: { token: string }) {
  // The whole area's tickets, every status, fetched once. The summary counts, the
  // society filter and the list are all read off this one list, so a count can never
  // disagree with the list a tap on it opens. The supervisor has always been able to
  // see every ticket in their area rather than only escalated ones; what was missing
  // was the overview that says how many of each there are and opens them in a tap.
  const [all, setAll] = useState<Issue[]>([]);
  const [view, setView] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [society, setSociety] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      setAll((await api.supIssues(token, {})).issues);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.worklist);

  if (openId) {
    return (
      <SupervisorTicketScreen
        token={token} issueId={openId}
        onBack={() => setOpenId(null)}
        onChanged={load}
      />
    );
  }

  const isEscalated = (i: Issue) =>
    i.status === "escalated_supervisor" || i.status === "escalated_admin"
    || i.escalatedToAdmin === true || i.escalatedToSupervisor === true;
  const isPending = (i: Issue) => i.status === "waiting_resident" || i.status === "waiting_operator";
  const isEmergency = (i: Issue) => i.priority === "emergency" && i.status !== "closed";
  // Which of a set of named views a ticket belongs to. A plain status name matches
  // that status; the three that are not statuses — pending, escalated, emergency —
  // match the rule that defines them.
  const inView = (i: Issue, v: string | null): boolean => {
    if (!v) return true;
    if (v === "pending") return isPending(i);
    if (v === "escalated") return isEscalated(i);
    if (v === "emergency") return isEmergency(i);
    return i.status === v;
  };

  const scoped = society ? all.filter((i) => i.societyName === society) : all;
  const count = (v: string | null) => scoped.filter((i) => inView(i, v)).length;
  const societies = Array.from(new Set(all.map((i) => i.societyName).filter((n): n is string => Boolean(n)))).sort();

  const displayed = scoped.filter((i) => inView(i, view) && (!priority || i.priority === priority));
  const emergencies = scoped.filter(isEmergency).length;
  // The tickets nobody has finished with, oldest first — the ones most likely to need
  // the supervisor before the resident chases them.
  const oldest = [...scoped]
    .filter((i) => i.status !== "closed" && i.status !== "resolved")
    .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0))
    .slice(0, 5);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Customer support" subtitle="Every ticket from residents in your area" />

      {emergencies ? (
        <Notice tone="warn" text={`${emergencies} emergency ticket${emergencies === 1 ? " needs" : "s need"} attention.`} />
      ) : null}

      {societies.length > 1 ? (
        <Dropdown
          label="Society"
          value={society}
          allLabel="All societies"
          options={societies.map((s) => ({ value: s, label: s }))}
          onChange={(v) => setSociety(v ?? undefined)}
        />
      ) : null}

      <SectionTitle>Volumes</SectionTitle>
      <StatGrid>
        <Stat label="Total issues" value={scoped.length} onPress={() => { setView(null); setPriority(null); }} />
        <Stat label="Open" value={count("open")} tone="warn" onPress={() => setView("open")} />
        <Stat label="In progress" value={count("in_progress")} onPress={() => setView("in_progress")} />
        <Stat label="Pending" value={count("pending")} tone="warn" onPress={() => setView("pending")} />
        <Stat label="Resolved" value={count("resolved")} tone="good" onPress={() => setView("resolved")} />
        <Stat label="Closed" value={count("closed")} onPress={() => setView("closed")} />
        <Stat label="Escalated" value={count("escalated")} tone="danger" onPress={() => setView("escalated")} />
        <Stat label="Emergency" value={count("emergency")} tone="danger" onPress={() => setView("emergency")} />
      </StatGrid>

      {oldest.length ? (
        <>
          <SectionTitle>Oldest still waiting</SectionTitle>
          {oldest.map((i) => (
            <Card key={i.id} onPress={() => setOpenId(i.id)}>
              <Row
                label={`${titleCase(i.category)}${i.societyName ? ` · ${i.societyName}` : ""}`}
                value={`${i.ageHours ?? 0}h · ${titleCase(i.status)}`}
              />
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle>Tickets</SectionTitle>
      <FilterRow
        specs={[
          {
            key: "view", label: "Issue status", allLabel: "Any status",
            options: [
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "pending", label: "Pending" },
              { value: "escalated", label: "Escalated" },
              { value: "resolved", label: "Resolved" },
              { value: "closed", label: "Closed" },
              { value: "emergency", label: "Emergency" },
            ],
          },
          {
            key: "priority", label: "Priority", allLabel: "Any priority",
            options: ["low", "normal", "high", "emergency"].map((v) => ({ value: v, label: titleCase(v) })),
          },
        ]}
        values={{ view: view ?? undefined, priority: priority ?? undefined }}
        onChange={(next) => {
          setView(next.view ?? null);
          setPriority(next.priority ?? null);
        }}
      />

      <View style={{ height: 10 }} />
      {displayed.length ? displayed.map((i) => <IssueRow key={i.id} issue={i} onPress={() => setOpenId(i.id)} />) : <Empty text="No tickets match." />}
      <ErrorText error={error} />
    </Screen>
  );
}

// The ticket, and the one thing anybody does with it.
//
// This screen used to offer seven: Take this ticket, Send back to the operator, a
// Resolve box, Escalate to admin with a reason field, a priority dropdown and a
// reply box, all stacked under each other. Six of them were bookkeeping — a status
// somebody had to remember to set — and the seventh was the only one that reached
// the resident. The status follows the conversation now; what is left is the reply.
function SupervisorTicketScreen({ token, issueId, onBack, onChanged }: { token: string; issueId: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  // The conversation as this supervisor sees it: whether it is still theirs to
  // answer, and who a reply is addressed to.
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Who this could be handed to, held to this supervisor's own societies by the
  // server rather than filtered here.
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [handling, setHandling] = useState(false);
  // Escalating to the admin — the one thing above a supervisor. Asked with a
  // reason, because the admin reads it, and offered only while there is somewhere
  // higher to send it.
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [detail, thread, list] = await Promise.all([
        api.supIssue(issueId, token),
        api.issueConversation(issueId, token),
        api.supIssues(token),
      ]);
      setIssue(detail.issue);
      setConversation(thread.conversation);
      setAssignees(list.assignees ?? []);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [issueId, token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.worklist);

  const reply = async (body: string) => {
    setError(null); setNote(null);
    try {
      const r = await api.supReplyToIssue(issue!.id, body, token);
      setIssue(r.issue);
      setNote("Reply sent.");
      await load();
      await onChanged();
    } catch (e) { setError((e as Error).message); }
  };

  const escalate = async () => {
    if (handling) return;
    setHandling(true); setError(null); setNote(null);
    try {
      const r = await api.supEscalateIssue(issue!.id, escalateNote.trim(), token);
      setIssue(r.issue);
      setEscalateOpen(false); setEscalateNote("");
      setNote("Escalated to admin. They answer the resident from here.");
      await load();
      await onChanged();
    } catch (e) { setError((e as Error).message); }
    finally { setHandling(false); }
  };

  if (busy && !issue) return <Loading />;
  if (!issue) return <Screen><BackLink label="Tickets" onPress={onBack} /><ErrorText error={error} /></Screen>;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Tickets" onPress={onBack} />
      <TicketDetail issue={issue} audience="staff" conversation={conversation}>
        <TicketPhotos ticketId={issue.id} token={token} canAdd canRemoveOwn />
        <TicketHandling
          issue={issue}
          assignees={assignees}
          busy={handling}
          onPriority={async (priority) => {
            setHandling(true); setError(null);
            try {
              const r = await api.supSetIssuePriority(issue.id, priority, token);
              setIssue(r.issue); setNote(`Priority set to ${priority}.`); await onChanged();
            } catch (e) { setError((e as Error).message); }
            finally { setHandling(false); }
          }}
          onAssign={async (userId) => {
            setHandling(true); setError(null);
            try {
              // A supervisor takes a ticket or hands it to somebody in their own
              // societies. There is no unassign here: theirs is the level that
              // answers for it, so putting it down would leave it with nobody.
              if (!userId) { setNote("A supervisor's ticket stays with somebody."); return; }
              const r = await api.supAssignIssue(issue.id, userId, token);
              setIssue(r.issue); setNote(`Handed to ${r.issue.assignedToName ?? "them"}.`); await onChanged();
            } catch (e) { setError((e as Error).message); }
            finally { setHandling(false); }
          }}
        />
        {issue.status !== "closed"
          ? <ReplyBox conversation={conversation} onSend={reply} />
          : <Notice text="This ticket is closed." />}
        {/* Escalate to the admin — the level above a supervisor. Offered only
            while there is somewhere higher to send it: an issue already with the
            admin, resolved or closed has nowhere left to go. Mirrors the web
            portal's EscalateModal (issues-tab.tsx). */}
        {issue.status !== "closed" && issue.status !== "resolved"
          && issue.responsibleRole !== "admin" && !issue.escalatedToAdmin ? (
          <View style={{ marginTop: 12 }}>
            <Button label="Escalate to admin" variant="secondary" onPress={() => setEscalateOpen(true)} />
          </View>
        ) : issue.escalatedToAdmin || issue.responsibleRole === "admin" ? (
          <Notice text="This issue is already with the admin — there is nowhere higher to escalate." />
        ) : null}
      </TicketDetail>
      <ConfirmDialog
        visible={escalateOpen}
        title="Escalate this issue to the admin?"
        message="Explain why this needs the admin's attention — it is added to the ticket for them, and they answer the resident from here."
        confirmLabel="Escalate to admin"
        busy={handling}
        onConfirm={escalate}
        onCancel={() => { setEscalateOpen(false); setEscalateNote(""); }}
      >
        <Field
          label="What could you not resolve?"
          value={escalateNote}
          onChangeText={setEscalateNote}
          placeholder="What have you tried, and why does this need the admin?"
        />
      </ConfirmDialog>
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------------- search

// A global, cross-entity search of the supervisor's own area. This is not the
// per-list filters: those narrow a list you are already looking at, one entity at
// a time. This one answers "where is this order / resident / operator / society"
// across all of them at once, backed by GET /v1/supervisor/search — the same API
// the web portal's header search uses.
function SupervisorSearchScreen({ token, onOpenOrder, onGoto }: {
  token: string; onOpenOrder: (id: string) => void; onGoto: (tab: Tab) => void;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const [data, setData] = useState<SupervisorSearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = debounced.trim();
    if (term.length < 2) { setData(null); setBusy(false); return; }
    let alive = true;
    setBusy(true); setError(null);
    api.supSearch(token, term)
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [debounced, token]);

  const total = data ? data.orders.length + data.residents.length + data.operators.length + data.societies.length : 0;
  const ready = debounced.trim().length >= 2;

  return (
    <Screen>
      <PageTitle title="Search" subtitle="Orders, residents, operators and societies in your area" />
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Order ID, resident, operator or society" />
      <Notice text="A global search of your own area. Unlike the filters on each list, this finds something without your having to know which list it is in." />
      {busy ? <Loading /> : null}
      <ErrorText error={error} />
      {ready && !busy && data && total === 0 ? <Empty text="Nothing in your area matches that search." /> : null}

      {data && data.orders.length ? (
        <>
          <SectionTitle>Orders</SectionTitle>
          <OrderList orders={data.orders} onOpen={(o) => onOpenOrder(o.id)} columns={{ desktop: 2, tablet: 2, mobile: 1 }} />
        </>
      ) : null}

      {data && data.residents.length ? (
        <>
          <SectionTitle>Residents</SectionTitle>
          {data.residents.map((r) => (
            <Card key={r.id}>
              <Text style={styles.title}>{r.fullName ?? "Unnamed"}</Text>
              <Row label="Flat / unit" value={r.unitNumber} />
              <Row label="Phone" value={r.phone ?? "—"} />
            </Card>
          ))}
        </>
      ) : null}

      {data && data.operators.length ? (
        <>
          <SectionTitle>Operators</SectionTitle>
          {data.operators.map((o) => (
            <Card key={o.id} onPress={() => onGoto("operators")}>
              <View style={styles.headRow}>
                <Text style={styles.title} numberOfLines={1}>{o.fullName ?? o.phone}</Text>
                <Pill text={titleCase(o.status)} color={o.status === "active" ? theme.success : o.status === "blocked" ? theme.danger : theme.amber} />
              </View>
              <Row label="Phone" value={o.phone} />
              {o.employeeId ? <Row label="Employee ID" value={o.employeeId} /> : null}
            </Card>
          ))}
        </>
      ) : null}

      {data && data.societies.length ? (
        <>
          <SectionTitle>Societies</SectionTitle>
          {data.societies.map((s) => (
            <Card key={s.id} onPress={() => onGoto("mysociety")}>
              <Text style={styles.title}>{s.name}</Text>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

// ------------------------------------------------------------ quality checks

// The colour a check's result reads as at a glance. Pending is not yet done;
// recheck is a second look; passed is good; failed (or held for rework) is not.
function qcColor(status: string): string {
  return status === "passed" ? theme.success
    : status === "failed" ? theme.danger
      : status === "recheck" ? theme.amber
        : theme.muted;
}

// QC monitoring: every quality check in the supervisor's society, narrowable by
// result, society, operator and free text, and paged. Read-only — checks are done
// by the operations staff — but the supervisor needs to see where they stand.
// Backed by GET /v1/supervisor/qc, matching the web portal's Quality checks view.
function SupervisorQcScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const LIMIT = 20;
  const [rows, setRows] = useState<QcRow[]>([]);
  const [filters, setFilters] = useState<FilterValues>({});
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [statuses, setStatuses] = useState<string[]>(["pending", "passed", "recheck", "failed"]);
  const [societies, setSocieties] = useState<{ id: string; name: string }[]>([]);
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A changed filter or search term is a new query, so it starts again from the
  // first page rather than appending onto results for a different question.
  useEffect(() => { setOffset(0); }, [filters.status, filters.societyId, filters.operatorUserId, debouncedSearch]);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.supQc(token, {
        q: debouncedSearch.trim() || undefined,
        status: filters.status,
        societyId: filters.societyId,
        operatorUserId: filters.operatorUserId,
        limit: LIMIT,
        offset,
      });
      setRows((prev) => (offset === 0 ? r.qc : [...prev, ...r.qc]));
      setHasMore(r.page.hasMore);
      setStatuses(r.filters.statuses);
      setSocieties(r.filters.societies);
      setOperators(r.filters.operators);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, debouncedSearch, filters.status, filters.societyId, filters.operatorUserId, offset]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy && offset === 0} onRefresh={() => (offset === 0 ? load() : setOffset(0))}>
      <PageTitle title="Quality checks" subtitle="Every check in your society" />
      <FilterRow
        specs={[
          { key: "status", label: "Result", allLabel: "All results", options: statuses.map((s) => ({ value: s, label: titleCase(s) })) },
          { key: "societyId", label: "Society", allLabel: "All societies", options: societies.map((s) => ({ value: s.id, label: s.name })) },
          { key: "operatorUserId", label: "Operator", allLabel: "All operators", options: operators.map((o) => ({ value: o.id, label: o.name })) },
        ]}
        values={filters}
        onChange={setFilters}
        onClear={() => { setFilters({}); setSearch(""); }}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search order or resident"
      />
      <Text style={styles.meta}>{rows.length} check{rows.length === 1 ? "" : "s"}</Text>
      <DataTable
        rows={rows}
        keyOf={(o) => o.id}
        onPress={(o) => onOpenOrder(o.id)}
        empty="No quality checks match those filters."
        columns={[
          { key: "code", label: "Order ID", width: 118, render: (o) => <Text style={styles.cell}>{o.orderCode}</Text> },
          { key: "resident", label: "Resident", width: 130, render: (o) => orDash(o.residentName) },
          { key: "result", label: "Result", width: 110, render: (o) => <Pill text={titleCase(o.qcStatus)} color={qcColor(o.qcStatus)} /> },
          { key: "checked", label: "Checked", width: 160, render: (o) => <Text style={styles.cell}>{dateTime(o.qcCheckedAt)}</Text> },
          { key: "operator", label: "Operator", width: 130, render: (o) => orDash(o.operatorName) },
          { key: "actions", label: "Actions", width: 110, render: (o) => <CardAction label="View details" onPress={() => onOpenOrder(o.id)} /> },
        ]}
      />
      {hasMore ? (
        <View style={{ alignSelf: "center", marginTop: 10 }}>
          <Button label="Load more" variant="secondary" onPress={() => setOffset(offset + LIMIT)} />
        </View>
      ) : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------- reports

// A comparison table, not a stack of tall cards.
//
// This was called a table and rendered as one card per row, ten labelled figures
// deep — so comparing four societies meant scrolling past forty numbers and
// holding them in your head. Every row is a line now, and the columns line up.
//
// Two other things the round asks for. Rows that are not a supervisor, an
// operator or a block — orders nobody has been assigned, orders with no block
// recorded — are pulled out into a section of their own: they were sitting in the
// performance table as though somebody called "Unassigned" were doing badly, when
// what they describe is a gap in the assignment. And rows with no activity at all
// are folded away by default, because a page of zeroes is a page you have to
// scroll past to reach the rows that say something.
export function ReportTable({ title, rows, keyOf, nameOf }: {
  title: string; rows: ReportsResponse["bySociety"]; keyOf: (row: ReportsResponse["bySociety"][number]) => string; nameOf: (row: ReportsResponse["bySociety"][number]) => string;
}) {
  const [showQuiet, setShowQuiet] = useState(false);
  type ReportRow = ReportsResponse["bySociety"][number] & { unassigned?: boolean };
  const all = rows as ReportRow[];

  const assigned = all.filter((r) => !r.unassigned);
  const unassigned = all.filter((r) => r.unassigned);
  const busy = assigned.filter((r) => r.orders > 0);
  const quiet = assigned.filter((r) => r.orders === 0);
  const shown = showQuiet ? assigned : busy;

  const columns = [
    { key: "name", label: "Name", width: 190, render: (r: ReportRow) => <Text style={reportStyles.cell} numberOfLines={1}>{nameOf(r)}</Text> },
    { key: "orders", label: "Orders", width: 80, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.orders}</Text> },
    { key: "delivered", label: "Delivered", width: 90, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.delivered}</Text> },
    { key: "cancelled", label: "Cancelled", width: 90, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.cancelled}</Text> },
    { key: "failed", label: "Failed pickups", width: 110, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.failedPickups}</Text> },
    { key: "qc", label: "QC failures", width: 100, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.qcFailures}</Text> },
    { key: "delayed", label: "Delayed", width: 90, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.delayed}</Text> },
    { key: "garments", label: "Garments", width: 90, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.garments}</Text> },
    { key: "extra", label: "Additional", width: 90, render: (r: ReportRow) => <Text style={reportStyles.cell}>{r.additionalQuantity}</Text> },
    { key: "revenue", label: "Additional revenue", width: 140, render: (r: ReportRow) => <Text style={reportStyles.cell}>{rupees(r.additionalRevenuePaise)}</Text> },
  ];

  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <DataTable rows={shown} keyOf={keyOf} columns={columns} empty="Nothing in this period." />
      {quiet.length ? (
        <View style={reportStyles.quietRow}>
          <Button
            label={showQuiet ? `Hide ${quiet.length} with no activity` : `Show ${quiet.length} with no activity`}
            variant="secondary"
            onPress={() => setShowQuiet(!showQuiet)}
          />
        </View>
      ) : null}

      {unassigned.length ? (
        <>
          <SectionTitle>{title} — unassigned</SectionTitle>
          <Notice text="These are not people or towers. They are orders the platform could not attribute, which is a gap in the assignment rather than a performance figure." />
          <DataTable rows={unassigned} keyOf={keyOf} columns={columns} empty="Nothing unattributed." />
        </>
      ) : null}
    </>
  );
}

const reportStyles = themed((theme) => ({
  cell: { ...type.body, color: theme.text.primary },
  quietRow: { alignSelf: "flex-start", marginTop: 8, marginBottom: 4 },
}));

// ------------------------------------------------------------------- profile

// Read-only, to match the web supervisor: the shell shows who is signed in and a
// way out, and nothing here can be edited. Name, email and the society assignment
// are an admin's to change, so they are shown as facts rather than as form fields.
function SupervisorProfileScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<StaffUser | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.supProfile(token);
      setProfile(r.profile);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      {/* Light and dark are chosen with the sun/moon icons in the header, the same
          control every portal carries. There is no longer an Appearance section. */}
      <PageTitle title="Supervisor profile" right={<AppearanceIcons />} />

      <Card>
        <Row label="Name" value={profile?.fullName ?? "—"} />
        <Row label="Email" value={profile?.email ?? "—"} />
        <Row label="Phone" value={profile?.phone} />
        <Row label="Employee ID" value={profile?.employeeId} />
        <Row label="Assigned society" value={profile?.societyName ?? "None yet"} />
        <Row label="Operations users" value={profile?.operationsUserCount ?? 0} />
        <Row label="Account status" value={profile ? titleCase(profile.status) : "—"} />
        <Row label="Last login" value={dateTime(profile?.lastLoginAt)} />
      </Card>
      <Notice text="Your name, email and society assignment are managed by the admin." />
      <ErrorText error={error} />
      <Button label="Sign out" variant="danger" onPress={onLogout} />
      <LegalLinks />
    </Screen>
  );
}

const styles = themed((theme) => ({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 2, marginBottom: 4 },
  buttonRow: { flexDirection: "row" },
  detailLink: { alignSelf: "flex-start", marginBottom: 10 },
  cell: { fontSize: 13, color: theme.slate },
  gridActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  flatWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
}));
