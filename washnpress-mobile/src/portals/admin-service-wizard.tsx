import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { Plan, Society, Area } from "../api/types";
import { theme, rupees } from "../theme";
import {
  SectionTitle, Card, Row, Button, Field, Notice, Pill, ErrorText, Empty,
} from "../components/ui";
import { perUnitLabel, formatQuantity } from "../api/units";
import {
  SERVICE_STEPS, SERVICE_CATEGORIES, SERVICE_UNITS, PLAN_PRICING_MODES,
  SERVICE_FREQUENCIES, SERVICE_MODES, AVAILABILITY_SCOPES, ELIGIBILITIES,
  CHARGE_KINDS, DAY_LABELS,
  emptyServiceDraft, emptyPlanRule, emptyTimeSlot, serviceDraftFrom,
  serviceProblemsAt, allServiceProblems, serviceBody,
  type ServiceDraft, type DraftPlanRule, type DraftTimeSlot,
} from "./service-wizard-rules";

// Building an extra service, one decision at a time.
//
// Twelve steps, because a service is twelve decisions: what it is, how it is
// measured, what it costs, what each plan does about it, how much a plan includes,
// how often it may be booked, where it is offered, at what times, to whom, under what
// booking rules, with what extras — and then a look at the whole thing before it
// exists. None of that fits on one screen, and none of it belongs in code.

