import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  ConversationView,
  Issue, IssuePriority, OrderDetail, OrderSummary, PickupQueueItem, ReportsResponse, Slot, Society,
  StaffUser, SupervisorDashboard, Workload, HandoverPreview, SlotWindows, SocietyAssignment,
  QcRow, PageInfo,
} from "../api/types";
import { theme, rupees, shortDate, dateTime, titleCase, stateLabel } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, StatePill, BackLink, Stat, StatGrid, CardGrid, FieldRow,
  SlotWindowPicker, DEFAULT_SLOT_WINDOWS, to12Hour,
  VerificationTags, VerificationActions,
} from "../components/ui";
import { OrderList, OrderDetailBody, IssueCard } from "../components/order";
import { IssueRow, TicketDetail, ReplyBox, ResolveBox, describeAge } from "../components/support";
import { usePolling, useDebounced, POLL } from "../hooks";
import { DateField, formatFriendly, todayIso } from "../components/calendar";
import { AssignmentPanel, supervisorAssignmentApi } from "./assignment-panel";
import { StaffWizard } from "./staff-wizard";
import { Dropdown, FilterRow, Pager, type FilterValues } from "../components/filters";

type Tab = "home" | "mysociety" | "societies" | "slots" | "operators" | "orders" | "pickups" | "processing" | "qc" | "delayed" | "issues" | "reports" | "search" | "profile";

