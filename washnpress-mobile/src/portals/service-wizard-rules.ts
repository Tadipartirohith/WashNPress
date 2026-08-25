import type { MeasurementUnit, PickupFrequency, Plan } from "../api/types";

// The rules behind the service wizard, kept apart from the screen that renders them.
//
// A car wash, a carpet clean and an hour of ironing were all "an offering with a name
// and a price". That could not say a car wash is per vehicle and carpet cleaning is
// per square foot, that ironing is sold in whole hours between one and four, that
// Premium includes four hours a month and Basic pays ₹300, that it is only done on
// weekdays, or that a home visit costs ₹50 extra. All of that is configuration, and
// there is too much of it for one screen — so it is asked for a step at a time, and
// each step checks its own answers before moving on.

export const SERVICE_STEPS = [
  "Basic details",
  "Measurement and quantity",
  "Pricing",
  "Plan-based pricing",
  "Plan allowance",
  "Frequency",
  "Availability",
  "Time slots",
  "Customer eligibility",
  "Booking rules",
  "Additional charges",
  "Review and create",
] as const;

export const SERVICE_CATEGORIES = [
  { key: "vehicle_care", label: "Vehicle Care" },
  { key: "home_care", label: "Home Care" },
  { key: "personal_care", label: "Personal Care" },
  { key: "other", label: "Other" },
] as const;

export const SERVICE_UNITS: { key: MeasurementUnit; label: string }[] = [
  { key: "piece", label: "Per piece" },
  { key: "kg", label: "Per kg" },
  { key: "hour", label: "Per hour" },
  { key: "vehicle", label: "Per vehicle" },
  { key: "room", label: "Per room" },
  { key: "sqft", label: "Per sq ft" },
  { key: "pair", label: "Per pair" },
  { key: "item", label: "Per item" },
  { key: "job", label: "Fixed price" },
];

export const PLAN_PRICING_MODES = [
  { key: "included", label: "Included" },
  { key: "fixed", label: "Fixed price" },
  { key: "discounted", label: "Discounted price" },
  { key: "percentage_discount", label: "Percentage discount" },
  { key: "additional_charge", label: "Additional charge" },
  { key: "not_available", label: "Not available" },
] as const;

export const SERVICE_FREQUENCIES: { key: PickupFrequency; label: string; needsDays: boolean }[] = [
  { key: "one_time", label: "One time", needsDays: false },
  { key: "daily", label: "Daily", needsDays: false },
  { key: "alternate_days", label: "Alternate days", needsDays: false },
  { key: "twice_weekly", label: "Twice a week", needsDays: true },
  { key: "weekly", label: "Weekly", needsDays: true },
  { key: "custom", label: "Custom", needsDays: true },
];

export const SERVICE_MODES = [
  { key: "at_society", label: "At the society" },
  { key: "at_home", label: "At home" },
  { key: "pickup_delivery", label: "Pickup and delivery" },
  { key: "at_home_and_pickup", label: "At home, with pickup" },
] as const;

export const AVAILABILITY_SCOPES = [
  { key: "all_societies", label: "All societies" },
  { key: "selected_societies", label: "Selected societies" },
  { key: "selected_areas", label: "Selected areas" },
] as const;

export const ELIGIBILITIES = [
  { key: "both", label: "Both" },
  { key: "subscriber", label: "Subscribers only" },
  { key: "non_subscriber", label: "Non-subscribers only" },
] as const;

export const CHARGE_KINDS = [
  { key: "service", label: "Service charge" },
  { key: "home_visit", label: "Home visit" },
  { key: "convenience", label: "Convenience fee" },
  { key: "emergency", label: "Emergency charge" },
  { key: "additional_unit", label: "Additional quantity" },
  { key: "weekend", label: "Weekend charge" },
] as const;

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The service being built. Numbers are held as text where the admin types them, so a
// half-finished "12." is not turned into a number the moment it is typed.
export interface ServiceDraft {
  name: string;
  category: string;
  description: string;
  icon: string;
  active: boolean;
  unit: MeasurementUnit;
  minimumQuantity: string;
  maximumQuantity: string;
  quantityIncrement: string;
  price: string;
  subscriberPrice: string;
  planRules: DraftPlanRule[];
  frequency: PickupFrequency | "";
  frequencyDays: number[];
  availabilityScope: string;
  societyIds: string[];
  areaIds: string[];
  mode: string;
  operatingDays: number[];
  timeSlots: DraftTimeSlot[];
  eligibility: string;
  eligiblePlanIds: string[];
  advanceBookingRequired: boolean;
  minAdvanceMinutes: string;
  maxAdvanceDays: string;
  cancellationAllowed: boolean;
  cancellationDeadlineMinutes: string;
  reschedulingAllowed: boolean;
  maxBookingsPerUser: string;
  maxQuantityPerBooking: string;
  charges: DraftCharge[];
}

