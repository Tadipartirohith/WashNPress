import type { PlanServiceRule, PickupFrequency, MeasurementUnit, AdditionalUsageBehaviour, Plan } from "../api/types";

// The rules behind the plan wizard, kept apart from the screen that renders them.
//
// A plan used to be a name, one garment allowance, a turnaround and a price. It is
// now a set of services each configured on its own terms — a unit, an allowance, a
// cadence, and an answer to "what if they want more" — which is too much to ask for
// on one screen. Each step therefore checks its own answers before moving on, and
// those checks are here where they can be read and tested without a renderer.

// Six steps for one plan, five of which asked about the same list of services from
// a different angle each time — which services, in what unit, how often, and what
// happens past the allowance. Somebody configuring three services walked that list
// four times. It is one step now: the plan, then the services it is made of, each
// answered in one place.
export const STEPS = [
  "Plan and services",
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
  { key: "pay_per_use", label: "Charge as extra", hint: "Anything beyond the allowance is billed at the rate below." },
  { key: "block", label: "Not allowed", hint: "The resident cannot book beyond the allowance at all." },
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
    // The unit comes from the service itself, never chosen again here.
    unit: s.unit,
    includedQuantity: Number(s.includedQuantity) || 0,
    // Frequency, "most per collection" and carry-forward are no longer part of a plan:
    // an allowance is a quantity per cycle, so these carry fixed, unrestrictive values.
    frequency: "daily",
    frequencyDays: [],
    maxPerFrequency: null,
    maxPerCycle: null,
    carryForward: false,
    additionalUsage: s.additionalUsage,
    additionalRatePaise: Math.round((Number(s.additionalRate) || 0) * 100),
  }));
}

// What the admin still has to do before this step is finished. Said per step, so
// Next is refused with a reason rather than simply not working.
export function problemsAt(step: number, draft: Draft): string[] {
  const problems: string[] = [];
  // Named rather than numbered: branching on the position moves a rule onto the
  // wrong screen the moment a step is added or removed, and nothing fails to
  // compile when it does.
  if (STEPS[step] === "Plan and services") {
    if (!draft.name.trim()) problems.push("Give the plan a name.");
    if (draft.price === "" || !(Number(draft.price) > 0)) problems.push("Give the plan a price greater than zero.");
    if (Number(draft.taxPercent) < 0 || Number(draft.taxPercent) > 100) problems.push("Tax is a percentage between 0 and 100.");
    if (Number(draft.discountPercent) < 0 || Number(draft.discountPercent) > 100) problems.push("Discount is a percentage between 0 and 100.");

    if (draft.services.length === 0) problems.push("Choose at least one service.");
    const seen = new Set<string>();
    for (const s of draft.services) {
      if (seen.has(s.serviceId)) problems.push(`${s.serviceName} is in this plan more than once.`);
      seen.add(s.serviceId);

      // The allowance, and — only when there is one to charge — the rate beyond it.
      // Frequency, "most per collection" and turnaround are gone: an allowance is a
      // quantity per cycle, and what happens beyond it is charge-as-extra or not at all.
      if (!(Number(s.includedQuantity) > 0)) problems.push(`${s.serviceName} needs an allowance greater than zero.`);
      if (Number(s.additionalRate) < 0) problems.push(`${s.serviceName} cannot have a negative additional charge.`);
      if (s.additionalUsage !== "block" && !(Number(s.additionalRate) > 0)) {
        problems.push(`${s.serviceName} charges for extra usage, so give it a rate.`);
      }
    }
  }
  return problems;
}

// The turnaround times a plan is actually sold with. A free-text box invited "1 day"
// and "24hrs" into a field that is counted in hours.
export const TURNAROUNDS = [24, 36, 48, 72];


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
