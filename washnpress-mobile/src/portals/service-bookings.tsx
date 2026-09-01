import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { PageInfo, ServiceOffering, ServiceSummary, StaffServiceRequest } from "../api/types";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Stat, StatGrid, BackLink,
  Empty, ErrorText, Loading, Notice, Pill,
} from "../components/ui";
import { DataTable, Dropdown, FilterRow, Pager, type FilterValues } from "../components/filters";
import { theme, space, type, rupees, dateTime, titleCase } from "../theme";

// Service bookings, for whoever is responsible for them.
//
// A booking used to go into the operator's queue and stop being visible: an admin
// could see which services existed and, one service at a time, who had booked
// that one; a supervisor could see nothing at all and had to ask the operator who
// was handling what. A service that is created and then disappears is not a
// workflow anybody can manage.
//
// The same screen serves both, because the question is the same one — who booked
// this, who is doing it, and what stage is it at — and only the scope differs. A
// supervisor sees their own society, an admin sees all of them and can narrow.

export interface ServiceBookingsSource {
  load: (params: Record<string, string | undefined>) => Promise<{
    requests: StaffServiceRequest[];
    page: PageInfo;
    summary: ServiceSummary;
    offerings: ServiceOffering[];
  }>;
  // Admins choose a society; a supervisor has exactly one and is not asked.
  societies?: { id: string; name: string }[];
}

const STATUSES = ["requested", "assigned", "in_progress", "completed", "cancelled"];