export function ServiceWizard({ token, plans, societies, areas, existing, onSaved, onCancel }: {
  token: string;
  plans: Plan[];
  societies: Society[];
  areas: Area[];
  // Absent when building a new service; the service being changed when editing one.
  existing?: Record<string, unknown> | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ServiceDraft>(() => {
    if (existing) return serviceDraftFrom(existing, plans);
    // Every plan gets a row from the start, so "what does Basic do about this?" is a
    // question the admin answers rather than one nobody asked.
    return { ...emptyServiceDraft(), planRules: plans.map(emptyPlanRule) };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const set = (patch: Partial<ServiceDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const setRule = (planId: string, patch: Partial<DraftPlanRule>) =>
    setDraft((current) => ({
      ...current,
      planRules: current.planRules.map((r) => (r.planId === planId ? { ...r, ...patch } : r)),
    }));
  const setSlot = (index: number, patch: Partial<DraftTimeSlot>) =>
    setDraft((current) => ({
      ...current,
      timeSlots: current.timeSlots.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));

  const toggle = (list: number[], value: number): number[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);
  const toggleId = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const stepProblems = serviceProblemsAt(step, draft);
  const reviewProblems = allServiceProblems(draft);
  const included = draft.planRules.filter((r) => r.mode === "included");

  const save = async () => {
    setBusy(true); setError(null); setProblems([]);
    try {
      const body = serviceBody(draft);
      if (existing) {
        const saved = await api.adminUpdateOffering(String(existing.id), body, token);
        onSaved(saved.openBookings
          ? `${draft.name} saved. ${saved.openBookings} booking${saved.openBookings === 1 ? "" : "s"} already made are unchanged.`
          : `${draft.name} saved.`);
        return;
      }
      await api.adminCreateOffering(body, token);
      onSaved(`${draft.name} created.`);
    } catch (e) {
      const failure = e as { problems?: string[]; message: string };
      // The backend names every problem at once; showing them one at a time would
      // undo the point of asking for them all.
      if (failure.problems?.length) setProblems(failure.problems);
      else setError(failure.message);
    } finally { setBusy(false); }
  };

  const chip = (active: boolean, label: string, onPress: () => void, key: string) => (
    <Button key={key} label={active ? `✓ ${label}` : label} variant="secondary" onPress={onPress} />
  );

  return (
    <Card>
      <View style={styles.headRow}>
        <Text style={styles.title}>{SERVICE_STEPS[step]}</Text>
        <Pill text={`Step ${step + 1} of ${SERVICE_STEPS.length}`} color={theme.aqua} />
      </View>

      {/* 1 — what it is */}
      {step === 0 ? (
        <>
          <Field label="Service name" value={draft.name} onChangeText={(v) => set({ name: v })} placeholder="Carpet cleaning" />
          <SectionTitle>Category</SectionTitle>
          <View style={styles.chipRow}>
            {SERVICE_CATEGORIES.map((c) => chip(draft.category === c.key, c.label, () => set({ category: c.key }), c.key))}
          </View>
          <Field label="Description" value={draft.description} onChangeText={(v) => set({ description: v })} placeholder="Deep cleaned in your flat" />
          <Field label="Icon (optional)" value={draft.icon} onChangeText={(v) => set({ icon: v })} placeholder="🧼" />
          <View style={styles.buttonRow}>
            {chip(draft.active, draft.active ? "Active" : "Inactive", () => set({ active: !draft.active }), "status")}
          </View>
        </>
      ) : null}

      {/* 2 — how it is measured */}
      {step === 1 ? (
        <>
          <Notice text="What this service is sold by. A car wash is per vehicle, carpet cleaning per square foot, ironing at home by the hour." />
          <View style={styles.chipRow}>
            {SERVICE_UNITS.map((u) => chip(draft.unit === u.key, u.label, () => set({ unit: u.key }), u.key))}
          </View>
          <Field label={`Smallest booking (${draft.unit}, optional)`} value={draft.minimumQuantity} onChangeText={(v) => set({ minimumQuantity: v })} keyboardType="number-pad" />
          <Field label={`Largest booking (${draft.unit}, optional)`} value={draft.maximumQuantity} onChangeText={(v) => set({ maximumQuantity: v })} keyboardType="number-pad" />
          <Field label={`Booked in steps of (${draft.unit}, optional)`} value={draft.quantityIncrement} onChangeText={(v) => set({ quantityIncrement: v })} keyboardType="number-pad" />
          {draft.unit === "hour" ? (
            <Notice text="An hourly service is booked into time slots, and a two hour booking needs two consecutive hours free. Set the slots on step 8." />
          ) : null}
        </>
      ) : null}

      {/* 3 — what it costs */}
      {step === 2 ? (
        <>
          <Field
            label={`Price for people without a plan (rupees ${perUnitLabel(draft.unit)})`}
            value={draft.price}
            onChangeText={(v) => set({ price: v })}
            keyboardType="number-pad"
          />
          <Field
            label={`Flat subscriber price (rupees ${perUnitLabel(draft.unit)}, optional)`}
            value={draft.subscriberPrice}
            onChangeText={(v) => set({ subscriberPrice: v })}
            keyboardType="number-pad"
          />
          <Notice text="A plan can override this on the next step. This is what applies when it does not." />
        </>
      ) : null}

      {/* 4 — what each plan does about it */}
      {step === 3 ? (
        <>
          <Notice text="What each plan does about this service. Every plan answers, because a plan not getting a service is a decision rather than an absence of one." />
          {draft.planRules.length ? null : <Empty text="There are no plans to configure." />}
          {draft.planRules.map((rule) => (
            <View key={rule.planId} style={styles.block}>
              <SectionTitle>{rule.planName}</SectionTitle>
              <View style={styles.chipRow}>
                {PLAN_PRICING_MODES.map((m) => chip(rule.mode === m.key, m.label, () => setRule(rule.planId, { mode: m.key }), m.key))}
              </View>
              {rule.mode === "fixed" || rule.mode === "discounted" ? (
                <Field label={`Price on this plan (rupees ${perUnitLabel(draft.unit)})`} value={rule.price} onChangeText={(v) => setRule(rule.planId, { price: v })} keyboardType="number-pad" />
              ) : null}
              {rule.mode === "percentage_discount" ? (
                <Field label="Discount percent" value={rule.discountPercent} onChangeText={(v) => setRule(rule.planId, { discountPercent: v })} keyboardType="number-pad" />
              ) : null}
              {rule.mode === "additional_charge" ? (
                <Field label={`Charge on this plan (rupees ${perUnitLabel(draft.unit)})`} value={rule.additionalRate} onChangeText={(v) => setRule(rule.planId, { additionalRate: v })} keyboardType="number-pad" />
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {/* 5 — how much a plan includes */}
      {step === 4 ? (
        <>
          {included.length ? (
            <Notice text="How much each plan includes, in this service's own unit, and what happens beyond it." />
          ) : (
            <Empty text="No plan includes this service, so there is no allowance to configure." />
          )}
          {included.map((rule) => (
            <View key={rule.planId} style={styles.block}>
              <SectionTitle>{rule.planName}</SectionTitle>
              <Field
                label={`Included per cycle (${draft.unit})`}
                value={rule.includedQuantity}
                onChangeText={(v) => setRule(rule.planId, { includedQuantity: v })}
                keyboardType="number-pad"
              />
              <SectionTitle>How often</SectionTitle>
              <View style={styles.chipRow}>
                {SERVICE_FREQUENCIES.map((f) => chip(rule.frequency === f.key, f.label, () => setRule(rule.planId, { frequency: f.key, frequencyDays: f.needsDays ? rule.frequencyDays : [] }), f.key))}
              </View>
              {SERVICE_FREQUENCIES.find((f) => f.key === rule.frequency)?.needsDays ? (
                <View style={styles.chipRow}>
                  {DAY_LABELS.map((label, day) => chip(rule.frequencyDays.includes(day), label, () => setRule(rule.planId, { frequencyDays: toggle(rule.frequencyDays, day) }), label))}
                </View>
              ) : null}
              {chip(rule.carryForward, rule.carryForward ? "Unused carries forward" : "Unused is lost at the end of the cycle", () => setRule(rule.planId, { carryForward: !rule.carryForward }), "carry")}
              {chip(rule.additionalUsageAllowed, rule.additionalUsageAllowed ? "Additional usage allowed" : "Additional usage not allowed", () => setRule(rule.planId, { additionalUsageAllowed: !rule.additionalUsageAllowed }), "extra")}
              {rule.additionalUsageAllowed ? (
                <Field
                  label={`Additional usage price (rupees ${perUnitLabel(draft.unit)})`}
                  value={rule.additionalRate}
                  onChangeText={(v) => setRule(rule.planId, { additionalRate: v })}
                  keyboardType="number-pad"
                />
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {/* 6 — how often it may be booked */}
      {step === 5 ? (
        <>
          <Notice text="How often this service may be booked at all, whatever a plan says. Leave it unset for no restriction." />
          <View style={styles.chipRow}>
            {chip(draft.frequency === "", "No restriction", () => set({ frequency: "", frequencyDays: [] }), "none")}
            {SERVICE_FREQUENCIES.map((f) => chip(draft.frequency === f.key, f.label, () => set({ frequency: f.key, frequencyDays: f.needsDays ? draft.frequencyDays : [] }), f.key))}
          </View>
          {SERVICE_FREQUENCIES.find((f) => f.key === draft.frequency)?.needsDays ? (
            <View style={styles.chipRow}>
              {DAY_LABELS.map((label, day) => chip(draft.frequencyDays.includes(day), label, () => set({ frequencyDays: toggle(draft.frequencyDays, day) }), label))}
            </View>
          ) : null}
        </>
      ) : null}

      {/* 7 — where it is offered */}
      {step === 6 ? (
        <>
          <SectionTitle>Where it is offered</SectionTitle>
          <View style={styles.chipRow}>
            {AVAILABILITY_SCOPES.map((a) => chip(draft.availabilityScope === a.key, a.label, () => set({ availabilityScope: a.key }), a.key))}
          </View>
          {draft.availabilityScope === "selected_societies" ? (
            <View style={styles.chipRow}>
              {societies.map((s) => chip(draft.societyIds.includes(s.id), s.name, () => set({ societyIds: toggleId(draft.societyIds, s.id) }), s.id))}
            </View>
          ) : null}
          {draft.availabilityScope === "selected_areas" ? (
            <View style={styles.chipRow}>
              {areas.map((a) => chip(draft.areaIds.includes(a.id), a.name, () => set({ areaIds: toggleId(draft.areaIds, a.id) }), a.id))}
            </View>
          ) : null}
          <SectionTitle>How the work is done</SectionTitle>
          <View style={styles.chipRow}>
            {SERVICE_MODES.map((m) => chip(draft.mode === m.key, m.label, () => set({ mode: m.key }), m.key))}
          </View>
          <SectionTitle>Operating days</SectionTitle>
          <View style={styles.chipRow}>
            {DAY_LABELS.map((label, day) => chip(draft.operatingDays.includes(day), label, () => set({ operatingDays: toggle(draft.operatingDays, day) }), label))}
          </View>
        </>
      ) : null}

      {/* 8 — the windows within those days */}
      {step === 7 ? (
        <>
          <Notice text="The windows this service is done in, and how many bookings each can take. Capacity and who may book are per window." />
          <View style={styles.chipRow}>
            {["Morning", "Afternoon", "Evening"].map((window) => (
              <Button
                key={window}
                label={`Add ${window}`}
                variant="secondary"
                onPress={() => set({ timeSlots: [...draft.timeSlots, emptyTimeSlot(window)] })}
              />
            ))}
          </View>
          {draft.timeSlots.length ? null : <Empty text="No time slots yet." />}
          {draft.timeSlots.map((slot, i) => (
            <View key={`${slot.window}-${i}`} style={styles.block}>
              <View style={styles.headRow}>
                <Text style={styles.title}>{slot.window}</Text>
                <Button label="Remove" variant="danger" onPress={() => set({ timeSlots: draft.timeSlots.filter((_, index) => index !== i) })} />
              </View>
              <Field label="Starts" value={slot.startTime} onChangeText={(v) => setSlot(i, { startTime: v })} placeholder="09:00" />
              <Field label="Ends" value={slot.endTime} onChangeText={(v) => setSlot(i, { endTime: v })} placeholder="12:00" />
              <Field label="Capacity" value={slot.capacity} onChangeText={(v) => setSlot(i, { capacity: v })} keyboardType="number-pad" />
              <Field label="Most bookings (optional)" value={slot.maxBookings} onChangeText={(v) => setSlot(i, { maxBookings: v })} keyboardType="number-pad" />
              {chip(slot.subscriberAvailable, "Open to subscribers", () => setSlot(i, { subscriberAvailable: !slot.subscriberAvailable }), "sub")}
              {chip(slot.nonSubscriberAvailable, "Open to everybody else", () => setSlot(i, { nonSubscriberAvailable: !slot.nonSubscriberAvailable }), "non")}
            </View>
          ))}
        </>
      ) : null}

      {/* 9 — who may book it */}
      {step === 8 ? (
        <>
          <SectionTitle>Who this is for</SectionTitle>
          <View style={styles.chipRow}>
            {ELIGIBILITIES.map((e) => chip(draft.eligibility === e.key, e.label, () => set({ eligibility: e.key }), e.key))}
          </View>
          {draft.eligibility === "subscriber" ? (
            <>
              <SectionTitle>Which plans</SectionTitle>
              <View style={styles.chipRow}>
                {plans.map((p) => chip(draft.eligiblePlanIds.includes(p.id), p.name ?? p.tier, () => set({ eligiblePlanIds: toggleId(draft.eligiblePlanIds, p.id) }), p.id))}
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {/* 10 — when it may be booked */}
      {step === 9 ? (
        <>
          {chip(draft.advanceBookingRequired, "Must be booked in advance", () => set({ advanceBookingRequired: !draft.advanceBookingRequired }), "advance")}
          {draft.advanceBookingRequired ? (
            <Field label="At least this many minutes ahead" value={draft.minAdvanceMinutes} onChangeText={(v) => set({ minAdvanceMinutes: v })} keyboardType="number-pad" />
          ) : null}
          <Field label="At most this many days ahead" value={draft.maxAdvanceDays} onChangeText={(v) => set({ maxAdvanceDays: v })} keyboardType="number-pad" />
          {chip(draft.cancellationAllowed, "Can be cancelled", () => set({ cancellationAllowed: !draft.cancellationAllowed }), "cancel")}
          {draft.cancellationAllowed ? (
            <Field label="Up to this many minutes before" value={draft.cancellationDeadlineMinutes} onChangeText={(v) => set({ cancellationDeadlineMinutes: v })} keyboardType="number-pad" />
          ) : null}
          {chip(draft.reschedulingAllowed, "Can be rescheduled", () => set({ reschedulingAllowed: !draft.reschedulingAllowed }), "resched")}
          <Field label="Most open bookings per resident (optional)" value={draft.maxBookingsPerUser} onChangeText={(v) => set({ maxBookingsPerUser: v })} keyboardType="number-pad" />
          <Field
            label={draft.unit === "hour" ? "Most hours per booking (optional)" : `Most ${draft.unit} per booking (optional)`}
            value={draft.maxQuantityPerBooking}
            onChangeText={(v) => set({ maxQuantityPerBooking: v })}
            keyboardType="number-pad"
          />
        </>
      ) : null}

      {/* 11 — the extras */}
      {step === 10 ? (
        <>
          <Notice text="Charges added to a booking where they apply: a home visit when the work is at the flat, a weekend charge on Saturdays and Sundays." />
          <View style={styles.chipRow}>
            {CHARGE_KINDS.filter((c) => !draft.charges.some((x) => x.kind === c.key)).map((c) => (
              <Button key={c.key} label={`Add ${c.label}`} variant="secondary" onPress={() => set({ charges: [...draft.charges, { kind: c.key, label: c.label, amount: "" }] })} />
            ))}
          </View>
          {draft.charges.length ? null : <Empty text="No additional charges." />}
          {draft.charges.map((charge, i) => (
            <View key={charge.kind} style={styles.block}>
              <View style={styles.headRow}>
                <Text style={styles.title}>{charge.label}</Text>
                <Button label="Remove" variant="danger" onPress={() => set({ charges: draft.charges.filter((_, index) => index !== i) })} />
              </View>
              <Field
                label={charge.kind === "additional_unit" ? `Amount per extra ${draft.unit} (rupees)` : "Amount (rupees)"}
                value={charge.amount}
                onChangeText={(v) => set({ charges: draft.charges.map((c, index) => (index === i ? { ...c, amount: v } : c)) })}
                keyboardType="number-pad"
              />
            </View>
          ))}
        </>
      ) : null}

      {/* 12 — the whole thing */}
      {step === 11 ? (
        <>
          <Row label="Service" value={draft.name} />
          <Row label="Category" value={SERVICE_CATEGORIES.find((c) => c.key === draft.category)?.label ?? "—"} />
          <Row label="Measured" value={perUnitLabel(draft.unit)} />
          <Row
            label="Quantities"
            value={[
              draft.minimumQuantity ? `from ${formatQuantity(draft.unit, Number(draft.minimumQuantity))}` : null,
              draft.maximumQuantity ? `to ${formatQuantity(draft.unit, Number(draft.maximumQuantity))}` : null,
              draft.quantityIncrement ? `in steps of ${formatQuantity(draft.unit, Number(draft.quantityIncrement))}` : null,
            ].filter(Boolean).join(" ") || "Any"}
          />
          <Row label="Price" value={`${rupees(Math.round(Number(draft.price || 0) * 100))} ${perUnitLabel(draft.unit)}`} />
          <SectionTitle>Plans</SectionTitle>
          {draft.planRules.map((rule) => (
            <Row
              key={rule.planId}
              label={rule.planName}
              value={rule.mode === "included"
                ? `Includes ${formatQuantity(draft.unit, Number(rule.includedQuantity || 0))}${rule.additionalUsageAllowed ? `, then ${rupees(Math.round(Number(rule.additionalRate || 0) * 100))}` : ", no more"}`
                : PLAN_PRICING_MODES.find((m) => m.key === rule.mode)?.label ?? rule.mode}
            />
          ))}
          <SectionTitle>Availability</SectionTitle>
          <Row label="Offered in" value={AVAILABILITY_SCOPES.find((a) => a.key === draft.availabilityScope)?.label ?? "—"} />
          <Row label="Work done" value={SERVICE_MODES.find((m) => m.key === draft.mode)?.label ?? "—"} />
          <Row label="Operating days" value={draft.operatingDays.map((d) => DAY_LABELS[d]).join(", ") || "None"} />
          <Row label="Time slots" value={draft.timeSlots.map((s) => `${s.window} ${s.startTime}–${s.endTime}`).join(", ") || "None"} />
          <SectionTitle>Rules</SectionTitle>
          <Row label="Eligible" value={ELIGIBILITIES.find((e) => e.key === draft.eligibility)?.label ?? "—"} />
          <Row label="Booked ahead" value={draft.advanceBookingRequired ? `${draft.minAdvanceMinutes} minutes to ${draft.maxAdvanceDays} days` : `Up to ${draft.maxAdvanceDays} days`} />
          <Row label="Cancellation" value={draft.cancellationAllowed ? `Up to ${draft.cancellationDeadlineMinutes} minutes before` : "Not allowed"} />
          {draft.charges.length ? <SectionTitle>Additional charges</SectionTitle> : null}
          {draft.charges.map((charge) => (
            <Row key={charge.kind} label={charge.label} value={rupees(Math.round(Number(charge.amount || 0) * 100))} />
          ))}
          {reviewProblems.length ? (
            // Everything still missing, from every step, so the admin is not sent back
            // through twelve screens one problem at a time.
            <Notice tone="warn" text={reviewProblems.join(" ")} />
          ) : null}
        </>
      ) : null}

      {step < SERVICE_STEPS.length - 1 && stepProblems.length ? <Notice tone="warn" text={stepProblems.join(" ")} /> : null}
      {problems.length ? <Notice tone="warn" text={problems.join(" ")} /> : null}
      <ErrorText error={error} />

      <View style={styles.buttonRow}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
        {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} /> : null}
        {step < SERVICE_STEPS.length - 1 ? (
          <Button label="Next" onPress={() => setStep(step + 1)} disabled={stepProblems.length > 0} />
        ) : (
          <Button
            label={existing ? "Save service" : "Create service"}
            onPress={save}
            disabled={busy || reviewProblems.length > 0}
          />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.slate, fontSize: 16, fontWeight: "700" },
  block: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 12, paddingTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
});
