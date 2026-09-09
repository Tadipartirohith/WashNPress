import { useCallback, useEffect, useState } from "react";
import { themed } from "../components/themed";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { api, ApiError } from "../api/client";
import type {
  ServiceOffering, ServiceDateSlot, ServiceRequestView,
} from "../api/types";
import { font, theme, rupees, dateTime, size, space } from "../theme";
import { ServiceMark } from "../components/service-mark";
import { markForService } from "./service-mark-rules";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Empty, ErrorText, Notice,
  Loading, Pill,
} from "../components/ui";
import { ConfirmDialog } from "../components/filters";
import { DateField, todayIso } from "../components/calendar";

// The resident screens the sixth round added: the services that are not laundry.
// (The standing-pickup "Regular pickups" screen was removed — it was imported but
// never rendered, and the web resident portal has no equivalent.)

// ------------------------------------------------------------- other services

export function ServicesScreen({ token }: { token: string }) {
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [requests, setRequests] = useState<ServiceRequestView[]>([]);
  const [chosen, setChosen] = useState<ServiceOffering | null>(null);
  const [date, setDate] = useState(new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  // The supervisor-created slots this service runs on the chosen day, and which one
  // was picked. A resident booking is just a date and a slot; the operator fills in
  // the vehicle, quantity and the rest afterwards (round-20 I-36).
  const [slots, setSlots] = useState<ServiceDateSlot[]>([]);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  // Moving a booking rather than giving it up. The slots offered are the ones free on
  // the day chosen, asked for again whenever that day changes.
  const [moving, setMoving] = useState<ServiceRequestView | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [moveSlots, setMoveSlots] = useState<ServiceDateSlot[]>([]);
  const [moveSlotId, setMoveSlotId] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [cancelling, setCancelling] = useState<ServiceRequestView | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
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

  // The slots published for this service on the chosen day. Only these can be booked;
  // a day with none published cannot be booked, and the form says so. What is drawn
  // is only true until somebody else books — capacity is checked again at the moment
  // of writing, and a slot that filled in between comes back as a refusal.
  useEffect(() => {
    let live = true;
    if (!chosen || !date) { setSlots([]); setSelectedSlotId(null); return () => { live = false; }; }
    setSlotsBusy(true);
    api.serviceDateSlots(chosen.id, date, token)
      .then((res) => {
        if (!live) return;
        setSlots(res.slots);
        setSelectedSlotId((current) => {
          const still = res.slots.find((s) => s.id === current && !s.full);
          return still ? current : null;
        });
      })
      .catch(() => { if (live) setSlots([]); })
      .finally(() => { if (live) setSlotsBusy(false); });
    return () => { live = false; };
  }, [chosen, date, token]);

  const bookIt = async () => {
    if (!chosen || !selectedSlotId) return;
    setError(null); setNote(null); setBooking(true);
    try {
      await api.bookServiceSlot({ serviceSlotId: selectedSlotId }, token);
      setNote(`${chosen.name} booked. Track it in My orders.`);
      setChosen(null); setSelectedSlotId(null);
      await load();
    } catch (e) {
      const err = e as ApiError;
      setError(err.code === "slot_full" ? "That slot just filled up. Pick another." : err.message);
    } finally { setBooking(false); }
  };

  // What is free on the day a booking is being moved to.
  useEffect(() => {
    let live = true;
    if (!moving || !moveDate) { setMoveSlots([]); return () => { live = false; }; }
    api.serviceDateSlots(moving.offeringId, moveDate, token)
      .then((res) => {
        if (!live) return;
        setMoveSlots(res.slots);
        setMoveSlotId((current) => {
          const still = res.slots.find((s) => s.id === current && !s.full);
          return still ? current : null;
        });
      })
      .catch(() => { if (live) setMoveSlots([]); });
    return () => { live = false; };
  }, [moving, moveDate, token]);

  const move = async () => {
    if (!moving || !moveDate) return;
    const slot = moveSlots.find((s) => s.id === moveSlotId);
    setMoveBusy(true); setError(null);
    try {
      // Reschedule takes a timestamp: use the chosen slot's start, or the booking's
      // current hour when the day publishes no slot to pick.
      const at = slot
        ? `${moveDate}T${slot.startTime}:00.000Z`
        : `${moveDate}T${moving.scheduledFor.slice(11, 16) || "09:00"}:00.000Z`;
      await api.rescheduleServiceRequest(moving.id, at, token);
      setNote(`${moving.offeringName} moved.`);
      setMoving(null); setMoveDate(""); setMoveSlotId(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setMoveBusy(false); }
  };

  // Cancelling a booking.
  //
  // This used to begin `if (!cancelling || !cancelReason.trim()) return`, while the
  // reason field was rendered on the page *behind* the confirmation dialog — under
  // the scrim, unreachable. So the reason was always empty, the function always
  // returned on its first line, and "Cancel booking" did nothing at all: no request,
  // no error, no change of status. The field is inside the dialog now, and the
  // reason is optional, so the button cannot be dead again.
  const cancel = async () => {
    if (!cancelling || cancelBusy) return;
    setError(null); setCancelBusy(true);
    try {
      // Said in the resident's words when they gave any, and still recorded when
      // they did not — the backend needs a reason and the team needs to know not
      // to come either way.
      await api.cancelServiceRequest(cancelling.id, cancelReason.trim() || "Cancelled by the resident", token);
      setNote("Booking cancelled.");
      setCancelling(null); setCancelReason("");
      await load();
    } catch (e) {
      // The booking keeps the status it had. Closing the dialog here would have
      // read as success for something that failed.
      setError((e as Error).message);
    } finally {
      setCancelBusy(false);
    }
  };

  if (busy && !offerings.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Other services" subtitle="Vehicle washing and ironing at home" />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      <SectionTitle>What we offer</SectionTitle>
      {offerings.map((offering) => (
        <Card key={offering.id} onPress={() => { setChosen(offering); setSelectedSlotId(null); }}>
          {/* The mark leads, because a list of services is scanned by shape before
              any of it is read. It takes the brand colour rather than a colour of
              its own: a per-service hue would sit beside the status pills and teach
              a reader that colour here means nothing in particular. */}
          <View style={styles.headRow}>
            <View style={styles.serviceHead}>
              <ServiceMark
                name={markForService(offering.kind, offering.name)}
                size={size.icon.lg}
                color={theme.brand.solid}
              />
              <Text style={[styles.title, styles.serviceName]}>{offering.name}</Text>
            </View>
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
          {/* A calendar rather than a format to memorise, and a date that has gone
              cannot be chosen for something that has not happened yet. */}
          <DateField
            label="Date"
            value={date || null}
            onChange={(next) => setDate(next ?? "")}
            minDate={todayIso()}
            placeholder="Select a date"
          />
          {/* Then the time, for a service that runs to one.
              A window with nothing left is drawn as full rather than left out: a
              resident who cannot see the ten o'clock slot assumes the service does
              not run then, where one who sees it marked full knows to try another
              day. Only what is actually available can be chosen. */}
          {slotsBusy ? <Text style={styles.hint}>Checking what is free…</Text> : null}
          {!slotsBusy ? (
            slots.length ? (
              <>
                <Text style={styles.groupTitle}>Choose a slot</Text>
                <View style={styles.slotWrap}>
                  {slots.map((slot) => {
                    const full = slot.full;
                    const picked = slot.id === selectedSlotId;
                    return (
                      <Pressable
                        key={slot.id}
                        onPress={full ? undefined : () => { setSelectedSlotId(slot.id); setError(null); }}
                        disabled={full}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: full, selected: picked }}
                        accessibilityLabel={`${slot.window}, ${slot.startTime} to ${slot.endTime}, ${full ? "fully booked" : `${slot.capacityRemaining} left`}`}
                        style={[styles.slotChip, picked && styles.slotChipPicked, full && styles.slotChipFull]}
                      >
                        <Text style={[styles.slotChipTime, picked && styles.slotChipTimePicked, full && styles.slotChipTimeFull]}>
                          {slot.window} · {slot.startTime} – {slot.endTime}
                        </Text>
                        <Text style={[styles.slotChipMeta, full && styles.slotChipTimeFull]}>
                          {full ? "Full" : `${slot.capacityRemaining} left`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!slots.some((slot) => !slot.full)
                  ? <Notice tone="warn" text="Every slot on this day is taken. Try another date." />
                  : null}
              </>
            ) : <Notice tone="warn" text={`No slots offered for ${chosen.name} on this day. Try another date.`} />
          ) : null}
          <Row label="Price" value={chosen.pricingBasis === "per_hour" ? `from ${rupees(chosen.unitPricePaise)} / hour` : rupees(chosen.unitPricePaise)} />
          <Text style={styles.hint}>The operator confirms the final price and any vehicle or job details when they take the booking.</Text>
          <Button label="Confirm booking" disabled={!selectedSlotId || booking} onPress={bookIt} />
          <Button label="Cancel" variant="secondary" onPress={() => { setChosen(null); setSelectedSlotId(null); }} />
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
            <View style={styles.buttonRow}>
              <Button
                label="Change time"
                variant="secondary"
                onPress={() => {
                  setMoving(request);
                  setMoveDate(request.scheduledFor.slice(0, 10));
                  setMoveSlotId(null);
                }}
              />
              <Button label="Cancel booking" variant="danger" onPress={() => setCancelling(request)} />
            </View>
          ) : null}
        </Card>
      )) : <Empty text="You have not booked any of these yet." />}

      <ConfirmDialog
        visible={Boolean(moving)}
        title="Move this booking"
        message="Pick another day, and a time if the service runs to one. The booking keeps its history."
        confirmLabel="Move booking"
        busy={moveBusy}
        onConfirm={move}
        onCancel={() => { setMoving(null); setMoveDate(""); setMoveSlotId(null); }}
      >
        <DateField
          label="New date"
          value={moveDate || null}
          onChange={(next) => { setMoveDate(next ?? ""); setMoveSlotId(null); }}
          minDate={todayIso()}
          placeholder="Select a date"
        />
        {moveSlots.length ? (
          <>
            <Text style={styles.groupTitle}>Choose a slot</Text>
            <View style={styles.slotWrap}>
              {moveSlots.map((slot) => {
                const full = slot.full;
                const picked = slot.id === moveSlotId;
                return (
                  <Pressable
                    key={slot.id}
                    onPress={full ? undefined : () => setMoveSlotId(slot.id)}
                    disabled={full}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: full, selected: picked }}
                    accessibilityLabel={`${slot.window}, ${slot.startTime} to ${slot.endTime}, ${full ? "fully booked" : `${slot.capacityRemaining} left`}`}
                    style={[styles.slotChip, picked && styles.slotChipPicked, full && styles.slotChipFull]}
                  >
                    <Text style={[styles.slotChipTime, picked && styles.slotChipTimePicked, full && styles.slotChipTimeFull]}>
                      {slot.window} · {slot.startTime} – {slot.endTime}
                    </Text>
                    <Text style={[styles.slotChipMeta, full && styles.slotChipTimeFull]}>
                      {full ? "Full" : `${slot.capacityRemaining} left`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        visible={Boolean(cancelling)}
        title="Cancel this booking?"
        message="Tell us why, so the team knows not to come. You can leave it blank."
        confirmLabel="Cancel booking"
        destructive
        busy={cancelBusy}
        onConfirm={cancel}
        onCancel={() => { setCancelling(null); setCancelReason(""); }}
      >
        <Field
          label="Reason"
          value={cancelReason}
          onChangeText={setCancelReason}
          placeholder="Changed my plans…"
        />
      </ConfirmDialog>
    </Screen>
  );
}

function statusColour(status: string): string {
  if (status === "completed") return theme.success;
  if (status === "cancelled") return theme.muted;
  if (status === "in_progress") return theme.aqua;
  return theme.amber;
}

const styles = themed((theme) => ({
  serviceHead: { flexDirection: "row", alignItems: "center", gap: space.snug, flex: 1 },
  serviceName: { flex: 1 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 6 },
  hint: { fontSize: 12, color: theme.muted, marginTop: 8 },
  buttonRow: { flexDirection: "row", marginTop: 8 },

  // The time chips, built on the same shape as the day chips above so a booking
  // form does not have two ways of drawing the same choice.
  groupTitle: { fontSize: 12, color: theme.muted, fontFamily: font.bold, marginTop: 12, marginBottom: 2 },
  slotWrap: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  slotChip: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginRight: 6, marginBottom: 6,
    backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border, minWidth: 108,
  },
  slotChipPicked: { backgroundColor: theme.ice, borderColor: theme.deepTeal },
  // Full is drawn as unavailable rather than removed, so a resident can tell "not
  // offered" from "somebody else took it".
  slotChipFull: { backgroundColor: theme.white, borderStyle: "dashed" },
  slotChipTime: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal },
  slotChipTimePicked: { color: theme.deepTeal },
  slotChipTimeFull: { color: theme.muted },
  slotChipMeta: { fontSize: 11, color: theme.muted, marginTop: 2 },
}));