export interface DraftPlanRule {
  planId: string;
  planName: string;
  mode: string;
  price: string;
  discountPercent: string;
  includedQuantity: string;
  frequency: PickupFrequency | "";
  frequencyDays: number[];
  carryForward: boolean;
  additionalUsageAllowed: boolean;
  additionalRate: string;
}

export interface DraftTimeSlot {
  window: string;
  startTime: string;
  endTime: string;
  capacity: string;
  maxBookings: string;
  subscriberAvailable: boolean;
  nonSubscriberAvailable: boolean;
}

export interface DraftCharge {
  kind: string;
  label: string;
  amount: string;
}

export function emptyServiceDraft(): ServiceDraft {
  return {
    name: "", category: "", description: "", icon: "", active: true,
    unit: "piece", minimumQuantity: "", maximumQuantity: "", quantityIncrement: "",
    price: "", subscriberPrice: "",
    planRules: [],
    frequency: "", frequencyDays: [],
    availabilityScope: "all_societies", societyIds: [], areaIds: [],
    mode: "at_society", operatingDays: [0, 1, 2, 3, 4, 5, 6],
    timeSlots: [],
    eligibility: "both", eligiblePlanIds: [],
    advanceBookingRequired: true, minAdvanceMinutes: "120", maxAdvanceDays: "30",
    cancellationAllowed: true, cancellationDeadlineMinutes: "60", reschedulingAllowed: true,
    maxBookingsPerUser: "", maxQuantityPerBooking: "",
    charges: [],
  };
}

export function emptyPlanRule(plan: Plan): DraftPlanRule {
  return {
    planId: plan.id,
    planName: plan.name ?? plan.tier,
    mode: "not_available",
    price: "", discountPercent: "",
    includedQuantity: "", frequency: "", frequencyDays: [],
    carryForward: false, additionalUsageAllowed: true, additionalRate: "",
  };
}

export function emptyTimeSlot(window = "Morning"): DraftTimeSlot {
  const times: Record<string, [string, string]> = {
    Morning: ["09:00", "12:00"],
    Afternoon: ["13:00", "16:00"],
    Evening: ["17:00", "20:00"],
  };
  const [startTime, endTime] = times[window] ?? ["09:00", "10:00"];
  return { window, startTime, endTime, capacity: "1", maxBookings: "", subscriberAvailable: true, nonSubscriberAvailable: true };
}

