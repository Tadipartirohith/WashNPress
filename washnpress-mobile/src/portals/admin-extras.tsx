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

// The admin screens for the services that are not laundry.

// The standalone Verification page is gone. Approving somebody is part of managing
// them: an admin approves a supervisor from the Supervisors section, and a supervisor
// approves their own operators from the Operators section. An admin who had just
// created a supervisor should not have to go somewhere else to let them in.

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
