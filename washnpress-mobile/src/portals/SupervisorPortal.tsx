import { useCallback, useEffect, useState } from "react";
import { themed } from "../components/themed";
import { AppearanceSetting } from "../components/appearance-setting";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  Assignee,
  ConversationView,
  Issue, OrderDetail, OrderSummary, PickupQueueItem, ReportsResponse, Slot, Society,
  StaffUser, SupervisorDashboard, Workload, HandoverPreview, SlotWindows, SocietyAssignment,
  BlockDetail,
} from "../api/types";
import { font, theme, type, rupees, shortDate, dateTime, titleCase, stateLabel } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, StatePill, BackLink, Stat, StatGrid, CardGrid,
  SlotWindowPicker, DEFAULT_SLOT_WINDOWS, to12Hour,
  VerificationTags, VerificationActions,
} from "../components/ui";
import { OrderList, OrderDetailBody, IssueCard, PaymentPill, orderTotal } from "../components/order";
import { CardAction, Dash, orDash } from "../components/records";
import { IssueRow, TicketDetail, TicketHandling, TicketPhotos, ReplyBox } from "../components/support";
import { usePolling, useDebounced, POLL } from "../hooks";
import { DateField, formatFriendly, todayIso } from "../components/calendar";
import { AssignmentPanel, supervisorAssignmentApi } from "./assignment-panel";
import { StaffWizard } from "./staff-wizard";
import { CenteredModal, StepIndicator, WizardFooter } from "../components/modal";
import { DataTable, Dropdown, FilterRow, type FilterValues } from "../components/filters";
import { ServiceBookingsScreen } from "./service-bookings";
import { AttentionBand, Pipeline, MetaStrip } from "../components/dashboard";
import { pipelineOf } from "./dashboard-rules";
import { SUPERVISOR_TABS, type SupervisorTab as Tab } from "./supervisor-rules";

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

  if (openOrderId) return <SupervisorOrderScreen token={token} orderId={openOrderId} onBack={() => setOpenOrderId(null)} />;
  if (openBlockId) return <BlockDetailScreen token={token} blockId={openBlockId} onBack={() => setOpenBlockId(null)} />;
  if (openSocietyId) return <SocietyDetailScreen token={token} societyId={openSocietyId} onBack={() => setOpenSocietyId(null)} onOpenOrder={setOpenOrderId} />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        options={SUPERVISOR_TABS}
      />
      {tab === "home" && <SupervisorHome token={token} onGoto={setTab} />}
      {tab === "mysociety" && (
        <MySocietyScreen token={token} onOpenDetail={setOpenSocietyId} onOpenBlock={setOpenBlockId} />
      )}
      {tab === "slots" && <SlotsScreen token={token} />}
      {tab === "operators" && <OperatorsScreen token={token} />}
      {tab === "orders" && (
        <SupervisorOrdersScreen
          token={token}
          filters={orderFilters}
          onFilters={setOrderFilters}
          onOpenOrder={setOpenOrderId}
        />
      )}
      {tab === "pickups" && <PickupsScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "services" && (
        <ServiceBookingsScreen
          source={{ load: (params) => api.supServices(token, params) }}
          title="Service bookings"
          subtitle="Car washing, at-home ironing and the rest, in your society"
        />
      )}
      {tab === "delayed" && <DelayedScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "issues" && <SupervisorIssuesScreen token={token} />}
      {tab === "reports" && <SupervisorReportsScreen token={token} />}
      {tab === "profile" && <SupervisorProfileScreen token={token} onLogout={onLogout} />}
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function SupervisorHome({ token, onGoto }: { token: string; onGoto: (tab: Tab) => void }) {
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
      <SectionTitle>Needs you</SectionTitle>
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
      <SectionTitle>Where the work is</SectionTitle>
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
        onOpen={() => onGoto("orders")}
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
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.supBlock(blockId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [blockId, token]);
  useEffect(() => { load(); }, [load]);

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
  visible, token, societies, slotWindows, onClose, onCreated,
}: {
  visible: boolean;
  token: string;
  societies: Society[];
  slotWindows: SlotWindows;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const today = todayIso();
  const [societyId, setSocietyId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(today);
  const [window, setWindow] = useState("Morning");
  const [capacity, setCapacity] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening it again starts from an empty form rather than from whatever was left
  // behind the last time it was closed. A supervisor runs one society, so that one
  // is filled in rather than asked for.
  useEffect(() => {
    if (!visible) return;
    setSocietyId(societies.length ? societies[0].id : undefined);
    setDate(today); setWindow("Morning"); setCapacity("10");
    setError(null); setBusy(false);
  }, [visible, societies, today]);

  const count = Number(capacity);
  const ready = Boolean(societyId) && date >= today && Number.isInteger(count) && count > 0;

  const create = async () => {
    if (!societyId) return;
    setBusy(true); setError(null);
    try {
      await api.supCreateSlot({ societyId, date, window, capacityTotal: count }, token);
      await onCreated();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <CenteredModal
      visible={visible}
      title="New slot"
      subtitle="Slot details"
      onClose={onClose}
      dirty={date !== today || window !== "Morning" || capacity !== "10"}
      discardMessage="Are you sure you want to discard this slot?"
      footer={<WizardFooter onNext={create} nextLabel="Create slot" nextDisabled={!ready} busy={busy} />}
    >
      <StepIndicator steps={["Slot details"]} current={0} />
      <Dropdown
        label="Society"
        value={societyId}
        allLabel="Choose a society"
        options={societies.map((sc) => ({ value: sc.id, label: sc.name }))}
        onChange={setSocietyId}
        width="full"
        disabled={societies.length <= 1}
      />
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
      <ErrorText error={error} />
    </CenteredModal>
  );
}

function SlotsScreen({ token }: { token: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  // One society, so what is left to narrow by is the day.
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [includePast] = useState(false);
  const [slotWindows, setSlotWindows] = useState<SlotWindows>(DEFAULT_SLOT_WINDOWS);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [slotRes, societyRes] = await Promise.all([
        api.supSlots(token, {
          from: filterDate ?? undefined,
          to: filterDate ?? undefined,
          includePast: includePast || undefined,
        }),
        api.supSocieties(token),
      ]);
      setSlots(slotRes.slots);
      if (slotRes.slotWindows) setSlotWindows(slotRes.slotWindows);
      setSocieties(societyRes.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, filterDate, includePast]);
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
    setError(null);
    try { await api.supUpdateSlot(slot.id, { capacityTotal: (slot.capacityTotal ?? 0) + delta }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Pickup slots"
        subtitle="Create and manage slots for your society"
        right={<Button label="New slot" variant="secondary" onPress={() => { setNote(null); setCreating(true); }} />}
      />
      <DateField
        label="Date"
        value={filterDate}
        onChange={setFilterDate}
        clearable
        placeholder="Any day"
      />
      <NewSlotWizard
        visible={creating}
        token={token}
        societies={societies}
        slotWindows={slotWindows}
        onClose={() => setCreating(false)}
        onCreated={async () => { setCreating(false); setNote("Slot created."); await load(); }}
      />
      {note ? <Notice tone="good" text={note} /> : null}

      <SectionTitle>Slots</SectionTitle>
      {/* Three across on a desktop. A slot card is a day, a window and three
          numbers; one per screen-width left the rest of the page blank. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {slots.map((slot) => (
          <Card key={slot.id}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{slot.window}</Text>
              <Pill
                text={slot.isActive === false ? "Cancelled" : slot.full ? "Full" : "Open"}
                color={slot.isActive === false ? theme.muted : slot.full ? theme.danger : theme.success}
              />
            </View>
            <Text style={styles.meta}>{shortDate(slot.date)} · {to12Hour(slot.startTime)} – {to12Hour(slot.endTime)}</Text>
            <Row label="Capacity" value={slot.capacityTotal ?? "—"} />
            <Row label="Booked" value={slot.bookedCount ?? "—"} />
            <Row label="Available" value={slot.capacityRemaining} />
            <View style={styles.gridActions}>
              <CardAction label="Capacity +1" onPress={() => changeCapacity(slot, 1)} />
              <CardAction label="Capacity -1" onPress={() => changeCapacity(slot, -1)} />
              {slot.isActive !== false ? <CardAction label="Cancel slot" tone="danger" onPress={() => cancel(slot)} /> : null}
            </View>
          </Card>
        ))}
      </CardGrid>
      {!slots.length ? <Empty text="No slots yet." /> : null}
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

  // Approving or rejecting one of their own operators. Only an approved and active
  // supervisor may do it, which the backend enforces; here it simply lives beside the
  // operator rather than on a page somewhere else.
  const decideOperator = async (op: StaffUser, status: "approved" | "rejected") => {
    setError(null); setNote(null);
    try {
      await api.supSetOperatorVerification(op.id, status, undefined, token);
      setNote(status === "approved"
        ? `${op.fullName} is approved and can sign in.`
        : `${op.fullName} was rejected. The decision is on the record.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

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
            <Row label="Approval" value={<VerificationTags status={op.verificationStatus} />} />
            {/* A supervisor approves their own operators here, beside everything
                else about them, rather than from a page of their own. */}
            <VerificationActions
              status={op.verificationStatus}
              onApprove={() => decideOperator(op, "approved")}
              onReject={() => decideOperator(op, "rejected")}
            />
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

// The supervisor is the first line of customer support for their area. They read
// the ticket, talk to the resident on it, coordinate with operations, and either
// resolve it or escalate it to admin.
function SupervisorIssuesScreen({ token }: { token: string }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [emergencyOnly, setEmergencyOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      setIssues((await api.supIssues(token, {
        status: status ?? undefined,
        priority: priority ?? undefined,
        emergency: emergencyOnly ? "true" : undefined,
      })).issues);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, priority, emergencyOnly]);
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

  const emergencies = issues.filter((i) => i.priority === "emergency" && i.status !== "closed");
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Customer support" subtitle="Tickets from residents in your area" />

      {emergencies.length ? (
        <Notice tone="warn" text={`${emergencies.length} emergency ticket${emergencies.length === 1 ? " needs" : "s need"} attention.`} />
      ) : null}

      <FilterRow
        specs={[
          {
            key: "status", label: "Issue status", allLabel: "Any status",
            options: ["open", "assigned", "in_progress", "resolved", "closed"]
              .map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            key: "priority", label: "Priority", allLabel: "Any priority",
            options: ["low", "normal", "high", "emergency"].map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            key: "scope", label: "Show", allLabel: "Everything",
            options: [{ value: "emergency", label: "Emergencies only" }],
          },
        ]}
        values={{
          status: status ?? undefined,
          priority: priority ?? undefined,
          scope: emergencyOnly ? "emergency" : undefined,
        }}
        onChange={(next) => {
          setStatus(next.status ?? null);
          setPriority(next.priority ?? null);
          setEmergencyOnly(next.scope === "emergency");
        }}
      />

      <View style={{ height: 10 }} />
      {issues.length ? issues.map((i) => <IssueRow key={i.id} issue={i} onPress={() => setOpenId(i.id)} />) : <Empty text="No tickets match." />}
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
      </TicketDetail>
      {note ? <Notice tone="good" text={note} /> : null}
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

function SupervisorReportsScreen({ token }: { token: string }) {
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.supReports(token, { from: from || undefined, to: to || undefined })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, from, to]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Area reports" subtitle="Your area only" />
      {/* Pick the dates from a calendar; the API still receives them in its own
          format, which is not the supervisor's problem to remember. */}
      <DateField label="From date" value={from || null} onChange={(next) => setFrom(next ?? "")} placeholder="Select start date" />
      <DateField label="To date" value={to || null} onChange={(next) => setTo(next ?? "")} placeholder="Select end date" minDate={from || undefined} />
      {from && to && to < from ? <Notice text="The end date is before the start date, so no report can be generated." /> : null}
      <Button label="Apply filters" variant="secondary" onPress={load} />

      <SectionTitle>Residents</SectionTitle>
      <Card>
        <Row label="Residents" value={data?.residents.residents ?? 0} />
        <Row label="Onboarded" value={data?.residents.onboarded ?? 0} />
        <Row label="Pending onboarding" value={data?.residents.pendingOnboarding ?? 0} />
        <Row label="With active subscription" value={data?.residents.withActiveSubscription ?? 0} />
      </Card>

      <SectionTitle>Revenue</SectionTitle>
      <Card>
        <Row label="Subscription revenue" value={rupees(data?.revenue.subscriptionRevenuePaise ?? 0)} />
        <Row label="Additional garment revenue" value={rupees(data?.revenue.additionalGarmentRevenuePaise ?? 0)} />
        <Row label="Pending charges" value={rupees(data?.revenue.pendingAdditionalChargesPaise ?? 0)} />
        <Row label="Total" value={rupees(data?.revenue.totalRevenuePaise ?? 0)} />
      </Card>

      {data ? <ReportTable title="Society-wise" rows={data.bySociety} keyOf={(r) => r.societyId ?? ""} nameOf={(r) => r.societyName ?? "Unknown"} /> : null}
      {data ? <ReportTable title="Operator performance" rows={data.byOperator} keyOf={(r) => r.operatorUserId ?? ""} nameOf={(r) => r.operatorName ?? "Unassigned"} /> : null}

      <SectionTitle>Issues</SectionTitle>
      <Card>
        <Row label="Total" value={data?.issues.total ?? 0} />
        <Row label="Open" value={data?.issues.open ?? 0} />
        <Row label="In progress" value={data?.issues.inProgress ?? 0} />
        <Row label="Resolved" value={data?.issues.resolved ?? 0} />
        {data?.issues.byType.map((t) => <Row key={t.type} label={titleCase(t.type)} value={t.count} />)}
      </Card>

      <SectionTitle>Subscription usage</SectionTitle>
      {data?.subscriptions.byPlan.map((plan) => (
        <Card key={plan.id}>
          <Text style={styles.title}>{plan.tier}</Text>
          <Row label="Active subscribers" value={plan.activeSubscribers} />
          <Row label="Allowance" value={plan.allowance} />
          <Row label="Garments used" value={plan.garmentsUsed} />
          <Row label="Revenue" value={rupees(plan.revenuePaise)} />
        </Card>
      ))}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------- profile

function SupervisorProfileScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<StaffUser | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.supProfile(token);
      setProfile(r.profile); setFullName(r.profile.fullName ?? ""); setEmail(r.profile.email ?? "");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setNote(null); setError(null);
    try { await api.supUpdateProfile({ fullName, email }, token); setNote("Profile updated."); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Supervisor profile" />
      {/* Appearance sits at the top of every profile screen rather than buried under
          the account fields: it is the one setting here that changes what the person
          is looking at while they look at it. */}
      <SectionTitle>Appearance</SectionTitle>
      <Card><AppearanceSetting /></Card>

      <Card>
        <Row label="Phone" value={profile?.phone} />
        <Row label="Employee ID" value={profile?.employeeId} />
        <Row label="Assigned society" value={profile?.societyName ?? "None yet"} />
        <Row label="Operations users" value={profile?.operationsUserCount ?? 0} />
        <Row label="Account status" value={profile ? titleCase(profile.status) : "—"} />
        <Row label="Last login" value={dateTime(profile?.lastLoginAt)} />
      </Card>
      <Notice text="Your society assignment is controlled by the admin." />
      <Field label="Full name" value={fullName} onChangeText={setFullName} />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Button label="Save changes" onPress={save} />
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
      <Button label="Sign out" variant="danger" onPress={onLogout} />
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
}));