const num = (text: string): number | null => {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

// What the admin still has to do before this step is finished. The numbers match the
// twelve steps above, and only the step being looked at is checked — so a wizard
// never refuses Next for something three steps away.
export function serviceProblemsAt(step: number, draft: ServiceDraft): string[] {
  const problems: string[] = [];

  if (step === 0) {
    if (!draft.name.trim()) problems.push("Give the service a name.");
    if (!draft.category) problems.push("Choose a category.");
  }

  if (step === 1) {
    if (!draft.unit) problems.push("Choose what this service is measured in.");
    const min = num(draft.minimumQuantity);
    const max = num(draft.maximumQuantity);
    const step2 = num(draft.quantityIncrement);
    if (min !== null && min <= 0) problems.push("The minimum quantity has to be greater than zero.");
    if (max !== null && max <= 0) problems.push("The maximum quantity has to be greater than zero.");
    if (min !== null && max !== null && max < min) problems.push("The maximum cannot be below the minimum.");
    if (step2 !== null && step2 <= 0) problems.push("The quantity increment has to be greater than zero.");
  }

  if (step === 2) {
    const price = num(draft.price);
    if (price === null) problems.push("Give the service a price.");
    else if (price < 0) problems.push("A price cannot be negative.");
    const subscriber = num(draft.subscriberPrice);
    if (subscriber !== null && subscriber < 0) problems.push("A subscriber price cannot be negative.");
  }

  if (step === 3) {
    for (const rule of draft.planRules) {
      if (rule.mode === "fixed" || rule.mode === "discounted") {
        const price = num(rule.price);
        if (price === null || price < 0) problems.push(`${rule.planName} needs a price for this service.`);
      }
      if (rule.mode === "percentage_discount") {
        const percent = num(rule.discountPercent);
        if (percent === null || percent < 0 || percent > 100) problems.push(`${rule.planName} needs a discount between 0 and 100 percent.`);
      }
      if (rule.mode === "additional_charge") {
        const rate = num(rule.additionalRate);
        if (rate === null || rate < 0) problems.push(`${rule.planName} needs an additional charge of zero or more.`);
      }
    }
  }

  if (step === 4) {
    for (const rule of draft.planRules.filter((r) => r.mode === "included")) {
      const included = num(rule.includedQuantity);
      if (included === null || included <= 0) problems.push(`${rule.planName} needs an included quantity greater than zero.`);
      if (!rule.frequency) problems.push(`${rule.planName} needs a frequency for this service.`);
      if (rule.additionalUsageAllowed) {
        const rate = num(rule.additionalRate);
        if (rate === null || rate < 0) problems.push(`${rule.planName} allows additional usage, so give it a price.`);
      }
    }
  }

  if (step === 5) {
    const definition = SERVICE_FREQUENCIES.find((f) => f.key === draft.frequency);
    if (definition?.needsDays) {
      if (draft.frequencyDays.length === 0) problems.push(`This is set to ${definition.label.toLowerCase()} but names no days.`);
      if (draft.frequency === "twice_weekly" && draft.frequencyDays.length !== 2) problems.push("Twice a week means two days.");
      if (draft.frequency === "weekly" && draft.frequencyDays.length !== 1) problems.push("Weekly means one day.");
    }
  }

  if (step === 6) {
    if (draft.availabilityScope === "selected_societies" && draft.societyIds.length === 0) {
      problems.push("Choose the societies this is offered in.");
    }
    if (draft.availabilityScope === "selected_areas" && draft.areaIds.length === 0) {
      problems.push("Choose the areas this is offered in.");
    }
    if (draft.operatingDays.length === 0) problems.push("Choose at least one operating day.");
  }

  if (step === 7) {
    for (const slot of draft.timeSlots) {
      if (!(slot.startTime < slot.endTime)) problems.push(`The ${slot.window} slot has to start before it ends.`);
      const capacity = num(slot.capacity);
      if (capacity === null || capacity <= 0) problems.push(`The ${slot.window} slot needs a capacity greater than zero.`);
      if (!slot.subscriberAvailable && !slot.nonSubscriberAvailable) problems.push(`The ${slot.window} slot is available to nobody.`);
    }
    // An hourly service is booked against its windows, so it has to have some.
    if (draft.unit === "hour" && draft.timeSlots.length === 0) {
      problems.push("An hourly service is booked into time slots, so add at least one.");
    }
  }

  if (step === 8) {
    if (!draft.eligibility) problems.push("Choose who this service is for.");
    if (draft.eligibility === "subscriber" && draft.eligiblePlanIds.length === 0) {
      problems.push("Choose which plans this is available to.");
    }
    if (draft.eligibility !== "subscriber" && num(draft.price) === null) {
      problems.push("This is sold to people without a plan, so it needs a price.");
    }
  }

  if (step === 9) {
    if (draft.advanceBookingRequired) {
      const minutes = num(draft.minAdvanceMinutes);
      if (minutes === null || minutes <= 0) problems.push("Advance booking is required, so say how far ahead.");
    }
    const days = num(draft.maxAdvanceDays);
    if (days === null || days <= 0) problems.push("Say how many days ahead a booking may be made.");
    if (draft.cancellationAllowed) {
      const deadline = num(draft.cancellationDeadlineMinutes);
      if (deadline === null || deadline < 0) problems.push("Say how long before the booking a cancellation is still accepted.");
    }
    const perBooking = num(draft.maxQuantityPerBooking);
    if (perBooking !== null && perBooking <= 0) problems.push("The most that can be booked at once has to be greater than zero.");
  }

  if (step === 10) {
    for (const charge of draft.charges) {
      const amount = num(charge.amount);
      if (amount === null || amount < 0) {
        const named = CHARGE_KINDS.find((c) => c.key === charge.kind)?.label ?? "A charge";
        problems.push(`${named} needs an amount of zero or more.`);
      }
    }
  }

  return problems;
}

// Everything wrong with the service, across every step. Used on the review step, so
// the admin is not sent back through twelve screens to find out what is missing.
export function allServiceProblems(draft: ServiceDraft): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (let step = 0; step < SERVICE_STEPS.length - 1; step += 1) {
    for (const problem of serviceProblemsAt(step, draft)) {
      if (seen.has(problem)) continue;
      seen.add(problem);
      problems.push(problem);
    }
  }
  return problems;
}

