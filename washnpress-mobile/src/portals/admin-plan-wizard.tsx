import { Fragment, useState } from "react";
import { themed } from "../components/themed";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { GarmentService, Plan, PlanServiceRule, MeasurementUnit, AdditionalUsageBehaviour } from "../api/types";
import { font, theme, rupees } from "../theme";
import {
  SectionTitle, Card, Row, Button, Field, FieldRow, Notice, Pill, ErrorText, Empty,
} from "../components/ui";
import { Dropdown } from "../components/filters";
import { formatQuantity, perUnitLabel } from "../api/units";
import {
  STEPS, USAGE,
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

export function PlanWizard({ token, catalogue, existing, existingNames = [], onCreated, onCancel, framed = true }: {
  token: string;
  catalogue: GarmentService[];
  // Absent when building a new plan; the plan being changed when editing one.
  existing?: Plan | null;
  // The names already in use, minus the one being edited, so the wizard catches a
  // duplicate before the API does.
  existingNames?: string[];
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
  // The same normalised comparison the backend makes, so a duplicate name is refused
  // in the wizard rather than only when the API answers.
  const nameTaken = draft.name.trim().length > 0
    && existingNames.some((n) => n.trim().toLowerCase() === draft.name.trim().toLowerCase());
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
          {nameTaken ? (
            <Notice tone="warn" text="Plan name already exists. Please enter a different plan name." />
          ) : null}
          <Field label="Description" value={draft.description} onChangeText={(v) => setDraft({ ...draft, description: v })} placeholder="Everything, including dry cleaning" />
          <FieldRow>
            <Field label="Price (rupees)" value={draft.price} onChangeText={(v) => setDraft({ ...draft, price: v })} keyboardType="number-pad" placeholder="1000" width="small" />
            {/* Monthly or Annually — nothing else. The allowance period follows from
                it, so a daily/weekly turnaround has no place on a plan. */}
            <Dropdown
              label="Validity"
              value={draft.validity}
              options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annually" }]}
              onChange={(next) => setDraft({ ...draft, validity: (next ?? "monthly") as Draft["validity"] })}
              width="medium"
            />
          </FieldRow>
          <FieldRow>
            <Field label="Tax (%)" value={draft.taxPercent} onChangeText={(v) => setDraft({ ...draft, taxPercent: v })} keyboardType="number-pad" placeholder="5" width="small" />
            <Field label="Discount (%)" value={draft.discountPercent} onChangeText={(v) => setDraft({ ...draft, discountPercent: v })} keyboardType="number-pad" placeholder="10" width="small" />
          </FieldRow>

          <SectionTitle>Services included</SectionTitle>
          <Notice text="Pick the services this plan covers. Each gets an allowance in its own unit, and an answer to what happens when somebody goes beyond it." />
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
            // The allowance the plan includes for this service, in the service's own
            // unit, and what happens beyond it. The unit is not asked again — it comes
            // from the service — and there is no cadence, no per-collection cap and no
            // carry-forward: a plan is an allowance per cycle and a rule for going over.
            const period = draft.validity === "annual" ? "year" : "month";
            const annualHint = draft.validity === "annual" && Number(s.includedQuantity) > 0
              ? ` (${Number(s.includedQuantity)} ${perUnitLabel(s.unit).replace("per ", "")}/year)`
              : "";
            return (
              <View key={s.serviceId} style={styles.block}>
                <SectionTitle action={<Button label="Remove" variant="danger" onPress={() => removeService(i)} />}>
                  {s.serviceName}
                </SectionTitle>
                <FieldRow>
                  <Field
                    label={`Allowance (${perUnitLabel(s.unit).replace("per ", "")} / ${period})${annualHint}`}
                    value={s.includedQuantity}
                    onChangeText={(v) => setService(i, { includedQuantity: v })}
                    keyboardType="number-pad"
                    placeholder={s.unit === "kg" ? "40" : "30"}
                    width="medium"
                  />
                  <Dropdown
                    label="When allowance is exceeded"
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
          <Row label="Validity" value={draft.validity === "annual" ? "Annually" : "Monthly"} />
          {Number(draft.taxPercent) > 0 ? <Row label="Tax" value={`${draft.taxPercent}%`} /> : null}
          {Number(draft.discountPercent) > 0 ? <Row label="Discount" value={`${draft.discountPercent}%`} /> : null}
          <SectionTitle>Services</SectionTitle>
          {rules(draft).map((r) => (
            <Row
              key={r.serviceId}
              label={r.serviceName}
              value={[
                `${formatQuantity(r.unit, r.includedQuantity)} / ${draft.validity === "annual" ? "year" : "month"}`,
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
          <Button label="Next" onPress={() => setStep(step + 1)} disabled={stepProblems.length > 0 || (step === 0 && nameTaken)} />
        ) : (
          <Button label={existing ? "Save plan" : "Create plan"} onPress={create} disabled={busy || stepProblems.length > 0 || nameTaken} />
        )}
      </View>
    </Frame>
  );
}

const styles = themed((theme) => ({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.slate, fontSize: 16, fontFamily: font.bold },
  block: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 12, paddingTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
}));
