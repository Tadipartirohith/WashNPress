import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  AdminDashboard, Area, AuditEntry, Issue, OrderDetail, OrderSummary, PlanUsage,
  ReportsResponse, Slot, Society, StaffUser, SystemConfig,
} from "../api/types";
import { theme, rupees, shortDate, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, BackLink, Stat, StatGrid, ChoiceChips,
} from "../components/ui";
import { OrderList, OrderDetailBody, IssueCard } from "../components/order";
import { ReportTable } from "./SupervisorPortal";

type Tab = "home" | "areas" | "supervisors" | "societies" | "users" | "orders" | "plans" | "slots" | "reports" | "issues" | "audit" | "config";

export function AdminPortal({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [orderFilter, setOrderFilter] = useState<string | null>(null);

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
          { key: "plans", label: "Plans" },
          { key: "slots", label: "Slots" },
          { key: "reports", label: "Reports" },
          { key: "issues", label: "Issues" },
          { key: "audit", label: "Audit" },
          { key: "config", label: "Config" },
        ]}
      />
      {tab === "home" && <AdminHome token={token} onGoto={(t, filter) => { setTab(t); setOrderFilter(filter ?? null); }} />}
      {tab === "areas" && <AreasScreen token={token} onOpen={setOpenAreaId} />}
      {tab === "supervisors" && <SupervisorsScreen token={token} />}
      {tab === "societies" && <AdminSocietiesScreen token={token} />}
      {tab === "users" && <UsersScreen token={token} onLogout={onLogout} />}
      {tab === "orders" && <AdminOrdersScreen token={token} initialState={orderFilter} onOpenOrder={setOpenOrderId} />}
      {tab === "plans" && <PlansScreen token={token} />}
      {tab === "slots" && <AdminSlotsScreen token={token} />}
      {tab === "reports" && <AdminReportsScreen token={token} />}
      {tab === "issues" && <AdminIssuesScreen token={token} />}
      {tab === "audit" && <AuditScreen token={token} />}
      {tab === "config" && <ConfigScreen token={token} onLogout={onLogout} />}
    </View>
  );
}

// ----------------------------------------------------------------- dashboard

