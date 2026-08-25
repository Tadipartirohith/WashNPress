import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { GarmentService, Plan, PlanServiceRule, PickupFrequency, MeasurementUnit, AdditionalUsageBehaviour } from "../api/types";
import { theme, rupees } from "../theme";
import {
  SectionTitle, Card, Row, Button, Field, Notice, Pill, ErrorText, Empty,
} from "../components/ui";
import { formatQuantity, perUnitLabel } from "../api/units";
import {
  STEPS, UNITS, FREQUENCIES, USAGE, DAY_LABELS,
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

export function PlanWizard({ token, catalogue, existing, onCreated, onCancel }: {
  token: string;
  catalogue: GarmentService[];
  // Absent when building a new plan; the plan being changed when editing one.
  existing?: Plan | null;
  onCreated: (message: string) => void;
  onCancel: () => void;
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

  return (
    <Card>
      <View style={styles.headRow}>
        <Text style={styles.title}>{STEPS[step]}</Text>
        <Pill text={`Step ${step + 1} of ${STEPS.length}`} color={theme.aqua} />
      </View>

      {step === 0 ? (
        <>
          <Field label="Plan name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="Premium Care" />
          <Field label="Description" value={draft.description} onChangeText={(v) => setDraft({ ...draft, description: v })} placeholder="Everything, including dry cleaning" />
          <Field label="Price (rupees)" value={draft.price} onChangeText={(v) => setDraft({ ...draft, price: v })} keyboardType="number-pad" placeholder="1299" />
          <SectionTitle>Validity</SectionTitle>
          <View style={styles.buttonRow}>
            <Button label={draft.validity === "monthly" ? "✓ Monthly" : "Monthly"} variant="secondary" onPress={() => setDraft({ ...draft, validity: "monthly" })} />
            <Button label={draft.validity === "annual" ? "✓ Annual" : "Annual"} variant="secondary" onPress={() => setDraft({ ...draft, validity: "annual" })} />
          </View>
          <Field label="Turnaround (hours)" value={draft.turnaround} onChangeText={(v) => setDraft({ ...draft, turnaround: v })} keyboardType="number-pad" />
          <View style={styles.buttonRow}>
            <Button label={draft.active ? "✓ Active" : "Inactive"} variant="secondary" onPress={() => setDraft({ ...draft, active: !draft.active })} />
          </View>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Notice text="A plan is a set of services, each configured on its own terms. Add every service this plan includes." />
          {catalogue.filter((service) => !chosen.has(service.id)).map((service) => (
            <Button
              key={service.id}
              label={`Add ${service.name} (${perUnitLabel(service.unit ?? "piece")})`}
              variant="secondary"
              onPress={() => addService(service)}
            />
          ))}
          {draft.services.length ? <SectionTitle>In this plan</SectionTitle> : <Empty text="No services yet." />}
          {draft.services.map((s, i) => (
            <Row key={s.serviceId} label={s.serviceName} value={<Button label="Remove" variant="danger" onPress={() => removeService(i)} />} />
          ))}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Notice text="Each service has its own allowance in its own unit. One shared garment allowance cannot say 40 kg of washing and 30 pieces of ironing." />
          {draft.services.map((s, i) => (
            <View key={s.serviceId} style={styles.block}>
              <SectionTitle>{s.serviceName}</SectionTitle>
              <View style={styles.chipRow}>
                {UNITS.map((unit) => (
                  <Button
                    key={unit}
                    label={s.unit === unit ? `✓ ${unit}` : unit}
                    variant="secondary"
                    onPress={() => setService(i, { unit })}
                  />
                ))}
              </View>
              <Field
                label={`Included quantity (${s.unit})`}
                value={s.includedQuantity}
                onChangeText={(v) => setService(i, { includedQuantity: v })}
                keyboardType="number-pad"
                placeholder={s.unit === "kg" ? "40" : "30"}
              />
            </View>
          ))}
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Notice text="How often each service may be collected. A resident can only book a service on the days its frequency allows." />
          {draft.services.map((s, i) => {
            const definition = FREQUENCIES.find((f) => f.key === s.frequency);
            return (
              <View key={s.serviceId} style={styles.block}>
                <SectionTitle>{s.serviceName}</SectionTitle>
                <View style={styles.chipRow}>
                  {FREQUENCIES.map((f) => (
                    <Button
                      key={f.key}
                      label={s.frequency === f.key ? `✓ ${f.label}` : f.label}
                      variant="secondary"
                      onPress={() => setService(i, { frequency: f.key, frequencyDays: f.needsDays ? s.frequencyDays : [] })}
                    />
                  ))}
                </View>
                {definition?.needsDays ? (
                  <View style={styles.chipRow}>
                    {DAY_LABELS.map((label, day) => (
                      <Button
                        key={label}
                        label={s.frequencyDays.includes(day) ? `✓ ${label}` : label}
                        variant="secondary"
                        onPress={() => toggleDay(i, day)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}

      {step === 4 ? (
        <>
          <Notice text="What happens when a resident wants more than the plan includes. Each service answers this for itself, and at its own rate." />
          {draft.services.map((s, i) => (
            <View key={s.serviceId} style={styles.block}>
              <SectionTitle>{s.serviceName}</SectionTitle>
              <Field
                label={`Most per collection (${s.unit}, optional)`}
                value={s.maxPerFrequency}
                onChangeText={(v) => setService(i, { maxPerFrequency: v })}
                keyboardType="number-pad"
              />
              <Button
                label={s.carryForward ? "✓ Unused allowance carries to next cycle" : "Unused allowance is lost at the end of the cycle"}
                variant="secondary"
                onPress={() => setService(i, { carryForward: !s.carryForward })}
              />
              <View style={styles.chipRow}>
                {USAGE.map((u) => (
                  <Button
                    key={u.key}
                    label={s.additionalUsage === u.key ? `✓ ${u.label}` : u.label}
                    variant="secondary"
                    onPress={() => setService(i, { additionalUsage: u.key })}
                  />
                ))}
              </View>
              <Notice text={USAGE.find((u) => u.key === s.additionalUsage)?.hint ?? ""} />
              {s.additionalUsage === "block" ? null : (
                <Field
                  label={`Additional charge (rupees ${perUnitLabel(s.unit)})`}
                  value={s.additionalRate}
                  onChangeText={(v) => setService(i, { additionalRate: v })}
                  keyboardType="number-pad"
                />
              )}
            </View>
          ))}
        </>
      ) : null}

      {step === 5 ? (
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