export function ServiceBookingsScreen({ source, title, subtitle }: {
  source: ServiceBookingsSource;
  title: string;
  subtitle: string;
}) {
  const [values, setValues] = useState<FilterValues>({});
  const [rows, setRows] = useState<StaffServiceRequest[]>([]);
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [summary, setSummary] = useState<ServiceSummary | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Narrowing changes what is being counted, so the page goes back to its start.
  useEffect(() => { setOffset(0); }, [values.status, values.offeringId, values.societyId]);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await source.load({
        status: values.status, offeringId: values.offeringId, societyId: values.societyId,
        limit: "20", offset: String(offset),
      });
      setRows(res.requests); setPage(res.page); setSummary(res.summary); setOfferings(res.offerings);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [source, values.status, values.offeringId, values.societyId, offset]);
  useEffect(() => { load(); }, [load]);

  if (busy && !rows.length && !summary) return <Loading />;

  const chosen = rows.find((r) => r.id === open) ?? null;
  if (chosen) return <BookingDetail booking={chosen} onBack={() => setOpen(null)} />;

  return (
    <Screen refreshing={busy} onRefresh={load} resetOn={null}>
      <PageTitle title={title} subtitle={subtitle} />

      {summary ? (
        <StatGrid>
          <Stat label="Bookings" value={summary.total} />
          <Stat label="Waiting" value={summary.requested} tone={summary.requested ? "warn" : "default"} />
          <Stat label="With an operator" value={summary.assigned + summary.inProgress} />
          <Stat label="Completed" value={summary.completed} tone="good" />
        </StatGrid>
      ) : null}

      <FilterRow
        specs={[
          { key: "status", label: "Status", allLabel: "Any status", options: STATUSES.map((s) => ({ value: s, label: titleCase(s.replace("_", " ")) })) },
          { key: "offeringId", label: "Service", allLabel: "Any service", options: offerings.map((o) => ({ value: o.id, label: o.name })) },
          ...(source.societies
            ? [{ key: "societyId", label: "Society", allLabel: "Every society", options: source.societies.map((s) => ({ value: s.id, label: s.name })) }]
            : []),
        ]}
        values={values}
        onChange={setValues}
      />

      <Text style={styles.meta}>
        {(page?.total ?? rows.length)} booking{(page?.total ?? rows.length) === 1 ? "" : "s"}
      </Text>

      <DataTable
        rows={rows}
        keyOf={(r) => r.id}
        onPress={(r) => setOpen(r.id)}
        empty="No service bookings match those filters."
        columns={[
          { key: "service", label: "Service", width: 150, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.offeringName}</Text> },
          { key: "resident", label: "Resident", width: 140, render: (r) => <Text style={styles.cell} numberOfLines={1}>{r.residentName ?? "—"}</Text> },
          { key: "where", label: "Society / Flat", width: 170, render: (r) => (
            <Text style={styles.cell} numberOfLines={1}>
              {[r.societyName, r.unitNumber].filter(Boolean).join(" · ") || "—"}
            </Text>
          ) },
          { key: "when", label: "Booked for", width: 150, render: (r) => <Text style={styles.cell}>{dateTime(r.scheduledFor)}</Text> },
          { key: "operator", label: "Operator", width: 140, render: (r) => (
            <Text style={styles.cell} numberOfLines={1}>{r.assignedToName ?? "Nobody yet"}</Text>
          ) },
          { key: "price", label: "Price", width: 90, render: (r) => <Text style={styles.cell}>{rupees(r.payablePaise)}</Text> },
          { key: "status", label: "Status", width: 120, render: (r) => (
            <Pill text={r.statusLabel} color={statusColour(r.status)} />
          ) },
        ]}
      />
      {page ? <Pager page={page} onChange={setOffset} /> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

// One booking, in the four parts the requirement asks to keep separate: who it is
// for, what was booked, who is doing it, and what has happened.
function BookingDetail({ booking, onBack }: { booking: StaffServiceRequest; onBack: () => void }) {
  return (
    <Screen resetOn={booking.id}>
      <BackLink label="Service bookings" onPress={onBack} />
      <PageTitle title={booking.offeringName} subtitle={booking.statusLabel} />

      <SectionTitle>Resident</SectionTitle>
      <Card>
        <Row label="Name" value={booking.residentName} />
        <Row label="Phone" value={booking.residentPhone} figure />
        <Row label="Society" value={booking.societyName} />
        <Row label="Tower" value={booking.blockName} />
        <Row label="Flat" value={booking.unitNumber} figure />
      </Card>

      <SectionTitle>Booking</SectionTitle>
      <Card>
        <Row label="Service" value={booking.offeringName} />
        <Row label="Type" value={booking.kindLabel} />
        <Row label="Booked for" value={dateTime(booking.scheduledFor)} />
        {booking.vehicleType ? <Row label="Vehicle" value={[booking.vehicleType, booking.vehicleNumber].filter(Boolean).join(" · ")} /> : null}
        {booking.estimatedHours ? <Row label="Estimated hours" value={booking.estimatedHours} figure /> : null}
        <Row label="Address" value={booking.address} />
        <Row label="Price" value={rupees(booking.payablePaise)} figure />
        <Row label="Payment" value={titleCase(booking.chargeStatus)} />
        {booking.notes ? <Row label="Notes" value={booking.notes} /> : null}
        {booking.cancelledReason ? <Row label="Cancelled because" value={booking.cancelledReason} /> : null}
      </Card>

      {/* Who to ask when it has gone wrong. The operator may have been reassigned
          twice and an unassigned booking has none, but the society always has
          somebody answering for it. */}
      <SectionTitle>Supervisor</SectionTitle>
      <Card>
        <Row label="Responsible" value={booking.supervisorName ?? "This society has no supervisor"} />
        <Row label="Society" value={booking.societyName} />
      </Card>

      <SectionTitle>Operator</SectionTitle>
      <Card>
        <Row label="Currently assigned" value={booking.assignedToName ?? "Nobody yet"} />
        <Row label="Accepted" value={booking.acceptedAt ? dateTime(booking.acceptedAt) : "Not yet"} />
      </Card>

      {/* Reassignment does not overwrite who had it before: both are here, with
          when it moved. */}
      {booking.assignments.length > 1 ? (
        <>
          <SectionTitle>Assignment history</SectionTitle>
          <Card>
            {booking.assignments.map((a, i) => (
              <Row key={`${a.at}-${i}`} label={dateTime(a.at)} value={a.byName ?? "Unknown"} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>History</SectionTitle>
      <Card>
        {booking.history.length ? booking.history.map((h, i) => (
          <Row
            key={`${h.at}-${i}`}
            label={h.statusLabel}
            value={[dateTime(h.at), h.actorName].filter(Boolean).join(" · ")}
          />
        )) : <Empty text="Nothing recorded yet." />}
      </Card>
      {booking.history.some((h) => h.note) ? (
        <Notice text={booking.history.filter((h) => h.note).map((h) => `${h.statusLabel}: ${h.note}`).join("  ·  ")} />
      ) : null}
    </Screen>
  );
}

function statusColour(status: string): string {
  if (status === "completed") return theme.success;
  if (status === "cancelled") return theme.muted;
  if (status === "in_progress") return theme.aqua;
  return theme.amber;
}

const styles = StyleSheet.create({
  meta: { ...type.caption, color: theme.text.tertiary, marginBottom: space.snug },
  cell: { ...type.body, color: theme.text.primary },
});
