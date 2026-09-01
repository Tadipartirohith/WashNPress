import { Fragment, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { GarmentService, Plan, PlanServiceRule, PickupFrequency, MeasurementUnit, AdditionalUsageBehaviour } from "../api/types";
import { font, theme, rupees } from "../theme";
import {
  SectionTitle, Card, Row, Button, Field, FieldRow, Notice, Pill, ErrorText, Empty,
} from "../components/ui";
import { Dropdown } from "../components/filters";
import { formatQuantity, perUnitLabel } from "../api/units";
import {
  STEPS, UNITS, FREQUENCIES, USAGE, DAY_LABELS, TURNAROUNDS,
  emptyDraft, draftFrom, draftPricing, problemsAt, rules,
  type Draft, type DraftService,
} from "./plan-wizard-rules";

// Building a plan, one decision at a time.
//
// The old form asked for a name, one garment allowance, a turnaround and a price,
// which could not express "40 kg of washing and 30 pieces of ironing, ironing on
// Tuesdays and Fridays, and going over costs ₹50 a kilo". A plan is now a set of
// services each configured on its own terms, and that is too much to ask for on one
// screen — so it is asked for in the order the decisions are actually made.

export function PlanWizard({ token, catalogue, existing, onCreated, onCancel, framed = true }: {
  token: string;
  catalogue: GarmentService[];
  // Absent when building a new plan; the plan being changed when editing one.
  existing?: Plan | null;
  onCreated: (message: string) => void;
  onCancel: () => void;
  // Whether the wizard draws its own card. Inside a centred modal the panel is
  // already the frame, and a card within it is a box inside a box.
  framed?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(existing ? draftFrom(existing) : emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const stepProblems = problemsAt(step, draft);
  const setService = (index: number, patch: Partial<DraftService>) => {
    setDraft((current) => ({
      ...current,
      services: current.services.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const addService = (service: GarmentService) => {
    setDraft((current) => ({
      ...current,
      services: [...current.services, {
        serviceId: service.id,
        serviceName: service.name,
        // The unit comes from the service itself rather than being chosen again.
        unit: service.unit ?? "piece",
        includedQuantity: "",
        frequency: "daily",
        frequencyDays: [],
        maxPerFrequency: "",
        carryForward: false,
        additionalUsage: "pay_per_use",
        // Seeded from what the service ordinarily costs, which is the sensible
        // starting point for what going over should cost.
        additionalRate: service.unitPricePaise ? String(service.unitPricePaise / 100) : "",
      }],
    }));
  };

  const removeService = (index: number) => {
    setDraft((current) => ({ ...current, services: current.services.filter((_, i) => i !== index) }));
  };

  const toggleDay = (index: number, day: number) => {
    const service = draft.services[index];
    const has = service.frequencyDays.includes(day);
    setService(index, {
      frequencyDays: has
        ? service.frequencyDays.filter((d) => d !== day)
        : [...service.frequencyDays, day].sort(),
    });
  };

  // What the plan will cost, shown on the review step.
  const { basePaise, discountPaise, taxPaise, payablePaise } = draftPricing(draft);

  const create = async () => {
    setBusy(true); setError(null); setProblems([]);
    const body = {
      name: draft.name.trim(),
      tier: draft.name.trim(),
      description: draft.description.trim() || null,
      monthlyPaise: basePaise,
      validity: draft.validity,
      turnaroundHours: Number(draft.turnaround),
      isActive: draft.active,
      taxPercent: Number(draft.taxPercent) || 0,
      discountPercent: Number(draft.discountPercent) || 0,
      // Kept so a screen written against the old single allowance still reads.
      garmentCap: rules(draft).reduce((sum, r) => sum + r.includedQuantity, 0),
      services: rules(draft),
      coveredServiceIds: rules(draft).map((r) => r.serviceId),
    };
    try {
      if (existing) {
        const saved = await api.adminUpdatePlan(existing.id, body, token);
        // How many residents this reaches, said out loud. Changing what a hundred
        // people are paying for is not the same act as changing a plan nobody is on.
        onCreated(saved.activeSubscriptions
          ? `${saved.plan.name ?? saved.plan.tier} saved. ${saved.activeSubscriptions} active subscription${saved.activeSubscriptions === 1 ? "" : "s"} are affected.`
          : `${saved.plan.name ?? saved.plan.tier} saved.`);
        return;
      }
      const created = await api.adminCreatePlan(body, token);
      onCreated(`${created.plan.name ?? created.plan.tier} created at ${rupees(created.pricing.payablePaise)}.`);
    } catch (e) {
      const failure = e as { problems?: string[]; message: string };
      // The backend names every problem at once; showing them one at a time would
      // undo the point of asking for them all.
      if (failure.problems?.length) setProblems(failure.problems);
      else setError(failure.message);
    } finally { setBusy(false); }
  };

  const chosen = new Set(draft.services.map((s) => s.serviceId));
  // The step being shown, by name. Numbered panels move onto the wrong screen the
  // moment a step is added or removed.
  const on = STEPS[step];

  const Frame = framed ? Card : Fragment;

  return (
    <Frame>
      <View style={styles.headRow}>
        <Text style={styles.title}>{on}</Text>
        <Pill text={`Step ${step + 1} of ${STEPS.length}`} color={theme.aqua} />
      </View>

      {/* 1 — the plan, and the services it is made of.
          Five steps walked the same list of services four times over: which ones,
          in what unit, how often, and what happens past the allowance. Each service
          answers all four in one place now, which is where somebody configuring it
          is actually thinking. */}
      {on === "Plan and services" ? (
        <>
          <Field label="Plan name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="Premium Care" />
          <Field label="Description" value={draft.description} onChangeText={(v) => setDraft({ ...draft, description: v })} placeholder="Everything, including dry cleaning" />
          <FieldRow>
            <Field label="Price (rupees)" value={draft.price} onChangeText={(v) => setDraft({ ...draft, price: v })} keyboardType="number-pad" placeholder="1299" width="small" />
            {/* Dropdowns rather than rows of buttons: these are one choice between
                named alternatives, which is what a list is for. */}
            <Dropdown
              label="Validity"
              value={draft.validity}
              options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual" }]}
              onChange={(next) => setDraft({ ...draft, validity: (next ?? "monthly") as Draft["validity"] })}
              width="medium"
            />
            <Dropdown
              label="Turnaround time"
              value={draft.turnaround || undefined}
              allLabel="Select turnaround time"
              options={TURNAROUNDS.map((hours) => ({ value: String(hours), label: `${hours} hours` }))}
              onChange={(next) => setDraft({ ...draft, turnaround: next ?? "" })}
              width="medium"
            />
          </FieldRow>
          <View style={styles.buttonRow}>
            <Button
              label={draft.active ? "Active" : "Inactive"}
              selected={draft.active}
              variant="secondary"
              onPress={() => setDraft({ ...draft, active: !draft.active })}
            />
          </View>

          <SectionTitle>Services</SectionTitle>
          <Notice text="A plan is a set of services, each configured on its own terms: its own allowance, its own cadence, and its own answer to what happens when somebody wants more." />
          <View style={styles.chipRow}>
            {catalogue.filter((service) => !chosen.has(service.id)).map((service) => (
              <Button
                key={service.id}
                label={`Add ${service.name}`}
                variant="secondary"
                onPress={() => addService(service)}
              />
            ))}
          </View>
          {draft.services.length ? null : <Empty text="No services yet." />}

          {draft.services.map((s, i) => {
            const definition = FREQUENCIES.find((f) => f.key === s.frequency);
            return (
              <View key={s.serviceId} style={styles.block}>
                <SectionTitle action={<Button label="Remove" variant="danger" onPress={() => removeService(i)} />}>
                  {s.serviceName}
                </SectionTitle>
                <FieldRow>
                  <Dropdown
                    label="Measured in"
                    value={s.unit}
                    options={UNITS.map((unit) => ({ value: unit, label: perUnitLabel(unit) }))}
                    onChange={(next) => { if (next) setService(i, { unit: next as typeof s.unit }); }}
                    width="medium"
                  />
                  <Field
                    label={`Garment allowance (${s.unit})`}
                    value={s.includedQuantity}
                    onChangeText={(v) => setService(i, { includedQuantity: v })}
                    keyboardType="number-pad"
                    placeholder={s.unit === "kg" ? "40" : "30"}
                    width="small"
                  />
                  <Dropdown
                    label="How often"
                    value={s.frequency}
                    allLabel="Select frequency"
                    options={FREQUENCIES.map((f) => ({ value: f.key, label: f.label }))}
                    onChange={(next) => { if (next) setService(i, { frequency: next as typeof s.frequency, frequencyDays: FREQUENCIES.find((f) => f.key === next)?.needsDays ? s.frequencyDays : [] }); }}
                    width="medium"
                  />
                </FieldRow>
                {definition?.needsDays ? (
                  <View style={styles.chipRow}>
                    {DAY_LABELS.map((label, day) => (
                      <Button
                        key={label}
                        label={label}
                        selected={s.frequencyDays.includes(day)}
                        variant="secondary"
                        onPress={() => toggleDay(i, day)}
                      />
                    ))}
                  </View>
                ) : null}
                <FieldRow>
                  <Field
                    label={`Most per collection (${s.unit}, optional)`}
                    value={s.maxPerFrequency}
                    onChangeText={(v) => setService(i, { maxPerFrequency: v })}
                    keyboardType="number-pad"
                    width="small"
                  />
                  <Dropdown
                    label="If they want more"
                    value={s.additionalUsage}
                    options={USAGE.map((u) => ({ value: u.key, label: u.label }))}
                    onChange={(next) => { if (next) setService(i, { additionalUsage: next as typeof s.additionalUsage }); }}
                    width="medium"
                  />
                  {s.additionalUsage === "block" ? null : (
                    <Field
                      label={`Additional charge (rupees ${perUnitLabel(s.unit)})`}
                      value={s.additionalRate}
                      onChangeText={(v) => setService(i, { additionalRate: v })}
                      keyboardType="number-pad"
                      width="small"
                    />
                  )}
                </FieldRow>
                <Button
                  label={s.carryForward ? "Unused allowance carries to next cycle" : "Unused allowance is lost at the end of the cycle"}
                  selected={s.carryForward}
                  variant="secondary"
                  onPress={() => setService(i, { carryForward: !s.carryForward })}
                />
              </View>
            );
          })}
        </>
      ) : null}

      {on === "Review and create" ? (
        <>
          <Row label="Plan" value={draft.name} />
          <Row label="Description" value={draft.description || "—"} />
          <Row label="Price" value={rupees(basePaise)} />
          <Row label="Validity" value={draft.validity === "annual" ? "Annual" : "Monthly"} />
          <Row label="Turnaround" value={`${draft.turnaround} hours`} />
          <Row label="Status" value={draft.active ? "Active" : "Inactive"} />
          <SectionTitle>Services</SectionTitle>
          {rules(draft).map((r) => (
            <Row
              key={r.serviceId}
              label={r.serviceName}
              value={[
                formatQuantity(r.unit, r.includedQuantity),
                FREQUENCIES.find((f) => f.key === r.frequency)?.label ?? r.frequency,
                r.frequencyDays.length ? r.frequencyDays.map((d) => DAY_LABELS[d]).join("/") : null,
                r.carryForward ? "carries forward" : null,
                r.additionalUsage === "block"
                  ? "no extra allowed"
                  : `extra ${rupees(r.additionalRatePaise)} ${perUnitLabel(r.unit)}`,
              ].filter(Boolean).join(" · ")}
            />
          ))}
          <SectionTitle>What it comes to</SectionTitle>
          <Row label="Price" value={rupees(basePaise)} />
          {discountPaise ? <Row label={`Discount (${draft.discountPercent}%)`} value={`− ${rupees(discountPaise)}`} /> : null}
          {taxPaise ? <Row label={`Tax (${draft.taxPercent}%)`} value={rupees(taxPaise)} /> : null}
          <Row label="Payable" value={rupees(payablePaise)} />
          <Field label="Tax percent" value={draft.taxPercent} onChangeText={(v) => setDraft({ ...draft, taxPercent: v })} keyboardType="number-pad" />
          <Field label="Discount percent" value={draft.discountPercent} onChangeText={(v) => setDraft({ ...draft, discountPercent: v })} keyboardType="number-pad" />
        </>
      ) : null}

      {stepProblems.length ? (
        <Notice tone="warn" text={stepProblems.join(" ")} />
      ) : null}
      {problems.length ? <Notice tone="warn" text={problems.join(" ")} /> : null}
      <ErrorText error={error} />

      <View style={styles.buttonRow}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
        {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} /> : null}
        {step < STEPS.length - 1 ? (
          // Required fields are checked before the step is left, so a mistake is
          // caught where it was made rather than at the end.
          <Button label="Next" onPress={() => setStep(step + 1)} disabled={stepProblems.length > 0} />
        ) : (
          <Button label={existing ? "Save plan" : "Create plan"} onPress={create} disabled={busy || stepProblems.length > 0} />
        )}
      </View>
    </Frame>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.slate, fontSize: 16, fontFamily: font.bold },
  block: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 12, paddingTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
});
