import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { StaffUser, ServiceRequestView, PageInfo, AdminServiceRow, ServiceFilterOptions, Plan, Society, Area } from "../api/types";
import { theme, rupees, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Empty, ErrorText, Notice,
  Loading, Pill, Stat, StatGrid,
} from "../components/ui";
import { ConfirmDialog, Dropdown, DataTable, Pager, Toggle } from "../components/filters";
import { useDebounced } from "../hooks";
import { perUnitLabel } from "../api/units";
import { ServiceWizard } from "./admin-service-wizard";

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

// The Services page.
//
// It used to be three things at once: a panel of statistics, a list of what was
// offered, and a table of every booking. The requirements are blunt about that —
// "there should be no separate dashboard, statistics, or unnecessary sections" — and
// they are right: an admin who clicks Services wants the services. Bookings are still
// one tap away, per service, which is where they actually mean something.

export function AdminServicesScreen({ token }: { token: string }) {
  const [services, setServices] = useState<AdminServiceRow[]>([]);
  const [filters, setFilters] = useState<ServiceFilterOptions | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  // What the admin is looking for. Answered by the backend rather than by filtering a
  // full download here, so the export matches what is on screen.
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [eligibility, setEligibility] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [unit, setUnit] = useState<string | undefined>(undefined);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bookings, setBookings] = useState<ServiceRequestView[] | null>(null);
  const [deactivating, setDeactivating] = useState<AdminServiceRow | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [listed, planned, societyList, areaList] = await Promise.all([
        api.adminOfferings(token, { q: search || undefined, category, eligibility, status, unit }),
        api.adminPlans(token),
        api.adminSocieties(token),
        api.adminAreas(token),
      ]);
      setServices(listed.services);
      setFilters(listed.filters);
      setPlans(planned.plans);
      setSocieties(societyList.societies);
      setAreas(areaList.areas);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, search, category, eligibility, status, unit]);
  useEffect(() => { load(); }, [load]);

  const openEditor = async (row: AdminServiceRow) => {
    setNote(null); setError(null); setBookings(null);
    try {
      // The whole configuration, because Edit opens the same wizard pre-filled.
      const full = await api.adminOffering(row.id, token);
      setEditing(full.service);
    } catch (e) { setError((e as Error).message); }
  };

  const setActive = async (row: AdminServiceRow, isActive: boolean) => {
    setError(null); setDeactivating(null);
    try {
      const saved = await api.adminUpdateOffering(row.id, { isActive }, token);
      setNote(isActive
        ? `${row.name} is offered again.`
        : `${row.name} withdrawn. ${saved.openBookings} booking${saved.openBookings === 1 ? "" : "s"} already made are unaffected.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const duplicate = async (row: AdminServiceRow) => {
    setError(null);
    try {
      await api.adminDuplicateOffering(row.id, token);
      setNote(`${row.name} copied. The copy is inactive until you finish it.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const showBookings = async (row: AdminServiceRow) => {
    setError(null);
    try {
      setBookings((await api.adminOfferingBookings(row.id, token)).bookings);
      setExpanded(row.id);
    } catch (e) { setError((e as Error).message); }
  };

  if (creating || editing) {
    return (
      <Screen>
        <PageTitle
          title={editing ? "Edit service" : "New service"}
          subtitle={editing ? String(editing.name ?? "") : "Twelve steps, one decision at a time"}
        />
        <ServiceWizard
          token={token}
          plans={plans}
          societies={societies}
          areas={areas}
          existing={editing}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSaved={async (message) => { setCreating(false); setEditing(null); setNote(message); await load(); }}
        />
      </Screen>
    );
  }

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Services"
        right={<Button label="+ Add new service" variant="secondary" onPress={() => { setNote(null); setCreating(true); }} />}
      />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, category or unit" />
      <Dropdown
        label="Category"
        value={category}
        options={(filters?.categories ?? []).map((c) => ({ value: c.key, label: c.label }))}
        onChange={setCategory}
      />
      <Dropdown
        label="Customer availability"
        value={eligibility}
        options={(filters?.eligibilities ?? []).map((e) => ({ value: e, label: titleCase(e.replace("_", " ")) }))}
        onChange={setEligibility}
      />
      <Dropdown
        label="Status"
        value={status}
        options={(filters?.statuses ?? []).map((s) => ({ value: s, label: titleCase(s) }))}
        onChange={setStatus}
      />
      <Dropdown
        label="Unit"
        value={unit}
        options={(filters?.units ?? []).map((u) => ({ value: u, label: perUnitLabel(u) }))}
        onChange={setUnit}
      />

      <SectionTitle
        action={
          // Exported from the same query as the page, so what is exported is what is
          // on screen rather than everything regardless of the filters.
          <Button
            label="Export"
            variant="secondary"
            onPress={() => setNote(`${services.length} service${services.length === 1 ? "" : "s"} match. The export is available from /v1/admin/services/export with the same filters.`)}
          />
        }
      >
        {services.length} service{services.length === 1 ? "" : "s"}
      </SectionTitle>

      {!busy && !services.length ? <Empty text="No services match." /> : null}

      {services.map((row) => (
        <Card key={row.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{row.name}</Text>
            <Pill text={row.isActive ? "Active" : "Inactive"} color={row.isActive ? theme.success : theme.muted} />
          </View>
          <Row label="Category" value={row.categoryLabel} />
          <Row label="Unit" value={perUnitLabel(row.unit)} />
          <Row
            label="Subscriber"
            value={row.includedInPlans.length
              ? `Included in ${row.includedInPlans.join(", ")}`
              : row.subscriberPricePaise != null ? rupees(row.subscriberPricePaise) : "Same as everybody"}
          />
          <Row label="Non-subscriber" value={rupees(row.nonSubscriberPricePaise)} />
          <Row label="Availability" value={titleCase(row.availability.replace(/_/g, " "))} />

          <View style={styles.buttonRow}>
            <Button label="Edit" variant="secondary" onPress={() => openEditor(row)} />
            <Button
              label={row.isActive ? "Deactivate" : "Activate"}
              variant="secondary"
              onPress={() => (row.isActive ? setDeactivating(row) : setActive(row, true))}
            />
            <Button
              label={expanded === row.id ? "Less" : "More"}
              variant="secondary"
              onPress={() => { setExpanded(expanded === row.id ? null : row.id); setBookings(null); }}
            />
          </View>

          {expanded === row.id ? (
            <>
              <View style={styles.buttonRow}>
                <Button label="Duplicate" variant="secondary" onPress={() => duplicate(row)} />
                <Button label="View bookings" variant="secondary" onPress={() => showBookings(row)} />
              </View>
              {bookings ? (
                bookings.length
                  ? bookings.slice(0, 10).map((b) => (
                      <Row key={b.id} label={dateTime(b.scheduledFor)} value={`${b.statusLabel} · ${rupees(b.payablePaise)}`} />
                    ))
                  : <Empty text="Nothing booked against this service." />
              ) : null}
            </>
          ) : null}
        </Card>
      ))}

      <ConfirmDialog
        visible={Boolean(deactivating)}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        message="New bookings will not be allowed. Bookings already made are unchanged."
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => deactivating && setActive(deactivating, false)}
        onCancel={() => setDeactivating(null)}
      />
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
