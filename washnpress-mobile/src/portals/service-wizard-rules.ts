import type { MeasurementUnit, PickupFrequency, Plan } from "../api/types";

// The rules behind the service wizard, kept apart from the screen that renders them.
//
// A car wash, a carpet clean and an hour of ironing were all "an offering with a name
// and a price". That could not say that Premium includes four hours a month and Basic
// pays ₹300, that it is only done on weekdays, or that a home visit costs ₹50 extra.
// All of that is configuration, and there is too much of it for one screen — so it is
// asked for a step at a time, and each step checks its own answers before moving on.
//
// It was sixteen steps, which is not "a decision at a time" so much as a form broken
// into sixteen forms. Several of them asked one question; several asked the same
// question twice from different angles — who a service is for, what a subscriber
// pays, how often they may have it and what their plan includes are four screens
// describing one arrangement. Those are one step now, and the ones nobody was
// answering are gone.

export const SERVICE_STEPS = [
  "Basic details",
  "Customer and pricing",
  "Availability",
  "Options and add-ons",
  "Additional charges",
  "Operations and workflow",
  "Review and publish",
] as const;

// What the resident may add, and the choices they pick between. A vehicle service
// already had its vehicle types; every other service had no way to offer a choice
// at all, so a Deluxe wash had to be created as a second service.
export interface DraftOption { id: string; label: string; priceDelta: string; active: boolean }
export interface DraftAddOn { id: string; name: string; description: string; price: string; active: boolean }

export const SERVICE_STATUSES = [
  { key: "draft", label: "Draft, being set up and not offered" },
  { key: "active", label: "Active, offered as configured" },
  { key: "inactive", label: "Inactive, not offered for now" },
] as const;

// The stages a service goes through, in the order they happen. A service should not
// be forced through a laundry's stages: a car wash has no ironing to do.
export const SERVICE_WORKFLOW_STAGES = [
  { key: "scheduled", label: "Scheduled", required: true },
  { key: "assigned", label: "Assigned", required: false },
  { key: "in_progress", label: "In progress", required: false },
  { key: "qc", label: "Quality check", required: false },
  { key: "completed", label: "Completed", required: true },
] as const;

export const SERVICE_NOTIFICATION_EVENTS = [
  { key: "booked", label: "Service booked" },
  { key: "assigned", label: "Service assigned" },
  { key: "scheduled", label: "Service scheduled" },
  { key: "started", label: "Service started" },
  { key: "completed", label: "Service completed" },
  { key: "cancelled", label: "Service cancelled" },
  { key: "rescheduled", label: "Service rescheduled" },
  { key: "delayed", label: "Service delayed" },
] as const;

export const SERVICE_CATEGORIES = [
  { key: "vehicle_care", label: "Vehicle Care" },
  { key: "home_care", label: "Home Care" },
  { key: "other", label: "Other" },
] as const;

// What a vehicle service is for. Asked only when the category is Vehicle Care,
// because it is meaningless anywhere else.
export const VEHICLE_TYPES = [
  { key: "Bike", label: "Bike" },
  { key: "Car", label: "Car" },
] as const;

// What a service is measured in follows from what it is, rather than being a screen
// of its own: a vehicle service is per vehicle, everything else is a fixed price for
// the job. The unit is still carried on the record — pricing and plan allowances are
// written in it — it simply is not a question anybody is asked.
export function unitForCategory(category: string): MeasurementUnit {
  return category === "vehicle_care" ? "vehicle" : "job";
}

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
] as const;

export const ELIGIBILITIES = [
  { key: "both", label: "Both" },
  { key: "subscriber", label: "Subscribers only" },
  { key: "non_subscriber", label: "Non-subscribers only" },
] as const;

// Who a service is for, as the two things it is actually offered to rather than as
// three named combinations of them. Both boxes ticked is "both"; neither is nobody,
// which is refused.
export function eligibilityFor(subscriber: boolean, nonSubscriber: boolean): string {
  if (subscriber && nonSubscriber) return "both";
  if (subscriber) return "subscriber";
  if (nonSubscriber) return "non_subscriber";
  return "";
}

export function offeredToSubscribers(eligibility: string): boolean {
  return eligibility === "both" || eligibility === "subscriber";
}