function AdminHome({ token, onGoto }: { token: string; onGoto: (tab: Tab, filter?: string) => void }) {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.adminDashboard(token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !data) return <Loading />;
  const o = data?.orders;
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Admin dashboard" subtitle="System-wide view of the whole platform" />
      <ErrorText error={error} />

      <SectionTitle>Network</SectionTitle>
      <StatGrid>
        <Stat label="Total areas" value={data?.areas.total ?? 0} onPress={() => onGoto("areas")} />
        <Stat label="Active areas" value={data?.areas.active ?? 0} onPress={() => onGoto("areas")} />
        <Stat label="Total supervisors" value={data?.supervisors.total ?? 0} onPress={() => onGoto("supervisors")} />
        <Stat label="Active supervisors" value={data?.supervisors.active ?? 0} onPress={() => onGoto("supervisors")} />
        <Stat label="Unassigned supervisors" value={data?.supervisors.unassigned ?? 0} tone="warn" onPress={() => onGoto("supervisors")} />
        <Stat label="Total societies" value={data?.societies.total ?? 0} onPress={() => onGoto("societies")} />
        <Stat label="Active societies" value={data?.societies.active ?? 0} onPress={() => onGoto("societies")} />
        <Stat label="Total residents" value={data?.residents.total ?? 0} onPress={() => onGoto("users")} />
        <Stat label="Operations staff" value={data?.operationsStaff.total ?? 0} onPress={() => onGoto("users")} />
      </StatGrid>

      <SectionTitle>Orders</SectionTitle>
      <StatGrid>
        <Stat label="Total orders" value={o?.total ?? 0} onPress={() => onGoto("orders")} />
        <Stat label="Today's orders" value={o?.today ?? 0} onPress={() => onGoto("orders")} />
        <Stat label="Pending" value={o?.pending ?? 0} onPress={() => onGoto("orders", "scheduled")} />
        <Stat label="Scheduled" value={o?.scheduled ?? 0} onPress={() => onGoto("orders", "scheduled")} />
        <Stat label="Picked up" value={o?.pickedUp ?? 0} onPress={() => onGoto("orders", "picked_up")} />
        <Stat label="Washing" value={o?.washing ?? 0} onPress={() => onGoto("orders", "in_wash")} />
        <Stat label="Ironing" value={o?.ironing ?? 0} onPress={() => onGoto("orders", "ironing")} />
        <Stat label="QC pending" value={o?.qcPending ?? 0} tone="warn" onPress={() => onGoto("orders", "qc")} />
        <Stat label="QC failed" value={o?.qcFailed ?? 0} tone="danger" onPress={() => onGoto("orders", "qc_hold")} />
        <Stat label="Ready for delivery" value={o?.readyForDelivery ?? 0} tone="good" onPress={() => onGoto("orders", "ready_for_delivery")} />
        <Stat label="Out for delivery" value={o?.outForDelivery ?? 0} onPress={() => onGoto("orders", "out_for_delivery")} />
        <Stat label="Delivered" value={o?.delivered ?? 0} tone="good" onPress={() => onGoto("orders", "delivered")} />
        <Stat label="Cancelled" value={o?.cancelled ?? 0} onPress={() => onGoto("orders", "cancelled")} />
        <Stat label="Delayed" value={o?.delayed ?? 0} tone="danger" onPress={() => onGoto("orders")} />
        <Stat label="Failed pickups" value={o?.failedPickups ?? 0} tone="danger" onPress={() => onGoto("orders", "pickup_failed")} />
      </StatGrid>

      <SectionTitle>Subscriptions and revenue</SectionTitle>
      <StatGrid>
        <Stat label="Active subscriptions" value={data?.subscriptions.active ?? 0} onPress={() => onGoto("plans")} />
        <Stat label="Paused" value={data?.subscriptions.paused ?? 0} onPress={() => onGoto("plans")} />
        <Stat label="Cancelled" value={data?.subscriptions.cancelled ?? 0} onPress={() => onGoto("plans")} />
      </StatGrid>
      <Card>
        <Row label="Subscription revenue" value={rupees(data?.revenue.subscriptionRevenuePaise ?? 0)} />
        <Row label="Additional garment revenue" value={rupees(data?.revenue.additionalGarmentRevenuePaise ?? 0)} />
        <Row label="Pending additional charges" value={rupees(data?.revenue.pendingAdditionalChargesPaise ?? 0)} />
        <Row label="Total revenue" value={rupees(data?.revenue.totalRevenuePaise ?? 0)} />
      </Card>

      <SectionTitle>Issues</SectionTitle>
      <StatGrid>
        <Stat label="Open" value={data?.issues.open ?? 0} tone="warn" onPress={() => onGoto("issues")} />
        <Stat label="Under review" value={data?.issues.underReview ?? 0} onPress={() => onGoto("issues")} />
        <Stat label="Escalated" value={data?.issues.escalated ?? 0} tone="danger" onPress={() => onGoto("issues")} />
      </StatGrid>
    </Screen>
  );
}

// ---------------------------------------------------------------------- areas

function AreasScreen({ token, onOpen }: { token: string; onOpen: (id: string) => void }) {
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
      const [a, s] = await Promise.all([api.adminAreas(token), api.adminSupervisors(token)]);
      setAreas(a.areas); setSupervisors(s.supervisors);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
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
          <View style={styles.buttonRow}>
            <View style={{ flex: 1, marginRight: 6 }}><Button label="Open" variant="secondary" onPress={() => onOpen(area.id)} /></View>
            <View style={{ flex: 1, marginLeft: 6 }}><Button label={area.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(area)} /></View>
          </View>
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

function SupervisorsScreen({ token }: { token: string }) {
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
      const [s, a] = await Promise.all([api.adminSupervisors(token), api.adminAreas(token)]);
      setSupervisors(s.supervisors); setAreas(a.areas);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
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
          <Button label={s.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(s)} />
        </Card>
      ))}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------ societies

function AdminSocietiesScreen({ token }: { token: string }) {
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

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [s, a] = await Promise.all([api.adminSocieties(token, { areaId: areaId ?? undefined, q: search || undefined }), api.adminAreas(token)]);
      setSocieties(s.societies); setAreas(a.areas);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, areaId, search]);
  useEffect(() => { load(); }, [load]);

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
          <Button label={s.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(s)} />
        </Card>
      ))}
      <ErrorText error={error} />
    </Screen>
  );
}

// ---------------------------------------------------------------------- users

function UsersScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setUsers((await api.adminUsers(token, { role: role ?? undefined, status: status ?? undefined, q: search || undefined })).users); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, role, status, search]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (user: StaffUser) => {
    setError(null);
    try { await api.adminSetUserStatus(user.id, user.status === "active" ? "blocked" : "active", token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="User management" subtitle="Admin, supervisor, operations and resident accounts" right={<Button label="Sign out" variant="danger" onPress={onLogout} />} />
      <Field label="Search by name, phone or email" value={search} onChangeText={setSearch} />
      <SectionTitle>Role</SectionTitle>
      <ChoiceChips options={["admin", "supervisor", "operator", "resident"]} value={role} onChange={(next) => setRole(next === role ? null : next)} labelOf={titleCase} />
      <SectionTitle>Status</SectionTitle>
      <ChoiceChips options={["active", "blocked"]} value={status} onChange={(next) => setStatus(next === status ? null : next)} labelOf={titleCase} />
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
          {!u.roles.includes("admin") ? <Button label={u.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(u)} /> : null}
        </Card>
      ))}
      <ErrorText error={error} />
    </Screen>
  );
}

// --------------------------------------------------------------------- orders

function AdminOrdersScreen({ token, initialState, onOpenOrder }: { token: string; initialState: string | null; onOpenOrder: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(initialState);
  const [orderCode, setOrderCode] = useState("");
  const [resident, setResident] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [o, a, s] = await Promise.all([
        api.adminOrders(token, { areaId: areaId ?? undefined, societyId: societyId ?? undefined, state: state ?? undefined, orderCode: orderCode || undefined, resident: resident || undefined }),
        api.adminAreas(token),
        api.adminSocieties(token, { areaId: areaId ?? undefined }),
      ]);
      setOrders(o.orders); setAreas(a.areas); setSocieties(s.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, areaId, societyId, state, orderCode, resident]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Order management" subtitle="System-wide order monitoring" />
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
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setPlans((await api.adminPlans(token)).plans); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

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
          <Button label={plan.isActive ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(plan)} />
        </Card>
      ))}
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
        <Row label="Under review" value={data?.issues.underReview ?? 0} />
        <Row label="Resolved" value={data?.issues.resolved ?? 0} />
        {data?.issues.byType.map((t) => <Row key={t.type} label={titleCase(t.type)} value={t.count} />)}
      </Card>
      <ErrorText error={error} />
    </Screen>
  );
}

// --------------------------------------------------------------------- issues

function AdminIssuesScreen({ token }: { token: string }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setIssues((await api.adminIssues(token, { status: status ?? undefined, escalated: escalatedOnly ? "true" : undefined })).issues); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, escalatedOnly]);
  useEffect(() => { load(); }, [load]);

  const resolve = async (issue: Issue) => {
    setError(null);
    try { await api.adminSetIssueStatus(issue.id, "resolved", "Resolved by admin", token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Issues and complaints" subtitle="Escalated and system-wide visibility" />
      <ChoiceChips options={["open", "under_review", "resolved"]} value={status} onChange={(next) => setStatus(next === status ? null : next)} labelOf={titleCase} />
      <Button label={escalatedOnly ? "Showing escalated only" : "Show escalated only"} variant="secondary" onPress={() => setEscalatedOnly(!escalatedOnly)} />
      <Notice text="Normal operational issues are handled by operations and the supervisor. Admin sees escalations and the system-wide picture." />
      {issues.length ? issues.map((issue) => (
        <IssueCard key={issue.id} issue={issue}>
          {issue.status !== "resolved" ? <Button label="Mark resolved" variant="secondary" onPress={() => resolve(issue)} /> : null}
        </IssueCard>
      )) : <Empty text="No issues." />}
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

function truncate(value: string, max = 220): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// --------------------------------------------------------------------- config

function ConfigScreen({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [rate, setRate] = useState("");
  const [categories, setCategories] = useState("");
  const [capacity, setCapacity] = useState("");
  const [turnaround, setTurnaround] = useState("");
  const [grace, setGrace] = useState("");
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.adminConfig(token);
      setConfig(r.config);
      setRate(String(r.config.additionalGarmentRatePaise / 100));
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
        garmentCategories: categories.split(",").map((c) => c.trim()).filter(Boolean),
        defaultSlotCapacity: Number(capacity),
        defaultTurnaroundHours: Number(turnaround),
        delayGraceHours: Number(grace),
      }, token);
      setNote("Configuration saved. The change is recorded in the audit log.");
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
      <Field label="Additional garment rate (rupees per garment)" value={rate} onChangeText={setRate} keyboardType="number-pad" />
      <Field label="Garment categories (comma separated)" value={categories} onChangeText={setCategories} />
      <Field label="Default slot capacity" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
      <Field label="Default turnaround hours" value={turnaround} onChangeText={setTurnaround} keyboardType="number-pad" />
      <Field label="Delay grace hours" value={grace} onChangeText={setGrace} keyboardType="number-pad" />
      <Button label="Save configuration" onPress={save} />

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
});
