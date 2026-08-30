import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { ServiceRequestView, AdminServiceRow, ServiceFilterOptions, Plan, Society } from "../api/types";
import { font, theme, rupees, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Empty, ErrorText, Notice,
  Pill, CardGrid,
} from "../components/ui";
import { ConfirmDialog, FilterRow } from "../components/filters";
import { CenteredModal } from "../components/modal";
import { RecordCard, CardAction, orDash } from "../components/records";
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
//
// Two things changed again in this round. The card is now the way into a service:
// tapping it shows everything that was configured for it, rather than a "More"
// button that revealed two more buttons. And the creation form opens in the middle
// of the screen with this page out of reach behind it, like every other creation
// flow in the portal, instead of replacing the page and losing where you were.

export function AdminServicesScreen({ token }: { token: string }) {
  const [services, setServices] = useState<AdminServiceRow[]>([]);
  const [filters, setFilters] = useState<ServiceFilterOptions | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [societies, setSocieties] = useState<Society[]>([]);

  // What the admin is looking for. Answered by the backend rather than by filtering a
  // full download here, so the export matches what is on screen.
  const [q, setQ] = useState("");
  const search = useDebounced(q, 250);
  // The category filter is gone: three categories over a handful of services is a
  // control that never narrows anything.
  const [eligibility, setEligibility] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [unit, setUnit] = useState<string | undefined>(undefined);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  // The whole configuration of one service, shown because its card was tapped.
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);
  const [bookings, setBookings] = useState<ServiceRequestView[] | null>(null);
  const [deactivating, setDeactivating] = useState<AdminServiceRow | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [listed, planned, societyList] = await Promise.all([
        api.adminOfferings(token, { q: search || undefined, eligibility, status, unit }),
        api.adminPlans(token),
        api.adminSocieties(token),
      ]);
      setServices(listed.services);
      setFilters(listed.filters);
      setPlans(planned.plans);
      setSocieties(societyList.societies);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, search, eligibility, status, unit]);
  useEffect(() => { load(); }, [load]);

  const openEditor = async (row: AdminServiceRow) => {
    setNote(null); setError(null); setBookings(null); setViewing(null);
    try {
      // The whole configuration, because Edit opens the same wizard pre-filled.
      const full = await api.adminOffering(row.id, token);
      setEditing(full.service);
    } catch (e) { setError((e as Error).message); }
  };

  // Tapping the card shows everything the service was configured with, rather than
  // making the admin walk the wizard to find out what it says.
  const openDetails = async (row: AdminServiceRow) => {
    setNote(null); setError(null); setBookings(null);
    try {
      const full = await api.adminOffering(row.id, token);
      setViewing(full.service);
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

  const showBookings = async (id: string) => {
    setError(null);
    try { setBookings((await api.adminOfferingBookings(id, token)).bookings); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Services"
        right={<Button label="+ Add new service" variant="secondary" onPress={() => { setNote(null); setCreating(true); }} />}
      />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      {/* In the middle of the screen, in a card of its own, with this page behind
          it out of reach — the same shape as every other creation flow here. */}
      <CenteredModal
        visible={creating || Boolean(editing)}
        title={editing ? `Edit ${String(editing.name ?? "service")}` : "New service"}
        onClose={() => { setCreating(false); setEditing(null); }}
        width="wide"
      >
        <ServiceWizard
          token={token}
          plans={plans}
          societies={societies}
          existing={editing}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSaved={async (message) => { setCreating(false); setEditing(null); setNote(message); await load(); }}
        />
      </CenteredModal>

      <ServiceDetails
        service={viewing}
        bookings={bookings}
        onBookings={showBookings}
        onClose={() => { setViewing(null); setBookings(null); }}
      />

      <FilterRow
        specs={[
          {
            key: "eligibility", label: "Customer availability", allLabel: "Everyone",
            options: (filters?.eligibilities ?? []).map((e) => ({ value: e, label: titleCase(e.replace("_", " ")) })),
          },
          {
            key: "status", label: "Status", allLabel: "Any status",
            options: (filters?.statuses ?? []).map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            key: "unit", label: "Unit", allLabel: "Any unit",
            options: (filters?.units ?? []).map((u) => ({ value: u, label: perUnitLabel(u) })),
          },
        ]}
        values={{ eligibility, status, unit }}
        onChange={(next) => {
          setEligibility(next.eligibility);
          setStatus(next.status);
          setUnit(next.unit);
        }}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Name or unit"
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

      {/* The card is a compact summary; the whole configuration appears when it is
          tapped. There is no View button, because a button beside a card that is
          already showing what it knows is a button that says nothing. */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {services.map((row) => (
          <RecordCard
            key={row.id}
            title={row.name}
            badge={<Pill text={row.isActive ? "Active" : "Inactive"} color={row.isActive ? theme.success : theme.muted} />}
            onOpen={() => openDetails(row)}
            fields={[
              { label: "Category", value: orDash(row.categoryLabel) },
              { label: "Unit", value: orDash(perUnitLabel(row.unit)) },
              {
                label: "Subscriber",
                value: orDash(row.includedInPlans.length
                  ? `Included in ${row.includedInPlans.join(", ")}`
                  : row.subscriberPricePaise != null ? rupees(row.subscriberPricePaise) : "Same as everybody"),
              },
              { label: "Non-subscriber", value: orDash(rupees(row.nonSubscriberPricePaise)) },
              { label: "Availability", value: orDash(titleCase(row.availability.replace(/_/g, " "))) },
            ]}
            actions={(
              <>
                <CardAction label="Edit" onPress={() => openEditor(row)} />
                <CardAction
                  label={row.isActive ? "Deactivate" : "Activate"}
                  tone={row.isActive ? "danger" : "good"}
                  onPress={() => (row.isActive ? setDeactivating(row) : setActive(row, true))}
                />
                <CardAction label="Duplicate" onPress={() => duplicate(row)} />
              </>
            )}
          />
        ))}
      </CardGrid>

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

// Everything one service was configured with, in the middle of the screen.
//
// A field that does not apply reads as "—" rather than as a blank, because a blank
// beside a label is indistinguishable from something that failed to load.
function ServiceDetails({ service, bookings, onBookings, onClose }: {
  service: Record<string, unknown> | null;
  bookings: ServiceRequestView[] | null;
  onBookings: (id: string) => void;
  onClose: () => void;
}) {
  if (!service) return null;
  const text = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  };
  const money = (value: unknown): string =>
    typeof value === "number" ? rupees(value) : "—";
  const id = String(service.id ?? "");

  return (
    <CenteredModal visible title={String(service.name ?? "Service")} onClose={onClose} width="wide">
      <Row label="Category" value={text(service.category).replace(/_/g, " ")} />
      <Row label="Vehicle type" value={text(service.vehicleTypes)} />
      <Row label="Description" value={text(service.description)} />
      <Row label="Service type" value={text(service.kind)} />
      <Row label="Measured in" value={text(service.unit)} />

      <SectionTitle>Who it is for</SectionTitle>
      <Row label="Customer type" value={text(service.eligibility).replace(/_/g, " ")} />
      <Row label="Eligible plans" value={text(service.eligiblePlanIds)} />

      <SectionTitle>Pricing</SectionTitle>
      <Row label="Non-subscriber price" value={money(service.unitPricePaise)} />
      <Row label="Subscriber price" value={money(service.subscriberUnitPricePaise)} />
      <Row label="How often" value={text(service.frequency)} />

      <SectionTitle>Availability</SectionTitle>
      <Row label="Offered in" value={text(service.availabilityScope).replace(/_/g, " ")} />
      <Row label="Societies" value={text(service.societyIds)} />
      <Row label="Work done" value={text(service.mode).replace(/_/g, " ")} />
      <Row label="Operating days" value={text(service.operatingDays)} />

      <SectionTitle>Options and extras</SectionTitle>
      <Row label="Options" value={text((service.options as { label?: string }[] ?? []).map((o) => o.label))} />
      <Row label="Add-ons" value={text((service.addOns as { name?: string }[] ?? []).map((a) => a.name))} />
      <Row label="Additional charges" value={text((service.additionalCharges as { label?: string }[] ?? []).map((c) => c.label))} />

      <SectionTitle>Operations</SectionTitle>
      <Row label="Workflow" value={text((service.operations as { workflow?: string[] } | undefined)?.workflow)} />
      <Row label="Status" value={text(service.status)} />
      <Row label="Created" value={service.createdAt ? dateTime(String(service.createdAt)) : "—"} />
      <Row label="Last updated" value={service.updatedAt ? dateTime(String(service.updatedAt)) : "—"} />

      <View style={styles.buttonRow}>
        <Button label="View bookings" variant="secondary" onPress={() => onBookings(id)} />
        <Button label="Close" variant="secondary" onPress={onClose} />
      </View>
      {bookings ? (
        bookings.length
          ? bookings.slice(0, 10).map((b) => (
            <Row key={b.id} label={dateTime(b.scheduledFor)} value={`${b.statusLabel} · ${rupees(b.payablePaise)}`} />
          ))
          : <Empty text="Nothing booked against this service." />
      ) : null}
    </CenteredModal>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 6 },
  buttonRow: { flexDirection: "row", marginTop: 8 },
  cell: { fontSize: 12, color: theme.slate },
  cellMuted: { fontSize: 11, color: theme.muted },
});