export function offeredToOthers(eligibility: string): boolean {
  return eligibility === "both" || eligibility === "non_subscriber";
}

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
  mode: string;
  // Bike, car, or both. Meaningless outside Vehicle Care, and not asked for there.
  vehicleTypes: string[];
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

  // The rest of the configuration.
  status: string;
  options: DraftOption[];
  addOns: DraftAddOn[];
  // When it may be booked at all, beyond which days of the week it runs.
  startDate: string;
  endDate: string;
  suspended: boolean;
  suspendedReason: string;
  // What the operation can carry across all the slots, which is a different limit
  // from what one slot holds and usually the one reached first.
  maxBookingsPerDay: string;
  maxBookingsPerSociety: string;
  maxConcurrentJobs: string;
  recurringEnabled: boolean;
  recurringFrequencies: PickupFrequency[];
  team: string;
  workflow: string[];
  notifyOn: string[];
  cancellationFee: string;
  refundPercent: string;
  maxReschedules: string;
  rescheduleDeadlineMinutes: string;
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
    // Follows from the category, and is corrected the moment one is chosen.
    unit: "job", minimumQuantity: "", maximumQuantity: "", quantityIncrement: "",
    price: "", subscriberPrice: "",
    planRules: [],
    frequency: "", frequencyDays: [],
    availabilityScope: "all_societies", societyIds: [], vehicleTypes: [],
    mode: "at_society", operatingDays: [0, 1, 2, 3, 4, 5, 6],
    timeSlots: [],
    eligibility: "both", eligiblePlanIds: [],
    advanceBookingRequired: true, minAdvanceMinutes: "120", maxAdvanceDays: "30",
    cancellationAllowed: true, cancellationDeadlineMinutes: "60", reschedulingAllowed: true,
    maxBookingsPerUser: "", maxQuantityPerBooking: "",
    charges: [],
    // A new service is a draft until somebody publishes it. Inactive means a
    // service that used to be offered, which is a different thing from one nobody
    // has finished writing.
    status: "draft",
    options: [], addOns: [],
    startDate: "", endDate: "", suspended: false, suspendedReason: "",
    maxBookingsPerDay: "", maxBookingsPerSociety: "", maxConcurrentJobs: "",
    recurringEnabled: false, recurringFrequencies: [],
    team: "",
    workflow: ["scheduled", "assigned", "in_progress", "completed"],
    // Nothing chosen means the resident is told about everything, which is what
    // happened before any of this was configurable.
    notifyOn: [],
    cancellationFee: "", refundPercent: "",
    maxReschedules: "", rescheduleDeadlineMinutes: "",
  };
}

export function emptyOption(): DraftOption {
  return { id: `opt-${Math.random().toString(36).slice(2, 8)}`, label: "", priceDelta: "", active: true };
}

