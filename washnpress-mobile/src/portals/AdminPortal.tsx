import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  ConversationView,
  AdminDashboard, Area, AreaCoverage, AuditEntry, GarmentService, Issue, IssueAnalytics,
  OrderDetail, OrderSummary, PlanUsage, ReportsResponse, Slot, Society, StaffUser, SystemConfig,
  RevenueReport, RevenueBucket, ChargedOrderRow, MonitoredSlot, SlotSummary, PriceList, SlotWindows, IssueStatus, PageInfo,
} from "../api/types";
import { theme, rupees, shortDate, dateTime, titleCase, stateLabel } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, BackLink, Stat, StatGrid, ChoiceChips, Meter, CardGrid, FieldRow,
  SlotWindowPicker, DEFAULT_SLOT_WINDOWS, to12Hour,
  VerificationTags, VerificationActions,
} from "../components/ui";
import { AssignmentPanel, adminAssignmentApi } from "./assignment-panel";
import { OrderList, OrderDetailBody, IssueCard } from "../components/order";
import { IssueRow, TicketDetail, ReplyBox, ResolveBox, describeMinutes } from "../components/support";
import { usePolling, useDebounced, POLL } from "../hooks";
import { DateField, DATE_PRESETS, todayIso } from "../components/calendar";
import { PlanWizard } from "./admin-plan-wizard";
import { formatQuantity, perUnitLabel } from "../api/units";
import { ReportTable } from "./SupervisorPortal";
import { AdminServicesScreen } from "./admin-extras";
import { ISSUE_STATUS_LABEL } from "../components/support";
import { Dropdown, FilterRow, ConfirmDialog, DataTable, Pager, type FilterValues } from "../components/filters";

