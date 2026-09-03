import { useState } from "react";
import { themed } from "../components/themed";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { Plan, Society } from "../api/types";
import { font, theme, rupees } from "../theme";
import {
  SectionTitle, Card, Row, Button, Field, FieldRow, Notice, Pill, ErrorText, Empty,
} from "../components/ui";
import { Dropdown } from "../components/filters";
import { perUnitLabel } from "../api/units";
import {
  SERVICE_STEPS, SERVICE_UNITS, VEHICLE_TYPES, PLAN_PRICING_MODES,
  SERVICE_FREQUENCIES, SERVICE_MODES, AVAILABILITY_SCOPES, ELIGIBILITIES,
  CHARGE_KINDS, DAY_LABELS, SERVICE_WORKFLOW_STAGES,
  emptyServiceDraft, emptyPlanRule, emptyOption, emptyAddOn, serviceDraftFrom,
  serviceProblemsAt, allServiceProblems, serviceBody,
  eligibilityFor, offeredToSubscribers, offeredToOthers,
  type ServiceDraft, type DraftPlanRule,
} from "./service-wizard-rules";

// Building an extra service, one decision at a time.
//
// A service is a list of decisions: what it is, who it is for and what they pay,
// where it is offered, what the resident may add, what extras apply, and whose work
// it is — and then a look at the whole thing before it is published. None of that
// fits on one screen, and none of it belongs in code.
//
// It used to be sixteen screens. Several asked one question; four of them described
// one arrangement between them, so reading any one told you a quarter of the answer.
// Seven now, and the numbering runs 1 to 7 with no gaps where a step was removed.

