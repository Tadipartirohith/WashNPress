import { useCallback, useEffect, useRef, useState } from "react";
import { themed } from "../components/themed";
import { AppearanceSetting } from "../components/appearance-setting";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  ConversationView,
  AdminDashboard, SocietyCoverage, AuditEntry, GarmentService, Issue, IssueAnalytics,
  OrderDetail, OrderSummary, PlanUsage, ReportsResponse, Slot, Society, StaffUser, SystemConfig,
  RevenueReport, RevenueBucket, ChargedOrderRow, MonitoredSlot, SlotSummary, PriceList, SlotWindows, IssueStatus, PageInfo, SubscriptionDetail,
} from "../api/types";
import { font, theme, rupees, shortDate, dateTime, titleCase, stateLabel } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Tabs, Empty, ErrorText, Notice,
  Loading, Pill, StatePill, BackLink, Stat, StatGrid, Meter, CardGrid, FieldRow,
  SlotWindowPicker, DEFAULT_SLOT_WINDOWS, to12Hour,
  VerificationTags, VerificationActions,
} from "../components/ui";
import { CenteredModal, WizardFooter } from "../components/modal";
import { RecordCard, CardAction, InlineEditCard, orDash } from "../components/records";
import { SocietyWizard } from "./society-wizard";
import { StaffWizard } from "./staff-wizard";
import { actionsFor, statusLabelFor, type UserAction } from "./user-action-rules";
import { societyEmptyLine } from "./society-filter-rules";
import { AssignmentPanel, adminAssignmentApi } from "./assignment-panel";
import { OrderList, OrderDetailBody, IssueCard } from "../components/order";
import { IssueRow, TicketDetail, ReplyBox, ResolveBox, describeMinutes } from "../components/support";
import { usePolling, useDebounced, POLL } from "../hooks";
import { DateField, DATE_PRESETS, todayIso } from "../components/calendar";
import { PlanWizard } from "./admin-plan-wizard";
import { formatQuantity, perUnitLabel } from "../api/units";
import { ReportTable } from "./SupervisorPortal";
import { AdminServicesScreen } from "./admin-extras";
import { ServiceBookingsScreen } from "./service-bookings";
import { AttentionBand, Pipeline, MetaStrip } from "../components/dashboard";
import { pipelineOf } from "./dashboard-rules";
import { ISSUE_STATUS_LABEL } from "../components/support";
import { Dropdown, FilterRow, Toggle, ConfirmDialog, DataTable, Pager, countActive, type FilterValues } from "../components/filters";

// Approving somebody is part of managing them, not a place of its own. A separate
// Verification page meant an admin who had just created a supervisor had to go
// somewhere else to let them in.
type Tab = "home" | "supervisors" | "operators" | "societies" | "users" | "orders" | "services" | "bookings" | "subscriptions" | "revenue" | "plans" | "slots" | "reports" | "issues" | "audit" | "config";

// Every dashboard metric drills into the matching list with the right filter
// already applied, so the admin never has to search for the same thing twice.
export type DrillFilter = Record<string, string | undefined>;