// The body the backend is actually sent. Rupees become paise here, once, rather than
// at each of a dozen call sites.
export function serviceBody(draft: ServiceDraft): Record<string, unknown> {
  const paise = (text: string): number => Math.round((Number(text) || 0) * 100);
  const optionalNumber = (text: string): number | null => (text.trim() ? Number(text) : null);

  return {
    name: draft.name.trim(),
    category: draft.category,
    description: draft.description.trim() || null,
    icon: draft.icon.trim() || null,
    isActive: draft.active,
    unit: draft.unit,
    minimumQuantity: optionalNumber(draft.minimumQuantity),
    maximumQuantity: optionalNumber(draft.maximumQuantity),
    quantityIncrement: optionalNumber(draft.quantityIncrement),
    unitPricePaise: paise(draft.price),
    subscriberUnitPricePaise: draft.subscriberPrice.trim() ? paise(draft.subscriberPrice) : null,
    // Plans that say "not available" are still sent, because saying a plan does not
    // get a service is a decision and not an absence of one.
    planRules: draft.planRules.map((rule) => ({
      planId: rule.planId,
      planName: rule.planName,
      mode: rule.mode,
      pricePaise: rule.price.trim() ? paise(rule.price) : null,
      discountPercent: optionalNumber(rule.discountPercent),
      includedQuantity: optionalNumber(rule.includedQuantity),
      frequency: rule.frequency || null,
      frequencyDays: rule.frequencyDays,
      carryForward: rule.carryForward,
      additionalUsageAllowed: rule.additionalUsageAllowed,
      additionalRatePaise: rule.additionalRate.trim() ? paise(rule.additionalRate) : null,
    })),
    frequency: draft.frequency || null,
    frequencyDays: draft.frequencyDays,
    availabilityScope: draft.availabilityScope,
    societyIds: draft.societyIds,
    areaIds: draft.areaIds,
    mode: draft.mode,
    operatingDays: draft.operatingDays,
    timeSlots: draft.timeSlots.map((slot) => ({
      window: slot.window,
      startTime: slot.startTime,
      endTime: slot.endTime,
      capacity: Number(slot.capacity) || 1,
      maxBookings: optionalNumber(slot.maxBookings),
      subscriberAvailable: slot.subscriberAvailable,
      nonSubscriberAvailable: slot.nonSubscriberAvailable,
    })),
    eligibility: draft.eligibility,
    eligiblePlanIds: draft.eligiblePlanIds,
    bookingRules: {
      advanceBookingRequired: draft.advanceBookingRequired,
      minAdvanceMinutes: Number(draft.minAdvanceMinutes) || 0,
      maxAdvanceDays: Number(draft.maxAdvanceDays) || 1,
      cancellationAllowed: draft.cancellationAllowed,
      cancellationDeadlineMinutes: Number(draft.cancellationDeadlineMinutes) || 0,
      reschedulingAllowed: draft.reschedulingAllowed,
      maxBookingsPerUser: optionalNumber(draft.maxBookingsPerUser),
      maxQuantityPerBooking: optionalNumber(draft.maxQuantityPerBooking),
    },
    additionalCharges: draft.charges.map((charge) => ({
      kind: charge.kind,
      label: charge.label || CHARGE_KINDS.find((c) => c.key === charge.kind)?.label || charge.kind,
      amountPaise: paise(charge.amount),
    })),
  };
}

