import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { StaffUser, ServiceOffering, ServiceRequestView, ServiceSummary, PageInfo } from "../api/types";
import { theme, rupees, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Empty, ErrorText, Notice,
  Loading, Pill, Stat, StatGrid,
} from "../components/ui";
import { ConfirmDialog, Dropdown, DataTable, Pager, Toggle } from "../components/filters";

// The admin screens the sixth round added: deciding whether a staff account may be
// used at all, and managing the services that are not laundry.

// ------------------------------------------------------------ verifying staff

export function StaffVerificationScreen({ token }: { token: string }) {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [status, setStatus] = useState<string>("pending");
  const [role, setRole] = useState<string | undefined>(undefined);
  const [deciding, setDeciding] = useState<{ user: StaffUser; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setStaff((await api.adminPendingStaff(token, { status, role })).staff); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, role]);
  useEffect(() => { load(); }, [load]);

  const decide = async () => {
    if (!deciding) return;
    setError(null); setMessage(null);
    try {
      await api.adminSetVerification(deciding.user.id, deciding.approve ? "approved" : "rejected", note.trim() || undefined, token);
      setMessage(deciding.approve
        ? `${deciding.user.fullName ?? "The account"} can now use their portal.`
        : `${deciding.user.fullName ?? "The account"} has been refused access.`);
      setDeciding(null); setNote("");
      await load();
    } catch (e) { setError((e as Error).message); setDeciding(null); }
  };

  if (busy && !staff.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Staff verification" subtitle="Who may use their portal" />
      <ErrorText error={error} />
      {message ? <Notice tone="good" text={message} /> : null}

      <Dropdown
        label="Decision"
        value={status}
        options={[
          { value: "pending", label: "Waiting for a decision" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
        ]}
        onChange={(next) => setStatus(next ?? "pending")}
        allLabel="Waiting for a decision"
      />
      <Dropdown
        label="Role"
        value={role}
        options={[{ value: "supervisor", label: "Supervisors" }, { value: "operator", label: "Operators" }]}
        onChange={setRole}
      />

      {status === "pending" && staff.length ? (
        <Notice tone="warn" text={`${staff.length} account${staff.length === 1 ? "" : "s"} cannot sign in to their portal until you decide.`} />
      ) : null}

      {staff.length ? staff.map((user) => (
        <Card key={user.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{user.fullName ?? user.phone}</Text>
            <Pill text={titleCase(user.roles[0] ?? "staff")} color={theme.aqua} />
          </View>
          <Row label="Phone" value={user.phone} />
          <Row label="Employee ID" value={user.employeeId} />
          <Row label="Area" value={user.areaName ?? "Not assigned"} />
          <Row label="Societies" value={user.societyNames?.length ? user.societyNames.join(", ") : "None assigned"} />
          <Row label="Created" value={dateTime(user.createdAt)} />
          {user.verificationNote ? <Row label="Note" value={user.verificationNote} /> : null}
          {user.verifiedAt ? <Row label="Decided" value={dateTime(user.verifiedAt)} /> : null}

          {status === "pending" ? (
            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Button label="Approve" onPress={() => setDeciding({ user, approve: true })} />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Button label="Reject" variant="danger" onPress={() => setDeciding({ user, approve: false })} />
              </View>
            </View>
          ) : status === "rejected" ? (
            <Button label="Approve after all" variant="secondary" onPress={() => setDeciding({ user, approve: true })} />
          ) : null}
        </Card>
      )) : <Empty text={status === "pending" ? "Nothing waiting for a decision." : "Nothing here."} />}

      <ConfirmDialog
        visible={Boolean(deciding)}
        title={deciding?.approve ? "Approve this account?" : "Reject this account?"}
        message={deciding?.approve
          ? "They will be able to sign in to their portal straight away."
          : "They will be able to sign in but will not be let into their portal."}
        confirmLabel={deciding?.approve ? "Approve" : "Reject"}
        destructive={!deciding?.approve}
        onConfirm={decide}
        onCancel={() => { setDeciding(null); setNote(""); }}
      />
      {deciding ? (
        <Card>
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Why, for the record" />
        </Card>
      ) : null}
    </Screen>
  );
}

// -------------------------------------------------- the services that are not laundry

export function AdminServicesScreen({ token }: { token: string }) {
  const [requests, setRequests] = useState<ServiceRequestView[]>([]);
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [summary, setSummary] = useState<ServiceSummary | null>(null);
  const [page, setPage] = useState<PageInfo>({ total: 0, limit: 20, offset: 0, hasMore: false });
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<ServiceOffering | null>(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (offset = 0) => {
    setBusy(true); setError(null);
    try {
      const [listed, offered] = await Promise.all([
        api.adminServices(token, { status, kind, limit: "20", offset: String(offset) }),
        api.adminServiceOfferings(token),
      ]);
      setRequests(listed.requests);
      setPage(listed.page);
      setSummary(listed.summary);
      setOfferings(offered.offerings);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, kind]);
  useEffect(() => { load(0); }, [load]);

  const savePrice = async () => {
    if (!editing) return;
    const paise = Math.round(Number(price) * 100);
    if (!Number.isFinite(paise) || paise < 0) { setError("Give a price in rupees."); return; }
    setError(null);
    try {
      await api.adminUpdateOffering(editing.id, { unitPricePaise: paise }, token);
      setNote(`${editing.name} repriced. Bookings already made keep the price they were quoted.`);
      setEditing(null); setPrice("");
      await load(page.offset);
    } catch (e) { setError((e as Error).message); }
  };

  const setActive = async (offering: ServiceOffering, isActive: boolean) => {
    setError(null);
    try {
      await api.adminUpdateOffering(offering.id, { isActive }, token);
      setNote(isActive ? `${offering.name} is available again.` : `${offering.name} withdrawn. Bookings already made are unaffected.`);
      await load(page.offset);
    } catch (e) { setError((e as Error).message); }
  };

  if (busy && !requests.length && !offerings.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={() => load(page.offset)}>
      <PageTitle title="Other services" subtitle="Vehicle washing and at-home ironing" />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      {summary ? (
        <>
          <SectionTitle>How they are going</SectionTitle>
          <StatGrid>
            <Stat label="Requested" value={summary.requested} tone="warn" />
            <Stat label="Assigned" value={summary.assigned} />
            <Stat label="In progress" value={summary.inProgress} />
            <Stat label="Completed" value={summary.completed} tone="good" />
            <Stat label="Cancelled" value={summary.cancelled} />
          </StatGrid>
          <Card>
            {summary.byKind.map((k) => (
              <Row key={k.kind} label={k.label} value={`${k.open} open of ${k.total}`} />
            ))}
            <Row label="Collected" value={rupees(summary.revenuePaise)} />
            <Row label="Awaiting payment" value={rupees(summary.pendingPaise)} />
          </Card>
        </>
      ) : null}

      <SectionTitle>What is offered</SectionTitle>
      {offerings.map((offering) => (
        <Card key={offering.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{offering.name}</Text>
            <Pill
              text={offering.pricingBasis === "per_hour" ? `${rupees(offering.unitPricePaise)} / hour` : rupees(offering.unitPricePaise)}
              color={offering.isActive ? theme.aqua : theme.muted}
            />
          </View>
          <Text style={styles.meta}>
            {titleCase(offering.kind.replace("_", " "))}
            {offering.vehicleTypes.length ? ` · ${offering.vehicleTypes.join(", ")}` : ""}
            {offering.minimumHours ? ` · minimum ${offering.minimumHours}h` : ""}
          </Text>
          <Toggle
            label="Offered to residents"
            value={offering.isActive}
            hint={offering.isActive ? "Residents can book this." : "Withdrawn. Existing bookings are unaffected."}
            onChange={(on) => setActive(offering, on)}
          />
          <Button
            label="Change price"
            variant="secondary"
            onPress={() => { setEditing(offering); setPrice(String(offering.unitPricePaise / 100)); }}
          />
        </Card>
      ))}

      {editing ? (
        <Card>
          <SectionTitle>Reprice {editing.name}</SectionTitle>
          <Field
            label={editing.pricingBasis === "per_hour" ? "Rupees per hour" : "Rupees per job"}
            value={price} onChangeText={setPrice} keyboardType="number-pad"
          />
          <Notice text="Bookings already made keep the price they were quoted." />
          <Button label="Save price" onPress={savePrice} />
          <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
        </Card>
      ) : null}

      <SectionTitle>Bookings</SectionTitle>
      <Dropdown
        label="Status"
        value={status}
        options={["requested", "assigned", "in_progress", "completed", "cancelled"].map((s) => ({ value: s, label: titleCase(s) }))}
        onChange={setStatus}
      />
      <Dropdown
        label="Service"
        value={kind}
        options={[{ value: "vehicle_wash", label: "Vehicle washing" }, { value: "home_ironing", label: "At-home ironing" }]}
        onChange={setKind}
      />
      <DataTable
        columns={[
          { key: "service", label: "Service", width: 140, render: (r: ServiceRequestView) => <Text style={styles.cell}>{r.offeringName}</Text> },
          { key: "when", label: "When", width: 130, render: (r) => <Text style={styles.cellMuted}>{dateTime(r.scheduledFor)}</Text> },
          { key: "status", label: "Status", width: 110, render: (r) => <Pill text={r.statusLabel} color={theme.aqua} /> },
          { key: "cost", label: "Cost", width: 90, render: (r) => <Text style={styles.cell}>{rupees(r.payablePaise)}</Text> },
        ]}
        rows={requests}
        keyOf={(r) => r.id}
        empty="No bookings match."
      />
      <Pager page={page} onChange={(offset) => load(offset)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 15, fontWeight: "800", color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 6 },
  buttonRow: { flexDirection: "row", marginTop: 8 },
  cell: { fontSize: 12, color: theme.slate },
  cellMuted: { fontSize: 11, color: theme.muted },
});