export function AdminPortal({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DrillFilter>({});

  if (openOrderId) return <AdminOrderScreen token={token} orderId={openOrderId} onBack={() => setOpenOrderId(null)} />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: "home", label: "Dashboard" },
          { key: "supervisors", label: "Supervisors" },
          { key: "operators", label: "Operators" },
          { key: "societies", label: "Societies" },
          { key: "users", label: "Users" },
          { key: "orders", label: "Orders" },
          { key: "services", label: "Services" },
          { key: "bookings", label: "Bookings" },
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
      {tab === "supervisors" && <SupervisorsScreen token={token} filter={filter} onOpenOrder={setOpenOrderId} />}
      {tab === "operators" && <AdminOperatorsScreen token={token} filter={filter} />}
      {tab === "societies" && <AdminSocietiesScreen token={token} filter={filter} />}
      {tab === "users" && <UsersScreen token={token} filter={filter} />}
      {tab === "services" && <AdminServicesScreen token={token} />}
      {/* The catalogue and the bookings made against it are different questions:
          one is what is on offer, the other is who asked for it and who is doing
          it. They were one page, and the second half of it did not exist. */}
      {tab === "bookings" && (
        <AdminServiceBookings token={token} />
      )}
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
  const [coverage, setCoverage] = useState<SocietyCoverage[]>([]);
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


      {/* What needs an admin. The backend's own alerts, plus the exceptions the
          order counts imply, in one band — worst first, and only the ones that are
          actually happening. It used to render nothing at all when there were no
          alerts, which reads as a section that failed to load rather than as a
          platform with nothing wrong. */}
      <SectionTitle>Needs you</SectionTitle>
      <AttentionBand
        scope="the platform"
        onOpen={(item) => {
          if (item.key === "delayed") return onGoto("orders", { delayed: "true" });
          if (item.key === "failedPickups") return onGoto("orders", { state: "pickup_failed" });
          if (item.key === "qcFailed") return onGoto("orders", { state: "qc_hold" });
          if (item.key === "unassignedSupervisors") return onGoto("supervisors", { assigned: "false" });
          if (item.key === "coverage") return onGoto("societies");
          return onGoto(...alertTarget(item.key));
        }}
        items={[
          ...(data?.alerts ?? []).map((alert) => ({
            key: alert.kind,
            label: alert.label,
            count: alert.count,
            tone: alert.severity === "critical" ? ("danger" as const) : ("warn" as const),
          })),
          { key: "delayed", label: "orders running late", count: o?.delayed ?? 0, tone: "danger" as const },
          { key: "failedPickups", label: "pickups failed", count: o?.failedPickups ?? 0, tone: "danger" as const },
          { key: "qcFailed", label: "orders failed quality check", count: o?.qcFailed ?? 0, tone: "warn" as const },
          { key: "unassignedSupervisors", label: "supervisors with no society", count: data?.supervisors.unassigned ?? 0, tone: "warn" as const },
          // The societies this admin is personally covering. This used to be a
          // warning banner of its own directly above the band — so the page could
          // say "4 societies have no active supervisor" and "nothing needs
          // attention" one after the other. One list of what is wrong, not two.
          { key: "coverage", label: `societies with no active supervisor — you are covering ${coverage.length === 1 ? "it" : "them"}`, count: coverage.length, tone: "danger" as const },
        ]}
      />

      {coverage.length ? (
        <Card>
          {coverage.map((c) => (
            <Row
              key={c.societyId}
              label={c.societyName}
              value={c.supervisorName ? `${c.supervisorName} · ${titleCase(c.supervisorStatus ?? "")}` : "No supervisor assigned"}
            />
          ))}
        </Card>
      ) : null}

      <SectionTitle>Network</SectionTitle>
      <StatGrid>
        <Stat label="Total supervisors" value={data?.supervisors.total ?? 0} onPress={() => onGoto("supervisors")} />
        <Stat label="Active supervisors" value={data?.supervisors.active ?? 0} onPress={() => onGoto("supervisors", { status: "active" })} />
        <Stat label="Unassigned supervisors" value={data?.supervisors.unassigned ?? 0} tone="warn" onPress={() => onGoto("supervisors", { assigned: "false" })} />
        <Stat label="Total societies" value={data?.societies.total ?? 0} onPress={() => onGoto("societies")} />
        <Stat label="Active societies" value={data?.societies.active ?? 0} onPress={() => onGoto("societies", { status: "active" })} />
        <Stat label="Total residents" value={data?.residents.total ?? 0} onPress={() => onGoto("users", { role: "resident" })} />
        <Stat label="Operations staff" value={data?.operationsStaff.total ?? 0} onPress={() => onGoto("users", { role: "operator" })} />
        <Stat label="Active operators" value={data?.operationsStaff.active ?? 0} onPress={() => onGoto("operators", { status: "active" })} />
      </StatGrid>

      {/* The order state machine as a flow rather than as fifteen equal squares.
          Every state was a tile of the same size, so "2 failed QC" and "480 total
          orders" had the same weight and the shape of the day was invisible.
          Delayed and failed pickups are not stages of this pipeline — they are
          exceptions, and they are in the band above. */}
      <SectionTitle>Where the work is</SectionTitle>
      <Pipeline
        stages={pipelineOf({
          scheduled: o?.scheduled,
          pickedUp: o?.pickedUp,
          washing: o?.washing,
          ironing: o?.ironing,
          qcPending: o?.qcPending,
          qcFailed: o?.qcFailed,
          readyForDelivery: o?.readyForDelivery,
          outForDelivery: o?.outForDelivery,
        })}
        onOpen={(stage) => onGoto("orders", { state: stage.goto })}
        emptyText="No orders are in progress across the platform."
      />

      {/* The day, and the size of the platform, as reference. */}
      <MetaStrip
        onOpen={() => onGoto("orders")}
        items={[
          { key: "today", label: "orders today", value: o?.today ?? 0 },
          { key: "pickups", label: "pickups today", value: data?.operations?.pickups.today ?? 0 },
          { key: "deliveredToday", label: "delivered today", value: o?.deliveredToday ?? 0 },
          { key: "total", label: "orders all time", value: o?.total ?? 0 },
        ]}
      />

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

      {/* Society by society. Comparing areas averaged five societies into one row
          and hid the one that was struggling behind the four that were not. */}
      <SectionTitle>Society performance</SectionTitle>
      {data?.societyPerformance?.length ? (
        <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
          {data.societyPerformance.map((society) => (
            <RecordCard
              key={society.societyId}
              title={society.name}
              badge={society.delayedOrders || society.openIssues
                ? <Pill text={`${society.delayedOrders + society.openIssues} to watch`} color={theme.danger} />
                : <Pill text="On track" color={theme.success} />}
              onOpen={() => onGoto("societies")}
              fields={[
                { label: "Supervisor", value: orDash(society.supervisorName ?? "Unassigned") },
                { label: "Residents", value: orDash(society.residents) },
                { label: "Operators", value: orDash(society.operators) },
                { label: "Orders", value: `${society.totalOrders} total · ${society.pendingOrders} pending · ${society.deliveredOrders} delivered` },
                { label: "Needs attention", value: `${society.delayedOrders} delayed · ${society.openIssues} open issue${society.openIssues === 1 ? "" : "s"}` },
              ]}
            />
          ))}
        </CardGrid>
      ) : <Empty text="No societies yet." />}

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
    "society.supervisor_assigned": "Supervisor assigned to a society",
    "block.created": "New block created",
    "operator.blocks_assigned": "Operator put on blocks",
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

// ---------------------------------------------------------------- supervisors

function SupervisorsScreen({ token, filter, onOpenOrder }: {
  token: string; filter: DrillFilter; onOpenOrder: (id: string) => void;
}) {
  const [open, setOpen] = useState<StaffUser | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ firstName: "", lastName: "", email: "", societyId: "" });
  const [note, setNote] = useState<string | null>(null);
  const [supervisors, setSupervisors] = useState<StaffUser[]>([]);
  const [societies, setSocieties] = useState<{ id: string; name: string; supervisorUserId: string | null }[]>([]);
  // Status and assignment, and nothing else. The area filter went with areas, and
  // the verification filter went because approval is shown on the card and acted on
  // there: a filter for it was a second way to ask the same question.
  const [values, setValues] = useState<FilterValues>({
    status: filter.status,
    assigned: filter.assigned === "false" ? "unassigned" : undefined,
  });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useDebounced(search, 250);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.adminSupervisors(token, { q: query || undefined });
      setSupervisors(res.supervisors);
      setSocieties(res.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, query]);
  useEffect(() => { load(); }, [load]);

  const shown = supervisors.filter((s) => {
    if (values.status && s.status !== values.status) return false;
    if (values.assigned === "assigned" && !s.societyId) return false;
    if (values.assigned === "unassigned" && s.societyId) return false;
    return true;
  });

  const toggle = async (supervisor: StaffUser) => {
    setError(null);
    try {
      await api.adminUpdateSupervisor(supervisor.id, { status: supervisor.status === "active" ? "blocked" : "active" }, token);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const startEditing = (supervisor: StaffUser) => {
    setError(null); setNote(null);
    setEditing(supervisor.id);
    setDraft({
      firstName: supervisor.firstName ?? "",
      lastName: supervisor.lastName ?? "",
      email: supervisor.email ?? "",
      societyId: supervisor.societyId ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null); setNote(null);
    try {
      await api.adminUpdateSupervisor(editing, {
        firstName: draft.firstName, lastName: draft.lastName,
        email: draft.email || undefined,
        societyId: draft.societyId || undefined,
      }, token);
      setNote("Supervisor saved. The change is recorded in the audit log.");
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  if (open) {
    return (
      <AdminSupervisorDetailScreen
        token={token}
        supervisor={open}
        onBack={() => { setOpen(null); load(); }}
        onOpenOrder={onOpenOrder}
      />
    );
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Supervisor management"
        subtitle="Manage supervisors and their assigned societies"
        right={<Button label="New supervisor" variant="secondary" onPress={() => { setNote(null); setCreating(true); }} />}
      />
      <StaffWizard
        visible={creating}
        role="supervisor"
        token={token}
        societies={societies}
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          setCreating(false);
          setNote(`${created.fullName} created with employee ID ${created.employeeId}.`);
          await load();
        }}
      />

      <FilterRow
        specs={[
          {
            key: "status", label: "Status", allLabel: "Any status",
            options: [{ value: "active", label: "Active" }, { value: "blocked", label: "Deactivated" }],
          },
          {
            key: "assigned", label: "Assignment", allLabel: "Assigned or not",
            options: [
              { value: "assigned", label: "Runs a society" },
              { value: "unassigned", label: "Waiting for one" },
            ],
          },
        ]}
        values={values}
        onChange={setValues}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name or phone"
      />
      <Text style={styles.meta}>{shown.length} of {supervisors.length} shown</Text>

      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {shown.map((s) => (editing === s.id ? (
          <InlineEditCard
            key={s.id}
            title={`Edit ${s.fullName ?? "supervisor"}`}
            onSave={saveEdit}
            onCancel={() => setEditing(null)}
          >
            {/* The phone number is the sign-in identity and the employee ID is
                generated once, so neither is editable here: changing the first
                would lock the person out, and the second identifies them
                everywhere else. */}
            <FieldRow>
              <Field label="First name" value={draft.firstName} onChangeText={(v) => setDraft({ ...draft, firstName: v })} width="medium" />
              <Field label="Last name" value={draft.lastName} onChangeText={(v) => setDraft({ ...draft, lastName: v })} width="medium" />
            </FieldRow>
            <Field label="Email" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} keyboardType="email-address" width="wide" />
            <Row label="Employee ID" value={orDash(s.employeeId)} />
            <Dropdown
              label="Assigned society"
              value={draft.societyId || undefined}
              allLabel="Choose a society"
              options={societies.map((sc) => ({
                value: sc.id,
                label: sc.supervisorUserId && sc.supervisorUserId !== s.id ? `${sc.name} · already run` : sc.name,
              }))}
              onChange={(id) => setDraft({ ...draft, societyId: id ?? "" })}
              width="full"
            />
          </InlineEditCard>
        ) : (
          // Badged with only whether they are active. A supervisor is approved by
          // the admin who creates them, in the same act, so an "Approved" badge
          // beside "Active" was two badges saying one thing — and the one it
          // repeated was never anything but yes.
          <RecordCard
            key={s.id}
            title={s.fullName ?? s.phone}
            badge={<VerificationTags active={s.status === "active"} />}
            onOpen={() => setOpen(s)}
            fields={[
              { label: "Phone", value: orDash(s.phone) },
              { label: "Email", value: orDash(s.email) },
              { label: "Employee ID", value: orDash(s.employeeId) },
              { label: "Assigned society", value: orDash(s.societyName ?? "Waiting for one") },
              { label: "Operations users", value: orDash(s.operationsUserCount ?? 0) },
              { label: "Created", value: orDash(shortDate(s.createdAt)) },
              { label: "Last login", value: orDash(dateTime(s.lastLoginAt)) },
            ]}
            actions={(
              <>
                <CardAction label="Edit" onPress={() => startEditing(s)} />
                <CardAction
                  label={s.status === "active" ? "Deactivate" : "Activate"}
                  tone={s.status === "active" ? "danger" : "good"}
                  onPress={() => toggle(s)}
                />
              </>
            )}
          />
        )))}
      </CardGrid>
      {!busy && !shown.length ? <Empty text="No supervisors match those filters." /> : null}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// A supervisor, and everything they answer for. Reached by tapping their card,
// which is the only way in: an Open button beside a card already showing what it
// knows is a button that says nothing.
function AdminSupervisorDetailScreen({ token, supervisor, onBack, onOpenOrder }: {
  token: string; supervisor: StaffUser; onBack: () => void; onOpenOrder: (id: string) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminSupervisor>> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.adminSupervisor(supervisor.id, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, supervisor.id]);
  useEffect(() => { load(); }, [load]);

  const person = data?.supervisor ?? supervisor;
  return (
    <Screen refreshing={busy} onRefresh={load}>
      <BackLink label="Supervisors" onPress={onBack} />
      <PageTitle title={person.fullName ?? person.phone} subtitle={person.societyName ?? "No society assigned"} />
      <ErrorText error={error} />
      <Card>
        <View style={styles.headRow}>
          <Text style={styles.title}>{person.fullName}</Text>
          <VerificationTags status={person.verificationStatus} active={person.status === "active"} />
        </View>
        <Row label="Phone" value={person.phone} />
        <Row label="Email" value={person.email} />
        <Row label="Employee ID" value={person.employeeId} />
        <Row label="Assigned society" value={person.societyName ?? "Unassigned"} />
        <Row label="Operations users" value={person.operationsUserCount ?? 0} />
        <Row label="Created" value={shortDate(person.createdAt)} />
        <Row label="Last login" value={dateTime(person.lastLoginAt)} />
      </Card>

      <SectionTitle>Societies</SectionTitle>
      {data?.societies.length ? (
        <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
          {data.societies.map((society) => (
            <Card key={society.id}>
              <View style={styles.headRow}>
                <Text style={styles.title} numberOfLines={1}>{society.name}</Text>
                <Pill text={titleCase(society.status)} color={society.status === "active" ? theme.success : theme.muted} />
              </View>
              <Text style={styles.meta}>{society.addressLine}</Text>
              <Row label="Blocks" value={society.blockNames?.length ? society.blockNames.join(", ") : "None yet"} />
              <Row label="Residents" value={society.residentCount ?? 0} />
              <Row label="Active orders" value={society.activeOrderCount ?? 0} />
            </Card>
          ))}
        </CardGrid>
      ) : <Empty text="This supervisor does not run a society yet." />}

      <SectionTitle>Operations staff</SectionTitle>
      {data?.operators.length ? (
        <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
          {data.operators.map((op) => (
            <Card key={op.id}>
              <View style={styles.headRow}>
                <Text style={styles.title} numberOfLines={1}>{op.fullName}</Text>
                <Pill
                  text={op.status === "on_leave" ? "On leave" : titleCase(op.status)}
                  color={op.status === "active" ? theme.success : op.status === "on_leave" ? theme.amber : theme.danger}
                />
              </View>
              <Row label="Phone" value={op.phone} />
              <Row label="Blocks" value={op.blockNames?.length ? op.blockNames.join(", ") : "None yet"} />
            </Card>
          ))}
        </CardGrid>
      ) : <Empty text="No operations staff under this supervisor." />}

      <SectionTitle>Orders</SectionTitle>
      <OrderList orders={data?.orders ?? []} onOpen={(o) => onOpenOrder(o.id)} />
    </Screen>
  );
}

// ------------------------------------------------------------------ operators

// Operations staff, managed by the admin directly. An operator does not need a
// supervisor to exist first: supervision is a property of the society, so an
// operator created into a society nobody runs yet still works perfectly well, and
// picks up a supervisor the moment one is given that society.
function AdminOperatorsScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [operators, setOperators] = useState<StaffUser[]>([]);
  const [societies, setSocieties] = useState<{ id: string; name: string }[]>([]);
  const [blocks, setBlocks] = useState<{ id: string; name: string; societyId: string }[]>([]);
  const [supervisors, setSupervisors] = useState<{ id: string; fullName: string | null }[]>([]);
  // Search, society, block, availability and supervisor — what an admin actually
  // looks somebody up by. Area is gone with areas; a separate approval filter went
  // because approval is shown on the card and acted on there.
  const [values, setValues] = useState<FilterValues>({ societyId: filter.societyId });
  const [search, setSearch] = useState("");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ firstName: "", lastName: "", email: "", societyId: "", blockIds: [] as string[] });

  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useDebounced(search, 250);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.adminOperators(token, {
        q: query || undefined,
        societyId: values.societyId,
        blockId: values.blockId,
        availability: values.availability,
        supervisorUserId: values.supervisorUserId,
      });
      setOperators(res.operators);
      setSocieties(res.societies);
      setBlocks(res.blocks);
      setSupervisors(res.supervisors);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, query, values.societyId, values.blockId, values.availability, values.supervisorUserId]);
  useEffect(() => { load(); }, [load]);

  // Only an approved and active supervisor may approve their own operators, so an
  // admin doing it here is the cover for a society that has nobody running it yet.
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

  const startEditing = (operator: StaffUser) => {
    setError(null); setNote(null);
    setEditing(operator.id);
    setDraft({
      firstName: operator.firstName ?? "",
      lastName: operator.lastName ?? "",
      email: operator.email ?? "",
      societyId: operator.societyId ?? "",
      blockIds: operator.blockIds ?? [],
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null); setNote(null);
    try {
      await api.adminUpdateOperator(editing, {
        firstName: draft.firstName, lastName: draft.lastName,
        email: draft.email || undefined,
        societyId: draft.societyId || undefined,
        blockIds: draft.blockIds,
      }, token);
      setNote("Operator saved."); setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const setStatus = async (operator: StaffUser, status: string) => {
    setError(null); setNote(null);
    try { await api.adminUpdateOperator(operator.id, { status }, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  // The towers of whichever society the draft names. A block from another society
  // is a wider permission, not a narrower one, so it is not offered.
  const draftBlocks = blocks.filter((b) => b.societyId === draft.societyId);
  const toggleDraftBlock = (id: string) => setDraft((d) => ({
    ...d,
    blockIds: d.blockIds.includes(id) ? d.blockIds.filter((b) => b !== id) : [...d.blockIds, id],
  }));

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Operator management"
        subtitle="Operations staff across every society"
        right={<Button label="New operator" variant="secondary" onPress={() => { setNote(null); setCreating(true); }} />}
      />

      {/* Blocks are passed whole and narrowed by the wizard itself to the society
          being chosen in it. Pre-filtering here by the *page's* society filter was
          the wrong axis: with no filter set it passed every society's towers
          through, and the wizard then offered all of them whatever society the
          operator was being put in. */}
      <StaffWizard
        visible={creating}
        role="operator"
        token={token}
        societies={societies}
        blocks={blocks}
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          setCreating(false);
          setNote(`${created.fullName} created with employee ID ${created.employeeId}.`);
          await load();
        }}
      />

      <FilterRow
        specs={[
          { key: "societyId", label: "Society", allLabel: "All societies", options: societies.map((sc) => ({ value: sc.id, label: sc.name })) },
          {
            key: "blockId", label: "Block", allLabel: "All blocks",
            options: blocks
              .filter((b) => !values.societyId || b.societyId === values.societyId)
              .map((b) => ({ value: b.id, label: b.name })),
          },
          {
            key: "availability", label: "Availability", allLabel: "All",
            options: [
              { value: "active", label: "Active" },
              { value: "on_leave", label: "On leave" },
              { value: "blocked", label: "Blocked" },
            ],
          },
          {
            key: "supervisorUserId", label: "Supervisor", allLabel: "All supervisors",
            options: supervisors.map((sup) => ({ value: sup.id, label: sup.fullName ?? sup.id })),
          },
        ]}
        values={values}
        onChange={setValues}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name or phone"
      />
      <Text style={styles.meta}>{operators.length} operator{operators.length === 1 ? "" : "s"}</Text>

      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {operators.map((op) => (editing === op.id ? (
          <InlineEditCard
            key={op.id}
            title={`Edit ${op.fullName ?? "operator"}`}
            onSave={saveEdit}
            onCancel={() => setEditing(null)}
          >
            <FieldRow>
              <Field label="First name" value={draft.firstName} onChangeText={(v) => setDraft({ ...draft, firstName: v })} width="medium" />
              <Field label="Last name" value={draft.lastName} onChangeText={(v) => setDraft({ ...draft, lastName: v })} width="medium" />
            </FieldRow>
            <Field label="Email" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} keyboardType="email-address" width="wide" />
            {/* Generated once and never again: the system must not hand an existing
                operator a different id, because it is what identifies them
                everywhere else. */}
            <Row label="Employee ID" value={orDash(op.employeeId)} />
            <Dropdown
              label="Society"
              value={draft.societyId || undefined}
              allLabel="Choose a society"
              options={societies.map((sc) => ({ value: sc.id, label: sc.name }))}
              onChange={(id) => setDraft({ ...draft, societyId: id ?? "", blockIds: [] })}
              width="full"
            />
            <Text style={styles.meta}>Assigned blocks</Text>
            <View style={styles.blockList}>
              {draftBlocks.map((b) => (
                <View key={b.id} style={styles.blockItem}>
                  <Button
                    label={b.name}
                    selected={draft.blockIds.includes(b.id)}
                    variant={draft.blockIds.includes(b.id) ? "primary" : "secondary"}
                    onPress={() => toggleDraftBlock(b.id)}
                  />
                </View>
              ))}
            </View>
            {draft.societyId && !draftBlocks.length
              ? <Notice tone="warn" text="That society has no blocks yet." />
              : null}
          </InlineEditCard>
        ) : (
          <RecordCard
            key={op.id}
            title={op.fullName ?? op.phone}
            badge={(
              <Pill
                text={op.status === "on_leave" ? "On leave" : titleCase(op.status)}
                color={op.status === "active" ? theme.success : op.status === "on_leave" ? theme.amber : theme.danger}
              />
            )}
            onOpen={() => startEditing(op)}
            fields={[
              { label: "Phone", value: orDash(op.phone) },
              { label: "Email", value: orDash(op.email) },
              { label: "Employee ID", value: orDash(op.employeeId) },
              { label: "Society", value: orDash(op.societyName) },
              // Blocks are the assignment, so an operator with none covers
              // nothing — which is what the card says rather than crediting them
              // with every tower in the society.
              { label: "Blocks", value: orDash(op.blockNames?.length ? op.blockNames.join(", ") : "None yet") },
              { label: "Flats covered", value: orDash(op.flatsCovered ?? 0) },
              { label: "Supervisor", value: orDash(op.supervisorName ?? "Their society has no supervisor yet") },
              { label: "Last login", value: orDash(dateTime(op.lastLoginAt)) },
            ]}
            footer={(
              <VerificationActions
                status={op.verificationStatus}
                onApprove={() => decideOperator(op, "approved")}
                onReject={() => decideOperator(op, "rejected")}
                note={op.supervisorName ? null : "Their society has no supervisor yet, so an admin is approving on their behalf."}
              />
            )}
            actions={(
              <>
                <CardAction label="Edit" onPress={() => startEditing(op)} />
                <CardAction
                  label={op.status === "active" ? "Block" : "Unblock"}
                  tone={op.status === "active" ? "danger" : "good"}
                  onPress={() => setStatus(op, op.status === "active" ? "blocked" : "active")}
                />
              </>
            )}
          />
        )))}
      </CardGrid>
      {!operators.length ? (
        <Empty text={search || countActive(values) ? "No operators match those filters." : "No operations staff yet."} />
      ) : null}

      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// ------------------------------------------------------------------ societies

function AdminSocietiesScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [open, setOpen] = useState<Society | null>(null);
  const [wizard, setWizard] = useState<{ existing: Society | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the tile that was pressed to get here. Arriving from "6 active
  // societies" narrowed the list and nothing on the page said so, which reads as a
  // society having gone missing rather than as a filter being on.
  const [values, setValues] = useState<FilterValues>({ status: filter.status });

  // A request per keystroke races with itself: a slow earlier response lands after
  // a newer one, and the list stops matching what was typed until some other
  // control forces a clean reload. Hold the value still, and ignore a stale reply.
  const query = useDebounced(search, 250);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const mine = ++generation.current;
    setBusy(true); setError(null);
    try {
      const res = await api.adminSocieties(token, { q: query || undefined, status: values.status });
      if (mine !== generation.current) return;
      setSocieties(res.societies);
      setStates(res.supportedStates);
    } catch (e) { if (mine === generation.current) setError((e as Error).message); }
    finally { if (mine === generation.current) setBusy(false); }
  }, [token, query, values.status]);
  useEffect(() => { load(); }, [load]);

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
        subtitle="Every society, its blocks and who runs it"
        right={<Button label="New society" variant="secondary" onPress={() => { setNote(null); setWizard({ existing: null }); }} />}
      />

      {/* The same wizard creates and edits, because a society being changed is the
          same shape as one being made. */}
      <SocietyWizard
        visible={Boolean(wizard)}
        token={token}
        states={states}
        existing={wizard?.existing ?? null}
        onClose={() => setWizard(null)}
        onSaved={async (saved) => {
          setWizard(null);
          setNote(`${saved.name} saved.`);
          await load();
        }}
      />

      {/* Name and status, narrowed together. Both are asked of the server rather
          than applied to the page, so the count underneath is how many there are
          and not how many happen to have been fetched. There is no area to narrow
          by, and a society code no longer exists to search for. */}
      <FilterRow
        specs={[{
          key: "status", label: "Status", allLabel: "All societies",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        }]}
        values={values}
        onChange={setValues}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name"
      />
      {search && search !== query ? <Text style={styles.meta}>Searching…</Text> : null}
      <Text style={styles.meta}>{societies.length} shown</Text>

      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {societies.map((s) => (
          <RecordCard
            key={s.id}
            title={s.name}
            badge={<Pill text={titleCase(s.status)} color={s.status === "active" ? theme.success : theme.muted} />}
            onOpen={() => setOpen(s)}
            fields={[
              { label: "Address", value: orDash(s.addressLine) },
              { label: "Supervisor", value: orDash(s.supervisorName ?? "Unassigned") },
              { label: "Blocks", value: orDash(s.blockNames?.length ? s.blockNames.join(", ") : "None yet") },
              { label: "Residents", value: orDash(s.residentCount ?? 0) },
              { label: "Operations staff", value: orDash(s.operationsStaffCount ?? 0) },
              { label: "Orders", value: orDash(s.orderCount ?? 0) },
              { label: "Available slots", value: orDash(s.availableSlots ?? 0) },
            ]}
            actions={(
              <>
                <CardAction label="Edit" onPress={() => setWizard({ existing: s })} />
                <CardAction
                  label={s.status === "active" ? "Deactivate" : "Activate"}
                  tone={s.status === "active" ? "danger" : "good"}
                  onPress={() => toggle(s)}
                />
              </>
            )}
          />
        ))}
      </CardGrid>
      {!busy && !societies.length ? <Empty text={societyEmptyLine(search, values.status)} /> : null}
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
      <PageTitle title={society.name} subtitle={society.addressLine ?? society.address?.city} />
      <Card>
        <View style={styles.headRow}>
          <Text style={styles.title}>{society.name}</Text>
          <Pill text={titleCase(society.status)} color={society.status === "active" ? theme.success : theme.muted} />
        </View>
        <Row label="House / building" value={society.address?.house} />
        <Row label="Street" value={society.address?.street} />
        <Row label="Area / locality" value={society.address?.locality} />
        <Row label="City" value={society.address?.city} />
        <Row label="State" value={society.address?.state} />
        <Row label="Pincode" value={society.address?.pincode} />
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

// The people who run the operation and the people it serves, as a table.
//
// This was a grid of cards, which is the wrong shape for it: every user carries the
// same nine short facts, and a card per user turned a hundred accounts into a
// hundred screens of mostly whitespace. A table puts them side by side, where they
// can be compared.
//
// Admin accounts are deliberately absent. This page manages the people who run the
// operation; an admin account is managed through the platform's own administrative
// configuration rather than sitting on a list between an operator and a resident.
// And "Mark on leave" is gone from here: leave is an operational fact about a
// person's week, not an edit to their account, and it belongs to a workflow that
// knows what happens to the work they were holding.

function UsersScreen({ token, filter }: { token: string; filter: DrillFilter }) {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [open, setOpen] = useState<StaffUser | null>(null);
  const [societies, setSocieties] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState<PageInfo>({ total: 0, limit: 25, offset: 0, hasMore: false });
  const [offset, setOffset] = useState(0);
  const [values, setValues] = useState<FilterValues>({ role: filter.role, status: filter.status });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const query = useDebounced(search, 250);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.adminUsers(token, {
        role: values.role, status: values.status, q: query || undefined,
        societyId: values.societyId, onboarding: filter.onboarding,
        limit: 25, offset,
      });
      setUsers(res.users); setSocieties(res.societies); setPage(res.page);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, values.role, values.status, values.societyId, query, filter.onboarding, offset]);
  useEffect(() => { load(); }, [load]);

  // Nothing that changes an account happens on one tap: the action is held here
  // until it has been confirmed. See user-action-rules for which actions each
  // account has and what each one says.
  const [pending, setPending] = useState<{ user: StaffUser; action: UserAction } | null>(null);
  const [applying, setApplying] = useState(false);

  const applyPending = async () => {
    if (!pending?.action.to || applying) return;
    setError(null); setNote(null); setApplying(true);
    try {
      await api.adminSetUserStatus(pending.user.id, pending.action.to, token);
      const who = pending.user.fullName ?? "That account";
      setNote(
        pending.action.key === "block" ? `${who} is blocked and cannot sign in.`
          : pending.action.key === "deactivate" ? `${who} is deactivated. Their record and assignments are kept.`
          : `${who} can sign in again.`,
      );
      setPending(null);
      await load();
    } catch (e) {
      // The account keeps the status it had, and the question stays open so the
      // admin can read the reason and try again.
      setError((e as Error).message);
    } finally { setApplying(false); }
  };

  // The same question wherever the action was pressed — the list or the record.
  const statusConfirm = (
    <ConfirmDialog
      visible={Boolean(pending)}
      title={pending?.action.confirm?.title ?? ""}
      message={pending?.action.confirm?.message ?? ""}
      confirmLabel={pending?.action.confirm?.confirmLabel ?? "Confirm"}
      destructive={pending?.action.tone === "danger"}
      busy={applying}
      onConfirm={applyPending}
      onCancel={() => setPending(null)}
    />
  );

  if (open) {
    const person = users.find((u) => u.id === open.id) ?? open;
    return (
      <Screen refreshing={busy} onRefresh={load} resetOn={open?.id ?? null}>
        <BackLink label="Users" onPress={() => setOpen(null)} />
        <PageTitle title={person.fullName ?? "Unnamed"} subtitle={person.roles.map(titleCase).join(", ")} />
        {/* What this account is and whether it works, before the reference.
            The card used to open by repeating the name already in the page title
            above it, then the roles already in the subtitle beside that, and only
            then say anything the reader did not have. */}
        <Card elevated>
          <View style={styles.headRow}>
            <Text style={styles.title}>{statusLabelFor(person.status)}</Text>
            {/* The heading is the status, so the badge does not repeat it. Only
                an approval still waiting or refused is worth a badge here; an
                approved account says nothing a reader needs. */}
            {person.verificationStatus && person.verificationStatus !== "approved"
              ? <VerificationTags status={person.verificationStatus} />
              : null}
          </View>
          <Row label="Where" value={[person.societyLabel, person.blockNames?.length ? person.blockNames.join(", ") : person.blockName, person.unitNumber].filter(Boolean).join(" · ") || "Not assigned anywhere"} />
          <Row label="Last signed in" value={person.lastLoginAt ? dateTime(person.lastLoginAt) : "Never"} />
          {person.onboardingCompleted === false
            ? <Notice tone="warn" text="This resident has not finished onboarding, so they cannot book a pickup yet." />
            : null}
          <View style={styles.buttonRow}>
            {actionsFor(person, person.fullName ?? null)
              .filter((a) => a.key !== "edit")
              .map((action) => (
                <View key={action.key} style={{ flex: 1 }}>
                  <Button
                    label={action.label}
                    variant={action.tone === "danger" ? "danger" : "secondary"}
                    onPress={() => setPending({ user: person, action })}
                  />
                </View>
              ))}
          </View>
        </Card>

        <SectionTitle>Account</SectionTitle>
        <Card>
          <Row label="Roles" value={person.roles.map(titleCase).join(", ")} />
          <Row label="Phone" value={person.phone} figure />
          <Row label="Email" value={person.email} />
          <Row label="Employee ID" value={person.employeeId} figure />
          <Row label="Created" value={shortDate(person.createdAt)} />
        </Card>
        {note ? <Notice tone="good" text={note} /> : null}
        {statusConfirm}
        <ErrorText error={error} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={busy} onRefresh={load} resetOn={null}>
      {/* No Sign out here. Signing out is not a thing done to the list of users,
          and a red button at the top right of a management page is one mis-tap away
          from ending the session somebody is working in. It lives on Config, where
          the rest of the account's own actions are. */}
      <PageTitle title="User management" subtitle="Supervisors, operators and residents" />
      <FilterRow
        specs={[
          {
            key: "role", label: "Role", allLabel: "All roles",
            options: [
              { value: "supervisor", label: "Supervisor" },
              { value: "operator", label: "Operator" },
              { value: "resident", label: "Resident" },
            ],
          },
          {
            key: "status", label: "Status", allLabel: "All statuses",
            // Blocked and deactivated are different states and are filtered
            // separately; "Inactive" used to stand for both and for neither.
            options: [
              { value: "active", label: "Active" },
              { value: "blocked", label: "Blocked" },
              { value: "deleted", label: "Deactivated" },
            ],
          },
          {
            key: "societyId", label: "Society", allLabel: "All societies",
            options: societies.map((sc) => ({ value: sc.id, label: sc.name })),
          },
        ]}
        values={values}
        onChange={(next) => { setOffset(0); setValues(next); }}
        search={search}
        onSearch={(next) => { setOffset(0); setSearch(next); }}
        searchPlaceholder="Search by name, phone or email"
      />
      {note ? <Notice tone="good" text={note} /> : null}

      <DataTable
        rows={users}
        keyOf={(u) => u.id}
        onPress={(u) => setOpen(u)}
        empty="No users found."
        columns={[
          { key: "user", label: "User", width: 150, render: (u) => <Text style={styles.cell}>{u.fullName ?? "Unnamed"}</Text> },
          { key: "role", label: "Role", width: 100, render: (u) => <Text style={styles.cell}>{u.roles.map(titleCase).join(", ")}</Text> },
          { key: "phone", label: "Phone", width: 120, render: (u) => <Text style={styles.cell}>{u.phone}</Text> },
          { key: "email", label: "Email", width: 190, render: (u) => <Text style={styles.cell} numberOfLines={1}>{u.email ?? "—"}</Text> },
          { key: "society", label: "Society", width: 150, render: (u) => <Text style={styles.cell} numberOfLines={1}>{u.societyLabel ?? "—"}</Text> },
          {
            key: "blocks",
            label: "Blocks",
            width: 120,
            render: (u) => (
              <Text style={styles.cell} numberOfLines={1}>
                {u.blockNames?.length ? u.blockNames.join(", ") : u.blockName ?? "—"}
              </Text>
            ),
          },
          { key: "flat", label: "Flat / Unit", width: 100, render: (u) => <Text style={styles.cell}>{u.unitNumber ?? "—"}</Text> },
          {
            key: "status",
            label: "Status",
            width: 90,
            render: (u) => (
              <Pill
                text={statusLabelFor(u.status)}
                color={u.status === "active" ? theme.success : u.status === "blocked" ? theme.danger : theme.muted}
              />
            ),
          },
          { key: "lastLogin", label: "Last Login", width: 140, render: (u) => <Text style={styles.cell}>{dateTime(u.lastLoginAt)}</Text> },
          { key: "created", label: "Created", width: 110, render: (u) => <Text style={styles.cell}>{shortDate(u.createdAt)}</Text> },
          {
            key: "actions",
            label: "Actions",
            width: 170,
            render: (u) => (
              <View style={{ flexDirection: "row" }}>
                {actionsFor(u, u.fullName ?? null).map((action) => (
                  <CardAction
                    key={action.key}
                    label={action.label}
                    tone={action.tone}
                    onPress={() => (action.key === "edit" ? setOpen(u) : setPending({ user: u, action }))}
                  />
                ))}
              </View>
            ),
          },
        ]}
      />
      {!busy && !users.length ? (
        <View style={styles.emptyActions}>
          <Button
            label="Clear filters"
            variant="secondary"
            onPress={() => { setValues({}); setSearch(""); setOffset(0); }}
          />
        </View>
      ) : null}
      <Pager page={page} onChange={setOffset} />
      <ErrorText error={error} />
      {statusConfirm}
    </Screen>
  );
}

// --------------------------------------------------------------------- orders

// Every state an order can be in, in the order it passes through them, so a status
// list reads as a journey rather than as an alphabet.
const ORDER_STATES = [
  "scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold",
  "ready_for_delivery", "out_for_delivery", "delivered", "cancelled", "pickup_failed",
];

function AdminOrdersScreen({ token, filter, onOpenOrder }: { token: string; filter: DrillFilter; onOpenOrder: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [values, setValues] = useState<FilterValues>({
    societyId: filter.societyId, state: filter.state,
  });
  const [orderCode, setOrderCode] = useState("");
  const [resident, setResident] = useState("");
  // A range rather than a single day, because "what went out last week" is the
  // question people actually ask of an order list.
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Twenty to a page. The backend has always paged this endpoint; the screen
  // simply never asked, so it received the default fifty and rendered whatever
  // came back as though that were all of them.
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<PageInfo | null>(null);

  // A "to" before its "from" is a range that can never match anything, and is
  // worth saying so about rather than quietly returning nothing.
  const backwards = Boolean(from && to && from > to);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [o, s] = await Promise.all([
        api.adminOrders(token, {
          societyId: values.societyId, state: values.state,
          orderCode: orderCode || undefined, resident: resident || undefined,
          from: applied.from, to: applied.to,
          delayed: filter.delayed, payment: filter.payment, today: filter.today, unassigned: filter.unassigned,
          limit: "20", offset: String(offset),
        }),
        api.adminSocieties(token),
      ]);
      setOrders(o.orders); setPage(o.page); setSocieties(s.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, values.societyId, values.state, orderCode, resident, applied.from, applied.to,
    filter.delayed, filter.payment, filter.today, filter.unassigned, offset]);
  useEffect(() => { load(); }, [load]);

  // Any change to what is being matched goes back to the first page. A page
  // number is a position in a result set and means nothing once the result set
  // changes underneath it.
  useEffect(() => {
    setOffset(0);
  }, [values.societyId, values.state, orderCode, resident, applied.from, applied.to,
    filter.delayed, filter.payment, filter.today, filter.unassigned]);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Order management"
        subtitle={describeOrderFilter(filter) ?? "System-wide order monitoring"}
      />
      {/* The filters take the width of the page rather than a narrow column with
          the rest of the row empty beside them. */}
      <FieldRow>
        <Field label="Order ID" value={orderCode} onChangeText={setOrderCode} placeholder="ORD-756272" width="medium" compact />
        <Field label="Resident name or phone" value={resident} onChangeText={setResident} width="wide" compact />
      </FieldRow>
      <FilterRow
        specs={[
          {
            key: "societyId", label: "Society", allLabel: "All societies",
            options: societies.map((sc) => ({ value: sc.id, label: sc.name })),
          },
          {
            key: "state", label: "Status", allLabel: "All statuses",
            options: ORDER_STATES.map((value) => ({ value, label: stateLabel[value] ?? titleCase(value) })),
          },
        ]}
        values={values}
        onChange={setValues}
        onClear={() => {
          setOrderCode(""); setResident("");
          setFrom(null); setTo(null); setApplied({});
        }}
      />
      <FieldRow>
        <DateField label="From date" value={from} onChange={setFrom} placeholder="Select start date" />
        <DateField label="To date" value={to} onChange={setTo} placeholder="Select end date" />
        <View style={styles.dateActions}>
          <Button
            label="Apply filters"
            variant="secondary"
            disabled={backwards}
            onPress={() => setApplied({ from: from ?? undefined, to: to ?? undefined })}
          />
        </View>
        <View style={styles.dateActions}>
          <Button
            label="Clear filters"
            variant="secondary"
            onPress={() => { setFrom(null); setTo(null); setApplied({}); }}
          />
        </View>
      </FieldRow>
      {backwards ? <Notice tone="warn" text="The start date is after the end date, so nothing could fall inside that range." /> : null}
      {/* Every order the filters matched, not the twenty on screen; the pager
          below says which of them these are. */}
      <Text style={styles.meta}>
        {(page?.total ?? orders.length)} order{(page?.total ?? orders.length) === 1 ? "" : "s"}
      </Text>

      {/* A table across the page rather than cards down a column: every order
          carries the same short facts, and side by side is how they are compared. */}
      <DataTable
        rows={orders}
        keyOf={(o) => o.id}
        onPress={(o) => onOpenOrder(o.id)}
        empty="No orders match those filters."
        columns={[
          { key: "code", label: "Order ID", width: 130, render: (o) => <Text style={styles.linkCell}>{o.orderCode}</Text> },
          { key: "resident", label: "Resident", width: 140, render: (o) => <Text style={styles.cell} numberOfLines={1}>{o.residentName ?? "—"}</Text> },
          { key: "society", label: "Society", width: 150, render: (o) => <Text style={styles.cell} numberOfLines={1}>{o.societyName ?? "—"}</Text> },
          {
            key: "place",
            label: "Block / Flat",
            width: 110,
            render: (o) => (
              <Text style={styles.cell} numberOfLines={1}>
                {[o.blockName, o.unitNumber].filter(Boolean).join(" · ") || "—"}
              </Text>
            ),
          },
          { key: "garments", label: "Garments", width: 90, render: (o) => <Text style={styles.cell}>{o.acceptedCount ?? o.requestedCount ?? "—"}</Text> },
          { key: "amount", label: "Amount", width: 100, render: (o) => <Text style={styles.cell}>{rupees(o.additionalChargePaise ?? 0)}</Text> },
          { key: "status", label: "Status", width: 130, render: (o) => <StatePill state={o.state} /> },
          { key: "operator", label: "Operator", width: 140, render: (o) => <Text style={styles.cell} numberOfLines={1}>{o.operatorName ?? "Unassigned"}</Text> },
          { key: "date", label: "Order Date", width: 120, render: (o) => <Text style={styles.cell}>{shortDate(o.createdAt)}</Text> },
          {
            key: "actions",
            label: "Actions",
            width: 90,
            render: (o) => <CardAction label="View" onPress={() => onOpenOrder(o.id)} />,
          },
        ]}
      />
      {page ? <Pager page={page} onChange={setOffset} /> : null}
      {page ? <Pager page={page} onChange={setOffset} /> : null}
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
      {/* Two or three across. A plan card is a name, a price and a handful of
          numbers; at the width of a screen it was mostly empty. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
      {plans.map((plan) => (
        <Card key={plan.id}>
          <View style={styles.headRow}>
            <Text style={styles.title} numberOfLines={1}>{plan.tier}</Text>
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

          {(
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
      </CardGrid>
      {!plans.length ? <Empty text="No plans yet." /> : null}
      {note ? <Notice tone="good" text={note} /> : null}

      {/* Creating and editing a plan both happen in the middle of the screen.
          Editing used to render the whole wizard *inside the plan's own card*,
          in a grid two or three columns wide — so a form with a step indicator,
          a service list and a pricing summary was squeezed into a third of the
          page, pushing every card below it down. It is the same wizard either
          way; only the title and the final button differ. */}
      <CenteredModal
        visible={creating || Boolean(editing)}
        title={editing ? `Edit ${editing.tier}` : "Create subscription plan"}
        subtitle="Create a plan and configure the services included in it."
        width="wide"
        onClose={() => { setCreating(false); setEditing(null); }}
      >
        {creating || editing ? (
          <PlanWizard
            token={token}
            catalogue={servicesCatalogue}
            existing={editing}
            framed={false}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onCreated={async (message) => {
              setCreating(false); setEditing(null); setNote(message); await load();
            }}
          />
        ) : null}
      </CenteredModal>

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
  const [societies, setSocieties] = useState<Society[]>([]);
  const [operators, setOperators] = useState<StaffUser[]>([]);
  const [supervisors, setSupervisors] = useState<StaffUser[]>([]);

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
      const [monitor, societyRes, staffRes, supRes] = await Promise.all([
        api.adminSlots(token, {
          societyId: societyId ?? undefined,
          supervisorUserId: supervisorUserId ?? undefined, operatorUserId: operatorUserId ?? undefined,
          from: from ?? undefined, to: to ?? undefined,
          shift: shift ?? undefined, status: status ?? undefined,
          bookingStatus: bookingStatus ?? undefined, utilisation: utilisation ?? undefined,
          includePast: includePast || undefined,
        }),
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
      setSocieties(societyRes.societies);
      setOperators(staffRes.operators);
      setSupervisors(supRes.supervisors);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, societyId, supervisorUserId, operatorUserId, from, to, shift, status, bookingStatus, utilisation, includePast]);
  useEffect(() => { load(); }, [load]);

  const clearFilters = () => {
    setSocietyId(null); setSupervisorUserId(null); setOperatorUserId(null);
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

  // Who is inside a slot, fetched when somebody asks rather than for every card.
  const [viewingBookings, setViewingBookings] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Awaited<ReturnType<typeof api.adminSlotBookings>>["bookings"]>([]);
  const [cancelling, setCancelling] = useState<MonitoredSlot | null>(null);

  const openBookings = async (slotId: string) => {
    if (viewingBookings === slotId) { setViewingBookings(null); return; }
    setError(null);
    try {
      const res = await api.adminSlotBookings(slotId, token);
      setBookings(res.bookings);
      setViewingBookings(slotId);
    } catch (e) { setError((e as Error).message); }
  };

  const cancel = async (slot: MonitoredSlot) => {
    setError(null); setNote(null);
    try {
      const result = await api.adminCancelSlot(slot.id, token);
      setNote(result.cancelledPickups
        ? `Slot cancelled. ${result.cancelledPickups} booking${result.cancelledPickups === 1 ? " was" : "s were"} cancelled and those residents have been told.`
        : "Slot cancelled.");
      setCancelling(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  // Choosing a society narrows the staff to the people who work in it.
  const visibleSupervisors = supervisors.filter(
    (sp) => !societyId || (sp.societyIds ?? []).includes(societyId));
  const visibleOperators = operators.filter(
    (op) => !societyId || (op.societyIds ?? []).includes(societyId));

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Slot monitoring"
        subtitle="Capacity, demand and utilisation across every society"
        right={<Button label="New slot" variant="secondary" onPress={() => setCreating(true)} />}
      />

      {/* In the middle of the screen with this page behind it, rather than as a
          wide section pushed into the top of a list that stays live underneath. */}
      <CenteredModal
        visible={creating}
        title="New pickup slot"
        onClose={() => setCreating(false)}
        dirty={Boolean(newSocietyId)}
        discardMessage="Are you sure you want to discard this slot?"
        footer={(
          <WizardFooter
            onNext={create}
            nextLabel="Create slot"
            nextDisabled={!newSocietyId || !newDate}
          />
        )}
      >
        <Dropdown
          label="Society"
          value={newSocietyId ?? undefined}
          allLabel="Choose a society"
          options={societies.map((sc) => ({ value: sc.id, label: sc.name }))}
          onChange={(id) => setNewSocietyId(id ?? null)}
          width="full"
        />
        <FieldRow>
          {/* A slot on a day that has gone can never be worked, so it cannot be
              created either. The backend refuses it too. */}
          <DateField label="Date" value={newDate} onChange={setNewDate} minDate={todayIso()} clearable={false} />
          <Field label="Capacity" value={newCapacity} onChangeText={setNewCapacity} keyboardType="number-pad" width="small" />
        </FieldRow>
        <SlotWindowPicker windows={slotWindows} value={newWindow} onChange={setNewWindow} />
        <ErrorText error={error} />
      </CenteredModal>

      <SectionTitle>Summary</SectionTitle>
      <StatGrid>
        <Stat label="Total slots" value={summary?.totalSlots ?? 0} />
        <Stat label="Open" value={summary?.openSlots ?? 0} tone="good" />
        <Stat label="Full" value={summary?.fullSlots ?? 0} tone="warn" />
        <Stat label="Capacity" value={summary?.totalCapacity ?? 0} />
        <Stat label="Booked" value={summary?.totalBookings ?? 0} />
        <Stat label="Utilisation" value={`${summary?.utilisationPercent ?? 0}%`} />
      </StatGrid>

      {/* Eight filters. As rows of buttons they filled two screens before a single
          slot appeared; as compact fields they sit above the list and combine. */}
      <FilterRow
        specs={[
          {
            key: "societyId", label: "Society", allLabel: "Select society",
            options: societies.map((sc) => ({ value: sc.id, label: sc.name })),
          },
          {
            key: "supervisorUserId", label: "Supervisor", allLabel: "Select supervisor",
            options: visibleSupervisors.map((sp) => ({ value: sp.id, label: sp.fullName ?? sp.phone })),
          },
          {
            key: "operatorUserId", label: "Operator", allLabel: "Select operator",
            options: visibleOperators.map((op) => ({ value: op.id, label: op.fullName ?? op.phone })),
          },
          { key: "shift", label: "Shift", allLabel: "Any shift", options: options.shifts.map((v) => ({ value: v, label: v })) },
          {
            key: "status", label: "Slot status", allLabel: "Any",
            options: options.statuses.map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            key: "bookingStatus", label: "Booking status", allLabel: "Any",
            options: options.bookingStatuses.map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            key: "utilisation", label: "Utilisation", allLabel: "Any",
            options: options.utilisationBands.map((b) => ({ value: b, label: b === "100" ? "Fully utilised" : `${b}%` })),
          },
        ]}
        values={{
          societyId: societyId ?? undefined,
          supervisorUserId: supervisorUserId ?? undefined, operatorUserId: operatorUserId ?? undefined,
          shift: shift ?? undefined, status: status ?? undefined,
          bookingStatus: bookingStatus ?? undefined, utilisation: utilisation ?? undefined,
        }}
        onChange={(next) => {
          const societyChanged = (next.societyId ?? null) !== societyId;
          setSocietyId(next.societyId ?? null);
          // Anybody chosen inside the previous society goes with it, rather than
          // staying behind and silently matching nothing.
          setSupervisorUserId(societyChanged ? null : next.supervisorUserId ?? null);
          setOperatorUserId(societyChanged ? null : next.operatorUserId ?? null);
          setShift(next.shift ?? null);
          setStatus(next.status ?? null);
          setBookingStatus(next.bookingStatus ?? null);
          setUtilisation(next.utilisation ?? null);
        }}
        onClear={clearFilters}
        extra={(
          <FieldRow>
            <DateField label="From" value={from} onChange={setFrom} placeholder="Any date" />
            {/* The calendar will not offer a day before the start date, so an
                impossible range cannot be entered in the first place. */}
            <DateField label="To" value={to} onChange={setTo} placeholder="Any date" minDate={from ?? undefined} />
          </FieldRow>
        )}
      />
      <Button label={includePast ? "Hide days that have passed" : "Include days that have passed"} variant="secondary" onPress={() => setIncludePast(!includePast)} />

      <View style={{ height: 8 }} />
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
      {slots.map((slot) => (
        <Card key={slot.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{shortDate(slot.date)} · {to12Hour(slot.startTime)} – {to12Hour(slot.endTime)}</Text>
            <Pill text={titleCase(slot.status)} color={slotStatusColour(slot.status)} />
          </View>
          <Text style={styles.meta}>{[slot.societyName, slot.shift].filter(Boolean).join(" · ")}</Text>
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
              <Field label="Capacity" value={editCapacity} onChangeText={setEditCapacity} keyboardType="number-pad" width="small" />
              <View style={styles.buttonRow}>
                <View style={{ flex: 1, marginRight: 6 }}><Button label="Save" onPress={() => saveCapacity(slot)} /></View>
                <View style={{ flex: 1, marginLeft: 6 }}><Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} /></View>
              </View>
            </>
          ) : slot.status !== "cancelled" ? (
            <>
              <View style={styles.buttonRow}>
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Button label="Change capacity" variant="secondary" onPress={() => { setEditing(slot.id); setEditCapacity(String(slot.capacityTotal)); }} />
                </View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  {/* Cancelled, never deleted: the bookings inside it have to be
                      cancelled too and those residents told. Asked first, with the
                      number of people it affects in the question. */}
                  <Button label="Cancel slot" variant="danger" onPress={() => setCancelling(slot)} />
                </View>
              </View>
              {/* "6 of 10 booked" is a number. This is the six — which is what an
                  admin actually needs before moving or cancelling anything. */}
              <Button
                label={viewingBookings === slot.id ? "Hide bookings" : `View bookings (${slot.bookedCount})`}
                variant="secondary"
                onPress={() => openBookings(slot.id)}
              />
              {viewingBookings === slot.id ? (
                bookings.length ? bookings.map((b) => (
                  <Row
                    key={b.pickupId}
                    label={[b.residentName ?? "Unnamed resident", b.blockName, b.unitNumber].filter(Boolean).join(" · ")}
                    value={[b.orderCode, titleCase(b.state)].filter(Boolean).join(" · ")}
                  />
                )) : <Empty text="Nobody has booked this slot." />
              ) : null}
            </>
          ) : null}
        </Card>
      ))}
      </CardGrid>
      {!slots.length ? <Empty text="No slots match those filters." /> : null}

      {/* Cancelling a slot cancels the bookings inside it, so the number of
          residents it affects is in the question rather than in the result. */}
      <ConfirmDialog
        visible={Boolean(cancelling)}
        title="Cancel this slot?"
        message={cancelling
          ? `${cancelling.date} · ${cancelling.window}. ${cancelling.bookedCount} resident${cancelling.bookedCount === 1 ? " has" : "s have"} booked it, and their pickups will be cancelled and they will be told.`
          : ""}
        confirmLabel="Cancel slot"
        destructive
        onConfirm={() => cancelling && cancel(cancelling)}
        onCancel={() => setCancelling(null)}
      />

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
  // Held as the applied values and the ones being chosen, so the report does not
  // reload halfway through picking a range.
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.adminReports(token, { from: applied.from ?? undefined, to: applied.to ?? undefined })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, applied.from, applied.to]);
  useEffect(() => { load(); }, [load]);

  // The system-wide totals, added up from the society rows — which between them
  // cover every order in the range, each exactly once. Summed here rather than
  // asked for separately so the headline can never disagree with the table under
  // it.
  const overview = (data?.bySociety ?? []).reduce(
    (sum, row) => ({
      orders: sum.orders + row.orders,
      delivered: sum.delivered + row.delivered,
      cancelled: sum.cancelled + row.cancelled,
      failedPickups: sum.failedPickups + row.failedPickups,
      qcFailures: sum.qcFailures + row.qcFailures,
      delayed: sum.delayed + row.delayed,
      garments: sum.garments + row.garments,
    }),
    { orders: 0, delivered: 0, cancelled: 0, failedPickups: 0, qcFailures: 0, delayed: 0, garments: 0 },
  );

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Reports and analytics" subtitle="System-wide" />
      {/* Nobody should have to type YYYY-MM-DD, and nobody should be able to ask
          for a range that ends before it starts: the calendar does not offer those
          days at all, so the invalid range cannot be entered rather than being
          entered and then rejected. */}
      <FieldRow>
        <DateField label="From" value={from} onChange={setFrom} placeholder="Select start date" maxDate={to ?? undefined} />
        <DateField label="To" value={to} onChange={setTo} placeholder="Select end date" minDate={from ?? undefined} />
      </FieldRow>
      <View style={styles.buttonRow}>
        <View style={{ marginRight: 8 }}>
          <Button label="Apply filters" onPress={() => setApplied({ from, to })} />
        </View>
        {from || to ? (
          <Button
            label="Clear filters"
            variant="secondary"
            onPress={() => { setFrom(null); setTo(null); setApplied({ from: null, to: null }); }}
          />
        ) : null}
      </View>

      {/* The system-wide picture first, before any of the breakdowns. A reporting
          page that opens on a table of societies asks the reader to add it up
          themselves to find out how the platform is doing. */}
      <SectionTitle>Overview</SectionTitle>
      <StatGrid>
        <Stat label="Orders" value={overview.orders} />
        <Stat label="Delivered" value={overview.delivered} tone="good" />
        <Stat label="Cancelled" value={overview.cancelled} tone={overview.cancelled ? "warn" : "default"} />
        <Stat label="Delayed" value={overview.delayed} tone={overview.delayed ? "danger" : "default"} />
        <Stat label="QC failures" value={overview.qcFailures} tone={overview.qcFailures ? "warn" : "default"} />
        <Stat label="Failed pickups" value={overview.failedPickups} tone={overview.failedPickups ? "warn" : "default"} />
        <Stat label="Garments" value={overview.garments} />
        <Stat label="Revenue" value={rupees(data?.revenue.totalRevenuePaise ?? 0)} />
      </StatGrid>

      <SectionTitle>Revenue</SectionTitle>
      <Card>
        {/* Named for what each figure is. "Total revenue" excludes the pending
            charges listed above it, which is right for money that has actually
            been recognised and wrong for anybody who reads the three as a sum. */}
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

      {data ? <ReportTable title="Society-wise orders" rows={data.bySociety} keyOf={(r) => r.societyId ?? ""} nameOf={(r) => r.societyName ?? "Unknown"} /> : null}
      {/* Block by block, which is what one operator covers and therefore the level
          a supervisor can act on. */}
      {data?.byBlock ? <ReportTable title="Block-wise orders" rows={data.byBlock} keyOf={(r) => r.blockId ?? ""} nameOf={(r) => r.blockName ?? "No block recorded"} /> : null}
      {data?.bySupervisor ? <ReportTable title="Supervisor performance" rows={data.bySupervisor} keyOf={(r) => r.societyId ?? ""} nameOf={(r) => `${r.supervisorName ?? "Unassigned"} (${r.societyName})`} /> : null}
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
    <Screen refreshing={busy} onRefresh={load} resetOn={openId}>
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

      <SectionTitle>By society</SectionTitle>
      <Card>
        {analytics?.bySociety?.length
          ? analytics.bySociety.map((r) => <Row key={r.key} label={r.label} value={`${r.total} total · ${r.open} open`} />)
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
      <FilterRow
        specs={[
          {
            key: "status", label: "Issue status", allLabel: "Any status",
            options: [
              "open", "in_progress", "waiting_resident", "waiting_operator",
              "escalated_supervisor", "escalated_admin", "resolved", "closed",
            ].map((key) => ({ value: key, label: ISSUE_STATUS_LABEL[key as IssueStatus] ?? titleCase(key) })),
          },
          {
            key: "priority", label: "Priority", allLabel: "Any priority",
            options: ["low", "normal", "high", "emergency"].map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            // Three separate "show only" buttons were three ways of narrowing the
            // same list, so they are one list of the ways to narrow it.
            key: "scope", label: "Show", allLabel: "Everything",
            options: [
              { value: "open", label: "Unresolved only" },
              { value: "emergency", label: "Emergencies only" },
              { value: "escalated", label: "Escalated only" },
            ],
          },
        ]}
        values={{
          status: status ?? undefined,
          priority: priority ?? undefined,
          scope: openOnly ? "open" : emergencyOnly ? "emergency" : escalatedOnly ? "escalated" : undefined,
        }}
        onChange={(next) => {
          setStatus(next.status ?? null);
          setPriority(next.priority ?? null);
          setOpenOnly(next.scope === "open");
          setEmergencyOnly(next.scope === "emergency");
          setEscalatedOnly(next.scope === "escalated");
        }}
      />
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
  const [values, setValues] = useState<FilterValues>({ status: filter.status });
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminSubscriptions>>["subscriptions"]>([]);
  const [plans, setPlans] = useState<PlanUsage[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A page of subscriptions rather than all of them. Ten to a page, and every
  // filter change goes back to the first: a page number is a position in a result
  // set, and it means nothing once the result set changes underneath it.
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<PageInfo | null>(null);
  useEffect(() => { setOffset(0); }, [values.status, values.planId, values.societyId]);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [subs, planRes, societyRes] = await Promise.all([
        api.adminSubscriptions(token, {
          status: values.status, planId: values.planId, societyId: values.societyId,
          limit: "10", offset: String(offset),
        }),
        api.adminPlans(token),
        api.adminSocieties(token),
      ]);
      setRows(subs.subscriptions); setPage(subs.page);
      setPlans(planRes.plans); setSocieties(societyRes.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, values.status, values.planId, values.societyId, offset]);
  useEffect(() => { load(); }, [load]);

  // The society narrowing is the server's now, so the page count matches what is
  // actually being shown. Filtering a page after it arrives gives "1–10 of 84"
  // above four rows.
  const shown = rows;

  if (open) return <SubscriptionDetailScreen token={token} id={open} onBack={() => setOpen(null)} />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Subscriptions" subtitle="Who is on which plan" />
      <FilterRow
        specs={[
          {
            key: "status", label: "Status", allLabel: "All statuses",
            options: [
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          {
            key: "planId", label: "Plan", allLabel: "All plans",
            options: plans.map((p) => ({ value: p.id, label: p.tier })),
          },
          {
            key: "societyId", label: "Society", allLabel: "All societies",
            options: societies.map((sc) => ({ value: sc.id, label: sc.name })),
          },
        ]}
        values={values}
        onChange={setValues}
      />
      {/* The whole match, not the page: the pager below says which slice of it is
          on screen. "10 subscriptions" above a filter that selected 84 was a lie
          about the data rather than about the page. */}
      <Text style={styles.meta}>
        {(page?.total ?? shown.length)} subscription{(page?.total ?? shown.length) === 1 ? "" : "s"}
      </Text>

      {/* A table across the page. Two columns of cards left a wide empty strip
          down the right and gave every subscription a screen of its own, when all
          any of them carries is eight short figures. */}
      <DataTable
        rows={shown}
        keyOf={(r) => r.id}
        onPress={(r) => setOpen(r.id)}
        empty="No subscriptions match those filters."
        columns={[
          { key: "resident", label: "Resident", width: 150, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.residentName ?? "Unnamed resident"}</Text> },
          { key: "society", label: "Society", width: 160, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.societyName ?? "—"}</Text> },
          { key: "plan", label: "Plan", width: 110, render: (r) => <Text style={styles.cell}>{r.planTier ?? "—"}</Text> },
          { key: "price", label: "Monthly Price", width: 120, render: (r) => <Text style={styles.cell}>{r.monthlyPaise !== null ? rupees(r.monthlyPaise) : "—"}</Text> },
          { key: "allowance", label: "Allowance", width: 90, render: (r) => <Text style={styles.cell}>{r.allowance ?? "—"}</Text> },
          { key: "used", label: "Used", width: 70, render: (r) => <Text style={styles.cell}>{r.garmentsUsed}</Text> },
          { key: "remaining", label: "Remaining", width: 90, render: (r) => <Text style={styles.cell}>{r.remaining ?? "—"}</Text> },
          {
            key: "status",
            label: "Status",
            width: 110,
            // Cancelled, paused and active have to stay tellable apart at a
            // glance, which is what a badge is for.
            render: (r) => (
              <Pill
                text={titleCase(r.status)}
                color={r.status === "active" ? theme.success : r.status === "paused" ? theme.amber : theme.danger}
              />
            ),
          },
        ]}
      />
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
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [supervisorUserId, setSupervisorUserId] = useState<string | null>(null);
  const [operatorUserId, setOperatorUserId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<"society" | "block" | "supervisor" | "operator" | "plan" | "service">("society");
  const [showCharged, setShowCharged] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      setData(await api.adminRevenue(token, {
        preset: preset === "custom" ? undefined : preset,
        from: preset === "custom" ? from ?? undefined : undefined,
        to: preset === "custom" ? to ?? undefined : undefined,
        societyId: societyId ?? undefined,
        blockId: blockId ?? undefined,
        supervisorUserId: supervisorUserId ?? undefined,
        operatorUserId: operatorUserId ?? undefined,
        paymentStatus: paymentStatus ?? undefined,
      }));
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, preset, from, to, societyId, blockId, supervisorUserId, operatorUserId, paymentStatus]);
  useEffect(() => { load(); }, [load]);

  const clearFilters = () => {
    setPreset("this_month"); setFrom(null); setTo(null);
    setSocietyId(null); setBlockId(null);
    setSupervisorUserId(null); setOperatorUserId(null); setPaymentStatus(null);
  };

  const filters = data?.filters;
  // Choosing a society narrows the blocks and the staff to that society, so the
  // controls cannot contradict each other.
  const societies = filters?.societies ?? [];
  const blocks = (filters?.blocks ?? []).filter((b) => !societyId || b.societyId === societyId);
  const supervisors = (filters?.supervisors ?? []).filter(
    (sp) => !societyId || sp.societyIds.includes(societyId));
  const operators = (filters?.operators ?? []).filter(
    (op) => !societyId || op.societyIds.includes(societyId));

  const buckets: Record<typeof tab, RevenueBucket[]> = {
    society: data?.bySociety ?? [],
    block: data?.byBlock ?? [],
    supervisor: data?.bySupervisor ?? [],
    operator: data?.byOperator ?? [],
    plan: data?.byPlan ?? [],
    // Shaped like the others so the same card renders it; sharePercent is the
    // extra it carries.
    service: (data?.byService ?? []).map((row) => ({
      id: row.id, name: row.name, orders: row.orders,
      completedOrders: 0, cancelledOrders: 0,
      garmentChargePaise: 0, servicesPaise: row.revenuePaise,
      revenuePaise: row.revenuePaise, sharePercent: row.sharePercent,
    })),
  };

  return (
    <Screen refreshing={busy} onRefresh={load} resetOn={tab}>
      <PageTitle title="Revenue" subtitle={data ? `${data.range.label}${data.range.from ? ` · ${shortDate(data.range.from)} to ${shortDate(data.range.to)}` : ""}` : "Where the money came from, not just the total"} />

      {/* Six filters as six rows of buttons filled the screen before a single
          figure appeared. As six compact fields they fit above the summary, they
          combine, and one control puts them all back. */}
      <FilterRow
        specs={[
          {
            key: "preset", label: "Date range", allLabel: "This month",
            options: (data?.presets ?? DATE_PRESETS).map((p) => ({ value: p.value, label: p.label })),
          },
          {
            key: "societyId", label: "Society", allLabel: "Select society",
            options: societies.map((sc) => ({ value: sc.id, label: sc.name })),
          },
          {
            key: "blockId", label: "Block", allLabel: "Select block",
            options: blocks.map((b) => ({ value: b.id, label: b.name })),
          },
          {
            key: "supervisorUserId", label: "Supervisor", allLabel: "Select supervisor",
            options: supervisors.map((sp) => ({ value: sp.id, label: sp.name ?? sp.id })),
          },
          {
            key: "operatorUserId", label: "Operator", allLabel: "Select operator",
            options: operators.map((op) => ({ value: op.id, label: op.name ?? op.id })),
          },
          {
            key: "paymentStatus", label: "Payment status", allLabel: "Any",
            options: (data?.paymentStatuses ?? []).map((v) => ({ value: v, label: titleCase(v) })),
          },
        ]}
        values={{
          preset: preset === "this_month" ? undefined : preset,
          societyId: societyId ?? undefined,
          blockId: blockId ?? undefined,
          supervisorUserId: supervisorUserId ?? undefined,
          operatorUserId: operatorUserId ?? undefined,
          paymentStatus: paymentStatus ?? undefined,
        }}
        onChange={(next) => {
          const societyChanged = (next.societyId ?? null) !== societyId;
          setPreset(next.preset ?? "this_month");
          setSocietyId(next.societyId ?? null);
          // A block, supervisor or operator chosen inside the previous society
          // would silently match nothing once the society moves, so they go with it.
          setBlockId(societyChanged ? null : next.blockId ?? null);
          setSupervisorUserId(societyChanged ? null : next.supervisorUserId ?? null);
          setOperatorUserId(societyChanged ? null : next.operatorUserId ?? null);
          setPaymentStatus(next.paymentStatus ?? null);
        }}
        onClear={clearFilters}
      />
      {preset === "custom" ? (
        <>
          <FieldRow>
            <DateField label="From" value={from} onChange={setFrom} placeholder="Select start date" />
            {/* The end date cannot be dragged behind the start: the calendar will
                not offer those days at all. */}
            <DateField label="To" value={to} onChange={setTo} placeholder="Select end date" minDate={from ?? undefined} />
          </FieldRow>
          {from && to && to < from ? <Notice text="The end date is before the start date." /> : null}
        </>
      ) : null}

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
        <Notice text="Subscription fees are not earned by one block or one person, so they are left out while a location or staff filter is applied." />
      ) : null}

      <SectionTitle>Breakdown</SectionTitle>
      <Tabs
        options={[
          { key: "society", label: "Society" },
          { key: "block", label: "Block" },
          { key: "supervisor", label: "Supervisor" },
          { key: "operator", label: "Operator" },
          { key: "plan", label: "Plan" },
          { key: "service", label: "Service" },
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
          ) : tab === "service" ? (
            <>
              <Row label="Orders" value={row.orders} figure />
              {/* Which services carry the business, without an admin dividing the
                  column in their head. */}
              <Row label="Share of revenue" value={`${row.sharePercent ?? 0}%`} figure />
            </>
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

      {/* Late money, separately. Reported as one figure with the rest, "still to
          collect" put a charge raised this morning beside one ignored for a
          fortnight, and an admin chasing payment could not tell them apart. */}
      <SectionTitle>
        Overdue ({rupees(data?.summary.overduePaise ?? 0)} · {data?.overdueCharges.length ?? 0} orders)
      </SectionTitle>
      <Button label={showOverdue ? "Hide" : "Show overdue"} variant="secondary" onPress={() => setShowOverdue(!showOverdue)} />
      {showOverdue ? (
        <ChargedOrderList rows={data?.overdueCharges ?? []} onOpen={onOpenOrder} emptyText="Nothing is overdue." />
      ) : null}

      <ErrorText error={error} />
    </Screen>
  );
}

// One charged order with everybody and everywhere behind it, which is what makes
// the number in the summary explainable rather than merely stated.
function ChargedOrderList({ rows, onOpen, emptyText }: { rows: ChargedOrderRow[]; onOpen: (id: string) => void; emptyText: string }) {
  return (
    <DataTable
      rows={rows}
      keyOf={(row) => row.id}
      onPress={(row) => onOpen(row.id)}
      empty={emptyText}
      columns={[
        { key: "code", label: "Order ID", width: 130, render: (r) => <Text style={styles.linkCell}>{r.orderCode}</Text> },
        { key: "resident", label: "Resident", width: 130, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.residentName ?? "—"}</Text> },
        { key: "flat", label: "Flat / Unit", width: 90, render: (r) => <Text style={styles.cell}>{r.unitNumber ?? "—"}</Text> },
        { key: "society", label: "Society", width: 140, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.societyName ?? "—"}</Text> },
        { key: "block", label: "Block", width: 90, render: (r) => <Text style={styles.cell}>{r.blockName ?? "—"}</Text> },
        { key: "supervisor", label: "Supervisor", width: 130, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.supervisorName ?? "None"}</Text> },
        { key: "operator", label: "Operator", width: 130, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.operatorName ?? "Unassigned"}</Text> },
        { key: "garments", label: "Garments", width: 80, render: (r) => <Text style={styles.cell}>{r.acceptedCount ?? "—"}</Text> },
        { key: "services", label: "Service", width: 90, render: (r) => <Text style={styles.cell}>{rupees(r.servicesPaise)}</Text> },
        { key: "additional", label: "Additional", width: 90, render: (r) => <Text style={styles.cell}>{rupees(r.additionalChargePaise)}</Text> },
        { key: "total", label: "Total", width: 90, render: (r) => <Text style={styles.amountCell}>{rupees(r.totalPaise)}</Text> },
        { key: "state", label: "Status", width: 120, render: (r) => <StatePill state={r.state} /> },
        {
          key: "payment",
          label: "Payment",
          width: 100,
          render: (r) => (
            <Pill
              text={titleCase(r.paymentStatus)}
              color={r.paymentStatus === "paid" ? theme.success : r.paymentStatus === "pending" ? theme.amber : theme.muted}
            />
          ),
        },
        { key: "date", label: "Date", width: 110, render: (r) => <Text style={styles.cell}>{shortDate(r.createdAt)}</Text> },
      ]}
    />
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
    <Screen refreshing={busy} onRefresh={load} resetOn={openEntry}>
      <PageTitle title="Audit and activity log" subtitle="Every important change, with before and after" />
      <Dropdown
        label="Resource"
        value={resource ?? undefined}
        options={["user", "society", "block", "slot", "order", "plan", "issue", "service_request", "offering", "schedule", "system_config"]
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

// System configuration.
//
// It was one long single column: a full-width box for every setting, twelve garment
// prices stacked one per row each holding two digits, and a service catalogue whose
// every card carried three full-width buttons. Reaching Sign out meant scrolling
// past all of it.
//
// The same settings, grouped into the sections they belong to and laid out in rows
// where the values are short — which is most of them. Adding a service opens in the
// middle of the screen like every other creation flow here, rather than pushing the
// page down; the yes/no rules are switches rather than a row and a button restating
// each other; and Sign out sits at the foot, styled as the thing you do last and
// not as another configuration control.
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
      {/* Appearance sits at the top of every profile screen rather than buried under
          the account fields: it is the one setting here that changes what the person
          is looking at while they look at it. */}
      <SectionTitle>Appearance</SectionTitle>
      <Card><AppearanceSetting /></Card>

      <Notice text="These settings apply platform-wide. Every change is written to the audit log with its previous and new value." />

      {/* ------------------------------------------------- general settings */}
      <SectionTitle>General settings</SectionTitle>
      <Card>
        <FieldRow>
          <Field label="Additional garment rate for subscribers (₹ per garment)" value={rate} onChangeText={setRate} keyboardType="number-pad" width="small" />
          <Field label="Pay per garment rate without a plan (₹ per garment)" value={guestRate} onChangeText={setGuestRate} keyboardType="number-pad" width="small" />
          <Field label="Garment categories (comma separated)" value={categories} onChangeText={setCategories} width="wide" />
        </FieldRow>
        <Text style={styles.meta}>
          Subscription is optional. A resident without a plan pays the second rate for every garment.
        </Text>
      </Card>

      {/* --------------------------------------------- default slot settings */}
      <SectionTitle>Default slot settings</SectionTitle>
      <Card>
        <FieldRow>
          <Field label="Default slot capacity" value={capacity} onChangeText={setCapacity} keyboardType="number-pad" width="small" />
          <Field label="Default turnaround hours" value={turnaround} onChangeText={setTurnaround} keyboardType="number-pad" width="small" />
          <Field label="Delay grace hours" value={grace} onChangeText={setGrace} keyboardType="number-pad" width="small" />
        </FieldRow>
        <Text style={styles.meta}>
          These values are used as defaults while creating new slots. They can be edited at any time.
        </Text>
      </Card>

      {/* ------------------------------------------------- garment pricing */}
      <SectionTitle>Garment prices for non-plan residents</SectionTitle>
      <Card>
        <Text style={styles.meta}>
          What a resident with no plan pays for one garment, before any service charge. These prices
          are separate from subscriptions: changing them never alters a plan&apos;s allowance or what
          it covers.
        </Text>
        {/* A price is four characters. One per full-width row was a screen of boxes
            each holding two digits. */}
        <FieldRow>
          {(config?.garmentCategories ?? []).map((category) => (
            <Field
              key={category}
              label={category}
              value={garmentPrices[category] != null ? String(garmentPrices[category] / 100) : ""}
              placeholder={`Default ${(config?.nonSubscriberGarmentRatePaise ?? 0) / 100}`}
              keyboardType="number-pad"
              width="small"
              onChangeText={(value) => setGarmentPrices((current) => {
                const next = { ...current };
                if (value.trim() === "") delete next[category];
                else next[category] = Math.max(0, Math.round(Number(value || 0) * 100));
                return next;
              })}
            />
          ))}
        </FieldRow>
      </Card>

      {/* -------------------------------------------------- garment services */}
      <SectionTitle action={<Button label="+ Add new service" variant="secondary" onPress={() => setAddingService(true)} />}>
        Garment services
      </SectionTitle>
      <Text style={styles.meta}>
        A service is priced per garment category, because pressing a saree is not pressing a shirt.
        Each service also says what physically has to happen to the garment, which is what lets an
        Iron Only order skip washing.
      </Text>

      <CenteredModal
        visible={addingService}
        title="New garment service"
        onClose={() => setAddingService(false)}
        dirty={Boolean(newName)}
        discardMessage="Are you sure you want to discard this service?"
        footer={(
          <WizardFooter onNext={addService} nextLabel="Add service" nextDisabled={!newName.trim()} />
        )}
      >
        <FieldRow>
          <Field label="Service name" value={newName} onChangeText={setNewName} placeholder="Starch and Press" width="medium" />
          {/* A price is four characters, not a line. */}
          <Field label="Price per garment (₹)" value={newPrice} onChangeText={setNewPrice} keyboardType="number-pad" width="small" />
        </FieldRow>
        <Toggle
          label="Needs cleaning"
          value={newRequiresClean}
          onChange={setNewRequiresClean}
          hint="A press-only service skips washing entirely."
        />
        {newRequiresClean ? (
          <Dropdown
            label="Cleaning"
            value={newCleanStage}
            allowClear={false}
            options={[
              { value: "wash", label: "Wash" },
              { value: "dry_clean", label: "Dry clean" },
              { value: "premium", label: "Premium care" },
            ]}
            onChange={(v) => { if (v) setNewCleanStage(v as typeof newCleanStage); }}
            width="medium"
          />
        ) : null}
        <Toggle label="Needs ironing" value={newRequiresPress} onChange={setNewRequiresPress} />
        <ErrorText error={error} />
      </CenteredModal>

      {/* Two across rather than one per screen width, with compact actions rather
          than three full-width buttons stacked under every card. */}
      <CardGrid columns={{ desktop: 2, tablet: 2, mobile: 1 }}>
        {services.map((service, index) => (
          <Card key={service.id}>
            <View style={styles.headRow}>
              <Text style={styles.title}>{service.name}</Text>
              <Pill
                text={service.isBase ? "Base" : service.isActive ? "Active" : "Off"}
                color={service.isBase ? theme.aqua : service.isActive ? theme.success : theme.muted}
              />
            </View>
            <Text style={styles.meta}>
              {[service.requiresClean ? ({ wash: "Wash", dry_clean: "Dry clean", premium: "Premium care" }[service.cleanStage ?? "wash"]) : null,
                service.requiresPress ? "Iron" : null].filter(Boolean).join(" then ") || "No processing"}
            </Text>
            <Field
              label="Price per garment (₹)"
              value={String(service.unitPricePaise / 100)}
              keyboardType="number-pad"
              width="small"
              onChangeText={(value) => setServices((current) => {
                const next = [...current];
                next[index] = { ...next[index], unitPricePaise: Math.max(0, Math.round(Number(value || 0) * 100)) };
                return next;
              })}
            />
            <View style={styles.buttonRow}>
              <CardAction
                label={expandedService === service.id ? "Hide per-garment prices" : "Set pay-as-you-go price"}
                onPress={() => setExpandedService(expandedService === service.id ? null : service.id)}
              />
              <CardAction
                label={service.isActive ? "Turn off service" : "Turn on service"}
                onPress={() => setServices((current) => {
                  const next = [...current];
                  next[index] = { ...next[index], isActive: !next[index].isActive };
                  return next;
                })}
              />
              {!service.isBase ? (
                <CardAction label="Retire service" tone="danger" onPress={() => retireService(service)} />
              ) : null}
            </View>
            {expandedService === service.id ? (
              <>
                {/* A category left blank falls back to the default price above, so
                    an admin only has to price the garments that genuinely differ. */}
                <Text style={styles.meta}>Leave a garment blank to charge the default price for it.</Text>
                <FieldRow>
                  {(config?.garmentCategories ?? []).map((category) => (
                    <Field
                      key={category}
                      label={category}
                      value={service.pricesPaise?.[category] != null ? String(service.pricesPaise[category] / 100) : ""}
                      placeholder={`Default ${service.unitPricePaise / 100}`}
                      keyboardType="number-pad"
                      width="small"
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
                </FieldRow>
              </>
            ) : null}
          </Card>
        ))}
      </CardGrid>

      {/* --------------------------------------------------- operational rules */}
      <SectionTitle>Operational rules</SectionTitle>
      <Card>
        {/* A switch says what it is and changes it. A row stating "Yes" beside a
            button offering to turn it off is the same fact written twice. */}
        <Toggle
          label="Quality check required"
          value={Boolean(config?.qcRequired)}
          onChange={() => toggle("qcRequired")}
        />
        <Toggle
          label="Notifications enabled"
          value={Boolean(config?.notificationsEnabled)}
          onChange={() => toggle("notificationsEnabled")}
        />
        <Row label="Last updated" value={dateTime(config?.updatedAt)} />
      </Card>

      {/* One primary action for the global settings, one for the catalogue. */}
      <View style={styles.buttonRow}>
        <View style={{ marginRight: 8 }}><Button label="Save configuration" onPress={save} /></View>
        <Button label="Save services" variant="secondary" onPress={saveServices} />
      </View>

      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />

      {/* Last, and on its own: it ends the session rather than changing a setting. */}
      <View style={styles.signOut}>
        <Button label="← Sign out" variant="danger" onPress={onLogout} />
      </View>
    </Screen>
  );
}


// The bookings, with the societies an admin can narrow them by.
function AdminServiceBookings({ token }: { token: string }) {
  const [societies, setSocieties] = useState<Society[]>([]);
  useEffect(() => {
    api.adminSocieties(token).then((r) => setSocieties(r.societies)).catch(() => setSocieties([]));
  }, [token]);
  return (
    <ServiceBookingsScreen
      source={{
        load: (params) => api.adminServiceRequests(token, params),
        societies: societies.map((s) => ({ id: s.id, name: s.name })),
      }}
      title="Service bookings"
      subtitle="Every extra service booked across the platform"
    />
  );
}


// One subscription, whole.
//
// Opening a subscription used to show the eight figures the list already showed
// and nothing else — so what plan the resident was on before, what they have
// paid, when they upgraded or cancelled, and how the allowance is actually being
// spent were all unanswerable from the one screen meant to answer them.
function SubscriptionDetailScreen({ token, id, onBack }: { token: string; id: string; onBack: () => void }) {
  const [data, setData] = useState<SubscriptionDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await api.adminSubscription(id, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, id]);
  useEffect(() => { load(); }, [load]);

  if (busy && !data) return <Loading />;
  if (!data) {
    return <Screen><BackLink label="Subscriptions" onPress={onBack} /><ErrorText error={error} /></Screen>;
  }
  const { subscription: sub, resident } = data;

  return (
    <Screen refreshing={busy} onRefresh={load} resetOn={id}>
      <BackLink label="Subscriptions" onPress={onBack} />
      <PageTitle
        title={resident?.fullName ?? "Unnamed resident"}
        subtitle={[resident?.societyName, resident?.blockName, resident?.unitNumber].filter(Boolean).join(" · ")}
      />

      <SectionTitle>Resident</SectionTitle>
      <Card>
        <Row label="Name" value={resident?.fullName} />
        <Row label="Phone" value={resident?.phone} figure />
        <Row label="Email" value={resident?.email} />
        <Row label="Society" value={resident?.societyName} />
        <Row label="Tower" value={resident?.blockName} />
        <Row label="Flat" value={resident?.unitNumber} figure />
      </Card>

      <SectionTitle>Current subscription</SectionTitle>
      <Card>
        <View style={styles.headRow}>
          <Text style={styles.title}>{sub.planTier ?? "No plan"}</Text>
          <Pill text={titleCase(sub.status)} color={sub.status === "active" ? theme.success : theme.muted} />
        </View>
        <Row label="Monthly price" value={sub.monthlyPaise !== null ? rupees(sub.monthlyPaise) : "—"} figure />
        <Row label="Billing cycle" value={titleCase(sub.cycle ?? "monthly")} />
        <Row label="Started" value={shortDate(sub.cycleStart)} />
        <Row label="Renews" value={shortDate(sub.cycleEnd)} />
        <Row label="Auto renew" value={sub.autoRenew ? "Yes" : "No"} />
        {sub.cancelReason ? <Row label="Cancelled because" value={sub.cancelReason} /> : null}
        <Row label="Subscription ID" value={sub.id} figure />
      </Card>

      <SectionTitle>Usage</SectionTitle>
      <Card>
        <Row label="Allowance" value={sub.allowance ?? "—"} figure />
        <Row label="Used" value={sub.garmentsUsed} figure />
        <Row label="Remaining" value={sub.remaining ?? "—"} figure />
        <Row label="Used so far" value={sub.usagePercent !== null ? `${sub.usagePercent}%` : "—"} figure />
      </Card>

      {/* One figure cannot say "40 kg of washing and 30 pieces of ironing". */}
      {data.services.length ? (
        <>
          <SectionTitle>Services in this plan</SectionTitle>
          <Card>
            {data.services.map((a) => (
              <Row key={a.serviceId} label={a.serviceName} value={a.remainingLabel} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Payments</SectionTitle>
      <Card>
        {data.payments.length ? data.payments.map((p, i) => (
          <Row
            key={`${p.reference}-${i}`}
            label={`${shortDate(p.at)} · ${p.reference}`}
            value={`${p.direction === "credit" ? "+" : "−"}${rupees(p.amountPaise)}`}
            figure
          />
        )) : <Empty text="No payments recorded against this resident." />}
      </Card>

      {/* Read-only: a past subscription is a record of what happened, not a row to
          correct. */}
      <SectionTitle>Previous subscriptions</SectionTitle>
      <Card>
        {data.previousSubscriptions.length ? data.previousSubscriptions.map((p) => (
          <Row
            key={p.id}
            label={`${shortDate(p.cycleStart)} · ${p.planTier ?? "Unknown plan"}`}
            value={`${p.monthlyPaise !== null ? rupees(p.monthlyPaise) : "—"} · ${titleCase(p.status)}`}
          />
        )) : <Empty text="This is their first subscription." />}
      </Card>

      <SectionTitle>Activity</SectionTitle>
      <Card>
        {data.activity.length ? data.activity.map((a, i) => (
          <Row
            key={`${a.at}-${i}`}
            label={titleCase(a.action.replace(/[._]/g, " "))}
            value={`${dateTime(a.at)}${a.actor ? ` · ${a.actor}` : ""}`}
          />
        )) : <Empty text="Nothing recorded against this subscription yet." />}
      </Card>

      <ErrorText error={error} />
    </Screen>
  );
}

const styles = themed((theme) => ({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 2, marginBottom: 4 },
  amount: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal },
  buttonRow: { flexDirection: "row" },
  json: { fontSize: 10, color: theme.muted, marginTop: 6, fontFamily: "monospace" },
  alertRow: { flexDirection: "row", alignItems: "center" },
  alertDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  alertText: { fontSize: 14, fontFamily: font.bold, color: theme.deepTeal },
  cardTitle: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal, flex: 1 },
  activityRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 6 },
  activityWhat: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal },
  activityWho: { fontSize: 11, color: theme.muted, marginTop: 2 },
  activityWhen: { fontSize: 11, color: theme.muted, marginLeft: 10 },
  changeRow: { marginTop: 8 },
  changeField: { fontSize: 11, color: theme.muted, fontFamily: font.bold, textTransform: "uppercase" },
  changeValue: { fontSize: 13, marginTop: 2 },
  changeBefore: { color: theme.muted, textDecorationLine: "line-through" },
  changeAfter: { color: theme.deepTeal, fontFamily: font.bold },
  rowLink: { flexDirection: "row", alignItems: "center" },
  signOut: { alignSelf: "flex-start", marginTop: 18 },
  cell: { fontSize: 13, color: theme.slate },
  linkCell: { fontSize: 13, color: theme.deepTeal, fontFamily: font.bold },
  amountCell: { fontSize: 13, color: theme.deepTeal, fontFamily: font.bold },
  blockList: { flexDirection: "row", flexWrap: "wrap", marginTop: 6, marginHorizontal: -4 },
  blockItem: { minWidth: 130, paddingHorizontal: 4, marginBottom: 8 },
  dateActions: { marginBottom: 10, marginRight: 10, justifyContent: "flex-end" },
  emptyActions: { alignSelf: "flex-start", marginTop: 10 },
  rowLinkAction: { color: theme.aqua, fontSize: 12, fontFamily: font.bold, marginLeft: 10 },
}));
