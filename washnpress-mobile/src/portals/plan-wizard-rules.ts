import type { PlanServiceRule, PickupFrequency, MeasurementUnit, AdditionalUsageBehaviour, Plan } from "../api/types";

// The rules behind the plan wizard, kept apart from the screen that renders them.
//
// A plan used to be a name, one garment allowance, a turnaround and a price. It is
// now a set of services each configured on its own terms — a unit, an allowance, a
// cadence, and an answer to "what if they want more" — which is too much to ask for
// on one screen. Each step therefore checks its own answers before moving on, and
// those checks are here where they can be read and tested without a renderer.

export const STEPS = [
  "Basic details",
  "Add services",
  "Measurement and allowance",
  "Frequency",
  "Usage and additional pricing",
  "Review and create",
] as const;

export const UNITS: MeasurementUnit[] = ["kg", "piece", "hour", "job", "vehicle", "room", "sqft", "pair", "item"];

export const FREQUENCIES: { key: PickupFrequency; label: string; needsDays: boolean }[] = [
  { key: "daily", label: "Daily", needsDays: false },
  { key: "alternate_days", label: "Alternate days", needsDays: false },
  { key: "twice_weekly", label: "Twice a week", needsDays: true },
  { key: "weekly", label: "Weekly", needsDays: true },
  { key: "custom", label: "Custom", needsDays: true },
];

export const USAGE: { key: AdditionalUsageBehaviour; label: string; hint: string }[] = [
  { key: "pay_per_use", label: "Charged as extra", hint: "Anything beyond the allowance is billed at the rate below." },
  { key: "block", label: "Not allowed", hint: "The resident cannot book beyond the allowance at all." },
  { key: "admin_approval", label: "Needs approval", hint: "Going beyond the allowance is held until somebody says yes." },
];

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The plan being built. Held as text where the admin types it, so a half-finished
// "12." is not turned into a number the moment it is typed.
export interface Draft {
  name: string;
  description: string;
  price: string;
  validity: "monthly" | "annual";
  turnaround: string;
  active: boolean;
  taxPercent: string;
  discountPercent: string;
  services: DraftService[];
}

export interface DraftService {
  serviceId: string;
  serviceName: string;
  unit: MeasurementUnit;
  includedQuantity: string;
  frequency: PickupFrequency;
  frequencyDays: number[];
  maxPerFrequency: string;
  carryForward: boolean;
  additionalUsage: AdditionalUsageBehaviour;
  additionalRate: string;
}

export function emptyDraft(): Draft {
  return {
    name: "", description: "", price: "", validity: "monthly", turnaround: "48",
    active: true, taxPercent: "", discountPercent: "", services: [],
  };
}

export function rules(draft: Draft): PlanServiceRule[] {
  return draft.services.map((s) => ({
    serviceId: s.serviceId,
    serviceName: s.serviceName,
    unit: s.unit,
    includedQuantity: Number(s.includedQuantity) || 0,
    frequency: s.frequency,
    frequencyDays: s.frequencyDays,
    maxPerFrequency: s.maxPerFrequency ? Number(s.maxPerFrequency) : null,
    maxPerCycle: null,
    carryForward: s.carryForward,
    additionalUsage: s.additionalUsage,
    additionalRatePaise: Math.round((Number(s.additionalRate) || 0) * 100),
  }));
}

// What the admin still has to do before this step is finished. Said per step, so
// Next is refused with a reason rather than simply not working.
export function problemsAt(step: number, draft: Draft): string[] {
  const problems: string[] = [];
  if (step === 0) {
    if (!draft.name.trim()) problems.push("Give the plan a name.");
    if (draft.price === "" || Number(draft.price) < 0) problems.push("Give the plan a price of zero or more.");
    if (!(Number(draft.turnaround) > 0)) problems.push("Give the plan a turnaround in hours.");
  }
  if (step === 1) {
    if (draft.services.length === 0) problems.push("Add at least one service.");
    const seen = new Set<string>();
    for (const s of draft.services) {
      if (seen.has(s.serviceId)) problems.push(`${s.serviceName} is in this plan more than once.`);
      seen.add(s.serviceId);
    }
  }
  if (step === 2) {
    for (const s of draft.services) {
      if (!s.unit) problems.push(`${s.serviceName} needs a measurement unit.`);
      if (!(Number(s.includedQuantity) > 0)) problems.push(`${s.serviceName} needs an included quantity greater than zero.`);
    }
  }
  if (step === 3) {
    for (const s of draft.services) {
      const definition = FREQUENCIES.find((f) => f.key === s.frequency);
      if (!definition) { problems.push(`${s.serviceName} needs a frequency.`); continue; }
      if (definition.needsDays && s.frequencyDays.length === 0) {
        problems.push(`${s.serviceName} is set to ${definition.label.toLowerCase()} but names no days.`);
      }
      if (s.frequency === "twice_weekly" && s.frequencyDays.length !== 2) {
        problems.push(`${s.serviceName} is collected twice a week, so name two days.`);
      }
      if (s.frequency === "weekly" && s.frequencyDays.length !== 1) {
        problems.push(`${s.serviceName} is collected weekly, so name one day.`);
      }
    }
  }
  if (step === 4) {
    for (const s of draft.services) {
      if (Number(s.additionalRate) < 0) problems.push(`${s.serviceName} cannot have a negative additional charge.`);
      if (s.additionalUsage !== "block" && !(Number(s.additionalRate) > 0)) {
        problems.push(`${s.serviceName} charges for additional usage, so give it a rate.`);
      }
    }
  }
  return problems;
}


// An existing plan, opened back up in the same wizard that built it. Editing used to
// be a smaller, weaker form that could not touch a plan's services at all — so a plan
// could be created with per-service allowances and then never changed.
export function draftFrom(plan: Plan): Draft {
  return {
    name: plan.name ?? plan.tier,
    description: plan.description ?? "",
    price: String(plan.monthlyPaise / 100),
    validity: plan.validity ?? "monthly",
    turnaround: String(plan.turnaroundHours),
    active: plan.isActive ?? true,
    taxPercent: plan.taxPercent ? String(plan.taxPercent) : "",
    discountPercent: plan.discountPercent ? String(plan.discountPercent) : "",
    services: (plan.services ?? []).map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      unit: r.unit,
      includedQuantity: String(r.includedQuantity),
      frequency: r.frequency,
      frequencyDays: r.frequencyDays ?? [],
      maxPerFrequency: r.maxPerFrequency ? String(r.maxPerFrequency) : "",
      carryForward: r.carryForward,
      additionalUsage: r.additionalUsage,
      additionalRate: String(r.additionalRatePaise / 100),
    })),
  };
}

// What the plan will cost: the price, less any discount, plus any tax on what is
// left. The backend works out the figure that is actually charged; this is the same
// arithmetic so the review step is not blank until it answers.
export function draftPricing(draft: Draft) {
  const basePaise = Math.round((Number(draft.price) || 0) * 100);
  const discountPaise = Math.round((basePaise * (Number(draft.discountPercent) || 0)) / 100);
  const taxPaise = Math.round(((basePaise - discountPaise) * (Number(draft.taxPercent) || 0)) / 100);
  return { basePaise, discountPaise, taxPaise, payablePaise: basePaise - discountPaise + taxPaise };
}
