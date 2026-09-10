import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { themed } from "../components/themed";
import { api } from "../api/client";
import type { FrequencyOption, PickupPreferences, ScheduleView } from "../api/types";
import { theme, space, type, radius, border, size, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Empty, ErrorText, Notice, Loading, Pill,
} from "../components/ui";
import { Dropdown } from "../components/filters";
import { DateField, todayIso } from "../components/calendar";
import { DAY_LABELS, daysLabel, daysRequiredFor, overCommitmentWarning, scheduleProblem } from "./schedule-rules";

// Repeat pickups.
//
// The backend has served these for a round — `/v1/resident/schedules` and
// `/v1/resident/preferences` — and the client has had typed calls for them with not
// one call site between them. So the feature that makes a laundry subscription a
// subscription rather than a series of purchases was finished, deployed, and
// unreachable: a resident who wants their washing collected every Tuesday booked it
// every Tuesday, from the same wizard, and stopped when they forgot.
//
// One screen, reached from Profile, doing the three things the endpoints offer:
// what repeats now, setting up a repeat, and which times of day to be asked about.

export function ResidentSchedulesScreen({ token }: { token: string }) {
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [frequencies, setFrequencies] = useState<FrequencyOption[]>([]);
  const [windows, setWindows] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<PickupPreferences | null>(null);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The draft being set up. Nothing is sent until it is complete; see
  // `scheduleProblem`, which is also what the sentence under the button says.
  const [frequency, setFrequency] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [window, setWindow] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(todayIso());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.residentSchedules(token);
      setSchedules(r.schedules);
      setFrequencies(r.frequencies);
      setWindows(r.windows);
      // The preferred windows are a separate record and a separate call. Its failure
      // is not the schedule list's failure, so it is caught on its own: a resident
      // whose preferences could not be read can still set up a collection.
      try { setPreferences((await api.residentPreferences(token)).preferences); }
      catch { setPreferences(null); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Changing the frequency changes how many days it wants, so days chosen for the
  // old one are dropped rather than silently carried into a schedule that means
  // something else.
  const chooseFrequency = (next: string | undefined) => {
    setFrequency(next ?? null);
    setDays([]);
  };

  const required = daysRequiredFor(frequency, frequencies);
  const toggleDay = (day: number) => {
    setDays((current) => {
      if (current.includes(day)) return current.filter((d) => d !== day);
      // At the limit, the new tap replaces the oldest choice rather than doing
      // nothing: a picker that stops responding reads as broken.
      const next = [...current, day];
      return required > 0 && next.length > required ? next.slice(next.length - required) : next;
    });
  };

  const problem = scheduleProblem({ frequency, days, window, frequencies });

  const create = async () => {
    if (problem) return;
    setSaving(true); setNote(null); setError(null);
    try {
      await api.residentCreateSchedule(
        { frequency: frequency!, days: required > 0 ? days : undefined, window: window!, startDate },
        token,
      );
      setNote("Repeat collection set up. You will be told before each one.");
      setFrequency(null); setDays([]); setWindow(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const cancel = async (schedule: ScheduleView) => {
    setNote(null); setError(null);
    try {
      await api.residentCancelSchedule(schedule.id, token);
      setNote("That repeat collection has been stopped. Collections already booked still stand.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const toggleWindow = async (name: string) => {
    const current = preferences?.preferredWindows ?? [];
    const next = current.includes(name) ? current.filter((w) => w !== name) : [...current, name];
    // Shown as chosen straight away and corrected by the reply, so tapping a chip
    // does not sit inert for a round trip.
    setPreferences((p) => (p ? { ...p, preferredWindows: next } : p));
    try { setPreferences((await api.residentSetPreferences(next, token)).preferences); }
    catch (e) { setError((e as Error).message); await load(); }
  };

  if (busy && !schedules.length && !frequencies.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Repeat pickups"
        subtitle="Have your washing collected on the same day every week, without booking it each time"
      />

      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />

      <SectionTitle>What repeats now</SectionTitle>
      {schedules.length ? schedules.map((s) => (
        <Card key={s.id}>
          <View style={styles.headRow}>
            <Text style={styles.description}>{s.description}</Text>
            <Pill text={titleCase(s.status)} color={s.status === "active" ? theme.feedback.successText : theme.text.tertiary} />
          </View>
          {s.days.length ? <Row label="Days" value={daysLabel(s.days)} /> : null}
          <Row label="Time of day" value={s.window} />
          <Row label="Collections a month" value={String(s.perMonth)} />
          <Row label="Already booked" value={`${s.upcomingCount} upcoming`} />
          {/* The one thing a schedule can commit somebody to that they are not
              present for. Said while it is being looked at, not when the charge
              lands. */}
          {overCommitmentWarning(s) ? <Notice tone="warn" text={overCommitmentWarning(s)!} /> : null}
          {s.status === "active"
            ? <Button label="Stop this repeat" variant="secondary" onPress={() => cancel(s)} />
            : null}
        </Card>
      )) : <Empty text="Nothing repeats yet. Set one up below." />}

      <SectionTitle>Set up a repeat</SectionTitle>
      <Card>
        <Dropdown
          label="How often"
          value={frequency ?? undefined}
          options={frequencies.map((f) => ({ value: f.key, label: f.label }))}
          onChange={chooseFrequency}
          allowClear={false}
          width="full"
        />
        {/* Only where the chosen frequency asks for days. Weekly wants one, twice a
            week wants two, and the backend is what says so — a form that decided
            that for itself would disagree with the server the first time a
            frequency was added. */}
        {required > 0 ? (
          <>
            <Text style={styles.label}>
              {required === 1 ? "Which day" : `Which ${required} days`}
            </Text>
            <View style={styles.dayRow}>
              {DAY_LABELS.map((name, day) => {
                const on = days.includes(day);
                return (
                  <Pressable
                    key={name}
                    onPress={() => toggleDay(day)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.day, on && styles.dayOn]}
                  >
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Time of day</Text>
        <View style={styles.dayRow}>
          {windows.map((name) => {
            const on = window === name;
            return (
              <Pressable
                key={name}
                onPress={() => setWindow(on ? null : name)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.window, on && styles.dayOn]}
              >
                <Text style={[styles.dayText, on && styles.dayTextOn]}>{name}</Text>
              </Pressable>
            );
          })}
        </View>

        <DateField label="Starting from" value={startDate} onChange={(next) => setStartDate(next ?? todayIso())} minDate={todayIso()} clearable={false} />

        {/* Beside the disabled button rather than after it is pressed, so the reason
            it will not go is readable without trying. */}
        {problem ? <Notice tone="warn" text={problem} /> : null}
        <Button
          label={saving ? "Setting up…" : "Set up this repeat"}
          onPress={create}
          disabled={saving || Boolean(problem)}
        />
      </Card>

      {/* The third endpoint that had no caller. Separate from a schedule on purpose:
          this is which times of day suit, which the operator's planning reads,
          whether or not anything repeats. */}
      {preferences ? (
        <>
          <SectionTitle>Times of day that suit you</SectionTitle>
          <Card>
            <Text style={styles.hint}>
              Used when we plan the round. Choosing none means any time is fine.
            </Text>
            <View style={styles.dayRow}>
              {windows.map((name) => {
                const on = preferences.preferredWindows.includes(name);
                return (
                  <Pressable
                    key={name}
                    onPress={() => toggleWindow(name)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.window, on && styles.dayOn]}
                  >
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {preferences.pickupsPerCycle != null ? (
              <Row
                label="Collections this cycle"
                value={`${preferences.pickupsUsed} of ${preferences.pickupsPerCycle} used`}
              />
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = themed((theme) => ({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.snug },
  description: { ...type.bodyStrong, color: theme.text.primary, flex: 1 },
  label: { ...type.caption, color: theme.text.tertiary, marginTop: space.snug, marginBottom: space.tight },
  hint: { ...type.body, color: theme.text.secondary, marginBottom: space.snug },
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: space.tight, marginBottom: space.snug },
  // Seven of these have to fit across a phone, so the target is made up by height
  // rather than by width.
  day: {
    minWidth: 44, minHeight: size.control.sm,
    alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: border.hairline, borderColor: theme.line.strong,
    backgroundColor: theme.surface.card,
  },
  window: {
    minHeight: size.control.sm, paddingHorizontal: space.base,
    alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: border.hairline, borderColor: theme.line.strong,
    backgroundColor: theme.surface.card,
  },
  dayOn: { backgroundColor: theme.brand.tint, borderColor: theme.brand.solid },
  dayText: { ...type.label, color: theme.text.secondary },
  dayTextOn: { color: theme.text.primary },
}));
