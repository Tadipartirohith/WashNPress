import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  AdminDashboard, Area, AreaCoverage, AuditEntry, GarmentService, Issue, IssueAnalytics,
  OrderDetail, OrderSummary, PlanUsage, ReportsResponse, Slot, Society, StaffUser, SystemConfig,
} from "../api/types";
import { theme, rupees, shortDate, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, BackLink, Stat, StatGrid, ChoiceChips,
} from "../components/ui";
import { OrderList, OrderDetailBody, IssueCard } from "../components/order";
import { IssueRow, TicketDetail, ReplyBox, describeMinutes } from "../components/support";
import { usePolling, useDebounced, POLL } from "../hooks";
import { ReportTable } from "./SupervisorPortal";

type Tab = "home" | "areas" | "supervisors" | "societies" | "users" | "orders" | "subscriptions" | "revenue" | "plans" | "slots" | "reports" | "issues" | "audit" | "config";

// Every dashboard metric drills into the matching list with the right filter
// already applied, so the admin never has to search for the same thing twice.
export type DrillFilter = Record<string, string | undefined>;

export function AdminPortal({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DrillFilter>({});

  if (openOrderId) return <AdminOrderScreen token={token} orderId={openOrderId} onBack={() => setOpenOrderId(null)} />;
  if (openAreaId) return <AreaDetailScreen token={token} areaId={openAreaId} onBack={() => setOpenAreaId(null)} onOpenOrder={setOpenOrderId} />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: "home", label: "Dashboard" },
          { key: "areas", label: "Areas" },
          { key: "supervisors", label: "Supervisors" },
          { key: "societies", label: "Societies" },
          { key: "users", label: "Users" },
          { key: "orders", label: "Orders" },
          { key: "subscriptions", label: "Subscriptions" },
          { key: "revenue", label: "Revenue" },
          { key: "plans", label: "Plans" },
          { key: "slots", label: "Slots" },
          { key: "reports", label: "Reports" },
          { key: "issues", label: "Issues" },
          { key: "audit", label: "Audit" },
          { key: "config", label: "Config" },
        ]}
      />
      {tab === "home" && <AdminHome token={token} onGoto={(t, next) => { setTab(t); setFilter(next ?? {}); }} />}
      {tab === "areas" && <AreasScreen token={token} filter={filter} onOpen={setOpenAreaId} />}
      {tab === "supervisors" && <SupervisorsScreen token={token} filter={filter} />}
      {tab === "societies" && <AdminSocietiesScreen token={token} filter={filter} />}
      {tab === "users" && <UsersScreen token={token} filter={filter} onLogout={onLogout} />}
      {tab === "orders" && <AdminOrdersScreen token={token} filter={filter} onOpenOrder={setOpenOrderId} />}
      {tab === "subscriptions" && <SubscriptionsScreen token={token} filter={filter} />}
      {tab === "revenue" && <RevenueScreen token={token} onOpenOrder={setOpenOrderId} />}
      {tab === "plans" && <PlansScreen token={token} />}
      {tab === "slots" && <AdminSlotsScreen token={token} />}
      {tab === "reports" && <AdminReportsScreen token={token} />}
      {tab === "issues" && <AdminIssuesScreen token={token} filter={filter} />}
      {tab === "audit" && <AuditScreen token={token} />}
      {tab === "config" && <ConfigScreen token={token} onLogout={onLogout} />}
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function AdminHome({ token, onGoto }: { token: string; onGoto: (tab: Tab, filter?: DrillFilter) => void }) {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [coverage, setCoverage] = useState<AreaCoverage[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [dashboard, cover] = await Promise.all([api.adminDashboard(token), api.adminCoverage(token)]);
      setData(dashboard);
      setCoverage(cover.needingCover);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.dashboard);

  if (busy && !data) return <Loading />;
  const o = data?.orders;
  const orders = (state?: string, extra?: DrillFilter) => () => onGoto("orders", { state, ...extra });

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Admin dashboard" subtitle="System-wide view of the whole platform" />
      <ErrorText error={error} />

      {coverage.length ? (
        <>
          <Notice tone="warn" text={`${coverage.length} area${coverage.length === 1 ? " has" : "s have"} no active supervisor. You are covering ${coverage.length === 1 ? "it" : "them"}.`} />
          {coverage.map((c) => (
            <Card key={c.areaId} onPress={() => onGoto("areas")}>
              <Row label={c.areaName} value={c.supervisorName ? `${c.supervisorName} · ${titleCase(c.supervisorStatus ?? "")}` : "No supervisor assigned"} />
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle>Network</SectionTitle>
      <StatGrid>
        <Stat label="Total areas" value={data?.areas.total ?? 0} onPress={() => onGoto("areas")} />
        <Stat label="Active areas" value={data?.areas.active ?? 0} onPress={() => onGoto("areas", { status: "active" })} />
        <Stat label="Total supervisors" value={data?.supervisors.total ?? 0} onPress={() => onGoto("supervisors")} />
        <Stat label="Active supervisors" value={data?.supervisors.active ?? 0} onPress={() => onGoto("supervisors", { status: "active" })} />
        <Stat label="Unassigned supervisors" value={data?.supervisors.unassigned ?? 0} tone="warn" onPress={() => onGoto("supervisors", { assigned: "false" })} />
        <Stat label="Total societies" value={data?.societies.total ?? 0} onPress={() => onGoto("societies")} />
        <Stat label="Active societies" value={data?.societies.active ?? 0} onPress={() => onGoto("societies", { status: "active" })} />
        <Stat label="Total residents" value={data?.residents.total ?? 0} onPress={() => onGoto("users", { role: "resident" })} />
        <Stat label="Operations staff" value={data?.operationsStaff.total ?? 0} onPress={() => onGoto("users", { role: "operator" })} />
      </StatGrid>

      <SectionTitle>Orders</SectionTitle>
      <StatGrid>
        <Stat label="Total orders" value={o?.total ?? 0} onPress={orders()} />
        <Stat label="Today's orders" value={o?.today ?? 0} onPress={orders(undefined, { today: "true" })} />
        <Stat label="Pending" value={o?.pending ?? 0} onPress={orders("scheduled")} />
        <Stat label="Scheduled" value={o?.scheduled ?? 0} onPress={orders("scheduled")} />
        <Stat label="Picked up" value={o?.pickedUp ?? 0} onPress={orders("picked_up")} />
        <Stat label="Washing" value={o?.washing ?? 0} onPress={orders("in_wash")} />
        <Stat label="Ironing" value={o?.ironing ?? 0} onPress={orders("ironing")} />
        <Stat label="QC pending" value={o?.qcPending ?? 0} tone="warn" onPress={orders("qc")} />
        <Stat label="QC failed" value={o?.qcFailed ?? 0} tone="danger" onPress={orders("qc_hold")} />
        <Stat label="Ready for delivery" value={o?.readyForDelivery ?? 0} tone="good" onPress={orders("ready_for_delivery")} />
        <Stat label="Out for delivery" value={o?.outForDelivery ?? 0} onPress={orders("out_for_delivery")} />
        <Stat label="Delivered" value={o?.delivered ?? 0} tone="good" onPress={orders("delivered")} />
        <Stat label="Cancelled" value={o?.cancelled ?? 0} onPress={orders("cancelled")} />
        <Stat label="Delayed" value={o?.delayed ?? 0} tone="danger" onPress={orders(undefined, { delayed: "true" })} />
        <Stat label="Failed pickups" value={o?.failedPickups ?? 0} tone="danger" onPress={orders("pickup_failed")} />
      </StatGrid>

      <SectionTitle>Subscriptions and revenue</SectionTitle>
      <StatGrid>
        <Stat label="Active subscriptions" value={data?.subscriptions.active ?? 0} onPress={() => onGoto("subscriptions", { status: "active" })} />
        <Stat label="Paused" value={data?.subscriptions.paused ?? 0} onPress={() => onGoto("subscriptions", { status: "paused" })} />
        <Stat label="Cancelled" value={data?.subscriptions.cancelled ?? 0} onPress={() => onGoto("subscriptions", { status: "cancelled" })} />
      </StatGrid>
      <Card>
        <RowLink label="Subscription revenue" value={rupees(data?.revenue.subscriptionRevenuePaise ?? 0)} onPress={() => onGoto("revenue")} />
        <RowLink label="Additional garment revenue" value={rupees(data?.revenue.additionalGarmentRevenuePaise ?? 0)} onPress={() => onGoto("revenue")} />
        <RowLink label="Pending additional charges" value={rupees(data?.revenue.pendingAdditionalChargesPaise ?? 0)} onPress={() => onGoto("orders", { payment: "pending" })} />
        <RowLink label="Total revenue" value={rupees(data?.revenue.totalRevenuePaise ?? 0)} onPress={() => onGoto("revenue")} />
      </Card>

      <SectionTitle>Customer support</SectionTitle>
      <StatGrid>
        <Stat label="Open" value={data?.issues.open ?? 0} tone="warn" onPress={() => onGoto("issues", { status: "open" })} />
        <Stat label="In progress" value={data?.issues.inProgress ?? 0} onPress={() => onGoto("issues", { status: "in_progress" })} />
        <Stat label="Pending" value={data?.issues.pending ?? 0} tone="warn" onPress={() => onGoto("issues", { open: "true" })} />
        <Stat label="Resolved" value={data?.issues.resolved ?? 0} tone="good" onPress={() => onGoto("issues", { status: "resolved" })} />
        <Stat label="Closed" value={data?.issues.closed ?? 0} onPress={() => onGoto("issues", { status: "closed" })} />
        <Stat label="Emergency" value={data?.issues.emergency ?? 0} tone="danger" onPress={() => onGoto("issues", { emergency: "true" })} />
        <Stat label="Escalated" value={data?.issues.escalated ?? 0} tone="danger" onPress={() => onGoto("issues", { escalated: "true" })} />
      </StatGrid>
    </Screen>
  );
}

// A data row that navigates, used where a figure should open the detail behind it.
function RowLink({ label, value, onPress }: { label: string; value: React.ReactNode; onPress: () => void }) {
  return (
    <View style={styles.rowLink}>
      <Row label={label} value={value} />
      <Text style={styles.rowLinkAction} onPress={onPress}>View</Text>
    </View>
  );
}

// ---------------------------------------------------------------------- areas

function AreasScreen({ token, filter, onOpen }: { token: string; filter: DrillFilter; onOpen: (id: string) => void }) {
  // The area currently being edited, with its unsaved values.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", code: "", region: "", description: "" });
  const [areas, setAreas] = useState<Area[]>([]);
  const [supervisors, setSupervisors] = useState<StaffUser[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [region, setRegion] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [a, s] = await Promise.all([api.adminAreas(token, { status: filter.status }), api.adminSupervisors(token)]);
      setAreas(a.areas); setSupervisors(s.supervisors);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, filter.status]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setError(null);
    try {
      await api.adminCreateArea({ name, code, region: region || undefined, description: description || undefined }, token);
      setName(""); setCode(""); setRegion(""); setDescription(""); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const assign = async (areaId: string, supervisorUserId: string) => {
    setError(null); setNote(null);
    try { await api.adminAssignSupervisor(areaId, supervisorUserId, token); setNote("Supervisor assigned."); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const toggle = async (area: Area) => {
    setError(null);
    try { await api.adminUpdateArea(area.id, { status: area.status === "active" ? "inactive" : "active" }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const startEditing = (area: Area) => {
    setError(null); setNote(null);
    setEditing(area.id);
    setDraft({ name: area.name, code: area.code, region: area.region ?? "", description: area.description ?? "" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null); setNote(null);
    try {
      await api.adminUpdateArea(editing, {
        name: draft.name, code: draft.code,
        region: draft.region || undefined, description: draft.description || undefined,
      }, token);
      setNote("Area saved. The change is recorded in the audit log.");
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Area management" subtitle="Operational areas across the platform" right={<Button label={creating ? "Close" : "New area"} variant="secondary" onPress={() => setCreating(!creating)} />} />
      {creating ? (
        <Card>
          <Field label="Area name" value={name} onChangeText={setName} placeholder="Madhapur" />
          <Field label="Area code" value={code} onChangeText={setCode} placeholder="MDH" />
          <Field label="Location / region" value={region} onChangeText={setRegion} placeholder="Hyderabad" />
          <Field label="Description" value={description} onChangeText={setDescription} />
          <Button label="Create area" onPress={create} disabled={name.length < 2 || code.length < 2} />
        </Card>
      ) : null}
      {note ? <Notice tone="good" text={note} /> : null}

      {areas.map((area) => (
        <Card key={area.id}>
          <View style={styles.headRow}>
            <Text style={styles.title} onPress={() => onOpen(area.id)}>{area.name}</Text>
            <Pill text={titleCase(area.status)} color={area.status === "active" ? theme.success : theme.muted} />
          </View>
          <Text style={styles.meta}>{area.code}{area.region ? ` · ${area.region}` : ""}</Text>
          <Row label="Description" value={area.description} />
          <Row label="Assigned supervisor" value={area.supervisorName ?? "Unassigned"} />
          <Row label="Societies" value={area.societyCount ?? 0} />
          <Row label="Residents" value={area.residentCount ?? 0} />
          <Row label="Operations staff" value={area.operationsStaffCount ?? 0} />
          <Row label="Orders" value={area.orderCount ?? 0} />
          <SectionTitle>{area.supervisorUserId ? "Change supervisor" : "Assign supervisor"}</SectionTitle>
          <ChoiceChips
            options={supervisors.map((s) => s.id)}
            value={area.supervisorUserId}
            onChange={(id) => assign(area.id, id)}
            labelOf={(id) => supervisors.find((s) => s.id === id)?.fullName ?? id}
          />
          {editing === area.id ? (
            <>
              <SectionTitle>Edit area</SectionTitle>
              <Field label="Area name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} />
              <Field label="Area code" value={draft.code} onChangeText={(v) => setDraft({ ...draft, code: v })} />
              <Field label="Location / region" value={draft.region} onChangeText={(v) => setDraft({ ...draft, region: v })} />
              <Field label="Description" value={draft.description} onChangeText={(v) => setDraft({ ...draft, description: v })} />
              <Button label="Save area" onPress={saveEdit} disabled={draft.name.length < 2 || draft.code.length < 2} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            </>
          ) : (
            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 4 }}><Button label="Open" variant="secondary" onPress={() => onOpen(area.id)} /></View>
              <View style={{ flex: 1, marginHorizontal: 4 }}><Button label="Edit" variant="secondary" onPress={() => startEditing(area)} /></View>
              <View style={{ flex: 1, marginLeft: 4 }}><Button label={area.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(area)} /></View>
            </View>
          )}
        </Card>
      ))}
      <ErrorText error={error} />
    </Screen>
  );
}

function AreaDetailScreen({ token, areaId, onBack, onOpenOrder }: { token: string; areaId: string; onBack: () => void; onOpenOrder: (id: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminArea>> | null>(null);
  const [section, setSection] = useState<"overview" | "societies" | "operators" | "orders">("overview");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.adminArea(areaId, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [areaId, token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !data) return <Loading />;
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={section}
        onChange={setSection}
        options={[
          { key: "overview", label: "Overview" },
          { key: "societies", label: "Societies", badge: data?.societies.length },
          { key: "operators", label: "Operations", badge: data?.operators.length },
          { key: "orders", label: "Orders", badge: data?.orders.length },
        ]}
      />
      <Screen refreshing={busy} onRefresh={load}>
        <BackLink label="Areas" onPress={onBack} />
        <PageTitle title={data?.area.name ?? "Area"} subtitle={data?.area.code} />
        <ErrorText error={error} />
        {section === "overview" ? (
          <Card>
            <Row label="Area code" value={data?.area.code} />
            <Row label="Description" value={data?.area.description} />
            <Row label="Location" value={data?.area.region} />
            <Row label="Status" value={data ? titleCase(data.area.status) : "—"} />
            <Row label="Assigned supervisor" value={data?.area.supervisorName ?? "Unassigned"} />
            <Row label="Societies" value={data?.area.societyCount ?? 0} />
            <Row label="Residents" value={data?.area.residentCount ?? 0} />
            <Row label="Operations staff" value={data?.area.operationsStaffCount ?? 0} />
            <Row label="Orders" value={data?.area.orderCount ?? 0} />
          </Card>
        ) : null}
        {section === "societies" ? (
          data?.societies.length ? data.societies.map((s) => (
            <Card key={s.id}>
              <Text style={styles.title}>{s.name}</Text>
              <Row label="Code" value={s.code} />
              <Row label="Residents" value={s.residentCount ?? 0} />
              <Row label="Active orders" value={s.activeOrderCount ?? 0} />
              <Row label="Status" value={titleCase(s.status)} />
            </Card>
          )) : <Empty text="No societies." />
        ) : null}
        {section === "operators" ? (
          data?.operators.length ? data.operators.map((op) => (
            <Card key={op.id}>
              <Text style={styles.title}>{op.fullName}</Text>
              <Row label="Employee ID" value={op.employeeId} />
              <Row label="Societies" value={op.societyNames.join(", ")} />
              <Row label="Status" value={titleCase(op.status)} />
            </Card>
          )) : <Empty text="No operations staff." />
        ) : null}
        {section === "orders" ? <OrderList orders={data?.orders ?? []} onOpen={(o) => onOpenOrder(o.id)} /> : null}
      </Screen>
    </View>
  );
}

// ---------------------------------------------------------------- supervisors

function SupervisorsScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  // The supervisor currently being edited, with their unsaved values.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ fullName: "", email: "", employeeId: "" });
  const [note, setNote] = useState<string | null>(null);
  const [supervisors, setSupervisors] = useState<StaffUser[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [s, a] = await Promise.all([
        api.adminSupervisors(token, { status: filter.status, assigned: filter.assigned }),
        api.adminAreas(token),
      ]);
      setSupervisors(s.supervisors); setAreas(a.areas);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, filter.status, filter.assigned]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setError(null);
    try {
      await api.adminCreateSupervisor({ fullName, phone, email: email || undefined, employeeId: employeeId || undefined, areaId: areaId ?? undefined }, token);
      setFullName(""); setPhone(""); setEmail(""); setEmployeeId(""); setAreaId(null); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const changeArea = async (supervisor: StaffUser, nextAreaId: string) => {
    setError(null);
    try { await api.adminAssignSupervisor(nextAreaId, supervisor.id, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const toggle = async (supervisor: StaffUser) => {
    setError(null);
    try { await api.adminUpdateSupervisor(supervisor.id, { status: supervisor.status === "active" ? "blocked" : "active" }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const startEditing = (supervisor: StaffUser) => {
    setError(null); setNote(null);
    setEditing(supervisor.id);
    setDraft({
      fullName: supervisor.fullName ?? "",
      email: supervisor.email ?? "",
      employeeId: supervisor.employeeId ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null); setNote(null);
    try {
      await api.adminUpdateSupervisor(editing, {
        fullName: draft.fullName,
        email: draft.email || undefined,
        employeeId: draft.employeeId || undefined,
      }, token);
      setNote("Supervisor saved. The change is recorded in the audit log.");
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Supervisor management" right={<Button label={creating ? "Close" : "New"} variant="secondary" onPress={() => setCreating(!creating)} />} />
      {creating ? (
        <Card>
          <Field label="Full name" value={fullName} onChangeText={setFullName} />
          <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <Field label="Employee ID" value={employeeId} onChangeText={setEmployeeId} />
          <SectionTitle>Assign area</SectionTitle>
          <ChoiceChips options={areas.map((a) => a.id)} value={areaId} onChange={setAreaId} labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id} />
          <Notice text="A supervisor is responsible for exactly one area and cannot see any other." />
          <Button label="Create supervisor" onPress={create} disabled={fullName.length < 2 || phone.length !== 10} />
        </Card>
      ) : null}

      {supervisors.map((s) => (
        <Card key={s.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{s.fullName}</Text>
            <Pill text={titleCase(s.status)} color={s.status === "active" ? theme.success : theme.danger} />
          </View>
          <Row label="Phone" value={s.phone} />
          <Row label="Email" value={s.email} />
          <Row label="Employee ID" value={s.employeeId} />
          <Row label="Assigned area" value={s.areaName ?? "Unassigned"} />
          <Row label="Societies" value={s.societyCount} />
          <Row label="Operations users" value={s.operationsUserCount ?? 0} />
          <Row label="Created" value={shortDate(s.createdAt)} />
          <Row label="Last login" value={dateTime(s.lastLoginAt)} />
          <SectionTitle>Change assigned area</SectionTitle>
          <ChoiceChips options={areas.map((a) => a.id)} value={s.areaId} onChange={(id) => changeArea(s, id)} labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id} />
          {editing === s.id ? (
            <>
              <SectionTitle>Edit supervisor</SectionTitle>
              {/* The phone number is the sign in identity, so it is not editable
                  here: changing it would silently lock the person out. */}
              <Field label="Full name" value={draft.fullName} onChangeText={(v) => setDraft({ ...draft, fullName: v })} />
              <Field label="Email" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} keyboardType="email-address" />
              <Field label="Employee ID" value={draft.employeeId} onChangeText={(v) => setDraft({ ...draft, employeeId: v })} />
              <Button label="Save supervisor" onPress={saveEdit} disabled={draft.fullName.length < 2} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            </>
          ) : (
            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 6 }}><Button label="Edit" variant="secondary" onPress={() => startEditing(s)} /></View>
              <View style={{ flex: 1, marginLeft: 6 }}><Button label={s.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(s)} /></View>
            </View>
          )}
        </Card>
      ))}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------ societies

function AdminSocietiesScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", code: "", address: "", areaId: "" });
  const [note, setNote] = useState<string | null>(null);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [newAreaId, setNewAreaId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A request per keystroke races with itself: a slow earlier response lands after
  // a newer one, and the list stops matching what was typed until some other
  // control forces a clean reload. Hold the value still, and ignore a stale reply.
  const query = useDebounced(search, 250);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const mine = ++generation.current;
    setBusy(true); setError(null);
    try {
      const [s, a] = await Promise.all([
        api.adminSocieties(token, { areaId: areaId ?? undefined, q: query || undefined, status: filter.status }),
        api.adminAreas(token),
      ]);
      if (mine !== generation.current) return;
      setSocieties(s.societies); setAreas(a.areas);
    } catch (e) { if (mine === generation.current) setError((e as Error).message); }
    finally { if (mine === generation.current) setBusy(false); }
  }, [token, areaId, query, filter.status]);
  useEffect(() => { load(); }, [load]);

  const startEditing = (society: Society) => {
    setError(null); setNote(null);
    setEditing(society.id);
    setDraft({ name: society.name, code: society.code, address: society.address ?? "", areaId: society.areaId ?? "" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null); setNote(null);
    try {
      await api.adminUpdateSociety(editing, {
        name: draft.name, code: draft.code,
        address: draft.address || undefined,
        areaId: draft.areaId || undefined,
      }, token);
      setNote("Society saved. The change is recorded in the audit log.");
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const create = async () => {
    if (!newAreaId) { setError("Choose the area this society belongs to."); return; }
    setError(null);
    try {
      await api.adminCreateSociety({ name, code, areaId: newAreaId, address: address || undefined }, token);
      setName(""); setCode(""); setAddress(""); setNewAreaId(null); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggle = async (society: Society) => {
    setError(null);
    try { await api.adminUpdateSociety(society.id, { status: society.status === "active" ? "inactive" : "active" }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Society management" subtitle="Every society, across every area" right={<Button label={creating ? "Close" : "New"} variant="secondary" onPress={() => setCreating(!creating)} />} />
      {creating ? (
        <Card>
          <Field label="Society name" value={name} onChangeText={setName} />
          <Field label="Society code" value={code} onChangeText={setCode} />
          <Field label="Address" value={address} onChangeText={setAddress} />
          <SectionTitle>Area</SectionTitle>
          <ChoiceChips options={areas.map((a) => a.id)} value={newAreaId} onChange={setNewAreaId} labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id} />
          <Button label="Create society" onPress={create} disabled={name.length < 2 || code.length < 2} />
        </Card>
      ) : null}
      <Field label="Search" value={search} onChangeText={setSearch} placeholder="Name or code" />
      {search && search !== query ? <Text style={styles.meta}>Searching…</Text> : null}
      <SectionTitle>Filter by area</SectionTitle>
      <ChoiceChips options={areas.map((a) => a.id)} value={areaId} onChange={(id) => setAreaId(id === areaId ? null : id)} labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id} />
      <View style={{ height: 8 }} />
      {societies.map((s) => (
        <Card key={s.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{s.name}</Text>
            <Pill text={titleCase(s.status)} color={s.status === "active" ? theme.success : theme.muted} />
          </View>
          <Row label="Code" value={s.code} />
          <Row label="Address" value={s.address} />
          <Row label="Area" value={s.areaName} />
          <Row label="Supervisor" value={s.supervisorName} />
          <Row label="Residents" value={s.residentCount ?? 0} />
          <Row label="Operations staff" value={s.operationsStaffCount ?? 0} />
          <Row label="Orders" value={s.orderCount ?? 0} />
          <Row label="Available slots" value={s.availableSlots ?? 0} />
          {editing === s.id ? (
            <>
              <SectionTitle>Edit society</SectionTitle>
              <Field label="Society name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} />
              <Field label="Society code" value={draft.code} onChangeText={(v) => setDraft({ ...draft, code: v })} />
              <Field label="Address" value={draft.address} onChangeText={(v) => setDraft({ ...draft, address: v })} />
              <SectionTitle>Area</SectionTitle>
              {/* Moving a society between areas moves who is responsible for it. */}
              <ChoiceChips options={areas.map((a) => a.id)} value={draft.areaId || null} onChange={(id) => setDraft({ ...draft, areaId: id })} labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id} />
              <Button label="Save society" onPress={saveEdit} disabled={draft.name.length < 2 || draft.code.length < 2} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            </>
          ) : (
            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 6 }}><Button label="Edit" variant="secondary" onPress={() => startEditing(s)} /></View>
              <View style={{ flex: 1, marginLeft: 6 }}><Button label={s.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(s)} /></View>
            </View>
          )}
        </Card>
      ))}
      {!busy && !societies.length ? <Empty text={search ? "No societies match that search." : "No societies yet."} /> : null}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// ---------------------------------------------------------------------- users

function UsersScreen({ token, filter, onLogout }: { token: string; filter: DrillFilter; onLogout: () => void }) {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [role, setRole] = useState<string | null>(filter.role ?? null);
  const [status, setStatus] = useState<string | null>(filter.status ?? null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setUsers((await api.adminUsers(token, { role: role ?? undefined, status: status ?? undefined, q: search || undefined, onboarding: filter.onboarding })).users); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, role, status, search, filter.onboarding]);
  useEffect(() => { load(); }, [load]);

  // Availability rather than a bare status flip, so an operator's open work is
  // handed over in the same step instead of being stranded.
  const setAvailability = async (user: StaffUser, next: string) => {
    setError(null); setNote(null);
    try {
      const r = await api.adminSetAvailability(user.id, { status: next }, token);
      const moved = r.reassigned.length;
      setNote(moved ? `${moved} order(s) returned to the shared queue.` : "Updated.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="User management" subtitle="Admin, supervisor, operations and resident accounts" right={<Button label="Sign out" variant="danger" onPress={onLogout} />} />
      <Field label="Search by name, phone or email" value={search} onChangeText={setSearch} />
      <SectionTitle>Role</SectionTitle>
      <ChoiceChips options={["admin", "supervisor", "operator", "resident"]} value={role} onChange={(next) => setRole(next === role ? null : next)} labelOf={titleCase} />
      <SectionTitle>Status</SectionTitle>
      <ChoiceChips options={["active", "on_leave", "blocked"]} value={status} onChange={(next) => setStatus(next === status ? null : next)} labelOf={titleCase} />
      {note ? <Notice tone="good" text={note} /> : null}
      <View style={{ height: 8 }} />
      {users.map((u) => (
        <Card key={u.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{u.fullName ?? "Unnamed"}</Text>
            <Pill text={titleCase(u.status)} color={u.status === "active" ? theme.success : theme.danger} />
          </View>
          <Text style={styles.meta}>{u.roles.map(titleCase).join(", ")}</Text>
          <Row label="Phone" value={u.phone} />
          <Row label="Email" value={u.email} />
          <Row label="Assigned area" value={u.areaName} />
          <Row label="Assigned society" value={u.residentSocietyName ?? u.societyNames.join(", ")} />
          {u.unitNumber ? <Row label="Flat / unit" value={u.unitNumber} /> : null}
          {u.onboardingCompleted !== null && u.onboardingCompleted !== undefined ? <Row label="Onboarding" value={u.onboardingCompleted ? "Completed" : "Pending"} /> : null}
          <Row label="Last login" value={dateTime(u.lastLoginAt)} />
          <Row label="Created" value={shortDate(u.createdAt)} />
          {!u.roles.includes("admin") ? (
            <>
              {u.status === "active" ? <Button label="Mark on leave" variant="secondary" onPress={() => setAvailability(u, "on_leave")} /> : null}
              <Button
                label={u.status === "active" ? "Deactivate" : "Return to duty"}
                variant={u.status === "active" ? "danger" : "secondary"}
                onPress={() => setAvailability(u, u.status === "active" ? "blocked" : "active")}
              />
            </>
          ) : null}
        </Card>
      ))}
      <ErrorText error={error} />
    </Screen>
  );
}

// --------------------------------------------------------------------- orders

function AdminOrdersScreen({ token, filter, onOpenOrder }: { token: string; filter: DrillFilter; onOpenOrder: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [areaId, setAreaId] = useState<string | null>(filter.areaId ?? null);
  const [societyId, setSocietyId] = useState<string | null>(filter.societyId ?? null);
  const [state, setState] = useState<string | null>(filter.state ?? null);
  const [orderCode, setOrderCode] = useState("");
  const [resident, setResident] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [o, a, s] = await Promise.all([
        api.adminOrders(token, {
          areaId: areaId ?? undefined, societyId: societyId ?? undefined, state: state ?? undefined,
          orderCode: orderCode || undefined, resident: resident || undefined,
          delayed: filter.delayed, payment: filter.payment, today: filter.today, unassigned: filter.unassigned,
        }),
        api.adminAreas(token),
        api.adminSocieties(token, { areaId: areaId ?? undefined }),
      ]);
      setOrders(o.orders); setAreas(a.areas); setSocieties(s.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, areaId, societyId, state, orderCode, resident, filter.delayed, filter.payment, filter.today, filter.unassigned]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Order management"
        subtitle={describeOrderFilter(filter) ?? "System-wide order monitoring"}
      />
      <Field label="Search order id" value={orderCode} onChangeText={setOrderCode} placeholder="ORD-756272" />
      <Field label="Search resident name or phone" value={resident} onChangeText={setResident} />
      <SectionTitle>Area</SectionTitle>
      <ChoiceChips options={areas.map((a) => a.id)} value={areaId} onChange={(id) => { setAreaId(id === areaId ? null : id); setSocietyId(null); }} labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id} />
      <SectionTitle>Society</SectionTitle>
      <ChoiceChips options={societies.map((s) => s.id)} value={societyId} onChange={(id) => setSocietyId(id === societyId ? null : id)} labelOf={(id) => societies.find((s) => s.id === id)?.name ?? id} />
      <SectionTitle>Status</SectionTitle>
      <ChoiceChips
        options={["scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold", "ready_for_delivery", "out_for_delivery", "delivered", "cancelled", "pickup_failed"]}
        value={state}
        onChange={(next) => setState(next === state ? null : next)}
        labelOf={titleCase}
      />
      <View style={{ height: 10 }} />
      <OrderList orders={orders} onOpen={(o) => onOpenOrder(o.id)} />
      <ErrorText error={error} />
    </Screen>
  );
}

function AdminOrderScreen({ token, orderId, onBack }: { token: string; orderId: string; onBack: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setOrder((await api.adminOrder(orderId, token)).order); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !order) return <Loading />;
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Back" onPress={onBack} />
      <ErrorText error={error} />
      {order ? (
        <>
          <OrderDetailBody order={order} audience="staff" />
          <Notice text="Admin has full visibility. Processing actions belong to the operations staff." />
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------- plans

function PlansScreen({ token }: { token: string }) {
  const [plans, setPlans] = useState<PlanUsage[]>([]);
  const [tier, setTier] = useState("");
  const [cap, setCap] = useState("");
  const [turnaround, setTurnaround] = useState("");
  const [price, setPrice] = useState("");
  const [creating, setCreating] = useState(false);
  // The plan currently being edited, with its unsaved values.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ tier: string; cap: string; turnaround: string; price: string; coveredServiceIds: string[] }>({ tier: "", cap: "", turnaround: "", price: "", coveredServiceIds: [] });
  const [servicesCatalogue, setServicesCatalogue] = useState<GarmentService[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [planRes, configRes] = await Promise.all([api.adminPlans(token), api.adminConfig(token)]);
      setPlans(planRes.plans);
      setServicesCatalogue(configRes.config.garmentServices.filter((service) => service.isActive));
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const startEditing = (plan: PlanUsage) => {
    setNote(null); setError(null);
    setEditing(plan.id);
    setDraft({
      tier: plan.tier,
      cap: String(plan.garmentCap),
      turnaround: String(plan.turnaroundHours),
      price: String(plan.monthlyPaise / 100),
      coveredServiceIds: plan.coveredServiceIds ?? [],
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setNote(null); setError(null);
    try {
      await api.adminUpdatePlan(editing, {
        tier: draft.tier,
        garmentCap: Number(draft.cap),
        turnaroundHours: Number(draft.turnaround),
        monthlyPaise: Math.round(Number(draft.price) * 100),
        coveredServiceIds: draft.coveredServiceIds,
      }, token);
      setNote("Plan saved. The change is recorded in the audit log.");
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggleCovered = (serviceId: string) => {
    setDraft((current) => ({
      ...current,
      coveredServiceIds: current.coveredServiceIds.includes(serviceId)
        ? current.coveredServiceIds.filter((id) => id !== serviceId)
        : [...current.coveredServiceIds, serviceId],
    }));
  };

  const create = async () => {
    setError(null);
    try {
      await api.adminCreatePlan({ tier, garmentCap: Number(cap), turnaroundHours: Number(turnaround), monthlyPaise: Math.round(Number(price) * 100) }, token);
      setTier(""); setCap(""); setTurnaround(""); setPrice(""); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggle = async (plan: PlanUsage) => {
    setError(null);
    try { await api.adminUpdatePlan(plan.id, { isActive: !plan.isActive }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Subscription plans" subtitle="Global plan configuration" right={<Button label={creating ? "Close" : "New plan"} variant="secondary" onPress={() => setCreating(!creating)} />} />
      {creating ? (
        <Card>
          <Field label="Plan name" value={tier} onChangeText={setTier} placeholder="Standard" />
          <Field label="Garment allowance" value={cap} onChangeText={setCap} keyboardType="number-pad" />
          <Field label="Turnaround hours" value={turnaround} onChangeText={setTurnaround} keyboardType="number-pad" />
          <Field label="Monthly price (rupees)" value={price} onChangeText={setPrice} keyboardType="number-pad" />
          <Button label="Create plan" onPress={create} disabled={!tier || !cap || !turnaround || !price} />
        </Card>
      ) : null}
      {plans.map((plan) => (
        <Card key={plan.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{plan.tier}</Text>
            <Pill text={plan.isActive ? "Active" : "Inactive"} color={plan.isActive ? theme.success : theme.muted} />
          </View>
          <Row label="Price" value={`${rupees(plan.monthlyPaise)} / month`} />
          <Row label="Garment allowance" value={plan.garmentCap} />
          <Row label="Turnaround" value={`${plan.turnaroundHours} hours`} />
          <Row label="Active subscribers" value={plan.activeSubscribers} />
          <Row label="Garments used" value={plan.garmentsUsed} />
          <Row label="Plan revenue" value={rupees(plan.revenuePaise)} />
          <Row
            label="Services included"
            value={plan.coveredServiceIds?.length
              ? servicesCatalogue.filter((service) => plan.coveredServiceIds!.includes(service.id)).map((service) => service.name).join(", ") || `${plan.coveredServiceIds.length} services`
              : "None"}
          />

          {editing === plan.id ? (
            <>
              <SectionTitle>Edit plan</SectionTitle>
              <Field label="Plan name" value={draft.tier} onChangeText={(v) => setDraft({ ...draft, tier: v })} />
              <Field label="Garment allowance" value={draft.cap} onChangeText={(v) => setDraft({ ...draft, cap: v })} keyboardType="number-pad" />
              <Field label="Turnaround hours" value={draft.turnaround} onChangeText={(v) => setDraft({ ...draft, turnaround: v })} keyboardType="number-pad" />
              <Field label="Monthly price (rupees)" value={draft.price} onChangeText={(v) => setDraft({ ...draft, price: v })} keyboardType="number-pad" />
              <SectionTitle>Services this plan includes</SectionTitle>
              {/* A garment sent for a service outside this list is priced per garment
                  even while allowance remains. */}
              <Notice text="A garment sent for a service that is not included is charged at its own price, even when the resident still has allowance left." />
              {servicesCatalogue.map((service) => (
                <Button
                  key={service.id}
                  label={`${draft.coveredServiceIds.includes(service.id) ? "✓ Included" : "Not included"} — ${service.name}`}
                  variant="secondary"
                  onPress={() => toggleCovered(service.id)}
                />
              ))}
              <Button label="Save plan" onPress={saveEdit} disabled={!draft.tier || !draft.cap || !draft.turnaround} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            </>
          ) : (
            <View style={styles.buttonRow}>
              <Button label="Edit" variant="secondary" onPress={() => startEditing(plan)} />
              <Button label={plan.isActive ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(plan)} />
            </View>
          )}
        </Card>
      ))}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// ---------------------------------------------------------------------- slots

function AdminSlotsScreen({ token }: { token: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [s, soc] = await Promise.all([api.adminSlots(token, { societyId: societyId ?? undefined }), api.adminSocieties(token)]);
      setSlots(s.slots); setSocieties(soc.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, societyId]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Slot monitoring" subtitle="Slot utilisation across every area" />
      <ChoiceChips options={societies.map((s) => s.id)} value={societyId} onChange={(id) => setSocietyId(id === societyId ? null : id)} labelOf={(id) => societies.find((s) => s.id === id)?.name ?? id} />
      <View style={{ height: 8 }} />
      {slots.length ? slots.map((slot) => (
        <Card key={slot.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{shortDate(slot.date)} · {slot.startTime} – {slot.endTime}</Text>
            <Pill
              text={slot.isActive === false ? "Cancelled" : slot.full ? "Full" : "Open"}
              color={slot.isActive === false ? theme.muted : slot.full ? theme.danger : theme.success}
            />
          </View>
          <Text style={styles.meta}>{slot.societyName} · {slot.window}</Text>
          <Row label="Capacity" value={slot.capacityTotal ?? "—"} />
          <Row label="Booked" value={slot.bookedCount ?? "—"} />
          <Row label="Available" value={slot.capacityRemaining} />
        </Card>
      )) : <Empty text="No slots." />}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------------------------- reports

function AdminReportsScreen({ token }: { token: string }) {
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.adminReports(token, { from: from || undefined, to: to || undefined })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, from, to]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Reports and analytics" subtitle="System-wide" />
      <Field label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
      <Field label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} />
      <Button label="Apply filters" variant="secondary" onPress={load} />

      <SectionTitle>Revenue</SectionTitle>
      <Card>
        <Row label="Subscription revenue" value={rupees(data?.revenue.subscriptionRevenuePaise ?? 0)} />
        <Row label="Additional garment revenue" value={rupees(data?.revenue.additionalGarmentRevenuePaise ?? 0)} />
        <Row label="Pending additional charges" value={rupees(data?.revenue.pendingAdditionalChargesPaise ?? 0)} />
        <Row label="Total revenue" value={rupees(data?.revenue.totalRevenuePaise ?? 0)} />
      </Card>

      <SectionTitle>Resident statistics</SectionTitle>
      <Card>
        <Row label="Residents" value={data?.residents.residents ?? 0} />
        <Row label="Onboarded" value={data?.residents.onboarded ?? 0} />
        <Row label="Pending onboarding" value={data?.residents.pendingOnboarding ?? 0} />
        <Row label="With active subscription" value={data?.residents.withActiveSubscription ?? 0} />
      </Card>

      {data?.byArea ? <ReportTable title="Area-wise orders" rows={data.byArea} keyOf={(r) => r.areaId ?? ""} nameOf={(r) => r.areaName ?? "Unassigned"} /> : null}
      {data ? <ReportTable title="Society-wise orders" rows={data.bySociety} keyOf={(r) => r.societyId ?? ""} nameOf={(r) => r.societyName ?? "Unknown"} /> : null}
      {data?.bySupervisor ? <ReportTable title="Supervisor performance" rows={data.bySupervisor} keyOf={(r) => r.areaId ?? ""} nameOf={(r) => `${r.supervisorName ?? "Unassigned"} (${r.areaName})`} /> : null}
      {data ? <ReportTable title="Operations performance" rows={data.byOperator} keyOf={(r) => r.operatorUserId ?? ""} nameOf={(r) => r.operatorName ?? "Unassigned"} /> : null}

      <SectionTitle>Subscription report</SectionTitle>
      {data?.subscriptions.byPlan.map((plan) => (
        <Card key={plan.id}>
          <Text style={styles.title}>{plan.tier}</Text>
          <Row label="Subscribers" value={plan.subscribers} />
          <Row label="Active subscribers" value={plan.activeSubscribers} />
          <Row label="Garments used" value={plan.garmentsUsed} />
          <Row label="Revenue" value={rupees(plan.revenuePaise)} />
        </Card>
      ))}

      <SectionTitle>Issue and complaint report</SectionTitle>
      <Card>
        <Row label="Total" value={data?.issues.total ?? 0} />
        <Row label="Open" value={data?.issues.open ?? 0} />
        <Row label="In progress" value={data?.issues.inProgress ?? 0} />
        <Row label="Resolved" value={data?.issues.resolved ?? 0} />
        {data?.issues.byType.map((t) => <Row key={t.type} label={titleCase(t.type)} value={t.count} />)}
      </Card>
      <ErrorText error={error} />
    </Screen>
  );
}

// --------------------------------------------------------------------- issues

// The admin support console: system wide visibility, the analytics the
// specification lists, and the ability to read any ticket end to end.
function AdminIssuesScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [analytics, setAnalytics] = useState<IssueAnalytics | null>(null);
  const [status, setStatus] = useState<string | null>(filter.status ?? null);
  const [priority, setPriority] = useState<string | null>(filter.priority ?? null);
  const [escalatedOnly, setEscalatedOnly] = useState(filter.escalated === "true");
  const [emergencyOnly, setEmergencyOnly] = useState(filter.emergency === "true");
  const [openOnly, setOpenOnly] = useState(filter.open === "true");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [list, stats] = await Promise.all([
        api.adminIssues(token, {
          status: status ?? undefined,
          priority: priority ?? undefined,
          escalated: escalatedOnly ? "true" : undefined,
          emergency: emergencyOnly ? "true" : undefined,
          open: openOnly ? "true" : undefined,
        }),
        api.adminIssueAnalytics(token),
      ]);
      setIssues(list.issues);
      setAnalytics(stats.analytics);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, priority, escalatedOnly, emergencyOnly, openOnly]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, POLL.dashboard);

  if (openId) {
    return <AdminTicketScreen token={token} issueId={openId} onBack={() => setOpenId(null)} onChanged={load} />;
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Customer support" subtitle="Every ticket across the platform" />

      <SectionTitle>Volumes</SectionTitle>
      <StatGrid>
        <Stat label="Total issues" value={analytics?.total ?? 0} />
        <Stat label="Open" value={analytics?.open ?? 0} tone="warn" />
        <Stat label="In progress" value={analytics?.inProgress ?? 0} />
        <Stat label="Pending" value={analytics?.pending ?? 0} tone="warn" />
        <Stat label="Resolved" value={analytics?.resolved ?? 0} tone="good" />
        <Stat label="Closed" value={analytics?.closed ?? 0} />
        <Stat label="Emergency" value={analytics?.emergency ?? 0} tone="danger" />
        <Stat label="Escalated" value={analytics?.escalated ?? 0} tone="danger" />
        <Stat label="Order related" value={analytics?.orderRelated ?? 0} />
      </StatGrid>
      <Card>
        <Row label="Average resolution time" value={describeMinutes(analytics?.averageResolutionMinutes)} />
      </Card>

      {analytics?.ageing?.length ? (
        <>
          <SectionTitle>Oldest still waiting</SectionTitle>
          {analytics.ageing.slice(0, 5).map((row) => (
            <Card key={row.id} onPress={() => setOpenId(row.id)}>
              <Row label={titleCase(row.category)} value={`${row.ageHours}h · ${titleCase(row.status)}`} />
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle>By area</SectionTitle>
      <Card>
        {analytics?.byArea?.length
          ? analytics.byArea.map((r) => <Row key={r.key} label={r.label} value={`${r.total} total · ${r.open} open`} />)
          : <Empty text="No data." />}
      </Card>

      <SectionTitle>By supervisor</SectionTitle>
      <Card>
        {analytics?.bySupervisor?.length
          ? analytics.bySupervisor.map((r) => <Row key={r.key} label={r.label} value={`${r.resolved} resolved of ${r.total}`} />)
          : <Empty text="No data." />}
      </Card>

      <SectionTitle>By category</SectionTitle>
      <Card>
        {analytics?.byCategory?.length
          ? analytics.byCategory.map((r) => <Row key={r.key} label={titleCase(r.label)} value={r.total} />)
          : <Empty text="No data." />}
      </Card>

      <SectionTitle>Tickets</SectionTitle>
      <ChoiceChips
        options={["open", "assigned", "in_progress", "resolved", "closed"]}
        value={status}
        onChange={(next) => setStatus(next === status ? null : next)}
        labelOf={titleCase}
      />
      <ChoiceChips
        options={["low", "normal", "high", "emergency"]}
        value={priority}
        onChange={(next) => setPriority(next === priority ? null : next)}
        labelOf={titleCase}
      />
      <Button label={openOnly ? "Showing unresolved only" : "Show unresolved only"} variant="secondary" onPress={() => setOpenOnly(!openOnly)} />
      <Button label={emergencyOnly ? "Showing emergencies only" : "Show emergencies only"} variant="secondary" onPress={() => setEmergencyOnly(!emergencyOnly)} />
      <Button label={escalatedOnly ? "Showing escalated only" : "Show escalated only"} variant="secondary" onPress={() => setEscalatedOnly(!escalatedOnly)} />
      <Notice text="Operations and the supervisor handle day to day issues. Admin sees everything and steps in on escalations." />

      <View style={{ height: 8 }} />
      {issues.length ? issues.map((i) => <IssueRow key={i.id} issue={i} onPress={() => setOpenId(i.id)} />) : <Empty text="No tickets match." />}
      <ErrorText error={error} />
    </Screen>
  );
}

function AdminTicketScreen({ token, issueId, onBack, onChanged }: { token: string; issueId: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setIssue((await api.adminIssue(issueId, token)).issue); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [issueId, token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !issue) return <Loading />;
  if (!issue) return <Screen><BackLink label="Tickets" onPress={onBack} /><ErrorText error={error} /></Screen>;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Tickets" onPress={onBack} />
      <TicketDetail issue={issue} audience="staff">
        {issue.status !== "closed" ? (
          <>
            <SectionTitle>Reply</SectionTitle>
            <ReplyBox
              label="Message to the resident"
              onSend={async (body) => {
                try {
                  const r = await api.adminReplyToIssue(issue.id, body, token);
                  setIssue(r.issue); setNote("Reply sent."); await onChanged();
                } catch (e) { setError((e as Error).message); }
              }}
            />
            {issue.status !== "resolved" ? (
              <Button
                label="Mark resolved"
                onPress={async () => {
                  try {
                    const r = await api.adminSetIssueStatus(issue.id, "resolved", "Resolved by admin", token);
                    setIssue(r.issue); setNote("Resolved."); await onChanged();
                  } catch (e) { setError((e as Error).message); }
                }}
              />
            ) : null}
          </>
        ) : <Notice text="This ticket is closed." />}
      </TicketDetail>
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// -------------------------------------------------- subscriptions and revenue

function SubscriptionsScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [status, setStatus] = useState<string | null>(filter.status ?? null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminSubscriptions>>["subscriptions"]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setRows((await api.adminSubscriptions(token, { status: status ?? undefined })).subscriptions); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Subscriptions" subtitle="Who is on which plan" />
      <ChoiceChips
        options={["active", "paused", "cancelled"]}
        value={status}
        onChange={(next) => setStatus(next === status ? null : next)}
        labelOf={titleCase}
      />
      <View style={{ height: 8 }} />
      {rows.length ? rows.map((sub) => (
        <Card key={sub.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{sub.residentName ?? "Unnamed resident"}</Text>
            <Pill text={titleCase(sub.status)} color={sub.status === "active" ? theme.success : theme.muted} />
          </View>
          <Row label="Plan" value={sub.planTier} />
          <Row label="Society" value={sub.societyName} />
          <Row label="Monthly price" value={sub.monthlyPaise !== null ? rupees(sub.monthlyPaise) : "—"} />
          <Row label="Allowance" value={sub.allowance ?? "—"} />
          <Row label="Used" value={sub.garmentsUsed} />
          <Row label="Remaining" value={sub.remaining ?? "—"} />
        </Card>
      )) : <Empty text="No subscriptions match." />}
      <ErrorText error={error} />
    </Screen>
  );
}

function RevenueScreen({ token, onOpenOrder }: { token: string; onOpenOrder: (id: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminRevenue>> | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.adminRevenue(token, { from: from || undefined, to: to || undefined })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, from, to]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Revenue" subtitle="Where the money came from, not just the total" />
      <Field label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
      <Field label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} />
      <Button label="Apply" variant="secondary" onPress={load} />

      <SectionTitle>Summary</SectionTitle>
      <Card>
        <Row label="Subscription revenue" value={rupees(data?.summary.subscriptionRevenuePaise ?? 0)} />
        <Row label="Additional garment revenue" value={rupees(data?.summary.additionalGarmentRevenuePaise ?? 0)} />
        <Row label="Pending additional charges" value={rupees(data?.summary.pendingAdditionalChargesPaise ?? 0)} />
        <Row label="Total" value={rupees(data?.summary.totalRevenuePaise ?? 0)} />
      </Card>

      <SectionTitle>By plan</SectionTitle>
      <Card>
        {data?.byPlan?.length
          ? data.byPlan.map((p) => <Row key={p.planId} label={`${p.tier} (${p.activeSubscribers} active)`} value={rupees(p.revenuePaise)} />)
          : <Empty text="No plan revenue yet." />}
      </Card>

      <SectionTitle>Charged orders</SectionTitle>
      <OrderList orders={data?.additionalCharges ?? []} onOpen={(o) => onOpenOrder(o.id)} emptyText="No additional charges." />

      <SectionTitle>Still to collect</SectionTitle>
      <OrderList orders={data?.pendingCharges ?? []} onOpen={(o) => onOpenOrder(o.id)} emptyText="Nothing outstanding." />
      <ErrorText error={error} />
    </Screen>
  );
}

// ---------------------------------------------------------------------- audit

function AuditScreen({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [resource, setResource] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setEntries((await api.adminAudit(token, { resource: resource ?? undefined, limit: 200 })).entries); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, resource]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Audit and activity log" subtitle="Every important change, with before and after" />
      <ChoiceChips
        options={["area", "user", "society", "slot", "order", "plan", "issue", "system_config"]}
        value={resource}
        onChange={(next) => setResource(next === resource ? null : next)}
        labelOf={titleCase}
      />
      <View style={{ height: 8 }} />
      {entries.length ? entries.map((entry) => (
        <Card key={entry.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{titleCase(entry.action)}</Text>
            <Pill text={titleCase(entry.role ?? "system")} color={theme.aqua} />
          </View>
          <Row label="User" value={entry.actorName ?? entry.actor} />
          <Row label="Resource" value={entry.resource ? titleCase(entry.resource) : "—"} />
          <Row label="Resource id" value={entry.resourceId} />
          <Row label="Date and time" value={dateTime(entry.at)} />
          {entry.previousValue ? <Text style={styles.json}>Previous: {truncate(JSON.stringify(entry.previousValue))}</Text> : null}
          {entry.newValue ? <Text style={styles.json}>New: {truncate(JSON.stringify(entry.newValue))}</Text> : null}
        </Card>
      )) : <Empty text="No audit entries." />}
      <ErrorText error={error} />
    </Screen>
  );
}

// Says what the list is currently showing, so a drill-down is never a mystery.
function describeOrderFilter(filter: DrillFilter): string | null {
  const parts: string[] = [];
  if (filter.state) parts.push(titleCase(filter.state));
  if (filter.delayed === "true") parts.push("delayed");
  if (filter.today === "true") parts.push("booked today");
  if (filter.payment === "pending") parts.push("with a charge still to collect");
  if (filter.unassigned === "true") parts.push("with no operator");
  return parts.length ? `Showing ${parts.join(", ")} orders` : null;
}

function truncate(value: string, max = 220): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// --------------------------------------------------------------------- config

function ConfigScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [rate, setRate] = useState("");
  const [guestRate, setGuestRate] = useState("");
  const [services, setServices] = useState<GarmentService[]>([]);
  const [categories, setCategories] = useState("");
  const [capacity, setCapacity] = useState("");
  const [turnaround, setTurnaround] = useState("");
  const [grace, setGrace] = useState("");
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [addingService, setAddingService] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("0");
  const [newRequiresClean, setNewRequiresClean] = useState(true);
  const [newCleanStage, setNewCleanStage] = useState<"wash" | "dry_clean" | "premium">("wash");
  const [newRequiresPress, setNewRequiresPress] = useState(true);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.adminConfig(token);
      setConfig(r.config);
      setRate(String(r.config.additionalGarmentRatePaise / 100));
      setGuestRate(String(r.config.nonSubscriberGarmentRatePaise / 100));
      setServices(r.config.garmentServices);
      setCategories(r.config.garmentCategories.join(", "));
      setCapacity(String(r.config.defaultSlotCapacity));
      setTurnaround(String(r.config.defaultTurnaroundHours));
      setGrace(String(r.config.delayGraceHours));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setNote(null); setError(null);
    try {
      await api.adminUpdateConfig({
        additionalGarmentRatePaise: Math.round(Number(rate) * 100),
        nonSubscriberGarmentRatePaise: Math.round(Number(guestRate) * 100),
        garmentCategories: categories.split(",").map((c) => c.trim()).filter(Boolean),
        defaultSlotCapacity: Number(capacity),
        defaultTurnaroundHours: Number(turnaround),
        delayGraceHours: Number(grace),
      }, token);
      setNote("Configuration saved. The change is recorded in the audit log.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const saveServices = async () => {
    setNote(null); setError(null);
    try {
      await api.adminUpdateConfig({ garmentServices: services }, token);
      setNote("Service catalogue saved. New orders use the updated prices.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  // Adding one service rather than resending the catalogue, so a new service can
  // never drop an existing one by omission.
  const addService = async () => {
    setNote(null); setError(null);
    try {
      const r = await api.adminAddService({
        name: newName.trim(),
        unitPricePaise: Math.max(0, Math.round(Number(newPrice || 0) * 100)),
        requiresClean: newRequiresClean,
        cleanStage: newCleanStage,
        requiresPress: newRequiresPress,
      }, token);
      setNote(`${r.service.name} added. Residents can book it straight away.`);
      setAddingService(false); setNewName(""); setNewPrice("0");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  // Retired, not deleted, because orders already in flight reference it.
  const retireService = async (service: GarmentService) => {
    setNote(null); setError(null);
    try {
      await api.adminRetireService(service.id, token);
      setNote(`${service.name} retired. Orders already using it are unaffected.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggle = async (key: "qcRequired" | "notificationsEnabled") => {
    if (!config) return;
    setError(null);
    try { await api.adminUpdateConfig({ [key]: !config[key] }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="System configuration" subtitle="Global settings, admin only" />
      <Notice text="These settings apply platform-wide. Every change is written to the audit log with its previous and new value." />
      <Field label="Additional garment rate for subscribers (rupees per garment)" value={rate} onChangeText={setRate} keyboardType="number-pad" />
      <Field label="Pay per garment rate without a plan (rupees per garment)" value={guestRate} onChangeText={setGuestRate} keyboardType="number-pad" />
      <Notice text="Subscription is optional. A resident without a plan pays the second rate for every garment." />
      <Field label="Garment categories (comma separated)" value={categories} onChangeText={setCategories} />
      <Field label="Default slot capacity" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
      <Field label="Default turnaround hours" value={turnaround} onChangeText={setTurnaround} keyboardType="number-pad" />
      <Field label="Delay grace hours" value={grace} onChangeText={setGrace} keyboardType="number-pad" />
      <Button label="Save configuration" onPress={save} />

      <SectionTitle>Garment services</SectionTitle>
      <Notice text="A service is priced per garment category, because pressing a saree is not pressing a shirt. Each service also says what physically has to happen to the garment, which is what lets an Iron Only order skip washing." />

      <Button label={addingService ? "Cancel" : "Add a new service"} variant="secondary" onPress={() => setAddingService(!addingService)} />
      {addingService ? (
        <Card>
          <SectionTitle>New service</SectionTitle>
          <Field label="Service name" value={newName} onChangeText={setNewName} placeholder="Starch and Press" />
          <Field label="Default price per garment (rupees)" value={newPrice} onChangeText={setNewPrice} keyboardType="number-pad" />
          <SectionTitle>What does it involve?</SectionTitle>
          <Row label="Needs cleaning" value={newRequiresClean ? "Yes" : "No"} />
          <Button label={newRequiresClean ? "It does not need cleaning" : "It needs cleaning"} variant="secondary" onPress={() => setNewRequiresClean(!newRequiresClean)} />
          {newRequiresClean ? (
            <ChoiceChips
              options={["wash", "dry_clean", "premium"] as const}
              value={newCleanStage}
              onChange={setNewCleanStage}
              labelOf={(option) => ({ wash: "Wash", dry_clean: "Dry clean", premium: "Premium care" })[option]}
            />
          ) : null}
          <Row label="Needs ironing" value={newRequiresPress ? "Yes" : "No"} />
          <Button label={newRequiresPress ? "It does not need ironing" : "It needs ironing"} variant="secondary" onPress={() => setNewRequiresPress(!newRequiresPress)} />
          <Button label="Add service" disabled={!newName.trim()} onPress={addService} />
        </Card>
      ) : null}

      {services.map((service, index) => (
        <Card key={service.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{service.name}</Text>
            <Pill text={service.isBase ? "Base" : service.isActive ? "Active" : "Off"} color={service.isBase ? theme.aqua : service.isActive ? theme.success : theme.muted} />
          </View>
          <Text style={styles.meta}>
            {[service.requiresClean ? ({ wash: "Wash", dry_clean: "Dry clean", premium: "Premium care" }[service.cleanStage ?? "wash"]) : null,
              service.requiresPress ? "Iron" : null].filter(Boolean).join(" then ") || "No processing"}
          </Text>
          <Field
            label="Default price per garment (rupees)"
            value={String(service.unitPricePaise / 100)}
            keyboardType="number-pad"
            onChangeText={(value) => setServices((current) => {
              const next = [...current];
              next[index] = { ...next[index], unitPricePaise: Math.max(0, Math.round(Number(value || 0) * 100)) };
              return next;
            })}
          />
          <Button
            label={expandedService === service.id ? "Hide per garment prices" : "Set a price per garment"}
            variant="secondary"
            onPress={() => setExpandedService(expandedService === service.id ? null : service.id)}
          />
          {expandedService === service.id ? (
            <>
              {/* A category left blank falls back to the default price above, so an
                  admin only has to price the garments that genuinely differ. */}
              <Notice text="Leave a garment blank to charge the default price for it." />
              {(config?.garmentCategories ?? []).map((category) => (
                <Field
                  key={category}
                  label={category}
                  value={service.pricesPaise?.[category] != null ? String(service.pricesPaise[category] / 100) : ""}
                  placeholder={`Default ${service.unitPricePaise / 100}`}
                  keyboardType="number-pad"
                  onChangeText={(value) => setServices((current) => {
                    const next = [...current];
                    const prices = { ...(next[index].pricesPaise ?? {}) };
                    if (value.trim() === "") delete prices[category];
                    else prices[category] = Math.max(0, Math.round(Number(value || 0) * 100));
                    next[index] = { ...next[index], pricesPaise: prices };
                    return next;
                  })}
                />
              ))}
            </>
          ) : null}
          <Button
            label={service.isActive ? "Turn this service off" : "Turn this service on"}
            variant="secondary"
            onPress={() => setServices((current) => {
              const next = [...current];
              next[index] = { ...next[index], isActive: !next[index].isActive };
              return next;
            })}
          />
          {!service.isBase ? (
            <Button label="Retire this service" variant="danger" onPress={() => retireService(service)} />
          ) : null}
        </Card>
      ))}
      <Button label="Save services" onPress={saveServices} />

      <SectionTitle>Operational rules</SectionTitle>
      <Card>
        <Row label="Quality check required" value={config?.qcRequired ? "Yes" : "No"} />
        <Button label={config?.qcRequired ? "Turn QC requirement off" : "Turn QC requirement on"} variant="secondary" onPress={() => toggle("qcRequired")} />
        <Row label="Notifications enabled" value={config?.notificationsEnabled ? "Yes" : "No"} />
        <Button label={config?.notificationsEnabled ? "Disable notifications" : "Enable notifications"} variant="secondary" onPress={() => toggle("notificationsEnabled")} />
        <Row label="Last updated" value={dateTime(config?.updatedAt)} />
      </Card>

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
  json: { fontSize: 10, color: theme.muted, marginTop: 6, fontFamily: "monospace" },
  rowLink: { flexDirection: "row", alignItems: "center" },
  rowLinkAction: { color: theme.aqua, fontSize: 12, fontWeight: "700", marginLeft: 10 },
});