export function ServiceWizard({ token, plans, societies, existing, existingNames = [], onSaved, onCancel }: {
  token: string;
  plans: Plan[];
  societies: Society[];
  // The names of the other services, so a duplicate is caught in the form rather than
  // only when the API refuses it. The service being edited is not in this list, so it
  // may keep its own name.
  existingNames?: string[];
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
  const toggle = (list: number[], value: number): number[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);
  const toggleId = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const stepProblems = serviceProblemsAt(step, draft);
  const reviewProblems = allServiceProblems(draft);
  // The same normalised comparison the backend makes — trimmed, case-folded — so the
  // form refuses a duplicate before the API has to.
  const nameTaken = draft.name.trim().length > 0
    && existingNames.some((n) => n.trim().toLowerCase() === draft.name.trim().toLowerCase());
  const included = draft.planRules.filter((r) => r.mode === "included");

  // The status is passed in rather than set first: setting state and then reading
  // it in the same handler reads the value before the change, so "Publish" would
  // have saved a draft.
  const save = async (status: string = draft.status) => {
    setBusy(true); setError(null); setProblems([]);
    try {
      const body = serviceBody({ ...draft, status, active: status === "active" });
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

  // The step being shown, by name. The panels used to be numbered, so inserting
  // one moved every panel after it onto the wrong screen without anything failing
  // to compile.
  const on = SERVICE_STEPS[step];

  const chip = (active: boolean, label: string, onPress: () => void, key: string) => (
    <Button key={key} label={label} selected={active} variant="secondary" onPress={onPress} />
  );

  return (
    <Card>
      <View style={styles.headRow}>
        <Text style={styles.title}>{SERVICE_STEPS[step]}</Text>
        <Pill text={`Step ${step + 1} of ${SERVICE_STEPS.length}`} color={theme.aqua} />
      </View>

      {/* 1 — what it is */}
      {on === "Basic details" ? (
        <>
          <Field label="Service name" value={draft.name} onChangeText={(v) => set({ name: v })} placeholder="Carpet cleaning" />
          {nameTaken ? (
            <Notice tone="warn" text="Service name already exists. Please enter a different service name." />
          ) : null}
          {/* What the service is measured in, chosen directly. There is no Category
              step any more: the category followed from the unit, so the unit is asked
              and the category is worked out from it. */}
          <Dropdown
            label="Measured in"
            value={draft.unit || undefined}
            allLabel="Choose how it is measured"
            options={SERVICE_UNITS.map((u) => ({ value: u.key, label: u.label }))}
            onChange={(next) => set({
              unit: (next ?? "job") as ServiceDraft["unit"],
              vehicleTypes: next === "vehicle" ? draft.vehicleTypes : [],
            })}
            width="medium"
          />
          {draft.unit === "vehicle" ? (
            <Dropdown
              label="Vehicle type"
              value={draft.vehicleTypes[0]}
              allLabel="Choose a vehicle type"
              options={VEHICLE_TYPES.map((v) => ({ value: v.key, label: v.label }))}
              onChange={(next) => set({ vehicleTypes: next ? [next] : [] })}
              width="medium"
            />
          ) : null}
          <Field label="Description" value={draft.description} onChangeText={(v) => set({ description: v })} placeholder="Deep cleaned in your flat" />
          {/* No icon, and no status. A service being built is a draft and a
              published one is active: which of the two it is follows from the
              button pressed on the last step, not from a field halfway through. */}
        </>
      ) : null}

      {/* 2 — who it is for, what they pay, and how often.
          Four screens described one arrangement: who may book it, what somebody
          without a plan pays, what each plan does about it, and how much a plan
          includes. Reading any one of them told you a quarter of the answer. */}
      {on === "Customer and pricing" ? (
        <>
          <SectionTitle>Customer type</SectionTitle>
          <View style={styles.chipRow}>
            {chip(
              offeredToSubscribers(draft.eligibility), "Subscriber",
              () => set({ eligibility: eligibilityFor(!offeredToSubscribers(draft.eligibility), offeredToOthers(draft.eligibility)) }),
              "sub",
            )}
            {chip(
              offeredToOthers(draft.eligibility), "Non-subscriber",
              () => set({ eligibility: eligibilityFor(offeredToSubscribers(draft.eligibility), !offeredToOthers(draft.eligibility)) }),
              "non",
            )}
          </View>

          {offeredToOthers(draft.eligibility) ? (
            <Field
              label={`Price without a plan (rupees ${perUnitLabel(draft.unit)})`}
              value={draft.price}
              onChangeText={(v) => set({ price: v })}
              keyboardType="number-pad"
            />
          ) : null}

          {offeredToSubscribers(draft.eligibility) ? (
            <>
              <Field
                label={`Flat subscriber price (rupees ${perUnitLabel(draft.unit)}, optional)`}
                value={draft.subscriberPrice}
                onChangeText={(v) => set({ subscriberPrice: v })}
                keyboardType="number-pad"
              />
              <Dropdown
                label="How often"
                value={draft.frequency || undefined}
                allLabel="No restriction"
                options={SERVICE_FREQUENCIES.map((f) => ({ value: f.key, label: f.label }))}
                onChange={(next) => set({
                  frequency: (next ?? "") as ServiceDraft["frequency"],
                  frequencyDays: SERVICE_FREQUENCIES.find((f) => f.key === next)?.needsDays ? draft.frequencyDays : [],
                })}
                width="medium"
              />
              {SERVICE_FREQUENCIES.find((f) => f.key === draft.frequency)?.needsDays ? (
                <View style={styles.chipRow}>
                  {DAY_LABELS.map((label, day) => chip(draft.frequencyDays.includes(day), label, () => set({ frequencyDays: toggle(draft.frequencyDays, day) }), label))}
                </View>
              ) : null}

              <SectionTitle>What each plan does about it</SectionTitle>
              <Notice text="Every plan answers, because a plan not getting a service is a decision rather than an absence of one." />
              {draft.planRules.length ? null : <Empty text="There are no plans to configure." />}
              {draft.planRules.map((rule) => (
                <View key={rule.planId} style={styles.block}>
                  <SectionTitle>{rule.planName}</SectionTitle>
                  {/* A dropdown rather than six buttons across the card: these are
                      one choice between named alternatives, which is what a list is. */}
                  <Dropdown
                    label="Pricing"
                    value={rule.mode}
                    options={PLAN_PRICING_MODES.map((m) => ({ value: m.key, label: m.label }))}
                    onChange={(next) => { if (next) setRule(rule.planId, { mode: next }); }}
                    width="medium"
                  />
                  {rule.mode === "fixed" || rule.mode === "discounted" ? (
                    <Field
                      label={`Price (rupees ${perUnitLabel(draft.unit)})`}
                      value={rule.price}
                      onChangeText={(v) => setRule(rule.planId, { price: v })}
                      keyboardType="number-pad"
                      width="small"
                    />
                  ) : null}
                  {rule.mode === "percentage_discount" ? (
                    <Field
                      label="Discount (percent)"
                      value={rule.discountPercent}
                      onChangeText={(v) => setRule(rule.planId, { discountPercent: v })}
                      keyboardType="number-pad"
                      width="small"
                    />
                  ) : null}
                  {rule.mode === "additional_charge" ? (
                    <Field
                      label={`Additional charge (rupees ${perUnitLabel(draft.unit)})`}
                      value={rule.additionalRate}
                      onChangeText={(v) => setRule(rule.planId, { additionalRate: v })}
                      keyboardType="number-pad"
                      width="small"
                    />
                  ) : null}
                  {rule.mode === "included" ? (
                    <>
                      <Field
                        label={`Included per cycle (${draft.unit})`}
                        value={rule.includedQuantity}
                        onChangeText={(v) => setRule(rule.planId, { includedQuantity: v })}
                        keyboardType="number-pad"
                        width="small"
                      />
                      <Dropdown
                        label="How often"
                        value={rule.frequency || undefined}
                        allLabel="Choose a frequency"
                        options={SERVICE_FREQUENCIES.map((f) => ({ value: f.key, label: f.label }))}
                        onChange={(next) => setRule(rule.planId, {
                          frequency: (next ?? "") as DraftPlanRule["frequency"],
                          frequencyDays: SERVICE_FREQUENCIES.find((f) => f.key === next)?.needsDays ? rule.frequencyDays : [],
                        })}
                        width="medium"
                      />
                      {SERVICE_FREQUENCIES.find((f) => f.key === rule.frequency)?.needsDays ? (
                        <View style={styles.chipRow}>
                          {DAY_LABELS.map((label, day) => chip(rule.frequencyDays.includes(day), label, () => setRule(rule.planId, { frequencyDays: toggle(rule.frequencyDays, day) }), `${rule.planId}-${label}`))}
                        </View>
                      ) : null}
                      {chip(rule.carryForward, rule.carryForward ? "Unused carries forward" : "Unused is lost at the end of the cycle", () => setRule(rule.planId, { carryForward: !rule.carryForward }), `${rule.planId}-carry`)}
                      {chip(rule.additionalUsageAllowed, rule.additionalUsageAllowed ? "Additional usage allowed" : "Additional usage not allowed", () => setRule(rule.planId, { additionalUsageAllowed: !rule.additionalUsageAllowed }), `${rule.planId}-extra`)}
                      {rule.additionalUsageAllowed ? (
                        <Field
                          label={`Additional usage price (rupees ${perUnitLabel(draft.unit)})`}
                          value={rule.additionalRate}
                          onChangeText={(v) => setRule(rule.planId, { additionalRate: v })}
                          keyboardType="number-pad"
                          width="small"
                        />
                      ) : null}
                    </>
                  ) : null}
                </View>
              ))}

              <SectionTitle>Which plans may book it</SectionTitle>
              <View style={styles.chipRow}>
                {plans.map((p) => chip(draft.eligiblePlanIds.includes(p.id), p.name ?? p.tier, () => set({ eligiblePlanIds: toggleId(draft.eligiblePlanIds, p.id) }), p.id))}
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {/* 3 — what it costs */}
      {/* What the resident chooses, and what they can add. A vehicle service had
          its vehicle types; every other service had no way to offer a choice at
          all, so a Deluxe wash had to be created as a second service. */}
      {on === "Options and add-ons" ? (
        <>
          <SectionTitle
            action={<Button label="Add option" variant="secondary" onPress={() => set({ options: [...draft.options, emptyOption()] })} />}
          >
            Options
          </SectionTitle>
          <Notice text="What the resident picks between when they book: which wash, which size, which level of finish. A price difference is optional." />
          {draft.options.map((option, index) => (
            <Card key={option.id}>
              <FieldRow>
                <Field
                  label="Label"
                  value={option.label}
                  onChangeText={(v) => set({ options: draft.options.map((o, i) => (i === index ? { ...o, label: v } : o)) })}
                  width="medium"
                />
                <Field
                  label="Price difference (rupees)"
                  value={option.priceDelta}
                  onChangeText={(v) => set({ options: draft.options.map((o, i) => (i === index ? { ...o, priceDelta: v } : o)) })}
                  keyboardType="number-pad"
                  width="small"
                />
              </FieldRow>
              <View style={styles.buttonRow}>
                {chip(option.active, option.active ? "Active" : "Inactive",
                  () => set({ options: draft.options.map((o, i) => (i === index ? { ...o, active: !o.active } : o)) }),
                  `${option.id}-active`)}
                <Button label="Remove" variant="danger" onPress={() => set({ options: draft.options.filter((_, i) => i !== index) })} />
              </View>
            </Card>
          ))}
          {!draft.options.length ? <Empty text="No options. The resident simply books the service." /> : null}

          <SectionTitle
            action={<Button label="Add add-on" variant="secondary" onPress={() => set({ addOns: [...draft.addOns, emptyAddOn()] })} />}
          >
            Add-ons
          </SectionTitle>
          <Notice text="Extras the resident asks for, each with its own price. Different from the additional charges on a later step, which the platform applies rather than the resident choosing." />
          {draft.addOns.map((addOn, index) => (
            <Card key={addOn.id}>
              <FieldRow>
                <Field
                  label="Name"
                  value={addOn.name}
                  onChangeText={(v) => set({ addOns: draft.addOns.map((a, i) => (i === index ? { ...a, name: v } : a)) })}
                  width="medium"
                />
                <Field
                  label="Price (rupees)"
                  value={addOn.price}
                  onChangeText={(v) => set({ addOns: draft.addOns.map((a, i) => (i === index ? { ...a, price: v } : a)) })}
                  keyboardType="number-pad"
                  width="small"
                />
              </FieldRow>
              <Field
                label="Description (optional)"
                value={addOn.description}
                onChangeText={(v) => set({ addOns: draft.addOns.map((a, i) => (i === index ? { ...a, description: v } : a)) })}
              />
              <View style={styles.buttonRow}>
                {chip(addOn.active, addOn.active ? "Active" : "Inactive",
                  () => set({ addOns: draft.addOns.map((a, i) => (i === index ? { ...a, active: !a.active } : a)) }),
                  `${addOn.id}-active`)}
                <Button label="Remove" variant="danger" onPress={() => set({ addOns: draft.addOns.filter((_, i) => i !== index) })} />
              </View>
            </Card>
          ))}
          {!draft.addOns.length ? <Empty text="No add-ons. Residents see only the service itself." /> : null}
        </>
      ) : null}

      {/* 7 — where it is offered */}
      {on === "Availability" ? (
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
          <SectionTitle>How the work is done</SectionTitle>
          <View style={styles.chipRow}>
            {SERVICE_MODES.map((m) => chip(draft.mode === m.key, m.label, () => set({ mode: m.key }), m.key))}
          </View>
          <SectionTitle>Operating days</SectionTitle>
          <View style={styles.chipRow}>
            {DAY_LABELS.map((label, day) => chip(draft.operatingDays.includes(day), label, () => set({ operatingDays: toggle(draft.operatingDays, day) }), label))}
          </View>

          {/* The windows the service actually runs in, and how many it can take in
              each. Until this existed the capacity was a number only the database
              could set — which made a service either unlimited or unconfigurable,
              and the booking screen had nothing to draw. */}
          <SectionTitle>Times and capacity</SectionTitle>
          <Notice text="A service with no times runs to no timetable: a resident may book it at any hour and nothing limits how many. Add times to hold it to a schedule, and a capacity to say how many can be booked into each." />
          {draft.timeSlots.map((slot, index) => {
            const patch = (part: Partial<typeof slot>) => set({
              timeSlots: draft.timeSlots.map((s, i) => (i === index ? { ...s, ...part } : s)),
            });
            return (
              <View key={index} style={styles.slotRow}>
                <FieldRow>
                  <Field label="Name" value={slot.window} onChangeText={(v) => patch({ window: v })} placeholder="Morning" width="medium" />
                  <Field label="From" value={slot.startTime} onChangeText={(v) => patch({ startTime: v })} placeholder="10:00" width="small" />
                  <Field label="To" value={slot.endTime} onChangeText={(v) => patch({ endTime: v })} placeholder="11:00" width="small" />
                  <Field label="How many" value={slot.capacity} onChangeText={(v) => patch({ capacity: v })} keyboardType="number-pad" width="small" />
                </FieldRow>
                <View style={styles.chipRow}>
                  {chip(slot.subscriberAvailable, "Offered to subscribers", () => patch({ subscriberAvailable: !slot.subscriberAvailable }), `sub-${index}`)}
                  {chip(slot.nonSubscriberAvailable, "Offered to everyone else", () => patch({ nonSubscriberAvailable: !slot.nonSubscriberAvailable }), `non-${index}`)}
                  <Button
                    label="Remove"
                    variant="secondary"
                    onPress={() => set({ timeSlots: draft.timeSlots.filter((_, i) => i !== index) })}
                  />
                </View>
              </View>
            );
          })}
          <Button
            label="Add a time"
            variant="secondary"
            onPress={() => set({
              timeSlots: [...draft.timeSlots, {
                window: "", startTime: "", endTime: "", capacity: "1", maxBookings: "",
                subscriberAvailable: true, nonSubscriberAvailable: true,
              }],
            })}
          />
        </>
      ) : null}

      {/* 11 — the extras */}
      {on === "Additional charges" ? (
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
      {/* Whose work it is, and what the work is. A service should not be forced
          through a laundry's stages: a car wash has no ironing to do. */}
      {on === "Operations and workflow" ? (
        <>
          <Field
            label="Operations team"
            value={draft.team}
            onChangeText={(v) => set({ team: v })}
            placeholder="Vehicle Service Operators"
          />
          <SectionTitle>Workflow</SectionTitle>
          <Notice text="The stages this service goes through, in the order they happen. Scheduled and completed are always needed: without the first it cannot be booked, and without the second it can never be finished." />
          <View style={styles.chipRow}>
            {SERVICE_WORKFLOW_STAGES.map((stage) => chip(
              draft.workflow.includes(stage.key),
              stage.required ? `${stage.label} (required)` : stage.label,
              () => {
                if (stage.required) return;
                const next = draft.workflow.includes(stage.key)
                  ? draft.workflow.filter((k) => k !== stage.key)
                  // Kept in the order the stages actually happen, whatever order
                  // they were tapped in.
                  : SERVICE_WORKFLOW_STAGES.filter((x) => x.key === stage.key || draft.workflow.includes(x.key)).map((x) => x.key);
                set({ workflow: next });
              },
              stage.key,
            ))}
          </View>
        </>
      ) : null}

      {/* What the resident is told, and when. Nothing chosen means everything,
          which is what happened before any of this was configurable. */}
      {on === "Review and publish" ? (
        <>
          <Row label="Service" value={draft.name} />
          <Row label="Measured in" value={SERVICE_UNITS.find((u) => u.key === draft.unit)?.label ?? "—"} />
          {draft.unit === "vehicle" ? <Row label="Vehicle type" value={draft.vehicleTypes.join(", ") || "—"} /> : null}
          <Row label="Description" value={draft.description || "—"} />
          <Row label="Offered to" value={ELIGIBILITIES.find((e) => e.key === draft.eligibility)?.label ?? "Nobody yet"} />
          <Row label="Price" value={`${rupees(Math.round(Number(draft.price || 0) * 100))} ${perUnitLabel(draft.unit)}`} />
          <Row label="How often" value={SERVICE_FREQUENCIES.find((f) => f.key === draft.frequency)?.label ?? "No restriction"} />
          <SectionTitle>Plans</SectionTitle>
          {draft.planRules.map((rule) => (
            <Row
              key={rule.planId}
              label={rule.planName}
              value={rule.mode === "included"
                ? `Includes ${rule.includedQuantity || 0}${rule.additionalUsageAllowed ? `, then ${rupees(Math.round(Number(rule.additionalRate || 0) * 100))}` : ", no more"}`
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
          <Button label="Next" onPress={() => setStep(step + 1)} disabled={stepProblems.length > 0 || (step === 0 && nameTaken)} />
        ) : (
          <>
            {/* Two ways to leave the last step. Saving a draft keeps the work
                without putting a half-configured service in front of anybody;
                publishing is the deliberate act that makes it bookable. */}
            <Button
              label="Save as draft"
              variant="secondary"
              onPress={() => save("draft")}
              disabled={busy || reviewProblems.length > 0 || nameTaken}
            />
            <Button
              label={existing && draft.status === "active" ? "Save service" : "Publish service"}
              onPress={() => save("active")}
              disabled={busy || reviewProblems.length > 0 || nameTaken}
            />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = themed((theme) => ({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.slate, fontSize: 16, fontFamily: font.bold },
  block: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 12, paddingTop: 8 },
  // Each window is a row of its own so the fields inside it read as belonging
  // together rather than as one long form.
  slotRow: {
    borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, marginTop: 10,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
}));
