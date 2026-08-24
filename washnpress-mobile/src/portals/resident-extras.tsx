import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type {
  ScheduleView, FrequencyOption, PickupPreferences, ServiceOffering, ServiceRequestView,
} from "../api/types";
import { theme, rupees, dateTime, shortDate } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Empty, ErrorText, Notice,
  Loading, Pill, Stat, StatGrid, ChoiceChips, Counter,
} from "../components/ui";
import { ConfirmDialog, Dropdown, Toggle } from "../components/filters";

// The resident screens the sixth round added: a standing pickup arrangement they can
// see and change, a preferred window, and the services that are not laundry.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ------------------------------------------------------------------ schedules

export function SchedulesScreen({ token }: { token: string }) {
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [frequencies, setFrequencies] = useState<FrequencyOption[]>([]);
  const [windows, setWindows] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<PickupPreferences | null>(null);
  const [creating, setCreating] = useState(false);
  const [frequency, setFrequency] = useState("weekly");
  const [days, setDays] = useState<number[]>([]);
  const [pickupWindow, setPickupWindow] = useState("Morning");
  const [stopping, setStopping] = useState<ScheduleView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const listed = await api.residentSchedules(token);
      setSchedules(listed.schedules);
      setFrequencies(listed.frequencies);
      setWindows(listed.windows);
      // A preferred window is part of a subscription, so a resident without one
      // simply does not see the section rather than being shown a broken control.
      try { setPreferences((await api.residentPreferences(token)).preferences); }
      catch { setPreferences(null); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const required = frequencies.find((f) => f.key === frequency)?.daysRequired ?? 0;

  const toggleDay = (day: number) => {
    setDays((current) => {
      if (current.includes(day)) return current.filter((d) => d !== day);
      // Choosing a third day when two are wanted replaces the oldest, which is less
      // annoying than refusing the tap.
      const next = [...current, day];
      return required > 0 && next.length > required ? next.slice(next.length - required) : next;
    });
  };

  const create = async () => {
    setError(null); setNote(null);
    try {
      await api.residentCreateSchedule({ frequency, days, window: pickupWindow }, token);
      setNote("Pickup schedule saved.");
      setCreating(false); setDays([]);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const setStatus = async (schedule: ScheduleView, status: "active" | "paused") => {
    setError(null); setNote(null);
    try {
      await api.residentUpdateSchedule(schedule.id, { status }, token);
      setNote(status === "paused" ? "Schedule paused." : "Schedule resumed.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const stop = async () => {
    if (!stopping) return;
    setError(null); setNote(null);
    try {
      await api.residentCancelSchedule(stopping.id, token);
      setNote("Schedule stopped. Pickups already booked are unaffected.");
      setStopping(null);
      await load();
    } catch (e) { setError((e as Error).message); setStopping(null); }
  };

  const savePreference = async (chosen: string[]) => {
    setError(null);
    try { setPreferences((await api.residentSetPreferences(chosen, token)).preferences); }
    catch (e) { setError((e as Error).message); }
  };

  if (busy && !schedules.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Regular pickups"
        subtitle="Have your laundry collected without booking every time"
        right={<Button label={creating ? "Close" : "New"} variant="secondary" onPress={() => setCreating(!creating)} />}
      />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      {creating ? (
        <Card>
          <Dropdown
            label="How often"
            value={frequency}
            options={frequencies.map((f) => ({ value: f.key, label: f.label }))}
            onChange={(next) => { setFrequency(next ?? "weekly"); setDays([]); }}
            allLabel="Choose"
          />
          {required > 0 ? (
            <>
              <Text style={styles.fieldLabel}>
                {required === 1 ? "Which day" : `Which ${required} days`}
              </Text>
              <View style={styles.dayRow}>
                {WEEKDAYS.map((label, day) => (
                  <Text
                    key={label}
                    onPress={() => toggleDay(day)}
                    style={[styles.day, days.includes(day) && styles.dayOn]}
                  >
                    {label}
                  </Text>
                ))}
              </View>
            </>
          ) : null}
          <Dropdown
            label="Preferred window"
            value={pickupWindow}
            options={windows.map((w) => ({ value: w, label: w }))}
            onChange={(next) => setPickupWindow(next ?? "Morning")}
            allLabel="Choose"
          />
          <Notice text="We will try your preferred window. If it is full on the day we will book the next one that is open and tell you." />
          <Button label="Save schedule" onPress={create} disabled={required > 0 && days.length !== required} />
        </Card>
      ) : null}

      <SectionTitle>Your schedules</SectionTitle>
      {schedules.length ? schedules.map((schedule) => (
        <Card key={schedule.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{schedule.description}</Text>
            <Pill
              text={schedule.status === "active" ? "Active" : "Paused"}
              color={schedule.status === "active" ? theme.success : theme.amber}
            />
          </View>
          <Row label="Preferred window" value={schedule.window} />
          <Row label="Pickups a month" value={
            schedule.allowance !== null ? `${schedule.perMonth} of ${schedule.allowance} included` : String(schedule.perMonth)
          } />
          <Row label="Booked ahead" value={schedule.upcomingCount} />
          <View style={styles.buttonRow}>
            <View style={{ flex: 1, marginRight: 6 }}>
              <Button
                label={schedule.status === "active" ? "Pause" : "Resume"}
                variant="secondary"
                onPress={() => setStatus(schedule, schedule.status === "active" ? "paused" : "active")}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <Button label="Stop" variant="danger" onPress={() => setStopping(schedule)} />
            </View>
          </View>
        </Card>
      )) : <Empty text="No regular pickups set up." />}

      {preferences ? (
        <>
          <SectionTitle>Preferred windows</SectionTitle>
          <Card>
            <Row label="Your plan" value={preferences.planTier ?? "—"} />
            <Row label="Pickups included" value={
              preferences.pickupsPerCycle !== null
                ? `${preferences.pickupsUsed} of ${preferences.pickupsPerCycle} used`
                : "Unlimited"
            } />
            {windows.map((w) => (
              <Toggle
                key={w}
                label={w}
                value={preferences.preferredWindows.includes(w)}
                onChange={(on) => savePreference(
                  on
                    ? [...preferences.preferredWindows, w]
                    : preferences.preferredWindows.filter((x) => x !== w),
                )}
              />
            ))}
            <Text style={styles.hint}>
              We check these against what is actually available on the day.
            </Text>
          </Card>
        </>
      ) : null}

      <ConfirmDialog
        visible={Boolean(stopping)}
        title="Stop this schedule?"
        message="No further pickups will be booked from it. Pickups already booked will still happen."
        confirmLabel="Stop schedule"
        destructive
        onConfirm={stop}
        onCancel={() => setStopping(null)}
      />
    </Screen>
  );
}

// ------------------------------------------------------------- other services

export function ServicesScreen({ token }: { token: string }) {
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [requests, setRequests] = useState<ServiceRequestView[]>([]);
  const [chosen, setChosen] = useState<ServiceOffering | null>(null);
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [hours, setHours] = useState(1);
  const [address, setAddress] = useState("");
  const [date, setDate] = useState(new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  const [cancelling, setCancelling] = useState<ServiceRequestView | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [offered, mine] = await Promise.all([api.serviceOfferings(), api.myServiceRequests(token)]);
      setOfferings(offered.offerings);
      setRequests(mine.requests);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // What it will cost, worked out the same way the backend works it out, so the
  // figure on the button is the figure that gets charged.
  const quotedPaise = chosen
    ? chosen.pricingBasis === "per_hour" ? chosen.unitPricePaise * Math.max(chosen.minimumHours ?? 0.5, hours) : chosen.unitPricePaise
    : 0;

  const bookIt = async () => {
    if (!chosen) return;
    setError(null); setNote(null);
    try {
      await api.bookService({
        offeringId: chosen.id,
        scheduledFor: new Date(`${date}T09:00:00.000Z`).toISOString(),
        vehicleType: vehicleType ?? undefined,
        vehicleNumber: vehicleNumber.trim() || undefined,
        estimatedHours: chosen.pricingBasis === "per_hour" ? hours : undefined,
        address: address.trim() || undefined,
      }, token);
      setNote(`${chosen.name} booked.`);
      setChosen(null); setVehicleType(null); setVehicleNumber(""); setAddress("");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const cancel = async () => {
    if (!cancelling || !cancelReason.trim()) return;
    setError(null);
    try {
      await api.cancelServiceRequest(cancelling.id, cancelReason.trim(), token);
      setNote("Booking cancelled.");
      setCancelling(null); setCancelReason("");
      await load();
    } catch (e) { setError((e as Error).message); setCancelling(null); }
  };

  if (busy && !offerings.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Other services" subtitle="Vehicle washing and ironing at home" />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      <SectionTitle>What we offer</SectionTitle>
      {offerings.map((offering) => (
        <Card key={offering.id} onPress={() => { setChosen(offering); setVehicleType(offering.vehicleTypes[0] ?? null); }}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{offering.name}</Text>
            <Pill
              text={offering.pricingBasis === "per_hour"
                ? `${rupees(offering.unitPricePaise)} / hour`
                : rupees(offering.unitPricePaise)}
              color={theme.aqua}
            />
          </View>
          {offering.description ? <Text style={styles.meta}>{offering.description}</Text> : null}
        </Card>
      ))}

      {chosen ? (
        <Card>
          <SectionTitle>Book {chosen.name}</SectionTitle>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          {chosen.vehicleTypes.length ? (
            <>
              <Text style={styles.fieldLabel}>Vehicle</Text>
              <ChoiceChips options={chosen.vehicleTypes} value={vehicleType} onChange={setVehicleType} />
              <Field label="Registration (optional)" value={vehicleNumber} onChangeText={setVehicleNumber} placeholder="TS 09 AB 1234" />
            </>
          ) : null}
          {chosen.pricingBasis === "per_hour" ? (
            <>
              <Counter label="Hours needed" value={hours} onChange={(next) => setHours(Math.max(chosen.minimumHours ?? 1, next))} />
              <Text style={styles.hint}>
                Charged for the time it actually takes, in half hours. This is an estimate.
              </Text>
            </>
          ) : null}
          <Field label="Where (optional)" value={address} onChangeText={setAddress} placeholder="Flat or parking bay" />
          <Row label="Estimated cost" value={rupees(quotedPaise)} />
          <Button label={`Book for ${rupees(quotedPaise)}`} onPress={bookIt} />
          <Button label="Cancel" variant="secondary" onPress={() => setChosen(null)} />
        </Card>
      ) : null}

      <SectionTitle>Your bookings</SectionTitle>
      {requests.length ? requests.map((request) => (
        <Card key={request.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{request.offeringName}</Text>
            <Pill text={request.statusLabel} color={statusColour(request.status)} />
          </View>
          <Row label="When" value={dateTime(request.scheduledFor)} />
          {request.vehicleType ? <Row label="Vehicle" value={[request.vehicleType, request.vehicleNumber].filter(Boolean).join(" · ")} /> : null}
          {request.estimatedHours ? <Row label="Hours booked" value={request.estimatedHours} /> : null}
          {request.actualHours ? <Row label="Hours worked" value={request.actualHours} /> : null}
          <Row
            label={request.finalPaise !== null ? "Final cost" : "Estimated cost"}
            value={rupees(request.payablePaise)}
          />
          {request.cancelledReason ? <Row label="Cancelled" value={request.cancelledReason} /> : null}
          {request.status === "requested" || request.status === "assigned" ? (
            <Button label="Cancel booking" variant="danger" onPress={() => setCancelling(request)} />
          ) : null}
        </Card>
      )) : <Empty text="You have not booked any of these yet." />}

      <ConfirmDialog
        visible={Boolean(cancelling)}
        title="Cancel this booking?"
        message="Tell us why, so the team knows not to come."
        confirmLabel="Cancel booking"
        destructive
        onConfirm={cancel}
        onCancel={() => { setCancelling(null); setCancelReason(""); }}
      />
      {cancelling ? (
        <Card>
          <Field label="Reason" value={cancelReason} onChangeText={setCancelReason} placeholder="Why are you cancelling?" />
        </Card>
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
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 15, fontWeight: "800", color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 6 },
  hint: { fontSize: 12, color: theme.muted, marginTop: 8 },
  fieldLabel: { fontSize: 12, color: theme.muted, marginBottom: 5, marginTop: 6 },
  buttonRow: { flexDirection: "row", marginTop: 8 },
  dayRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  day: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginRight: 6, marginBottom: 6,
    backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border,
    fontSize: 12, color: theme.muted, fontWeight: "700", overflow: "hidden",
  },
  dayOn: { backgroundColor: theme.ice, borderColor: theme.deepTeal, color: theme.deepTeal },
});