export function SupervisorPortal({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [openSocietyId, setOpenSocietyId] = useState<string | null>(null);

  if (openOrderId) return <SupervisorOrderScreen token={token} orderId={openOrderId} onBack={() => setOpenOrderId(null)} />;
  if (openSocietyId) return <SocietyDetailScreen token={token} societyId={openSocietyId} onBack={() => setOpenSocietyId(null)} onOpenOrder={setOpenOrderId} />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: "home", label: "Dashboard" },
          { key: "mysociety", label: "My society" },
          { key: "societies", label: "Societies" },
          { key: "slots", label: "Slots" },
          { key: "operators", label: "Operations" },
          { key: "pickups", label: "Pickups" },
          { key: "processing", label: "Processing" },
          { key: "qc", label: "QC" },
          { key: "orders", label: "Orders" },
          { key: "delayed", label: "Delayed" },
          { key: "issues", label: "Issues" },
          { key: "reports", label: "Reports" },
          { key: "search", label: "Search" },
          { key: "profile", label: "Profile" },
        ]}
      />
      {tab === "home" && <SupervisorHome token={token} onGoto={setTab} />}
      {tab === "mysociety" && <MySocietyScreen token={token} />}
      {tab === "societies" && <SocietiesScreen token={token} onOpen={setOpenSocietyId} />}
      {tab === "slots" && <SlotsScreen token={token} />}
      {tab === "operators" && <OperatorsScreen token={token} />}
      {tab === "orders" && <SupervisorOrdersScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "pickups" && <PickupsScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "processing" && <ProcessingScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "qc" && <QcScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "delayed" && <DelayedScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "issues" && <SupervisorIssuesScreen token={token} />}
      {tab === "reports" && <SupervisorReportsScreen token={token} />}
      {tab === "search" && <SearchScreen token={token} onOpenOrder={setOpenOrderId} />}
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
  // Only the cleaning stages this area's orders actually need, so a supervisor is
  // not shown a fixed workflow that has nothing to do with what was sent in.
  const stages = data?.processing?.stages ?? [];
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Supervisor Dashboard" subtitle={data?.area ? `Area: ${data.area.name}` : "No area assigned"} />
      <ErrorText error={error} />
      {!data?.area ? <Notice tone="warn" text="You have not been assigned to an area yet. Ask an admin to assign one." /> : null}

      <SectionTitle>Area overview</SectionTitle>
      <StatGrid>
        <Stat label="Societies" value={data?.societies.total ?? 0} onPress={() => onGoto("societies")} />
        <Stat label="Residents" value={data?.residents.total ?? 0} onPress={() => onGoto("societies")} />
        <Stat label="Operations staff" value={data?.operationsStaff.total ?? 0} onPress={() => onGoto("operators")} />
        <Stat label="Active staff" value={data?.operationsStaff.active ?? 0} onPress={() => onGoto("operators")} />
      </StatGrid>

      <SectionTitle>Today&apos;s operations</SectionTitle>
      <StatGrid>
        <Stat label="Today's pickups" value={data?.pickups.today ?? 0} onPress={() => onGoto("pickups")} />
        <Stat label="Pending pickups" value={data?.pickups.pending ?? 0} onPress={() => onGoto("pickups")} />
        <Stat label="Completed pickups" value={data?.pickups.completed ?? 0} tone="good" onPress={() => onGoto("pickups")} />
        <Stat label="Failed pickups" value={data?.pickups.failed ?? 0} tone="danger" onPress={() => onGoto("pickups")} />
      </StatGrid>

      <SectionTitle>Processing</SectionTitle>
      {stages.length || data?.processing?.ironing || data?.processing?.qcPending || data?.processing?.qcFailed ? (
        <StatGrid>
          {stages.map((stage) => (
            <Stat key={stage.key} label={stage.label} value={stage.count} onPress={() => onGoto("processing")} />
          ))}
          <Stat label="Ironing" value={data?.processing?.ironing ?? 0} onPress={() => onGoto("processing")} />
          <Stat label="QC pending" value={data?.processing?.qcPending ?? 0} tone="warn" onPress={() => onGoto("qc")} />
          <Stat label="QC failed" value={data?.processing?.qcFailed ?? 0} tone="danger" onPress={() => onGoto("qc")} />
        </StatGrid>
      ) : <Empty text="No orders currently processing." />}

      <SectionTitle>Delivery</SectionTitle>
      <StatGrid>
        <Stat label="Ready" value={o?.readyForDelivery ?? 0} tone="good" onPress={() => onGoto("processing")} />
        <Stat label="Out for delivery" value={o?.outForDelivery ?? 0} onPress={() => onGoto("orders")} />
        <Stat label="Delivered" value={o?.delivered ?? 0} tone="good" onPress={() => onGoto("orders")} />
        <Stat label="Delayed" value={o?.delayed ?? 0} tone="danger" onPress={() => onGoto("delayed")} />
      </StatGrid>

      <SectionTitle>Orders</SectionTitle>
      <StatGrid>
        <Stat label="Today's orders" value={o?.today ?? 0} onPress={() => onGoto("orders")} />
        <Stat label="Scheduled" value={o?.scheduled ?? 0} onPress={() => onGoto("orders")} />
        <Stat label="Active" value={o?.active ?? 0} onPress={() => onGoto("orders")} />
        <Stat label="Completed" value={o?.completed ?? 0} tone="good" onPress={() => onGoto("orders")} />
        <Stat label="Cancelled" value={o?.cancelled ?? 0} onPress={() => onGoto("orders")} />
      </StatGrid>

      <SectionTitle>Issues</SectionTitle>
      <StatGrid>
        <Stat label="Open" value={issues?.open ?? 0} tone="danger" onPress={() => onGoto("issues")} />
        <Stat label="Assigned" value={issues?.assigned ?? 0} tone="warn" onPress={() => onGoto("issues")} />
        <Stat label="In progress" value={issues?.inProgress ?? 0} tone="warn" onPress={() => onGoto("issues")} />
        <Stat label="Escalated to admin" value={issues?.escalatedAdmin ?? 0} tone="danger" onPress={() => onGoto("issues")} />
        <Stat label="Resolved" value={issues?.resolved ?? 0} tone="good" onPress={() => onGoto("issues")} />
      </StatGrid>

      <SectionTitle>Quick actions</SectionTitle>
      <StatGrid>
        <Stat label="View societies" value="›" onPress={() => onGoto("societies")} />
        <Stat label="Pickup slots" value="›" onPress={() => onGoto("slots")} />
        <Stat label="View pickups" value="›" onPress={() => onGoto("pickups")} />
        <Stat label="View processing" value="›" onPress={() => onGoto("processing")} />
        <Stat label="View QC" value="›" onPress={() => onGoto("qc")} />
        <Stat label="View orders" value="›" onPress={() => onGoto("orders")} />
        <Stat label="Manage issues" value="›" onPress={() => onGoto("issues")} />
        <Stat label="View reports" value="›" onPress={() => onGoto("reports")} />
      </StatGrid>
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
function MySocietyScreen({ token }: { token: string }) {
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
        subtitle={society ? `${society.code} · ${society.address ?? society.city}` : "Waiting to be assigned"}
      />
      <ErrorText error={error} />
      {society ? (
        <Card>
          <View style={styles.headRow}>
            <Text style={styles.title}>{society.name}</Text>
            <Pill text={titleCase(society.status)} color={society.status === "active" ? theme.success : theme.muted} />
          </View>
          <Row label="Area" value={society.areaName} />
          <Row label="Residents" value={society.residentCount ?? 0} />
          <Row label="Operations staff" value={society.operationsStaffCount ?? 0} />
          <Row label="Active orders" value={society.activeOrderCount ?? 0} />
          <Row label="Available slots" value={society.availableSlots ?? 0} />
        </Card>
      ) : null}
      {society ? (
        <AssignmentPanel
          source={supervisorAssignmentApi(society.id, token)}
          title="Blocks and operators"
          subtitle="Who covers which tower. An operator sees and handles only the blocks assigned to them."
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

function SocietiesScreen({ token, onOpen }: { token: string; onOpen: (id: string) => void }) {
  const [societies, setSocieties] = useState<Society[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setSocieties((await api.supSocieties(token, { q: search || undefined })).societies); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, search]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setError(null);
    try {
      await api.supCreateSociety({ name, code, address: address || undefined }, token);
      setName(""); setCode(""); setAddress(""); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggle = async (society: Society) => {
    setError(null);
    try { await api.supUpdateSociety(society.id, { status: society.status === "active" ? "inactive" : "active" }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Societies" subtitle="Societies in your area only" right={<Button label={creating ? "Close" : "New"} variant="secondary" onPress={() => setCreating(!creating)} />} />
      {creating ? (
        <Card>
          <Field label="Society name" value={name} onChangeText={setName} />
          <Field label="Society code" value={code} onChangeText={setCode} placeholder="MHB" />
          <Field label="Address" value={address} onChangeText={setAddress} />
          <Notice text="The society is created inside your assigned area." />
          <Button label="Create society" onPress={create} disabled={!name || code.length < 2} />
        </Card>
      ) : null}
      <Field label="Search" value={search} onChangeText={setSearch} placeholder="Name or code" />
      <View style={{ height: 8 }} />
      {societies.length ? societies.map((s) => (
        <Card key={s.id} onPress={() => onOpen(s.id)}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{s.name}</Text>
            <Pill text={titleCase(s.status)} color={s.status === "active" ? theme.success : theme.muted} />
          </View>
          <Text style={styles.meta}>{s.code} · {s.address ?? s.city}</Text>
          <Row label="Residents" value={s.residentCount ?? 0} />
          <Row label="Operations staff" value={s.operationsStaffCount ?? 0} />
          <Row label="Active orders" value={s.activeOrderCount ?? 0} />
          <Row label="Available slots" value={s.availableSlots ?? 0} />
          <Button label={s.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(s)} />
        </Card>
      )) : <Empty text="No societies in your area yet." />}
      <ErrorText error={error} />
    </Screen>
  );
}

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
      <Screen refreshing={busy} onRefresh={load}>
        <BackLink label="Societies" onPress={onBack} />
        <PageTitle title={data?.society.name ?? "Society"} subtitle={data?.society.code} />
        <ErrorText error={error} />

        {section === "overview" ? (
          <Card>
            <Row label="Society code" value={data?.society.code} />
            <Row label="Address" value={data?.society.address} />
            <Row label="Area" value={data?.society.areaName} />
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

function SlotsScreen({ token }: { token: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  // Area, then the societies inside it, then the day. A row of society buttons put
  // every society a supervisor covers on screen at once and said nothing about which
  // area they belonged to; a supervisor watching capacity wants to narrow, not scan.
  const [areaId, setAreaId] = useState<string | undefined>(undefined);
  const [societyId, setSocietyId] = useState<string | undefined>(undefined);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [includePast, setIncludePast] = useState(false);
  const [window, setWindow] = useState("Morning");
  // The hours belong to the window, and the backend is the one that says what they
  // are. Nobody types a time: a Morning slot is the same three hours everywhere.
  const [slotWindows, setSlotWindows] = useState<SlotWindows>(DEFAULT_SLOT_WINDOWS);
  const [capacity, setCapacity] = useState("10");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The areas this supervisor covers, taken from the societies they can see rather
  // than from a separate list: a supervisor sees exactly one area today, and this
  // keeps working if that ever changes.
  const areas = Array.from(
    new Map(
      societies
        .filter((so) => so.areaId)
        .map((so) => [so.areaId as string, { id: so.areaId as string, name: so.areaName ?? so.areaId as string }]),
    ).values(),
  );
  const societiesInArea = areaId ? societies.filter((so) => so.areaId === areaId) : societies;

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [slotRes, societyRes] = await Promise.all([
        api.supSlots(token, {
          societyId: societyId ?? undefined,
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
  }, [token, societyId, filterDate, includePast]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!societyId) { setError("Choose a society first."); return; }
    // A slot on a day that has already gone can never be worked. The backend
    // refuses it too; saying so here saves a round trip.
    if (date < today) { setError("That date has already passed. Choose today or a later day."); return; }
    setError(null); setNote(null);
    try {
      await api.supCreateSlot({ societyId, date, window, capacityTotal: Number(capacity) }, token);
      setNote("Slot created."); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

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
      <PageTitle title="Pickup slots" subtitle="Create and manage slots for your societies" right={<Button label={creating ? "Close" : "New slot"} variant="secondary" onPress={() => setCreating(!creating)} />} />
      {/* Area, then society, then date. Each narrows the next, and the society list
          only offers what is inside the area actually chosen. */}
      <Dropdown
        label="Area"
        value={areaId}
        options={areas.map((a) => ({ value: a.id, label: a.name }))}
        onChange={(next) => { setAreaId(next); setSocietyId(undefined); }}
        allLabel="All my areas"
      />
      <Dropdown
        label="Society"
        value={societyId}
        options={societiesInArea.map((so) => ({ value: so.id, label: so.name }))}
        onChange={setSocietyId}
        allLabel={areaId ? "All societies in this area" : "All my societies"}
        disabled={societiesInArea.length === 0}
        hint={areaId ? "No societies in this area." : undefined}
      />
      <DateField
        label="Date"
        value={filterDate}
        onChange={setFilterDate}
        clearable
        placeholder="Any day"
      />
      {creating ? (
        <Card>
          {/* The same calendar the rest of the application uses, rather than a box
              somebody types YYYY-MM-DD into. A day that has gone cannot be worked, so
              it cannot be chosen. */}
          <DateField
            label="Date"
            value={date}
            onChange={(next) => setDate(next ?? today)}
            minDate={today}
            clearable={false}
          />
          <SlotWindowPicker windows={slotWindows} value={window} onChange={setWindow} />
          <Field label="Capacity" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
          <Button label="Create slot" onPress={create} disabled={!societyId} />
        </Card>
      ) : null}
      {note ? <Notice tone="good" text={note} /> : null}

      <SectionTitle>Slots</SectionTitle>
      {slots.length ? slots.map((slot) => (
        <Card key={slot.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{shortDate(slot.date)} · {to12Hour(slot.startTime)} – {to12Hour(slot.endTime)}</Text>
            <Pill
              text={slot.isActive === false ? "Cancelled" : slot.full ? "Full" : "Open"}
              color={slot.isActive === false ? theme.muted : slot.full ? theme.danger : theme.success}
            />
          </View>
          <Text style={styles.meta}>{slot.societyName} · {slot.window}</Text>
          <Row label="Capacity" value={slot.capacityTotal ?? "—"} />
          <Row label="Booked" value={slot.bookedCount ?? "—"} />
          <Row label="Available" value={slot.capacityRemaining} />
          <View style={styles.buttonRow}>
            <View style={{ flex: 1, marginRight: 6 }}><Button label="Capacity +1" variant="secondary" onPress={() => changeCapacity(slot, 1)} /></View>
            <View style={{ flex: 1, marginLeft: 6 }}><Button label="Capacity −1" variant="secondary" onPress={() => changeCapacity(slot, -1)} /></View>
          </View>
          {slot.isActive !== false ? <Button label="Cancel slot" variant="danger" onPress={() => cancel(slot)} /> : null}
        </Card>
      )) : <Empty text="No slots yet." />}
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

  const reassign = async (op: StaffUser, targetSocietyId: string) => {
    setError(null);
    const next = op.societyIds.includes(targetSocietyId)
      ? op.societyIds.filter((id) => id !== targetSocietyId)
      : [...op.societyIds, targetSocietyId];
    try { await api.supUpdateOperator(op.id, { societyIds: next }, token); await load(); }
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
          area is the supervisor's own, so the assignment step says which it is
          rather than asking. */}
      <StaffWizard
        visible={creating}
        role="operator"
        token={token}
        // A supervisor works one area, so there is nothing to choose: the wizard's
        // assignment step says so rather than offering a list of one.
        areas={[]}
        regions={[]}
        fixedAreaId="own"
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          setCreating(false);
          setNote(`${created.fullName} created with employee ID ${created.employeeId}. Assign their blocks from My society.`);
          await load();
        }}
      />
      {note ? <Notice tone="good" text={note} /> : null}

      <SectionTitle>Workload</SectionTitle>
      {workload.length ? workload.map((w) => (
        <Card key={w.userId}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{w.name ?? "Unnamed"}</Text>
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
      )) : <Empty text="No operations staff yet." />}

      <SectionTitle>Staff</SectionTitle>
      {operators.map((op) => (
        <Card key={op.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{op.fullName}</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <VerificationTags status={op.verificationStatus} />
              <Pill text={titleCase(op.status)} color={STATUS_COLOR[op.status] ?? theme.muted} />
            </View>
          </View>
          <Row label="Employee ID" value={op.employeeId} />
          <Row label="Phone" value={op.phone} />
          <Row label="Area" value={op.areaName} />
          <Row label="Societies" value={op.societyNames.join(", ") || "None"} />
          {/* A supervisor approves their own operators here, beside everything else
              about them, rather than from a page of their own. */}
          <VerificationActions
            status={op.verificationStatus}
            onApprove={() => decideOperator(op, "approved")}
            onReject={() => decideOperator(op, "rejected")}
          />
          <Row label="Assigned societies" value={op.societyNames?.length ? op.societyNames.join(", ") : "None"} />
          <Row label="Blocks" value={op.blockNames?.length ? op.blockNames.join(", ") : "Whole society"} />
          <Dropdown
            label="Add or remove a society"
            value={undefined}
            allLabel="Choose a society"
            options={societies.map((sc) => ({
              value: sc.id,
              label: op.societyIds.includes(sc.id) ? `Remove ${sc.name}` : `Add ${sc.name}`,
            }))}
            onChange={(id) => { if (id) reassign(op, id); }}
          />
          <Button label="Availability and handover" variant="secondary" onPress={() => setHandoverFor(op.id)} />
        </Card>
      ))}
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

function SupervisorOrdersScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [orderCode, setOrderCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [o, s] = await Promise.all([
        api.supOrders(token, { societyId: societyId ?? undefined, state: state ?? undefined, orderCode: orderCode || undefined }),
        api.supSocieties(token),
      ]);
      setOrders(o.orders); setSocieties(s.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, societyId, state, orderCode]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Orders" subtitle="Every order in your society" />
      <FilterRow
        specs={[
          {
            key: "societyId", label: "Society", allLabel: "All societies",
            options: societies.map((sc) => ({ value: sc.id, label: sc.name })),
          },
          {
            key: "state", label: "Order status", allLabel: "All statuses",
            options: SUPERVISOR_ORDER_STATES.map((v) => ({ value: v, label: stateLabel[v] ?? titleCase(v) })),
          },
        ]}
        values={{ societyId: societyId ?? undefined, state: state ?? undefined }}
        onChange={(next) => { setSocietyId(next.societyId ?? null); setState(next.state ?? null); }}
        search={orderCode}
        onSearch={setOrderCode}
        searchPlaceholder="Order ID, e.g. ORD-756272"
      />
      <Text style={styles.meta}>{orders.length} order{orders.length === 1 ? "" : "s"}</Text>
      <OrderList orders={orders} onOpen={(o) => onOpenOrder(o.id)} />
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

// --------------------------------------------------------------- processing

const PROCESSING_GROUPS: { key: string; label: string }[] = [
  { key: "waitingForWashing", label: "Waiting for washing" },
  { key: "washing", label: "Washing" },
  { key: "ironingPending", label: "Waiting for ironing" },
  { key: "ironing", label: "Ironing" },
  { key: "waitingForQc", label: "Waiting for QC" },
  { key: "qcFailed", label: "QC failures" },
  { key: "readyForDelivery", label: "Ready for delivery" },
  { key: "outForDelivery", label: "Out for delivery" },
];

function ProcessingScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [groups, setGroups] = useState<Record<string, OrderSummary[]>>({});
  const [group, setGroup] = useState("waitingForWashing");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setGroups(await api.supProcessing(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const orders = Array.isArray(groups[group]) ? groups[group] : [];
  return (
    <View style={{ flex: 1 }}>
      <Tabs value={group} onChange={setGroup} options={PROCESSING_GROUPS.map((g) => ({ key: g.key, label: g.label, badge: Array.isArray(groups[g.key]) ? groups[g.key].length : 0 }))} />
      <Screen refreshing={busy} onRefresh={load}>
        <PageTitle title="Processing monitoring" subtitle="Where every batch is right now" />
        <OrderList orders={orders} onOpen={(o) => onOpenOrder(o.id)} emptyText="Nothing at this stage." />
        <ErrorText error={error} />
      </Screen>
    </View>
  );
}

// Quality checks, as something a supervisor can actually search.
//
// This was every check in the society, as full-width cards, in one unbroken list
// with no way to narrow it and no way to page through it. A society doing forty
// orders a day produces two hundred checks a week, and finding one meant scrolling.
function QcScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [rows, setRows] = useState<QcRow[]>([]);
  const [page, setPage] = useState<PageInfo>({ total: 0, limit: 24, offset: 0, hasMore: false });
  const [options, setOptions] = useState<{
    statuses: string[]; societies: { id: string; name: string }[]; operators: { id: string; name: string }[];
  }>({ statuses: [], societies: [], operators: [] });
  const [values, setValues] = useState<FilterValues>({});
  const [search, setSearch] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useDebounced(search, 250);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.supQc(token, {
        q: query || undefined,
        status: values.status, societyId: values.societyId, operatorUserId: values.operatorUserId,
        date: date ?? undefined, limit: 24, offset,
      });
      setRows(res.qc); setPage(res.page); setOptions(res.filters);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, query, values.status, values.societyId, values.operatorUserId, date, offset]);
  useEffect(() => { load(); }, [load]);

  // Narrowing the list starts it again from the top, because page four of the old
  // list has nothing to do with the new one.
  const narrow = (next: FilterValues) => { setValues(next); setOffset(0); };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="QC monitoring" subtitle="Quality checks in your society" />
      <FilterRow
        specs={[
          {
            key: "status", label: "Status", allLabel: "All statuses",
            options: options.statuses.map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            key: "societyId", label: "Society", allLabel: "All societies",
            options: options.societies.map((sc) => ({ value: sc.id, label: sc.name })),
          },
          {
            key: "operatorUserId", label: "Operator", allLabel: "All operators",
            options: options.operators.map((op) => ({ value: op.id, label: op.name })),
          },
        ]}
        values={values}
        onChange={narrow}
        search={search}
        onSearch={(next) => { setSearch(next); setOffset(0); }}
        searchPlaceholder="Order ID, resident or society"
        onClear={() => { setDate(null); setOffset(0); }}
        extra={<DateField label="Checked on" value={date} onChange={(next) => { setDate(next); setOffset(0); }} placeholder="Any date" />}
      />

      {/* Four across on a desktop. A QC card is six short rows and a badge. */}
      <CardGrid columns={{ desktop: 4, tablet: 2, mobile: 1 }}>
        {rows.map((o) => (
          <Card key={o.id}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{o.orderCode}</Text>
              <Pill text={titleCase(o.qcStatus)} color={QC_STATUS_COLOUR[o.qcStatus] ?? theme.amber} />
            </View>
            <Row label="Resident" value={o.residentName} />
            <Row label="Society" value={o.societyName} />
            <Row label="Operator" value={o.operatorName} />
            <Row label="Garments" value={o.acceptedCount ?? "—"} />
            <Row label="Checked" value={dateTime(o.qcCheckedAt)} />
            {o.qcReason ? <Notice tone="warn" text={o.qcReason} /> : null}
            <Button label="View details" variant="secondary" onPress={() => onOpenOrder(o.id)} />
          </Card>
        ))}
      </CardGrid>
      {!busy && !rows.length ? <Empty text="No quality checks match those filters." /> : null}
      <Pager page={page} onChange={setOffset} />
      <ErrorText error={error} />
    </Screen>
  );
}

const QC_STATUS_COLOUR: Record<string, string> = {
  passed: theme.success,
  failed: theme.danger,
  recheck: theme.amber,
  pending: theme.aqua,
};

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
      {orders.length ? orders.map((o) => (
        <Card key={o.id} onPress={() => onOpenOrder(o.id)}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{o.orderCode}</Text>
            <Pill text={`${Math.round(o.delayMinutes / 60)}h late`} color={theme.danger} />
          </View>
          <Row label="Resident" value={o.residentName} />
          <Row label="Society" value={o.societyName} />
          <Row label="Current status" value={titleCase(o.state)} />
          <Row label="Expected completion" value={dateTime(o.expectedCompletionAt)} />
          <Row label="Assigned operator" value={o.operatorName ?? "Unassigned"} />
        </Card>
      )) : <Empty text="No delayed orders." />}
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

function SupervisorTicketScreen({ token, issueId, onBack, onChanged }: { token: string; issueId: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  // The conversation as this supervisor sees it: whether it is still theirs to
  // answer, and who a reply is addressed to.
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [escalateNote, setEscalateNote] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [detail, thread] = await Promise.all([
        api.supIssue(issueId, token),
        api.issueConversation(issueId, token),
      ]);
      setIssue(detail.issue);
      setConversation(thread.conversation);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [issueId, token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.worklist);

  const act = async (run: () => Promise<{ issue: Issue }>, message: string) => {
    setError(null); setNote(null);
    try {
      const r = await run();
      setIssue(r.issue);
      setNote(message);
      await load();
      await onChanged();
    } catch (e) { setError((e as Error).message); }
  };

  if (busy && !issue) return <Loading />;
  if (!issue) return <Screen><BackLink label="Tickets" onPress={onBack} /><ErrorText error={error} /></Screen>;

  const openForWork = issue.status !== "closed";
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Tickets" onPress={onBack} />
      <TicketDetail issue={issue} audience="staff" conversation={conversation}>
        {openForWork ? (
          <>
            {/* One conversation section, and a label that says who is actually being
                written to. "Reply to the resident" was written into the screen, so a
                supervisor asking their operator for information was told they were
                answering the resident. */}
            <ReplyBox
              conversation={conversation}
              onSend={(body) => act(() => api.supReplyToIssue(issue.id, body, token), "Reply sent.")}
            />

            <Dropdown
              label="Priority"
              value={issue.priority}
              allowClear={false}
              options={(["low", "normal", "high", "emergency"] as IssuePriority[])
                .map((v) => ({ value: v, label: titleCase(v) }))}
              onChange={(next) => {
                if (next) act(() => api.supSetIssuePriority(issue.id, next as IssuePriority, token), "Priority updated.");
              }}
            />

            <SectionTitle>Progress</SectionTitle>
            {issue.status === "open" ? (
              <Button label="Take this ticket" onPress={() => act(() => api.supSetIssueStatus(issue.id, "in_progress", undefined, token), "Marked in progress.")} />
            ) : null}
            {issue.status !== "waiting_operator" && issue.status !== "resolved" && issue.status !== "closed" ? (
              <Button
                label="Send back to the operator"
                variant="secondary"
                onPress={() => act(() => api.supSetIssueStatus(issue.id, "waiting_operator", undefined, token), "Waiting on the operator.")}
              />
            ) : null}

            {issue.status !== "resolved" ? (
              // The note is asked for at the moment of resolving rather than kept on
              // screen permanently beside the button.
              <ResolveBox
                canClose={false}
                onResolve={async (note) => {
                  await act(() => api.supSetIssueStatus(issue.id, "resolved", note, token), "Resolved. The resident can now close it.");
                }}
              />
            ) : (
              <Notice tone="good" text="Resolved. The resident closes the ticket once they are satisfied." />
            )}

            {!issue.escalatedToAdmin ? (
              escalating ? (
                <>
                  <Field label="Why does admin need this?" value={escalateNote} onChangeText={setEscalateNote} placeholder="Needs a system level decision" />
                  <Button
                    label="Escalate to admin"
                    variant="danger"
                    disabled={!escalateNote.trim()}
                    onPress={async () => {
                      await act(() => api.supEscalateIssue(issue.id, escalateNote.trim(), token), "Escalated to admin.");
                      setEscalating(false); setEscalateNote("");
                    }}
                  />
                  <Button label="Cancel" variant="secondary" onPress={() => setEscalating(false)} />
                </>
              ) : (
                <Button label="Escalate to admin" variant="danger" onPress={() => setEscalating(true)} />
              )
            ) : (
              <Notice text="This ticket is with admin as well as you." />
            )}
          </>
        ) : (
          <Notice text="This ticket is closed." />
        )}
      </TicketDetail>
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------- reports

export function ReportTable({ title, rows, keyOf, nameOf }: {
  title: string; rows: ReportsResponse["bySociety"]; keyOf: (row: ReportsResponse["bySociety"][number]) => string; nameOf: (row: ReportsResponse["bySociety"][number]) => string;
}) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {rows.length ? rows.map((row) => (
        <Card key={keyOf(row)}>
          <Text style={styles.title}>{nameOf(row)}</Text>
          <Row label="Orders" value={row.orders} />
          <Row label="Delivered" value={row.delivered} />
          <Row label="Cancelled" value={row.cancelled} />
          <Row label="Failed pickups" value={row.failedPickups} />
          <Row label="QC failures" value={row.qcFailures} />
          <Row label="Delayed" value={row.delayed} />
          <Row label="Garments" value={row.garments} />
          <Row label="Subscription covered" value={row.subscriptionCovered} />
          <Row label="Additional garments" value={row.additionalQuantity} />
          <Row label="Additional revenue" value={rupees(row.additionalRevenuePaise)} />
        </Card>
      )) : <Empty text="No data." />}
    </>
  );
}

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

// -------------------------------------------------------------------- search

function SearchScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.supSearch>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true); setError(null);
    try { setResult(await api.supSearch(token, q.trim())); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <PageTitle title="Search" subtitle="Order id, resident, phone, society or operator" />
      <Field label="Search" value={q} onChangeText={setQ} placeholder="ORD-756272 or Anusha" />
      <Button label="Search" onPress={run} disabled={busy || !q.trim()} />
      <Notice text="Results are limited to your assigned area. An order from another area will not be found." />
      {result ? (
        <>
          <SectionTitle>Orders</SectionTitle>
          <OrderList orders={result.orders} onOpen={(o) => onOpenOrder(o.id)} emptyText="No matching orders." />
          <SectionTitle>Residents</SectionTitle>
          {result.residents.length ? result.residents.map((r) => (
            <Card key={r.id}>
              <Text style={styles.title}>{r.fullName ?? "Unnamed"}</Text>
              <Row label="Phone" value={r.phone} />
              <Row label="Flat / unit" value={r.unitNumber} />
            </Card>
          )) : <Empty text="No matching residents." />}
          <SectionTitle>Societies</SectionTitle>
          {result.societies.length ? result.societies.map((s) => (
            <Card key={s.id}><Text style={styles.title}>{s.name}</Text><Row label="Code" value={s.code} /></Card>
          )) : <Empty text="No matching societies." />}
        </>
      ) : null}
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
      <Card>
        <Row label="Phone" value={profile?.phone} />
        <Row label="Employee ID" value={profile?.employeeId} />
        <Row label="Assigned area" value={profile?.areaName} />
        <Row label="Societies managed" value={profile?.societyCount ?? 0} />
        <Row label="Operations users" value={profile?.operationsUserCount ?? 0} />
        <Row label="Account status" value={profile ? titleCase(profile.status) : "—"} />
        <Row label="Last login" value={dateTime(profile?.lastLoginAt)} />
      </Card>
      <Notice text="Your area assignment is controlled by the admin." />
      <Field label="Full name" value={fullName} onChangeText={setFullName} />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Button label="Save changes" onPress={save} />
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
      <Button label="Sign out" variant="danger" onPress={onLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 15, fontWeight: "800", color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 2, marginBottom: 4 },
  buttonRow: { flexDirection: "row" },
});