export function emptyAddOn(): DraftAddOn {
  return { id: `add-${Math.random().toString(36).slice(2, 8)}`, name: "", description: "", price: "", active: true };
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
// Everything wrong with the windows a service runs in.
//
// Windows are optional — a service with none runs to no timetable — but one that
// has been started has to be finished. A window with no time, or with room for
// nobody, is drawn on the booking screen and cannot be booked, which is a worse
// answer than not offering it.
export function timeSlotProblems(slots: DraftTimeSlot[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    const from = slot.startTime.trim();
    const to = slot.endTime.trim();
    if (!from || !to) {
      problems.push("Every time needs a start and an end, or remove it.");
      continue;
    }
    if (!isClockTime(from) || !isClockTime(to)) {
      problems.push("A time is written as 24 hour clock, like 09:00 or 14:30.");
      continue;
    }
    if (to <= from) problems.push(`The ${from} time ends before it starts.`);
    const capacity = Number(slot.capacity);
    if (!Number.isFinite(capacity) || capacity < 1) {
      problems.push(`The ${from} time needs room for at least one booking.`);
    }
    if (!slot.subscriberAvailable && !slot.nonSubscriberAvailable) {
      problems.push(`The ${from} time is offered to nobody.`);
    }
    if (seen.has(from)) problems.push(`There are two times starting at ${from}.`);
    seen.add(from);
  }
  return problems;
}

function isClockTime(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

export function serviceProblemsAt(stepIndex: number, draft: ServiceDraft): string[] {
  const problems: string[] = [];
  // Named rather than numbered. Branching on the position meant that inserting a
  // step renumbered every rule after it, which moves a check onto the wrong screen
  // without anything failing to compile.
  const step = SERVICE_STEPS[stepIndex];

  if (step === "Basic details") {
    if (!draft.name.trim()) problems.push("Give the service a name.");
    // The category is gone; the unit is what a service is measured in, and it is what
    // decides the rest — so it is what has to be chosen.
    if (!draft.unit) problems.push("Choose how the service is measured.");
    // Vehicle types are asked only where they mean something: a service measured per
    // vehicle is a bike or a car job; a carpet clean is neither.
    if (draft.unit === "vehicle" && draft.vehicleTypes.length === 0) {
      problems.push("Say whether this is for a bike or a car.");
    }
  }

  // Who it is for, what they pay, how often, and what each plan does about it —
  // one arrangement, described on one screen rather than across four.
  if (step === "Customer and pricing") {
    if (!draft.eligibility) problems.push("A service offered to nobody cannot be booked; tick at least one customer type.");
    if (draft.eligibility === "subscriber" && draft.eligiblePlanIds.length === 0) {
      problems.push("Choose which plans this is available to.");
    }
    if (offeredToOthers(draft.eligibility)) {
      const price = num(draft.price);
      if (price === null) problems.push("This is sold to people without a plan, so it needs a price.");
      else if (price < 0) problems.push("A price cannot be negative.");
    }
    const subscriber = num(draft.subscriberPrice);
    if (subscriber !== null && subscriber < 0) problems.push("A subscriber price cannot be negative.");

    const definition = SERVICE_FREQUENCIES.find((f) => f.key === draft.frequency);
    if (definition?.needsDays) {
      if (draft.frequencyDays.length === 0) problems.push(`This is set to ${definition.label.toLowerCase()} but names no days.`);
      if (draft.frequency === "twice_weekly" && draft.frequencyDays.length !== 2) problems.push("Twice a week means two days.");
      if (draft.frequency === "weekly" && draft.frequencyDays.length !== 1) problems.push("Weekly means one day.");
    }

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
      // A plan that includes the service says how much and how often, and what
      // happens past it. Asked here because it is the same arrangement.
      if (rule.mode === "included") {
        const included = num(rule.includedQuantity);
        if (included === null || included <= 0) problems.push(`${rule.planName} needs an included quantity greater than zero.`);
        if (!rule.frequency) problems.push(`${rule.planName} needs a frequency for this service.`);
        if (rule.additionalUsageAllowed) {
          const rate = num(rule.additionalRate);
          if (rate === null || rate < 0) problems.push(`${rule.planName} allows additional usage, so give it a price.`);
        }
      }
    }
  }

  if (step === "Availability") {
    if (draft.availabilityScope === "selected_societies" && draft.societyIds.length === 0) {
      problems.push("Choose the societies this is offered in.");
    }
    if (draft.operatingDays.length === 0) problems.push("Choose at least one operating day.");
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      problems.push("The service cannot stop being available before it starts.");
    }
    if (draft.suspended && !draft.suspendedReason.trim()) {
      problems.push("Say why the service is paused, so a resident is told something useful.");
    }
    // A window is optional; a half-written one is not. Saving one with no times or
    // no room in it produces a slot the booking screen draws and nobody can book,
    // which is worse than having no windows at all.
    problems.push(...timeSlotProblems(draft.timeSlots));
  }

  if (step === "Additional charges") {
    for (const charge of draft.charges) {
      const amount = num(charge.amount);
      if (amount === null || amount < 0) {
        const named = CHARGE_KINDS.find((c) => c.key === charge.kind)?.label ?? "A charge";
        problems.push(`${named} needs an amount of zero or more.`);
      }
    }
  }

  if (step === "Options and add-ons") {
    for (const option of draft.options) {
      if (!option.label.trim()) problems.push("Every option needs a label.");
    }
    const labels = draft.options.map((o) => o.label.trim().toLowerCase()).filter(Boolean);
    if (new Set(labels).size !== labels.length) {
      problems.push("Two options cannot share a label; a resident could not tell them apart.");
    }
    for (const addOn of draft.addOns) {
      if (!addOn.name.trim()) problems.push("Every add-on needs a name.");
      const price = num(addOn.price);
      if (price !== null && price < 0) problems.push(`${addOn.name || "An add-on"} cannot cost a negative amount.`);
    }
  }

  if (step === "Operations and workflow") {
    if (!draft.workflow.includes("scheduled")) {
      problems.push("A workflow without a scheduled stage is a service that cannot be booked.");
    }
    if (!draft.workflow.includes("completed")) {
      problems.push("A workflow without a completed stage is a service that can never be finished.");
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
    // The category is no longer asked for: it follows from the unit — a service
    // measured per vehicle is vehicle care, anything else is a general service — and a
    // service being edited keeps whatever category it already had.
    category: draft.category || (draft.unit === "vehicle" ? "vehicle_care" : "other"),
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
    vehicleTypes: draft.vehicleTypes,
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

    // Draft, active or inactive. isActive above follows this rather than being a
    // second answer to the same question.
    status: draft.status,
    options: draft.options
      .filter((option) => option.label.trim())
      .map((option) => ({
        id: option.id,
        label: option.label.trim(),
        priceDeltaPaise: option.priceDelta.trim() ? paise(option.priceDelta) : 0,
        isActive: option.active,
      })),
    addOns: draft.addOns
      .filter((addOn) => addOn.name.trim())
      .map((addOn) => ({
        id: addOn.id,
        name: addOn.name.trim(),
        description: addOn.description.trim() || null,
        pricePaise: paise(addOn.price),
        isActive: addOn.active,
      })),
    availabilityWindow: {
      startDate: draft.startDate.trim() || null,
      endDate: draft.endDate.trim() || null,
      suspended: draft.suspended,
      suspendedReason: draft.suspendedReason.trim() || null,
    },
    capacity: {
      maxBookingsPerDay: optionalNumber(draft.maxBookingsPerDay),
      maxBookingsPerSociety: optionalNumber(draft.maxBookingsPerSociety),
      maxConcurrentJobs: optionalNumber(draft.maxConcurrentJobs),
    },
    recurrence: {
      enabled: draft.recurringEnabled,
      frequencies: draft.recurringFrequencies,
    },
    operations: {
      team: draft.team.trim() || null,
      workflow: draft.workflow,
    },
    notifyOn: draft.notifyOn,
    cancellationRules: {
      feePaise: draft.cancellationFee.trim() ? paise(draft.cancellationFee) : null,
      refundPercent: optionalNumber(draft.refundPercent),
    },
    reschedulingRules: {
      maxReschedules: optionalNumber(draft.maxReschedules),
      deadlineMinutes: optionalNumber(draft.rescheduleDeadlineMinutes),
    },
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
    status: text(service.status) || (service.isActive === false ? "inactive" : "active"),
    options: ((service.options as Record<string, unknown>[] | undefined) ?? []).map((option) => ({
      id: text(option.id),
      label: text(option.label),
      priceDelta: rupees(option.priceDeltaPaise),
      active: option.isActive !== false,
    })),
    addOns: ((service.addOns as Record<string, unknown>[] | undefined) ?? []).map((addOn) => ({
      id: text(addOn.id),
      name: text(addOn.name),
      description: text(addOn.description),
      price: rupees(addOn.pricePaise),
      active: addOn.isActive !== false,
    })),
    startDate: text(((service.availabilityWindow ?? {}) as Record<string, unknown>).startDate),
    endDate: text(((service.availabilityWindow ?? {}) as Record<string, unknown>).endDate),
    suspended: Boolean(((service.availabilityWindow ?? {}) as Record<string, unknown>).suspended),
    suspendedReason: text(((service.availabilityWindow ?? {}) as Record<string, unknown>).suspendedReason),
    maxBookingsPerDay: text(((service.capacity ?? {}) as Record<string, unknown>).maxBookingsPerDay),
    maxBookingsPerSociety: text(((service.capacity ?? {}) as Record<string, unknown>).maxBookingsPerSociety),
    maxConcurrentJobs: text(((service.capacity ?? {}) as Record<string, unknown>).maxConcurrentJobs),
    recurringEnabled: Boolean(((service.recurrence ?? {}) as Record<string, unknown>).enabled),
    recurringFrequencies: (((service.recurrence ?? {}) as Record<string, unknown>).frequencies as PickupFrequency[] | undefined) ?? [],
    team: text(((service.operations ?? {}) as Record<string, unknown>).team),
    workflow: (((service.operations ?? {}) as Record<string, unknown>).workflow as string[] | undefined)
      ?? ["scheduled", "assigned", "in_progress", "completed"],
    notifyOn: (service.notifyOn as string[] | undefined) ?? [],
    cancellationFee: rupees(((service.cancellationRules ?? {}) as Record<string, unknown>).feePaise),
    refundPercent: text(((service.cancellationRules ?? {}) as Record<string, unknown>).refundPercent),
    maxReschedules: text(((service.reschedulingRules ?? {}) as Record<string, unknown>).maxReschedules),
    rescheduleDeadlineMinutes: text(((service.reschedulingRules ?? {}) as Record<string, unknown>).deadlineMinutes),
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
    vehicleTypes: (service.vehicleTypes as string[]) ?? [],
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