// Approving somebody is part of managing them, not a place of its own. A separate
// Verification page meant an admin who had just created a supervisor had to go
// somewhere else to let them in.
type Tab = "home" | "areas" | "supervisors" | "operators" | "societies" | "users" | "orders" | "services" | "subscriptions" | "revenue" | "plans" | "slots" | "reports" | "issues" | "audit" | "config";

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
          { key: "operators", label: "Operators" },
          { key: "societies", label: "Societies" },
          { key: "users", label: "Users" },
          { key: "orders", label: "Orders" },
          { key: "services", label: "Services" },
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
      {tab === "operators" && <AdminOperatorsScreen token={token} filter={filter} />}
      {tab === "societies" && <AdminSocietiesScreen token={token} filter={filter} />}
      {tab === "users" && <UsersScreen token={token} filter={filter} onLogout={onLogout} />}
      {tab === "services" && <AdminServicesScreen token={token} />}
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

      {data?.alerts?.length ? (
        <>
          <SectionTitle>Attention required</SectionTitle>
          {data.alerts.map((alert) => (
            <Card key={alert.kind} onPress={() => onGoto(...alertTarget(alert.kind))}>
              <View style={styles.alertRow}>
                <View style={[styles.alertDot, { backgroundColor: alertColour(alert.severity) }]} />
                <Text style={styles.alertText}>{alert.count} {alert.label}</Text>
              </View>
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
        <Stat label="Active operators" value={data?.operationsStaff.active ?? 0} onPress={() => onGoto("operators", { status: "active" })} />
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

      <SectionTitle>Operations today</SectionTitle>
      <StatGrid>
        <Stat label="Today's pickups" value={data?.operations?.pickups.today ?? 0} onPress={() => onGoto("orders", { today: "true" })} />
        <Stat label="Pending pickups" value={data?.operations?.pickups.pending ?? 0} onPress={orders("scheduled")} />
        <Stat label="Completed pickups" value={data?.operations?.pickups.completed ?? 0} tone="good" onPress={orders("picked_up")} />
        <Stat label="Failed pickups" value={data?.operations?.pickups.failed ?? 0} tone="danger" onPress={orders("pickup_failed")} />
        <Stat label="Delivered today" value={o?.deliveredToday ?? 0} tone="good" onPress={orders("delivered")} />
        <Stat label="Delayed orders" value={o?.delayed ?? 0} tone="danger" onPress={orders(undefined, { delayed: "true" })} />
      </StatGrid>

      <SectionTitle>Subscriptions and revenue</SectionTitle>
      <StatGrid>
        <Stat label="Active subscriptions" value={data?.subscriptions.active ?? 0} onPress={() => onGoto("subscriptions", { status: "active" })} />
        <Stat label="Paused" value={data?.subscriptions.paused ?? 0} onPress={() => onGoto("subscriptions", { status: "paused" })} />
        <Stat label="Cancelled" value={data?.subscriptions.cancelled ?? 0} onPress={() => onGoto("subscriptions", { status: "cancelled" })} />
        <Stat label="Expired" value={data?.subscriptions.expired ?? 0} tone="warn" onPress={() => onGoto("subscriptions", { status: "expired" })} />
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

      <SectionTitle>Area performance</SectionTitle>
      {data?.areaPerformance?.length ? data.areaPerformance.map((area) => (
        <Card key={area.areaId} onPress={() => onGoto("areas")}>
          <View style={styles.headRow}>
            <Text style={styles.cardTitle}>{area.name}</Text>
            {area.delayedOrders || area.openIssues
              ? <Pill text={`${area.delayedOrders + area.openIssues} to watch`} color={theme.danger} />
              : <Pill text="On track" color={theme.success} />}
          </View>
          <Row label="Societies · Residents · Operators" value={`${area.societies} · ${area.residents} · ${area.operators}`} />
          <Row label="Orders" value={`${area.totalOrders} total · ${area.pendingOrders} pending · ${area.deliveredOrders} delivered`} />
          <Row label="Needs attention" value={`${area.delayedOrders} delayed · ${area.openIssues} open issue${area.openIssues === 1 ? "" : "s"}`} />
        </Card>
      )) : <Empty text="No areas yet." />}

      <SectionTitle>Recent activity</SectionTitle>
      {data?.recentActivity?.length ? (
        <Card>
          {data.recentActivity.map((entry) => (
            <View key={entry.id} style={styles.activityRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityWhat}>{activityLabel(entry.action)}</Text>
                <Text style={styles.activityWho}>
                  {entry.actor}{entry.role ? ` · ${titleCase(entry.role)}` : ""}
                </Text>
              </View>
              <Text style={styles.activityWhen}>{dateTime(entry.at)}</Text>
            </View>
          ))}
        </Card>
      ) : <Empty text="Nothing has happened yet." />}

      <SectionTitle>Quick actions</SectionTitle>
      <StatGrid>
        <Stat label="Areas" value="›" onPress={() => onGoto("areas")} />
        <Stat label="Supervisors" value="›" onPress={() => onGoto("supervisors")} />
        <Stat label="Operators" value="›" onPress={() => onGoto("operators")} />
        <Stat label="Societies" value="›" onPress={() => onGoto("societies")} />
        <Stat label="Users" value="›" onPress={() => onGoto("users")} />
        <Stat label="Slots" value="›" onPress={() => onGoto("slots")} />
        <Stat label="Orders" value="›" onPress={() => onGoto("orders")} />
        <Stat label="Issues" value="›" onPress={() => onGoto("issues")} />
        <Stat label="Reports" value="›" onPress={() => onGoto("reports")} />
        <Stat label="Audit" value="›" onPress={() => onGoto("audit")} />
        <Stat label="Config" value="›" onPress={() => onGoto("config")} />
      </StatGrid>
    </Screen>
  );
}

// An alert should open the thing it is complaining about, not a general list the
// admin then has to filter by hand.
function alertTarget(kind: string): [Tab, DrillFilter] {
  switch (kind) {
    case "qc_failed": return ["orders", { state: "qc_hold" }];
    case "delayed_orders": return ["orders", { delayed: "true" }];
    case "failed_pickups": return ["orders", { state: "pickup_failed" }];
    case "disputed_orders": return ["orders", { state: "disputed" }];
    case "escalated_issues": return ["issues", { escalated: "true" }];
    case "emergency_issues": return ["issues", { emergency: "true" }];
    case "unassigned_supervisors": return ["supervisors", { assigned: "false" }];
    case "unassigned_operators": return ["operators", { assigned: "false" }];
    case "expired_subscriptions": return ["subscriptions", { status: "expired" }];
    default: return ["orders", {}];
  }
}

function alertColour(severity: string): string {
  if (severity === "critical") return theme.danger;
  if (severity === "warning") return theme.amber;
  return theme.aqua;
}

// Audit actions are recorded as "issue.escalated" and the like. The dashboard is
// read by people, so they are spelled out rather than shown as identifiers.
function activityLabel(action: string): string {
  const known: Record<string, string> = {
    "resident.registered": "New resident registered",
    "society.created": "New society created",
    "area.created": "New area created",
    "supervisor.assigned": "Supervisor assigned",
    "operator.assigned": "Operator assigned",
    "order.created": "New order created",
    "order.picked_up": "Order picked up",
    "order.state_changed": "Order moved on",
    "order.delivered": "Order delivered",
    "qc.failed": "QC failed",
    "issue.created": "Issue raised",
    "issue.escalated": "Issue escalated",
    "issue.resolved": "Issue resolved",
    "slot.created": "Slot created",
  };
  return known[action] ?? titleCase(action.replace(/[._]/g, " "));
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
  // The drill-in from the dashboard sets this; the dropdown changes it afterwards.
  const [statusFilter, setStatusFilter] = useState<string | undefined>(filter.status);
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

  const shownAreas = statusFilter ? areas.filter((a) => a.status === statusFilter) : areas;

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

      {/* All, active or inactive. There was no way to see one without the other,
          which made a long list impossible to scan. */}
      <Dropdown
        label="Status"
        value={statusFilter}
        options={[{ value: "active", label: "Active areas" }, { value: "inactive", label: "Inactive areas" }]}
        onChange={setStatusFilter}
        allLabel="All areas"
      />
      <Text style={styles.meta}>{shownAreas.length} of {areas.length} shown</Text>

      {shownAreas.map((area) => (
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
  const [statusFilter, setStatusFilter] = useState<string | undefined>(filter.status);
  const [areaFilter, setAreaFilter] = useState<string | undefined>(filter.areaId);
  const [assignedFilter, setAssignedFilter] = useState<string | undefined>(
    filter.assigned === "false" ? "unassigned" : undefined,
  );
  const [verificationFilter, setVerificationFilter] = useState<string | undefined>(undefined);
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

  // Everything the requirements ask to be able to narrow by, applied together.
  const shownSupervisors = supervisors.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (areaFilter && s.areaId !== areaFilter) return false;
    if (assignedFilter === "assigned" && !s.areaId) return false;
    if (assignedFilter === "unassigned" && s.areaId) return false;
    if (verificationFilter && (s.verificationStatus ?? "approved") !== verificationFilter) return false;
    return true;
  });

  // Approving or rejecting somebody, where they are managed.
  const decide = async (supervisor: StaffUser, status: "approved" | "rejected") => {
    setError(null); setNote(null);
    try {
      await api.adminSetVerification(supervisor.id, status, undefined, token);
      setNote(status === "approved"
        ? `${supervisor.fullName} is approved and can sign in.`
        : `${supervisor.fullName} was rejected. The decision is on the record.`);
      await load();
    } catch (e) { setError((e as Error).message); }
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

      <Dropdown
        label="Status"
        value={statusFilter}
        options={[{ value: "active", label: "Active" }, { value: "blocked", label: "Deactivated" }]}
        onChange={setStatusFilter}
        allLabel="Any status"
      />
      <Dropdown
        label="Area"
        value={areaFilter}
        options={areas.map((a) => ({ value: a.id, label: a.name }))}
        onChange={setAreaFilter}
        allLabel="Any area"
      />
      <Dropdown
        label="Assignment"
        value={assignedFilter}
        options={[{ value: "assigned", label: "Assigned to an area" }, { value: "unassigned", label: "Not assigned" }]}
        onChange={setAssignedFilter}
        allLabel="Assigned or not"
      />
      <Dropdown
        label="Verification"
        value={verificationFilter}
        options={[
          { value: "pending", label: "Waiting for a decision" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
        ]}
        onChange={setVerificationFilter}
        allLabel="Any"
      />
      <Text style={styles.meta}>{shownSupervisors.length} of {supervisors.length} shown</Text>

      {shownSupervisors.map((s) => (
        <Card key={s.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{s.fullName}</Text>
            {/* Approval and activity, side by side, where the person is managed. */}
            <VerificationTags status={s.verificationStatus} active={s.status === "active"} />
          </View>
          <Row label="Phone" value={s.phone} />
          <Row label="Email" value={s.email} />
          <Row label="Employee ID" value={s.employeeId} />
          <Row label="Assigned area" value={s.areaName ?? "Unassigned"} />
          {/* An admin approves a supervisor from the Supervisors section rather than
              from a page somewhere else. */}
          <VerificationActions
            status={s.verificationStatus}
            onApprove={() => decide(s, "approved")}
            onReject={() => decide(s, "rejected")}
          />
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

// ------------------------------------------------------------------ operators

// Operations staff, managed by the admin directly. An operator does not need a
// supervisor to exist first: supervision follows the area, so an operator created
// in an area that has nobody running it yet still works perfectly well, and picks
// up a supervisor the moment one is assigned to that area.
function AdminOperatorsScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [operators, setOperators] = useState<StaffUser[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [areaFilter, setAreaFilter] = useState<string | null>(filter.areaId ?? null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [creating, setCreating] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [newAreaId, setNewAreaId] = useState<string | null>(null);
  const [newSocietyIds, setNewSocietyIds] = useState<string[]>([]);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ fullName: "", email: "", employeeId: "" });

  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useDebounced(search, 250);
  // Approving or rejecting an operator, where they are managed. Only an approved and
  // active supervisor may approve their own operators, so an admin doing it here is
  // the fallback for an area that has nobody running it yet.
  const decideOperator = async (op: StaffUser, status: "approved" | "rejected") => {
    setError(null); setNote(null);
    try {
      await api.adminSetVerification(op.id, status, undefined, token);
      setNote(status === "approved"
        ? `${op.fullName} is approved and can sign in.`
        : `${op.fullName} was rejected. The decision is on the record.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [ops, areaRes, societyRes] = await Promise.all([
        api.adminOperators(token, { areaId: areaFilter ?? undefined, status: statusFilter === "all" ? undefined : statusFilter }),
        api.adminAreas(token),
        api.adminSocieties(token),
      ]);
      const needle = query.trim().toLowerCase();
      setOperators(needle
        ? ops.operators.filter((o) => (o.fullName ?? "").toLowerCase().includes(needle) || (o.phone ?? "").includes(needle))
        : ops.operators);
      setAreas(areaRes.areas);
      setSocieties(societyRes.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, areaFilter, statusFilter, query]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!newAreaId) { setError("Choose the area this operator works in."); return; }
    setError(null); setNote(null);
    try {
      const result = await api.adminCreateOperator({
        fullName, phone,
        email: email || undefined,
        employeeId: employeeId || undefined,
        areaId: newAreaId,
        societyIds: newSocietyIds,
      }, token);
      setNote(result.operator.supervisorName
        ? `${result.operator.fullName} created under ${result.operator.supervisorName}.`
        : `${result.operator.fullName} created. That area has no supervisor yet, which does not stop them working.`);
      setFullName(""); setPhone(""); setEmail(""); setEmployeeId("");
      setNewAreaId(null); setNewSocietyIds([]); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const startEditing = (operator: StaffUser) => {
    setError(null); setNote(null);
    setEditing(operator.id);
    setDraft({ fullName: operator.fullName ?? "", email: operator.email ?? "", employeeId: operator.employeeId ?? "" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null); setNote(null);
    try {
      await api.adminUpdateOperator(editing, {
        fullName: draft.fullName,
        email: draft.email || undefined,
        employeeId: draft.employeeId || undefined,
      }, token);
      setNote("Operator saved."); setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const move = async (operator: StaffUser, areaId: string) => {
    setError(null); setNote(null);
    try { await api.adminUpdateOperator(operator.id, { areaId, societyIds: [] }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const toggleSociety = async (operator: StaffUser, societyId: string) => {
    const next = operator.societyIds.includes(societyId)
      ? operator.societyIds.filter((id) => id !== societyId)
      : [...operator.societyIds, societyId];
    setError(null);
    try { await api.adminUpdateOperator(operator.id, { societyIds: next }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const setStatus = async (operator: StaffUser, status: string) => {
    setError(null); setNote(null);
    try { await api.adminUpdateOperator(operator.id, { status }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const societiesInNewArea = societies.filter((sc) => !newAreaId || sc.areaId === newAreaId);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Operator management"
        subtitle="Operations staff across every area"
        right={<Button label={creating ? "Close" : "New operator"} variant="secondary" onPress={() => setCreating(!creating)} />}
      />

      {creating ? (
        <Card>
          <SectionTitle>New operator</SectionTitle>
          <Field label="Full name" value={fullName} onChangeText={setFullName} />
          <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <Field label="Employee ID" value={employeeId} onChangeText={setEmployeeId} />
          <SectionTitle>Area</SectionTitle>
          <ChoiceChips
            options={areas.map((a) => a.id)}
            value={newAreaId}
            onChange={(id) => { setNewAreaId(id); setNewSocietyIds([]); }}
            labelOf={(id) => {
              const area = areas.find((a) => a.id === id);
              return area ? `${area.name}${area.supervisorName ? "" : " (no supervisor)"}` : id;
            }}
          />
          {newAreaId && !areas.find((a) => a.id === newAreaId)?.supervisorName ? (
            <Notice text="That area has no supervisor yet. The operator can still be created and can work normally; they pick one up as soon as a supervisor is assigned to the area." />
          ) : null}
          <SectionTitle>Societies (optional)</SectionTitle>
          <ChoiceChips
            options={societiesInNewArea.map((sc) => sc.id)}
            value={null}
            onChange={(id) => setNewSocietyIds(newSocietyIds.includes(id) ? newSocietyIds.filter((x) => x !== id) : [...newSocietyIds, id])}
            labelOf={(id) => `${newSocietyIds.includes(id) ? "✓ " : ""}${societiesInNewArea.find((sc) => sc.id === id)?.name ?? id}`}
          />
          <Button label="Create operator" onPress={create} disabled={fullName.length < 2 || phone.length !== 10 || !newAreaId} />
        </Card>
      ) : null}

      <Field label="Search by name or phone" value={search} onChangeText={setSearch} placeholder="Start typing" />
      <Text style={styles.meta}>Area</Text>
      <ChoiceChips
        options={areas.map((a) => a.id)}
        value={areaFilter}
        onChange={(id) => setAreaFilter(id === areaFilter ? null : id)}
        labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id}
      />
      <Text style={styles.meta}>Availability</Text>
      <ChoiceChips
        options={["all", "active", "on_leave", "blocked"]}
        value={statusFilter}
        onChange={setStatusFilter}
        labelOf={(v) => (v === "all" ? "All" : v === "on_leave" ? "On leave" : titleCase(v))}
      />

      <View style={{ height: 8 }} />
      {operators.length ? operators.map((op) => (
        <Card key={op.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{op.fullName}</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <VerificationTags status={op.verificationStatus} />
              <Pill
                text={op.status === "on_leave" ? "On leave" : titleCase(op.status)}
                color={op.status === "active" ? theme.success : op.status === "on_leave" ? theme.amber : theme.danger}
              />
            </View>
          </View>
          <Row label="Phone" value={op.phone} />
          <Row label="Email" value={op.email} />
          <Row label="Employee ID" value={op.employeeId} />
          <Row label="Area" value={op.areaName ?? "Unassigned"} />
          {/* Supervision follows the area, so this is a fact about where they work
              rather than a second link that could fall out of step. */}
          <Row label="Supervisor" value={op.supervisorName ?? "No supervisor for this area yet"} />
          <Row label="Societies" value={op.societyNames?.length ? op.societyNames.join(", ") : "None"} />
          <Row label="Last login" value={dateTime(op.lastLoginAt)} />
          {/* An operator is approved from the Operators section, beside everything
              else about them, rather than from a page of their own. */}
          <VerificationActions
            status={op.verificationStatus}
            onApprove={() => decideOperator(op, "approved")}
            onReject={() => decideOperator(op, "rejected")}
            note={op.supervisorName ? null : "Their area has no supervisor yet, so an admin is approving on their behalf."}
          />

          {editing === op.id ? (
            <>
              <SectionTitle>Edit operator</SectionTitle>
              <Field label="Full name" value={draft.fullName} onChangeText={(v) => setDraft({ ...draft, fullName: v })} />
              <Field label="Email" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} keyboardType="email-address" />
              <Field label="Employee ID" value={draft.employeeId} onChangeText={(v) => setDraft({ ...draft, employeeId: v })} />
              <Button label="Save operator" onPress={saveEdit} disabled={draft.fullName.length < 2} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            </>
          ) : (
            <>
              <SectionTitle>Move to another area</SectionTitle>
              <ChoiceChips
                options={areas.map((a) => a.id)}
                value={op.areaId}
                onChange={(id) => move(op, id)}
                labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id}
              />
              <SectionTitle>Societies they cover</SectionTitle>
              <ChoiceChips
                options={societies.filter((sc) => sc.areaId === op.areaId).map((sc) => sc.id)}
                value={null}
                onChange={(id) => toggleSociety(op, id)}
                labelOf={(id) => `${op.societyIds.includes(id) ? "✓ " : ""}${societies.find((sc) => sc.id === id)?.name ?? id}`}
              />
              <View style={styles.buttonRow}>
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Button label="Edit" variant="secondary" onPress={() => startEditing(op)} />
                </View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Button
                    label={op.status === "active" ? "Block" : "Reactivate"}
                    variant="secondary"
                    onPress={() => setStatus(op, op.status === "active" ? "blocked" : "active")}
                  />
                </View>
              </View>
            </>
          )}
        </Card>
      )) : <Empty text={search || areaFilter || statusFilter !== "all" ? "No operators match that filter." : "No operations staff yet."} />}

      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------ societies

function AdminSocietiesScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [open, setOpen] = useState<Society | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", code: "", address: "", areaId: "" });
  const [note, setNote] = useState<string | null>(null);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [supervisors, setSupervisors] = useState<StaffUser[]>([]);
  const [values, setValues] = useState<FilterValues>({ status: filter.status });
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [newAreaId, setNewAreaId] = useState<string | undefined>(undefined);
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
      const [s, a, sup] = await Promise.all([
        api.adminSocieties(token, {
          areaId: values.areaId, supervisorUserId: values.supervisorUserId,
          q: query || undefined, status: values.status,
        }),
        api.adminAreas(token),
        api.adminSupervisors(token),
      ]);
      if (mine !== generation.current) return;
      setSocieties(s.societies); setAreas(a.areas); setSupervisors(sup.supervisors);
    } catch (e) { if (mine === generation.current) setError((e as Error).message); }
    finally { if (mine === generation.current) setBusy(false); }
  }, [token, values.areaId, values.supervisorUserId, values.status, query]);
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
      setName(""); setCode(""); setAddress(""); setNewAreaId(undefined); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggle = async (society: Society) => {
    setError(null);
    try { await api.adminUpdateSociety(society.id, { status: society.status === "active" ? "inactive" : "active" }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  if (open) {
    return <AdminSocietyDetailScreen token={token} society={open} onBack={() => { setOpen(null); load(); }} />;
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Society management"
        subtitle="Every society, across every area"
        right={<Button label={creating ? "Close" : "New society"} variant="secondary" onPress={() => setCreating(!creating)} />}
      />
      {creating ? (
        <Card>
          <FieldRow>
            <Field label="Society name" value={name} onChangeText={setName} width="wide" />
            <Field label="Society code" value={code} onChangeText={setCode} width="small" />
          </FieldRow>
          <Field label="Address" value={address} onChangeText={setAddress} />
          <Dropdown
            label="Area"
            value={newAreaId}
            allLabel="Choose an area"
            options={areas.map((a) => ({ value: a.id, label: a.name }))}
            onChange={setNewAreaId}
          />
          <Button label="Create society" onPress={create} disabled={name.length < 2 || code.length < 2} />
        </Card>
      ) : null}

      {/* Filters above the list, as fields rather than as rows of buttons: they
          narrow, they combine, and one control puts them all back. */}
      <FilterRow
        specs={[
          { key: "areaId", label: "Area", allLabel: "All areas", options: areas.map((a) => ({ value: a.id, label: a.name })) },
          {
            key: "supervisorUserId", label: "Supervisor", allLabel: "All supervisors",
            options: supervisors.map((sup) => ({ value: sup.id, label: sup.fullName ?? sup.phone })),
          },
          {
            key: "status", label: "Status", allLabel: "All statuses",
            options: [
              { value: "active", label: "Active" },
              { value: "coming_soon", label: "Coming soon" },
              { value: "inactive", label: "Inactive" },
            ],
          },
        ]}
        values={values}
        onChange={setValues}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name or code"
      />
      {search && search !== query ? <Text style={styles.meta}>Searching…</Text> : null}
      <Text style={styles.meta}>{societies.length} shown</Text>

      {/* Two or three across rather than one per screen width, and the card itself
          is the way into the society: an Open button beside a card that is already
          showing everything is a button that says nothing. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {societies.map((s) => (
          <Card key={s.id} onPress={editing === s.id ? undefined : () => setOpen(s)}>
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>{s.name}</Text>
              <Pill text={titleCase(s.status)} color={s.status === "active" ? theme.success : theme.muted} />
            </View>
            <Text style={styles.meta}>{s.code}</Text>
            <Row label="Address" value={s.address} />
            <Row label="Area" value={s.areaName} />
            <Row label="Supervisor" value={s.supervisorName ?? "Unassigned"} />
            <Row label="Residents" value={s.residentCount ?? 0} />
            <Row label="Operations staff" value={s.operationsStaffCount ?? 0} />
            <Row label="Orders" value={s.orderCount ?? 0} />
            <Row label="Available slots" value={s.availableSlots ?? 0} />
            {editing === s.id ? (
              <>
                <SectionTitle>Edit society</SectionTitle>
                <FieldRow>
                  <Field label="Society name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} width="wide" />
                  <Field label="Society code" value={draft.code} onChangeText={(v) => setDraft({ ...draft, code: v })} width="small" />
                </FieldRow>
                <Field label="Address" value={draft.address} onChangeText={(v) => setDraft({ ...draft, address: v })} />
                {/* Moving a society between areas moves who is responsible for it. */}
                <Dropdown
                  label="Area"
                  value={draft.areaId || undefined}
                  allLabel="Choose an area"
                  options={areas.map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(id) => setDraft({ ...draft, areaId: id ?? "" })}
                />
                <View style={styles.buttonRow}>
                  <View style={{ flex: 1, marginRight: 6 }}>
                    <Button label="Save" onPress={saveEdit} disabled={draft.name.length < 2 || draft.code.length < 2} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 6 }}>
                    <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.buttonRow}>
                <View style={{ flex: 1, marginRight: 6 }}><Button label="Edit" variant="secondary" onPress={() => startEditing(s)} /></View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Button label={s.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={() => toggle(s)} />
                </View>
              </View>
            )}
          </Card>
        ))}
      </CardGrid>
      {!busy && !societies.length ? <Empty text={search ? "No societies match that search." : "No societies yet."} /> : null}
      {societies.length ? <Text style={styles.meta}>Tap a society to open its details and assignments.</Text> : null}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// A society, and who answers for it. Reached by tapping the card rather than by a
// separate Open button beside a card that is already showing everything.
function AdminSocietyDetailScreen({ token, society, onBack }: {
  token: string; society: Society; onBack: () => void;
}) {
  return (
    <Screen>
      <BackLink label="Societies" onPress={onBack} />
      <PageTitle title={society.name} subtitle={`${society.code} · ${society.address ?? society.city}`} />
      <Card>
        <View style={styles.headRow}>
          <Text style={styles.title}>{society.name}</Text>
          <Pill text={titleCase(society.status)} color={society.status === "active" ? theme.success : theme.muted} />
        </View>
        <Row label="Area" value={society.areaName} />
        <Row label="Residents" value={society.residentCount ?? 0} />
        <Row label="Operations staff" value={society.operationsStaffCount ?? 0} />
        <Row label="Orders" value={society.orderCount ?? 0} />
        <Row label="Active orders" value={society.activeOrderCount ?? 0} />
        <Row label="Available slots" value={society.availableSlots ?? 0} />
      </Card>
      <AssignmentPanel
        source={adminAssignmentApi(society.id, token)}
        title="Supervisor, blocks and operators"
        subtitle="One supervisor runs the society; operators are assigned to its blocks."
      />
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
      {/* Admin accounts are not managed from this page, so the filter does not
          offer a role the list will never usefully show. */}
      <ChoiceChips options={["supervisor", "operator", "resident"]} value={role} onChange={(next) => setRole(next === role ? null : next)} labelOf={titleCase} />
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

const FREQUENCY_LABELS: Record<string, string> = {
  one_time: "One time", daily: "Daily", alternate_days: "Alternate days",
  twice_weekly: "Twice a week", weekly: "Weekly", custom: "Custom",
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Twice a week on Tue and Fri", rather than a key and a list of numbers.
function describeFrequency(frequency: string, days: number[]): string {
  const label = FREQUENCY_LABELS[frequency] ?? frequency;
  return days.length ? `${label} on ${days.map((d) => DAY_NAMES[d]).join(" and ")}` : label;
}

function PlansScreen({ token }: { token: string }) {
  const [plans, setPlans] = useState<PlanUsage[]>([]);
  const [creating, setCreating] = useState(false);
  // Deactivating a plan is confirmed rather than done on one tap: residents are on
  // these, and turning one off is not the same weight of act as renaming it.
  const [deactivating, setDeactivating] = useState<PlanUsage | null>(null);
  // The plan currently open in the wizard for editing. Editing used to be a smaller
  // form that could not touch a plan's services at all, so a plan built with
  // per-service allowances could never have them changed.
  const [editing, setEditing] = useState<PlanUsage | null>(null);
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

  const toggle = async (plan: PlanUsage) => {
    setError(null); setDeactivating(null);
    try {
      const result = await api.adminUpdatePlan(plan.id, { isActive: !plan.isActive }, token);
      setNote(plan.isActive
        ? `${plan.tier} deactivated. ${result.activeSubscriptions} active subscription${result.activeSubscriptions === 1 ? "" : "s"} are on it.`
        : `${plan.tier} is active again.`);
      await load();
    }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Subscription plans" subtitle="Global plan configuration" right={<Button label={creating ? "Close" : "New plan"} variant="secondary" onPress={() => setCreating(!creating)} />} />
      {creating ? (
        <PlanWizard
          token={token}
          catalogue={servicesCatalogue}
          onCancel={() => setCreating(false)}
          onCreated={async (message) => { setCreating(false); setNote(message); await load(); }}
        />
      ) : null}
      {plans.map((plan) => (
        <Card key={plan.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{plan.tier}</Text>
            <Pill text={plan.isActive ? "Active" : "Inactive"} color={plan.isActive ? theme.success : theme.muted} />
          </View>
          <Row label="Price" value={`${rupees(plan.monthlyPaise)} / ${plan.validity === "annual" ? "year" : "month"}`} />
          <Row label="Turnaround" value={`${plan.turnaroundHours} hours`} />
          {plan.services?.length ? (
            <>
              <SectionTitle>What it includes</SectionTitle>
              {plan.services.map((rule) => (
                <Row
                  key={rule.serviceId}
                  label={rule.serviceName}
                  value={[
                    formatQuantity(rule.unit, rule.includedQuantity),
                    describeFrequency(rule.frequency, rule.frequencyDays),
                    rule.additionalUsage === "block"
                      ? "no extra"
                      : `extra ${rupees(rule.additionalRatePaise)} ${perUnitLabel(rule.unit)}`,
                  ].filter(Boolean).join(" · ")}
                />
              ))}
            </>
          ) : (
            // A plan written before per-service allowances existed still reads.
            <Row label="Garment allowance" value={plan.garmentCap} />
          )}
          <Row label="Active subscribers" value={plan.activeSubscribers} />
          <Row label="Garments used" value={plan.garmentsUsed} />
          <Row label="Plan revenue" value={rupees(plan.revenuePaise)} />
          {/* Only for a plan that has no per-service rules to show instead. With
              them, "what it includes" above already says it, in more detail. */}
          {plan.services?.length ? null : (
            <Row
              label="Services included"
              value={plan.coveredServiceIds?.length
                ? servicesCatalogue.filter((service) => plan.coveredServiceIds!.includes(service.id)).map((service) => service.name).join(", ") || `${plan.coveredServiceIds.length} services`
                : "None"}
            />
          )}

          {editing?.id === plan.id ? (
            <PlanWizard
              token={token}
              catalogue={servicesCatalogue}
              existing={plan}
              onCancel={() => setEditing(null)}
              onCreated={async (message) => { setEditing(null); setNote(message); await load(); }}
            />
          ) : (
            <View style={styles.buttonRow}>
              <Button label="Edit" variant="secondary" onPress={() => { setNote(null); setError(null); setEditing(plan); }} />
              <Button
                label={plan.isActive ? "Deactivate" : "Activate"}
                variant="secondary"
                onPress={() => (plan.isActive ? setDeactivating(plan) : toggle(plan))}
              />
            </View>
          )}
        </Card>
      ))}
      {note ? <Notice tone="good" text={note} /> : null}
      <ConfirmDialog
        visible={Boolean(deactivating)}
        title={`Deactivate ${deactivating?.tier ?? ""}?`}
        message={deactivating?.activeSubscribers
          ? `${deactivating.activeSubscribers} resident${deactivating.activeSubscribers === 1 ? " is" : "s are"} on this plan. Deactivating it stops anybody else taking it out.`
          : "Nobody is on this plan. Deactivating it stops it being offered."}
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => deactivating && toggle(deactivating)}
        onCancel={() => setDeactivating(null)}
      />
      <ErrorText error={error} />
    </Screen>
  );
}

// ---------------------------------------------------------------------- slots

function AdminSlotsScreen({ token }: { token: string }) {
  const [slots, setSlots] = useState<MonitoredSlot[]>([]);
  const [summary, setSummary] = useState<SlotSummary | null>(null);
  const [options, setOptions] = useState<{ shifts: string[]; statuses: string[]; bookingStatuses: string[]; utilisationBands: string[] }>({
    shifts: [], statuses: [], bookingStatuses: [], utilisationBands: [],
  });
  const [areas, setAreas] = useState<Area[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [operators, setOperators] = useState<StaffUser[]>([]);
  const [supervisors, setSupervisors] = useState<StaffUser[]>([]);

  const [areaId, setAreaId] = useState<string | null>(null);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [supervisorUserId, setSupervisorUserId] = useState<string | null>(null);
  const [operatorUserId, setOperatorUserId] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [shift, setShift] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [utilisation, setUtilisation] = useState<string | null>(null);
  const [includePast, setIncludePast] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newSocietyId, setNewSocietyId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState<string | null>(todayIso());
  const [newWindow, setNewWindow] = useState("Morning");
  // Fixed hours, sent by the backend. Nobody types a time here either.
  const [slotWindows, setSlotWindows] = useState<SlotWindows>(DEFAULT_SLOT_WINDOWS);
  const [newCapacity, setNewCapacity] = useState("20");
  const [editing, setEditing] = useState<string | null>(null);
  const [editCapacity, setEditCapacity] = useState("");

  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [monitor, areaRes, societyRes, staffRes, supRes] = await Promise.all([
        api.adminSlots(token, {
          areaId: areaId ?? undefined, societyId: societyId ?? undefined,
          supervisorUserId: supervisorUserId ?? undefined, operatorUserId: operatorUserId ?? undefined,
          from: from ?? undefined, to: to ?? undefined,
          shift: shift ?? undefined, status: status ?? undefined,
          bookingStatus: bookingStatus ?? undefined, utilisation: utilisation ?? undefined,
          includePast: includePast || undefined,
        }),
        api.adminAreas(token),
        api.adminSocieties(token),
        api.adminOperators(token),
        api.adminSupervisors(token),
      ]);
      setSlots(monitor.slots);
      if (monitor.slotWindows) setSlotWindows(monitor.slotWindows);
      setSummary(monitor.summary);
      setOptions({
        shifts: monitor.shifts, statuses: monitor.statuses,
        bookingStatuses: monitor.bookingStatuses, utilisationBands: monitor.utilisationBands,
      });
      setAreas(areaRes.areas);
      setSocieties(societyRes.societies);
      setOperators(staffRes.operators);
      setSupervisors(supRes.supervisors);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, areaId, societyId, supervisorUserId, operatorUserId, from, to, shift, status, bookingStatus, utilisation, includePast]);
  useEffect(() => { load(); }, [load]);

  const clearFilters = () => {
    setAreaId(null); setSocietyId(null); setSupervisorUserId(null); setOperatorUserId(null);
    setFrom(null); setTo(null); setShift(null); setStatus(null);
    setBookingStatus(null); setUtilisation(null); setIncludePast(false);
  };

  const create = async () => {
    if (!newSocietyId || !newDate) { setError("Choose a society and a date."); return; }
    setError(null); setNote(null);
    try {
      await api.adminCreateSlot({
        societyId: newSocietyId, date: newDate, window: newWindow, capacityTotal: Number(newCapacity),
      }, token);
      setNote("Slot created."); setCreating(false);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const saveCapacity = async (slot: MonitoredSlot) => {
    setError(null); setNote(null);
    try {
      await api.adminUpdateSlot(slot.id, { capacityTotal: Number(editCapacity) }, token);
      setNote("Capacity updated."); setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const cancel = async (slot: MonitoredSlot) => {
    setError(null); setNote(null);
    try {
      const result = await api.adminCancelSlot(slot.id, token);
      setNote(result.cancelledPickups
        ? `Slot cancelled. ${result.cancelledPickups} booking${result.cancelledPickups === 1 ? " was" : "s were"} cancelled and those residents have been told.`
        : "Slot cancelled.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  // Choosing an area narrows the societies and the staff to that area.
  const visibleSocieties = societies.filter((sc) => !areaId || sc.areaId === areaId);
  const visibleSupervisors = supervisors.filter((sp) => !areaId || sp.areaId === areaId);
  const visibleOperators = operators.filter((op) => {
    if (areaId && op.areaId !== areaId) return false;
    if (societyId && !op.societyIds.includes(societyId)) return false;
    return true;
  });

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Slot monitoring"
        subtitle="Capacity, demand and utilisation across every area"
        right={<Button label={creating ? "Close" : "New slot"} variant="secondary" onPress={() => setCreating(!creating)} />}
      />

      {creating ? (
        <Card>
          <SectionTitle>New pickup slot</SectionTitle>
          <Text style={styles.meta}>Society</Text>
          <ChoiceChips
            options={societies.map((sc) => sc.id)}
            value={newSocietyId}
            onChange={setNewSocietyId}
            labelOf={(id) => societies.find((sc) => sc.id === id)?.name ?? id}
          />
          {/* A slot on a day that has gone can never be worked, so it cannot be
              created either. The backend refuses it too. */}
          <DateField label="Date" value={newDate} onChange={setNewDate} minDate={todayIso()} clearable={false} />
          <SlotWindowPicker windows={slotWindows} value={newWindow} onChange={setNewWindow} />
          <Field label="Capacity" value={newCapacity} onChangeText={setNewCapacity} keyboardType="number-pad" />
          <Button label="Create slot" onPress={create} disabled={!newSocietyId || !newDate} />
        </Card>
      ) : null}

      <SectionTitle>Summary</SectionTitle>
      <StatGrid>
        <Stat label="Total slots" value={summary?.totalSlots ?? 0} />
        <Stat label="Open" value={summary?.openSlots ?? 0} tone="good" />
        <Stat label="Full" value={summary?.fullSlots ?? 0} tone="warn" />
        <Stat label="Capacity" value={summary?.totalCapacity ?? 0} />
        <Stat label="Booked" value={summary?.totalBookings ?? 0} />
        <Stat label="Utilisation" value={`${summary?.utilisationPercent ?? 0}%`} />
      </StatGrid>

      <SectionTitle>Filter</SectionTitle>
      <Text style={styles.meta}>Area</Text>
      <ChoiceChips
        options={areas.map((a) => a.id)}
        value={areaId}
        onChange={(id) => { setAreaId(id === areaId ? null : id); setSocietyId(null); setSupervisorUserId(null); setOperatorUserId(null); }}
        labelOf={(id) => areas.find((a) => a.id === id)?.name ?? id}
      />
      <Text style={styles.meta}>Society</Text>
      <ChoiceChips
        options={visibleSocieties.map((sc) => sc.id)}
        value={societyId}
        onChange={(id) => { setSocietyId(id === societyId ? null : id); setOperatorUserId(null); }}
        labelOf={(id) => visibleSocieties.find((sc) => sc.id === id)?.name ?? id}
      />
      <Text style={styles.meta}>Supervisor</Text>
      <ChoiceChips
        options={visibleSupervisors.map((sp) => sp.id)}
        value={supervisorUserId}
        onChange={(id) => setSupervisorUserId(id === supervisorUserId ? null : id)}
        labelOf={(id) => visibleSupervisors.find((sp) => sp.id === id)?.fullName ?? id}
      />
      <Text style={styles.meta}>Operator</Text>
      <ChoiceChips
        options={visibleOperators.map((op) => op.id)}
        value={operatorUserId}
        onChange={(id) => setOperatorUserId(id === operatorUserId ? null : id)}
        labelOf={(id) => visibleOperators.find((op) => op.id === id)?.fullName ?? id}
      />
      <DateField label="From" value={from} onChange={setFrom} placeholder="Any date" />
      <DateField label="To" value={to} onChange={setTo} placeholder="Any date" minDate={from ?? undefined} />
      <Text style={styles.meta}>Shift</Text>
      <ChoiceChips options={options.shifts} value={shift} onChange={(v) => setShift(v === shift ? null : v)} />
      <Text style={styles.meta}>Slot status</Text>
      <ChoiceChips options={options.statuses} value={status} onChange={(v) => setStatus(v === status ? null : v)} labelOf={titleCase} />
      <Text style={styles.meta}>Booking status</Text>
      <ChoiceChips options={options.bookingStatuses} value={bookingStatus} onChange={(v) => setBookingStatus(v === bookingStatus ? null : v)} labelOf={titleCase} />
      <Text style={styles.meta}>Utilisation</Text>
      <ChoiceChips options={options.utilisationBands} value={utilisation} onChange={(v) => setUtilisation(v === utilisation ? null : v)} labelOf={(b) => (b === "100" ? "Fully utilised" : `${b}%`)} />
      <Button label={includePast ? "Hide days that have passed" : "Include days that have passed"} variant="secondary" onPress={() => setIncludePast(!includePast)} />
      <Button label="Clear filters" variant="secondary" onPress={clearFilters} />

      <View style={{ height: 8 }} />
      {slots.length ? slots.map((slot) => (
        <Card key={slot.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{shortDate(slot.date)} · {to12Hour(slot.startTime)} – {to12Hour(slot.endTime)}</Text>
            <Pill text={titleCase(slot.status)} color={slotStatusColour(slot.status)} />
          </View>
          <Text style={styles.meta}>{[slot.societyName, slot.areaName, slot.shift].filter(Boolean).join(" · ")}</Text>
          <Row label="Capacity" value={slot.capacityTotal} />
          <Row label="Booked" value={slot.bookedCount} />
          <Row label="Available" value={slot.availableCount} />
          <Row label="Utilisation" value={`${slot.utilisationPercent}%`} />
          <Meter percent={slot.utilisationPercent} />
          <Row label="Booking status" value={titleCase(slot.bookingStatus)} />
          <Row label="Supervisor" value={slot.supervisorName ?? "None assigned"} />
          <Row label="Operator" value={slot.operatorName ?? "Nobody covering"} />

          {slot.readOnly ? (
            <Notice text="This day has passed, so the slot is a record rather than something to change." />
          ) : editing === slot.id ? (
            <>
              <Field label="Capacity" value={editCapacity} onChangeText={setEditCapacity} keyboardType="number-pad" />
              <Button label="Save capacity" onPress={() => saveCapacity(slot)} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
            </>
          ) : slot.status !== "cancelled" ? (
            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Button label="Change capacity" variant="secondary" onPress={() => { setEditing(slot.id); setEditCapacity(String(slot.capacityTotal)); }} />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                {/* Cancelled, never deleted: the bookings inside it have to be
                    cancelled too and those residents told. */}
                <Button label="Cancel slot" variant="danger" onPress={() => cancel(slot)} />
              </View>
            </View>
          ) : null}
        </Card>
      )) : <Empty text="No slots match those filters." />}

      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

function slotStatusColour(status: string): string {
  if (status === "full") return theme.amber;
  if (status === "cancelled") return theme.muted;
  if (status === "closed") return theme.border;
  return theme.success;
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
        options={[
          "open", "in_progress", "waiting_resident", "waiting_operator",
          "escalated_supervisor", "escalated_admin", "resolved", "closed",
        ]}
        value={status}
        onChange={(next) => setStatus(next === status ? null : next)}
        labelOf={(key) => ISSUE_STATUS_LABEL[key as IssueStatus] ?? titleCase(key)}
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
  // The conversation as this person sees it: who may speak, who a reply is addressed
  // to, and what has been read. Answered by the backend rather than worked out here.
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [detail, thread] = await Promise.all([
        api.adminIssue(issueId, token),
        api.issueConversation(issueId, token),
      ]);
      setIssue(detail.issue);
      setConversation(thread.conversation);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [issueId, token]);
  useEffect(() => { load(); }, [load]);

  if (busy && !issue) return <Loading />;
  if (!issue) return <Screen><BackLink label="Tickets" onPress={onBack} /><ErrorText error={error} /></Screen>;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Tickets" onPress={onBack} />
      <TicketDetail issue={issue} audience="staff" conversation={conversation}>
        {/* One conversation section rather than a Reply block and a separate Actions
            block: communicating about an issue and resolving it belong together, and
            who is being replied to comes from the conversation rather than a label
            written into the screen. */}
        <ReplyBox
          conversation={conversation}
          onSend={async (body) => {
            try {
              const r = await api.adminReplyToIssue(issue.id, body, token);
              setIssue(r.issue); setNote("Reply sent."); await load(); await onChanged();
            } catch (e) { setError((e as Error).message); }
          }}
        />
        {issue.status !== "closed" && issue.status !== "resolved" ? (
          <ResolveBox
            onResolve={async (resolution) => {
              try {
                const r = await api.adminSetIssueStatus(issue.id, "resolved", resolution, token);
                setIssue(r.issue); setNote("Resolved."); await load(); await onChanged();
              } catch (e) { setError((e as Error).message); }
            }}
            onClose={async () => {
              try {
                const r = await api.adminSetIssueStatus(issue.id, "closed", "Closed by admin", token);
                setIssue(r.issue); setNote("Closed."); await load(); await onChanged();
              } catch (e) { setError((e as Error).message); }
            }}
          />
        ) : null}
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
        labelOf={(key) => ISSUE_STATUS_LABEL[key as IssueStatus] ?? titleCase(key)}
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
  const [data, setData] = useState<RevenueReport | null>(null);
  // A preset covers the common questions in one tap; custom opens the two pickers.
  const [preset, setPreset] = useState<string>("this_month");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [supervisorUserId, setSupervisorUserId] = useState<string | null>(null);
  const [operatorUserId, setOperatorUserId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<"area" | "society" | "supervisor" | "operator" | "plan">("area");
  const [showCharged, setShowCharged] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      setData(await api.adminRevenue(token, {
        preset: preset === "custom" ? undefined : preset,
        from: preset === "custom" ? from ?? undefined : undefined,
        to: preset === "custom" ? to ?? undefined : undefined,
        areaId: areaId ?? undefined,
        societyId: societyId ?? undefined,
        supervisorUserId: supervisorUserId ?? undefined,
        operatorUserId: operatorUserId ?? undefined,
        paymentStatus: paymentStatus ?? undefined,
      }));
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, preset, from, to, areaId, societyId, supervisorUserId, operatorUserId, paymentStatus]);
  useEffect(() => { load(); }, [load]);

  const clearFilters = () => {
    setPreset("this_month"); setFrom(null); setTo(null);
    setAreaId(null); setSocietyId(null); setSupervisorUserId(null); setOperatorUserId(null); setPaymentStatus(null);
  };

  const filters = data?.filters;
  // Choosing an area narrows the societies to that area, so the two cannot
  // contradict each other.
  const societies = (filters?.societies ?? []).filter((sc) => !areaId || sc.areaId === areaId);
  const supervisors = (filters?.supervisors ?? []).filter((sp) => !areaId || sp.areaId === areaId);
  const operators = (filters?.operators ?? []).filter((op) => {
    if (areaId && op.areaId !== areaId) return false;
    if (societyId && !op.societyIds.includes(societyId)) return false;
    return true;
  });

  const buckets: Record<typeof tab, RevenueBucket[]> = {
    area: data?.byArea ?? [],
    society: data?.bySociety ?? [],
    supervisor: data?.bySupervisor ?? [],
    operator: data?.byOperator ?? [],
    plan: data?.byPlan ?? [],
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Revenue" subtitle={data ? `${data.range.label}${data.range.from ? ` · ${shortDate(data.range.from)} to ${shortDate(data.range.to)}` : ""}` : "Where the money came from, not just the total"} />

      <SectionTitle>Date range</SectionTitle>
      <ChoiceChips
        options={(data?.presets ?? DATE_PRESETS).map((p) => p.value) as string[]}
        value={preset}
        onChange={setPreset}
        labelOf={(v) => (data?.presets ?? DATE_PRESETS).find((p) => p.value === v)?.label ?? v}
      />
      {preset === "custom" ? (
        <>
          <DateField label="From" value={from} onChange={setFrom} placeholder="Select start date" />
          <DateField label="To" value={to} onChange={setTo} placeholder="Select end date" minDate={from ?? undefined} />
          {from && to && to < from ? <Notice text="The end date is before the start date." /> : null}
        </>
      ) : null}

      <SectionTitle>Filter by</SectionTitle>
      <Text style={styles.meta}>Area</Text>
      <ChoiceChips
        options={(filters?.areas ?? []).map((a) => a.id)}
        value={areaId}
        onChange={(id) => { setAreaId(id === areaId ? null : id); setSocietyId(null); setSupervisorUserId(null); setOperatorUserId(null); }}
        labelOf={(id) => filters?.areas.find((a) => a.id === id)?.name ?? id}
      />
      <Text style={styles.meta}>Society</Text>
      <ChoiceChips
        options={societies.map((sc) => sc.id)}
        value={societyId}
        onChange={(id) => { setSocietyId(id === societyId ? null : id); setOperatorUserId(null); }}
        labelOf={(id) => societies.find((sc) => sc.id === id)?.name ?? id}
      />
      <Text style={styles.meta}>Supervisor</Text>
      <ChoiceChips
        options={supervisors.map((sp) => sp.id)}
        value={supervisorUserId}
        onChange={(id) => setSupervisorUserId(id === supervisorUserId ? null : id)}
        labelOf={(id) => supervisors.find((sp) => sp.id === id)?.name ?? id}
      />
      <Text style={styles.meta}>Operator</Text>
      <ChoiceChips
        options={operators.map((op) => op.id)}
        value={operatorUserId}
        onChange={(id) => setOperatorUserId(id === operatorUserId ? null : id)}
        labelOf={(id) => operators.find((op) => op.id === id)?.name ?? id}
      />
      <Text style={styles.meta}>Payment status</Text>
      <ChoiceChips
        options={data?.paymentStatuses ?? []}
        value={paymentStatus}
        onChange={(v) => setPaymentStatus(v === paymentStatus ? null : v)}
        labelOf={titleCase}
      />
      <Button label="Clear filters" variant="secondary" onPress={clearFilters} />

      <SectionTitle>Summary</SectionTitle>
      {/* The headline figures as cards, so the page reads at a glance. */}
      <StatGrid>
        <Stat label="Total revenue" value={rupees(data?.summary.totalRevenuePaise ?? 0)} tone="good" />
        <Stat label="Subscriptions" value={rupees(data?.summary.subscriptionRevenuePaise ?? 0)} />
        <Stat label="Order revenue" value={rupees(data?.summary.orderRevenuePaise ?? 0)} />
        <Stat label="Pending" value={rupees(data?.summary.pendingPaise ?? 0)} tone="warn" onPress={() => setShowPending(true)} />
        <Stat label="Refunded" value={rupees(data?.summary.refundedPaise ?? 0)} />
        <Stat label="Net revenue" value={rupees(data?.summary.netRevenuePaise ?? 0)} tone="good" />
      </StatGrid>
      {data?.summary.narrowed ? (
        <Notice text="Subscription fees are not earned by one area or one person, so they are left out while a location or staff filter is applied." />
      ) : null}

      <SectionTitle>Breakdown</SectionTitle>
      <Tabs
        options={[
          { key: "area", label: "Area" },
          { key: "society", label: "Society" },
          { key: "supervisor", label: "Supervisor" },
          { key: "operator", label: "Operator" },
          { key: "plan", label: "Plan" },
        ]}
        value={tab}
        onChange={(k) => setTab(k)}
      />
      {buckets[tab].length ? buckets[tab].map((row) => (
        <Card key={row.id ?? row.name}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{row.name}</Text>
            <Text style={styles.amount}>{rupees(row.revenuePaise)}</Text>
          </View>
          {tab === "plan" ? (
            <Row label="Active subscribers" value={row.activeSubscribers ?? 0} />
          ) : (
            <>
              <Row label="Orders" value={row.orders} />
              <Row label="Delivered" value={row.completedOrders} />
              <Row label="Cancelled" value={row.cancelledOrders} />
              <Row label="Garment charges" value={rupees(row.garmentChargePaise)} />
              <Row label="Service charges" value={rupees(row.servicesPaise)} />
            </>
          )}
        </Card>
      )) : <Empty text="Nothing in this period." />}

      <SectionTitle>Charged orders ({data?.chargedOrders.length ?? 0})</SectionTitle>
      <Button label={showCharged ? "Hide" : "Show charged orders"} variant="secondary" onPress={() => setShowCharged(!showCharged)} />
      {showCharged ? <ChargedOrderList rows={data?.chargedOrders ?? []} onOpen={onOpenOrder} emptyText="No charged orders in this period." /> : null}

      <SectionTitle>Still to collect ({rupees(data?.summary.pendingPaise ?? 0)})</SectionTitle>
      <Button label={showPending ? "Hide" : "Show pending charges"} variant="secondary" onPress={() => setShowPending(!showPending)} />
      {showPending ? <ChargedOrderList rows={data?.pendingCharges ?? []} onOpen={onOpenOrder} emptyText="Nothing outstanding." /> : null}

      <ErrorText error={error} />
    </Screen>
  );
}

// One charged order with everybody and everywhere behind it, which is what makes
// the number in the summary explainable rather than merely stated.
function ChargedOrderList({ rows, onOpen, emptyText }: { rows: ChargedOrderRow[]; onOpen: (id: string) => void; emptyText: string }) {
  if (!rows.length) return <Empty text={emptyText} />;
  return (
    <>
      {rows.map((row) => (
        <Card key={row.id} onPress={() => onOpen(row.id)}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{row.orderCode}</Text>
            <Text style={styles.amount}>{rupees(row.totalPaise)}</Text>
          </View>
          <Text style={styles.meta}>
            {[row.residentName, row.unitNumber, row.societyName, row.areaName].filter(Boolean).join(" · ")}
          </Text>
          <Row label="Supervisor" value={row.supervisorName ?? "None"} />
          <Row label="Operator" value={row.operatorName ?? "Unassigned"} />
          <Row label="Garments" value={row.acceptedCount ?? "-"} />
          <Row label="Service charges" value={rupees(row.servicesPaise)} />
          <Row label="Additional charges" value={rupees(row.additionalChargePaise)} />
          <Row label="Order status" value={stateLabel[row.state] ?? titleCase(row.state)} />
          <Row label="Payment" value={titleCase(row.paymentStatus)} />
          <Row label="Date" value={shortDate(row.createdAt)} />
        </Card>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------- audit

// "issue.escalated" is how it is stored; "Issue escalated" is how it reads.
function auditActionLabel(action: string): string {
  return titleCase(action.replace(/[._]/g, " "));
}

// The fields that actually changed, so a reader sees "Status: qc → qc_passed"
// rather than the whole document twice.
function describeChanges(previous: unknown, next: unknown): { field: string; before: string; after: string }[] {
  const before = (previous ?? {}) as Record<string, unknown>;
  const after = (next ?? {}) as Record<string, unknown>;
  if (typeof before !== "object" || typeof after !== "object") return [];
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .map((field) => ({
      field,
      before: readable(before[field]),
      after: readable(after[field]),
    }))
    .filter((c) => c.before !== c.after)
    .slice(0, 6);
}

function readable(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "none";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "object") return truncate(JSON.stringify(value), 40);
  return String(value);
}

function AuditScreen({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [resource, setResource] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [page, setPage] = useState<PageInfo>({ total: 0, limit: 25, offset: 0, hasMore: false });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Paged, because this table grows forever and the screen only shows a few rows.
  const load = useCallback(async (offset = 0) => {
    setBusy(true); setError(null);
    try {
      const result = await api.adminAudit(token, {
        resource: resource ?? undefined,
        role: roleFilter,
        action: actionFilter,
        q: search.trim() || undefined,
        limit: 25, offset,
      });
      setEntries(result.entries);
      if (result.page) setPage(result.page);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, resource, roleFilter, actionFilter, search]);
  useEffect(() => { load(0); }, [token, resource, roleFilter, actionFilter]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Audit and activity log" subtitle="Every important change, with before and after" />
      <Dropdown
        label="Resource"
        value={resource ?? undefined}
        options={["area", "user", "society", "slot", "order", "plan", "issue", "service_request", "offering", "schedule", "system_config"]
          .map((r) => ({ value: r, label: titleCase(r.replace("_", " ")) }))}
        onChange={(next) => setResource(next ?? null)}
        allLabel="Everything"
      />
      <Dropdown
        label="Who"
        value={roleFilter}
        options={["admin", "supervisor", "operator", "resident", "system"].map((r) => ({ value: r, label: titleCase(r) }))}
        onChange={setRoleFilter}
        allLabel="Anybody"
      />
      <Dropdown
        label="What happened"
        value={actionFilter}
        options={["created", "updated", "deleted", "assigned", "resolved", "escalated", "approved", "rejected", "cancelled"]
          .map((a) => ({ value: a, label: titleCase(a) }))}
        onChange={setActionFilter}
        allLabel="Anything"
      />
      <Field label="Search" value={search} onChangeText={setSearch} placeholder="Order, user, resource or actor" />
      <View style={styles.buttonRow}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Button label="Apply" onPress={() => load(0)} />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Button
            label="Reset"
            variant="secondary"
            onPress={() => { setResource(null); setRoleFilter(undefined); setActionFilter(undefined); setSearch(""); setTimeout(() => load(0), 0); }}
          />
        </View>
      </View>

      {entries.length ? entries.map((entry) => (
        <Card key={entry.id} onPress={() => setOpenEntry(openEntry === entry.id ? null : entry.id)}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{auditActionLabel(entry.action)}</Text>
            <Pill text={titleCase(entry.role ?? "system")} color={theme.aqua} />
          </View>
          <Text style={styles.meta}>
            {dateTime(entry.at)} · {entry.actorName ?? entry.actor}
            {entry.resourceId ? ` · ${entry.resourceId.slice(0, 12)}` : ""}
          </Text>

          {/* What actually changed, field by field, rather than two lines of JSON
              that nobody reads. */}
          {describeChanges(entry.previousValue, entry.newValue).map((change) => (
            <View key={change.field} style={styles.changeRow}>
              <Text style={styles.changeField}>{titleCase(change.field)}</Text>
              <Text style={styles.changeValue}>
                <Text style={styles.changeBefore}>{change.before}</Text>
                {"  →  "}
                <Text style={styles.changeAfter}>{change.after}</Text>
              </Text>
            </View>
          ))}

          {openEntry === entry.id ? (
            <>
              <Row label="Actor" value={entry.actorName ?? entry.actor} />
              <Row label="Role" value={titleCase(entry.role ?? "system")} />
              <Row label="Resource" value={entry.resource ? titleCase(entry.resource) : "—"} />
              <Row label="Resource id" value={entry.resourceId} />
              <Row label="Timestamp" value={dateTime(entry.at)} />
              {entry.previousValue ? <Text style={styles.json}>Before: {truncate(JSON.stringify(entry.previousValue))}</Text> : null}
              {entry.newValue ? <Text style={styles.json}>After: {truncate(JSON.stringify(entry.newValue))}</Text> : null}
            </>
          ) : (
            <Text style={styles.meta}>Tap for the full record</Text>
          )}
        </Card>
      )) : <Empty text="No audit entries match." />}
      <Pager page={page} onChange={(offset) => load(offset)} />
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
  // Pay as you go price per garment category, kept apart from anything to do with
  // subscriptions: changing one must never change the other.
  const [garmentPrices, setGarmentPrices] = useState<Record<string, number>>({});
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
      setGarmentPrices(r.config.garmentPricesPaise ?? {});
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
        garmentPricesPaise: garmentPrices,
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

      <SectionTitle>Pay as you go garment prices</SectionTitle>
      <Notice text="What a resident with no plan pays for one garment, before any service charge. These prices are separate from subscriptions: changing them never alters a plan's allowance or what it covers." />
      {(config?.garmentCategories ?? []).map((category) => (
        <Field
          key={category}
          label={category}
          value={garmentPrices[category] != null ? String(garmentPrices[category] / 100) : ""}
          placeholder={`Default ${(config?.nonSubscriberGarmentRatePaise ?? 0) / 100}`}
          keyboardType="number-pad"
          onChangeText={(value) => setGarmentPrices((current) => {
            const next = { ...current };
            if (value.trim() === "") delete next[category];
            else next[category] = Math.max(0, Math.round(Number(value || 0) * 100));
            return next;
          })}
        />
      ))}
      <Field label="Default slot capacity" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
      <Field label="Default turnaround hours" value={turnaround} onChangeText={setTurnaround} keyboardType="number-pad" />
      <Field label="Delay grace hours" value={grace} onChangeText={setGrace} keyboardType="number-pad" />
      <Button label="Save configuration" onPress={save} />

      <SectionTitle>Garment services</SectionTitle>
      <Notice text="A service is priced per garment category, because pressing a saree is not pressing a shirt. Each service also says what physically has to happen to the garment, which is what lets an Iron Only order skip washing." />
      <Card>
        <SectionTitle>Two pricing models</SectionTitle>
        {/* Spelled out, because the whole point is that they are separate. */}
        <Row label="Subscribed resident" value="Included when the plan covers the service, then the additional rate" />
        <Row label="Paying as they go" value="The garment price above, plus the service price below" />
      </Card>

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
            label="Pay as you go price per garment (rupees)"
            value={String(service.unitPricePaise / 100)}
            keyboardType="number-pad"
            onChangeText={(value) => setServices((current) => {
              const next = [...current];
              next[index] = { ...next[index], unitPricePaise: Math.max(0, Math.round(Number(value || 0) * 100)) };
              return next;
            })}
          />
          <Button
            label={expandedService === service.id ? "Hide per garment prices" : "Set a pay as you go price per garment"}
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
  amount: { fontSize: 15, fontWeight: "800", color: theme.deepTeal },
  buttonRow: { flexDirection: "row" },
  json: { fontSize: 10, color: theme.muted, marginTop: 6, fontFamily: "monospace" },
  alertRow: { flexDirection: "row", alignItems: "center" },
  alertDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  alertText: { fontSize: 14, fontWeight: "700", color: theme.deepTeal },
  cardTitle: { fontSize: 15, fontWeight: "800", color: theme.deepTeal, flex: 1 },
  activityRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 6 },
  activityWhat: { fontSize: 13, fontWeight: "700", color: theme.deepTeal },
  activityWho: { fontSize: 11, color: theme.muted, marginTop: 2 },
  activityWhen: { fontSize: 11, color: theme.muted, marginLeft: 10 },
  changeRow: { marginTop: 8 },
  changeField: { fontSize: 11, color: theme.muted, fontWeight: "700", textTransform: "uppercase" },
  changeValue: { fontSize: 13, marginTop: 2 },
  changeBefore: { color: theme.muted, textDecorationLine: "line-through" },
  changeAfter: { color: theme.deepTeal, fontWeight: "700" },
  rowLink: { flexDirection: "row", alignItems: "center" },
  rowLinkAction: { color: theme.aqua, fontSize: 12, fontWeight: "700", marginLeft: 10 },
});