// An existing service, opened back up in the wizard that built it.
export function serviceDraftFrom(service: Record<string, unknown>, plans: Plan[]): ServiceDraft {
  const rupees = (paise: unknown): string => (typeof paise === "number" ? String(paise / 100) : "");
  const text = (value: unknown): string => (value == null ? "" : String(value));
  const rules = (service.planRules as DraftPlanRule[] | undefined) ?? [];
  const bookingRules = (service.bookingRules ?? {}) as Record<string, unknown>;

  return {
    ...emptyServiceDraft(),
    name: text(service.name),
    category: text(service.category) || "other",
    description: text(service.description),
    icon: text(service.icon),
    active: service.isActive !== false,
    unit: (service.unit as MeasurementUnit) ?? "piece",
    minimumQuantity: text(service.minimumQuantity),
    maximumQuantity: text(service.maximumQuantity),
    quantityIncrement: text(service.quantityIncrement),
    price: rupees(service.unitPricePaise),
    subscriberPrice: rupees(service.subscriberUnitPricePaise),
    // Every plan gets a row, whether or not the stored service mentioned it, so a
    // plan added after the service was created is not silently left out.
    planRules: plans.map((plan) => {
      const stored = rules.find((r) => r.planId === plan.id) as unknown as Record<string, unknown> | undefined;
      if (!stored) return emptyPlanRule(plan);
      return {
        planId: plan.id,
        planName: plan.name ?? plan.tier,
        mode: text(stored.mode) || "not_available",
        price: rupees(stored.pricePaise),
        discountPercent: text(stored.discountPercent),
        includedQuantity: text(stored.includedQuantity),
        frequency: (stored.frequency as PickupFrequency) ?? "",
        frequencyDays: (stored.frequencyDays as number[]) ?? [],
        carryForward: Boolean(stored.carryForward),
        additionalUsageAllowed: stored.additionalUsageAllowed !== false,
        additionalRate: rupees(stored.additionalRatePaise),
      };
    }),
    frequency: (service.frequency as PickupFrequency) ?? "",
    frequencyDays: (service.frequencyDays as number[]) ?? [],
    availabilityScope: text(service.availabilityScope) || "all_societies",
    societyIds: (service.societyIds as string[]) ?? [],
    areaIds: (service.areaIds as string[]) ?? [],
    mode: text(service.mode) || "at_society",
    operatingDays: (service.operatingDays as number[])?.length
      ? (service.operatingDays as number[])
      : [0, 1, 2, 3, 4, 5, 6],
    timeSlots: ((service.timeSlots as Record<string, unknown>[]) ?? []).map((slot) => ({
      window: text(slot.window),
      startTime: text(slot.startTime),
      endTime: text(slot.endTime),
      capacity: text(slot.capacity),
      maxBookings: text(slot.maxBookings),
      subscriberAvailable: slot.subscriberAvailable !== false,
      nonSubscriberAvailable: slot.nonSubscriberAvailable !== false,
    })),
    eligibility: text(service.eligibility) || "both",
    eligiblePlanIds: (service.eligiblePlanIds as string[]) ?? [],
    advanceBookingRequired: bookingRules.advanceBookingRequired !== false,
    minAdvanceMinutes: text(bookingRules.minAdvanceMinutes ?? 120),
    maxAdvanceDays: text(bookingRules.maxAdvanceDays ?? 30),
    cancellationAllowed: bookingRules.cancellationAllowed !== false,
    cancellationDeadlineMinutes: text(bookingRules.cancellationDeadlineMinutes ?? 60),
    reschedulingAllowed: bookingRules.reschedulingAllowed !== false,
    maxBookingsPerUser: text(bookingRules.maxBookingsPerUser),
    maxQuantityPerBooking: text(bookingRules.maxQuantityPerBooking),
    charges: ((service.additionalCharges as Record<string, unknown>[]) ?? []).map((charge) => ({
      kind: text(charge.kind),
      label: text(charge.label),
      amount: rupees(charge.amountPaise),
    })),
  };
}
