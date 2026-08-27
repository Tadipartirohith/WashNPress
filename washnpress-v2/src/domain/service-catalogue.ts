import type { MeasurementUnit } from "./measurement";
import { normaliseQuantity, formatQuantity, billableQuantity } from "./measurement";
import type { PickupFrequency } from "./recurrence";
import { allowedWeekdays, permitsDate, WEEKDAY_LABELS } from "./recurrence";

// What an extra service actually is.
//
// A car wash, a carpet clean and an hour of ironing at somebody's kitchen table were
// all "an offering with a name and a price". That was enough to book one and no more:
// it could not say a car wash is per vehicle and carpet cleaning is per square foot,
// that ironing is sold in whole hours between one and four, that Premium includes
// four hours a month and Basic pays ₹300, that it is only offered on weekdays, that a
// home visit costs ₹50 extra, or that a booking must be made two hours ahead and can
// be cancelled up to one hour before.
//
// All of that is configuration. None of it belongs in the client, and none of it
// belongs hard-coded per service line — a fourth service should be a form somebody
// fills in, not a release.

// ---------------------------------------------------------------- vocabulary

export type ServiceCategory = "vehicle_care" | "home_care" | "other";

export const SERVICE_CATEGORIES: ServiceCategory[] = ["vehicle_care", "home_care", "other"];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  vehicle_care: "Vehicle Care",
  home_care: "Home Care",
  other: "Other",
};

// Who a service is for. A service can be sold to subscribers only, to anybody, or
// only to people without a plan.
export type CustomerEligibility = "subscriber" | "non_subscriber" | "both";

export const CUSTOMER_ELIGIBILITIES: CustomerEligibility[] = ["subscriber", "non_subscriber", "both"];

// Where the work happens. A car wash happens at the parking space; ironing happens at
// the flat; laundry is collected and brought back.
export type ServiceMode = "at_society" | "at_home" | "pickup_delivery" | "at_home_and_pickup";

export const SERVICE_MODES: ServiceMode[] = ["at_society", "at_home", "pickup_delivery", "at_home_and_pickup"];

export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = {
  at_society: "At the society",
  at_home: "At home",
  pickup_delivery: "Pickup and delivery",
  at_home_and_pickup: "At home, with pickup and delivery",
};

// Which societies a service is offered in.
export type AvailabilityScope = "all_societies" | "selected_societies";

export const AVAILABILITY_SCOPES: AvailabilityScope[] = ["all_societies", "selected_societies"];

// What a plan does about this service. "Included" and "not available" are the two
// ends; everything between them is a way of charging less than the ordinary price.
export type PlanPricingMode =
  | "included"
  | "fixed"
  | "discounted"
  | "percentage_discount"
  | "additional_charge"
  | "not_available";

export const PLAN_PRICING_MODES: PlanPricingMode[] = [
  "included", "fixed", "discounted", "percentage_discount", "additional_charge", "not_available",
];

// The extras that can be added to a booking. Named rather than free-form, because a
// bill that says "other charge" tells the resident nothing.
export type ChargeKind =
  | "service"
  | "home_visit"
  | "convenience"
  | "emergency"
  | "additional_unit"
  | "weekend";

export const CHARGE_KINDS: ChargeKind[] = [
  "service", "home_visit", "convenience", "emergency", "additional_unit", "weekend",
];

export const CHARGE_LABELS: Record<ChargeKind, string> = {
  service: "Service charge",
  home_visit: "Home visit",
  convenience: "Convenience fee",
  emergency: "Emergency charge",
  additional_unit: "Additional quantity",
  weekend: "Weekend charge",
};

// ------------------------------------------------------------------- the shape

// What one plan does about one service.
export interface ServicePlanRule {
  planId: string;
  planName: string;
  mode: PlanPricingMode;
  // For "fixed" and "discounted": what a resident on this plan pays per unit.
  pricePaise?: number | null;
  // For "percentage_discount": how much off the ordinary price.
  discountPercent?: number | null;
  // For "included": how much the plan includes, in the service's own unit, and what
  // happens beyond it.
  includedQuantity?: number | null;
  frequency?: PickupFrequency | null;
  frequencyDays?: number[];
  carryForward?: boolean;
  additionalUsageAllowed?: boolean;
  additionalRatePaise?: number | null;
}

// One bookable window. Capacity and eligibility are per window, because a Saturday
// morning that is full for everybody and an evening kept for subscribers are both
// real and neither can be said with one number on the service.
export interface ServiceTimeSlot {
  window: string;
  startTime: string;
  endTime: string;
  capacity: number;
  maxBookings?: number | null;
  subscriberAvailable: boolean;
  nonSubscriberAvailable: boolean;
}

export interface ServiceBookingRules {
  advanceBookingRequired: boolean;
  // How far ahead a booking has to be made, and how far ahead it may be made.
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  cancellationAllowed: boolean;
  // How long before the booking a cancellation is still accepted.
  cancellationDeadlineMinutes: number;
  reschedulingAllowed: boolean;
  maxBookingsPerUser?: number | null;
  // For an hourly service this is a number of hours, not a count of things.
  maxQuantityPerBooking?: number | null;
}

export interface ServiceAdditionalCharge {
  kind: ChargeKind;
  label: string;
  amountPaise: number;
  // A weekend charge applies on Saturdays and Sundays; a home visit applies when the
  // work is done at the flat. Said here rather than inferred from the name.
  appliesOnWeekend?: boolean;
  appliesAtHome?: boolean;
}

// ------------------------------------------------------------ what is left to add

// Where a service is in its life, rather than a single on/off switch.
//
// A service being built needs somewhere to live that is not "off": inactive means a
// service that used to be offered and is not being offered now, which is a different
// thing from one nobody has finished writing. Publishing was the moment a
// half-configured service became bookable, because there was no third state.
export type ServiceStatus = "draft" | "active" | "inactive";

export const SERVICE_STATUSES: ServiceStatus[] = ["draft", "active", "inactive"];

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  draft: "Draft",
  active: "Active",
  inactive: "Inactive",
};

// Something the resident chooses when booking: which wash, which size, which level
// of finish. A vehicle service already had its vehicle types; every other service
// had no way to offer a choice at all, so a Deluxe wash had to be a second service.
export interface ServiceOption {
  id: string;
  label: string;
  // What choosing it does to the price. Left at zero it is a choice that costs
  // nothing, which is most of them.
  priceDeltaPaise: number;
  isActive: boolean;
}

// An extra the resident may add. Distinct from an additional charge, which is
// something the platform applies (a weekend, a home visit); this is something the
// resident asks for.
export interface ServiceAddOn {
  id: string;
  name: string;
  description?: string | null;
  pricePaise: number;
  isActive: boolean;
}

// When the service may be booked at all, beyond which days of the week it runs.
export interface ServiceAvailabilityWindow {
  // Nothing before this, and nothing after that. Either may be left open.
  startDate?: string | null;
  endDate?: string | null;
  // Off for a while without being withdrawn: a service whose operator is on leave
  // is not a service that should be deleted and rebuilt next week.
  suspended?: boolean;
  suspendedReason?: string | null;
}

// How much of the service can actually be done. A slot's capacity is how many
// bookings that window holds; this is what the operation can carry across all of
// them, which is a different limit and the one that is usually reached first.
export interface ServiceCapacity {
  maxBookingsPerDay?: number | null;
  maxBookingsPerSociety?: number | null;
  // How many people are available to do it. A service nobody is assigned to cannot
  // be booked however much slot capacity it has.
  maxConcurrentJobs?: number | null;
}

// Whether the service repeats, and how often it may be asked to.
export interface ServiceRecurrence {
  enabled: boolean;
  // The cadences offered. An empty list with recurrence enabled means every cadence
  // the platform supports.
  frequencies: PickupFrequency[];
}

// Which team does the work, and what the work is.
//
// Different services should not be forced through one workflow: a car wash is
// booked, assigned, done and finished, and putting it through a laundry's wash and
// iron stages produces stages nobody can complete.
export type ServiceWorkflowStage =
  | "scheduled" | "assigned" | "in_progress" | "qc" | "completed";

export const SERVICE_WORKFLOW_STAGES: ServiceWorkflowStage[] = [
  "scheduled", "assigned", "in_progress", "qc", "completed",
];

export const SERVICE_WORKFLOW_STAGE_LABELS: Record<ServiceWorkflowStage, string> = {
  scheduled: "Scheduled",
  assigned: "Assigned",
  in_progress: "In progress",
  qc: "Quality check",
  completed: "Completed",
};

// The stages every service has to have. A service that cannot be scheduled cannot
// be booked, and one that cannot be completed can never be finished.
export const REQUIRED_WORKFLOW_STAGES: ServiceWorkflowStage[] = ["scheduled", "completed"];

export interface ServiceOperations {
  // The team the work belongs to, so it appears in the right queue.
  team?: string | null;
  // Named operators, where the work is somebody's in particular.
  operatorUserIds?: string[];
  workflow?: ServiceWorkflowStage[];
}

// What the resident is told, and when.
export type ServiceNotificationEvent =
  | "booked" | "assigned" | "scheduled" | "started" | "completed"
  | "cancelled" | "rescheduled" | "delayed";

export const SERVICE_NOTIFICATION_EVENTS: ServiceNotificationEvent[] = [
  "booked", "assigned", "scheduled", "started", "completed", "cancelled", "rescheduled", "delayed",
];

// Cancelling and rescheduling, beyond whether they are allowed at all.
export interface ServiceCancellationRules {
  // What it costs to cancel inside the deadline. Free by default.
  feePaise?: number | null;
  // How much comes back. A hundred is a full refund.
  refundPercent?: number | null;
}

export interface ServiceReschedulingRules {
  // How many times, before the resident has to cancel and book again.
  maxReschedules?: number | null;
  // How long before the booking a change is still accepted. Falls back to the
  // cancellation deadline where it is not set separately.
  deadlineMinutes?: number | null;
}

export const DEFAULT_BOOKING_RULES: ServiceBookingRules = {
  advanceBookingRequired: true,
  minAdvanceMinutes: 120,
  maxAdvanceDays: 30,
  cancellationAllowed: true,
  cancellationDeadlineMinutes: 60,
  reschedulingAllowed: true,
  maxBookingsPerUser: null,
  maxQuantityPerBooking: null,
};

// ------------------------------------------------------------------ validation

export class InvalidOfferingError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "That service is not valid.");
    this.name = "InvalidOfferingError";
  }
}

export interface ServiceDefinition {
  name?: string;
  category?: ServiceCategory;
  unit?: MeasurementUnit;
  minimumQuantity?: number | null;
  maximumQuantity?: number | null;
  quantityIncrement?: number | null;
  unitPricePaise?: number;
  subscriberUnitPricePaise?: number | null;
  eligibility?: CustomerEligibility;
  planRules?: ServicePlanRule[];
  frequency?: PickupFrequency | null;
  frequencyDays?: number[];
  operatingDays?: number[];
  timeSlots?: ServiceTimeSlot[];
  bookingRules?: ServiceBookingRules;
  additionalCharges?: ServiceAdditionalCharge[];
}

// Everything wrong with a service, said at once. A twelve step wizard that reveals
// the next problem only after the last one is fixed is a wizard somebody abandons.
// What is wrong with the rest of the configuration. Separate from serviceProblems
// so a service written before any of it existed is not suddenly invalid: none of
// these fire on a service that simply does not have the section.
export function extendedServiceProblems(service: {
  options?: ServiceOption[];
  addOns?: ServiceAddOn[];
  availabilityWindow?: ServiceAvailabilityWindow;
  capacity?: ServiceCapacity;
  recurrence?: ServiceRecurrence;
  operations?: ServiceOperations;
  cancellationRules?: ServiceCancellationRules;
  reschedulingRules?: ServiceReschedulingRules;
}): string[] {
  const problems: string[] = [];

  for (const option of service.options ?? []) {
    if (!option.label?.trim()) problems.push("Every option needs a label.");
  }
  const optionLabels = (service.options ?? []).map((o) => o.label.trim().toLowerCase());
  if (new Set(optionLabels).size !== optionLabels.length) {
    problems.push("Two options cannot have the same label; a resident could not tell them apart.");
  }

  for (const addOn of service.addOns ?? []) {
    if (!addOn.name?.trim()) problems.push("Every add-on needs a name.");
    if ((addOn.pricePaise ?? 0) < 0) problems.push(`${addOn.name || "An add-on"} cannot cost a negative amount.`);
  }

  const window = service.availabilityWindow;
  if (window?.startDate && window.endDate && window.endDate < window.startDate) {
    problems.push("The service cannot stop being available before it starts.");
  }

  for (const [label, value] of [
    ["bookings a day", service.capacity?.maxBookingsPerDay],
    ["bookings per society", service.capacity?.maxBookingsPerSociety],
    ["jobs at once", service.capacity?.maxConcurrentJobs],
  ] as const) {
    if (value != null && value <= 0) problems.push(`The limit on ${label} has to be greater than zero.`);
  }

  const workflow = service.operations?.workflow;
  if (workflow && workflow.length > 0) {
    for (const required of REQUIRED_WORKFLOW_STAGES) {
      if (!workflow.includes(required)) {
        problems.push(
          required === "scheduled"
            ? "A workflow without a scheduled stage is a service that cannot be booked."
            : "A workflow without a completed stage is a service that can never be finished.",
        );
      }
    }
    // The stages have to be in the order they actually happen, or an operator is
    // asked to do the quality check before the work.
    const order = SERVICE_WORKFLOW_STAGES.filter((stage) => workflow.includes(stage));
    if (order.join(">") !== workflow.join(">")) {
      problems.push("The workflow stages have to be in the order they happen.");
    }
  }

  if ((service.cancellationRules?.feePaise ?? 0) < 0) {
    problems.push("A cancellation fee cannot be negative.");
  }
  const refund = service.cancellationRules?.refundPercent;
  if (refund != null && (refund < 0 || refund > 100)) {
    problems.push("A refund is between nothing and all of it.");
  }
  const reschedules = service.reschedulingRules?.maxReschedules;
  if (reschedules != null && reschedules < 0) {
    problems.push("The number of reschedules allowed cannot be negative.");
  }
  return problems;
}

// Whether the service is being offered at all right now, and why not where it is
// not. Asked before a resident is shown it and again before a booking is taken.
export function serviceOnOffer(
  service: {
    status?: ServiceStatus; isActive?: boolean;
    availabilityWindow?: ServiceAvailabilityWindow;
  },
  now: Date = new Date(),
): { ok: boolean; reason?: string } {
  const status = service.status ?? (service.isActive ? "active" : "inactive");
  if (status === "draft") return { ok: false, reason: "This service is still being set up." };
  if (status === "inactive") return { ok: false, reason: "This service is not being offered at the moment." };

  const window = service.availabilityWindow;
  if (window?.suspended) {
    return { ok: false, reason: window.suspendedReason?.trim() || "This service is paused at the moment." };
  }
  const today = now.toISOString().slice(0, 10);
  if (window?.startDate && today < window.startDate) {
    return { ok: false, reason: `This service starts on ${window.startDate}.` };
  }
  if (window?.endDate && today > window.endDate) {
    return { ok: false, reason: "This service is no longer offered." };
  }
  return { ok: true };
}

// The stages this service actually goes through. A service that says nothing about
// its workflow gets the ordinary one rather than none.
export function workflowFor(service: { operations?: ServiceOperations }): ServiceWorkflowStage[] {
  const configured = service.operations?.workflow ?? [];
  if (configured.length > 0) return configured;
  return ["scheduled", "assigned", "in_progress", "completed"];
}

// Whether the resident is told about this event for this service. A service that
// says nothing is a service that tells them everything, which is what happened
// before any of this was configurable.
export function notifiesOn(
  service: { notifyOn?: ServiceNotificationEvent[] },
  event: ServiceNotificationEvent,
): boolean {
  const configured = service.notifyOn;
  if (!configured || configured.length === 0) return true;
  return configured.includes(event);
}

export function serviceProblems(service: ServiceDefinition): string[] {
  const problems: string[] = [];
  if (!(service.name ?? "").trim()) problems.push("A service needs a name.");
  if (!service.category) problems.push("A service needs a category.");
  if (!service.unit) problems.push("A service needs a measurement unit.");
  if ((service.unitPricePaise ?? 0) < 0) problems.push("A price cannot be negative.");

  const min = service.minimumQuantity ?? null;
  const max = service.maximumQuantity ?? null;
  const step = service.quantityIncrement ?? null;
  if (min !== null && min <= 0) problems.push("The minimum quantity has to be greater than zero.");
  if (max !== null && max <= 0) problems.push("The maximum quantity has to be greater than zero.");
  if (min !== null && max !== null && max < min) problems.push("The maximum quantity cannot be below the minimum.");
  if (step !== null && step <= 0) problems.push("The quantity increment has to be greater than zero.");

  const eligibility = service.eligibility ?? "both";
  if (eligibility !== "subscriber" && !(service.unitPricePaise ?? 0) && !isFree(service)) {
    problems.push("A service sold to people without a plan needs a price.");
  }

  for (const rule of service.planRules ?? []) {
    const named = rule.planName || rule.planId || "A plan";
    if (!rule.planId) problems.push("Every plan rule needs to say which plan it is for.");
    if (rule.mode === "included") {
      if (!((rule.includedQuantity ?? 0) > 0)) problems.push(`${named} includes this service, so it needs an included quantity greater than zero.`);
      if (!rule.frequency) problems.push(`${named} includes this service, so it needs a frequency.`);
      if (rule.additionalUsageAllowed && (rule.additionalRatePaise ?? 0) < 0) {
        problems.push(`${named} cannot have a negative additional usage price.`);
      }
    }
    if ((rule.mode === "fixed" || rule.mode === "discounted") && !((rule.pricePaise ?? 0) >= 0)) {
      problems.push(`${named} needs a price for this service.`);
    }
    if (rule.mode === "percentage_discount") {
      const percent = rule.discountPercent ?? -1;
      if (percent < 0 || percent > 100) problems.push(`${named} needs a discount between 0 and 100 percent.`);
    }
    if (rule.mode === "additional_charge" && (rule.additionalRatePaise ?? 0) < 0) {
      problems.push(`${named} cannot have a negative additional charge.`);
    }
    if (rule.frequency === "custom" && [...new Set(rule.frequencyDays ?? [])].length === 0) {
      problems.push(`${named} is set to a custom frequency but names no days.`);
    }
  }

  for (const slot of service.timeSlots ?? []) {
    if (!(slot.startTime < slot.endTime)) {
      problems.push(`The ${slot.window || "time"} slot has to start before it ends.`);
    }
    if (!(slot.capacity > 0)) problems.push(`The ${slot.window || "time"} slot needs a capacity greater than zero.`);
    if (!slot.subscriberAvailable && !slot.nonSubscriberAvailable) {
      problems.push(`The ${slot.window || "time"} slot is available to nobody.`);
    }
  }

  const rules = service.bookingRules;
  if (rules) {
    if (rules.advanceBookingRequired && !(rules.minAdvanceMinutes > 0)) {
      problems.push("Advance booking is required, so say how far ahead.");
    }
    if (!(rules.maxAdvanceDays > 0)) problems.push("Say how many days ahead a booking may be made.");
    if (rules.cancellationAllowed && rules.cancellationDeadlineMinutes < 0) {
      problems.push("A cancellation deadline cannot be negative.");
    }
    if (rules.maxQuantityPerBooking != null && rules.maxQuantityPerBooking <= 0) {
      problems.push("The most that can be booked at once has to be greater than zero.");
    }
  }

  for (const charge of service.additionalCharges ?? []) {
    if (charge.amountPaise < 0) problems.push(`${charge.label || CHARGE_LABELS[charge.kind]} cannot be negative.`);
  }

  return problems;
}

// A service can legitimately cost nothing to a subscriber, so "no price" is only a
// problem when nobody is meant to get it free.
function isFree(service: ServiceDefinition): boolean {
  return (service.planRules ?? []).some((r) => r.mode === "included");
}

export function assertValidService(service: ServiceDefinition): void {
  const problems = serviceProblems(service);
  if (problems.length) throw new InvalidOfferingError(problems);
}

// ------------------------------------------------------------------- quantity

// A quantity the service will actually accept: at least the minimum, at most the
// maximum, and on the increment. Ironing sold in whole hours does not take 90
// minutes, and saying so after the resident has chosen it is too late.
export interface QuantityCheck {
  requested: number;
  accepted: number;
  ok: boolean;
  reason: string | null;
}

export function checkQuantity(
  service: Pick<ServiceDefinition, "unit" | "minimumQuantity" | "maximumQuantity" | "quantityIncrement">,
  requested: number,
): QuantityCheck {
  const unit = service.unit ?? "piece";
  const value = normaliseQuantity(unit, requested);
  if (value <= 0) {
    return { requested: value, accepted: 0, ok: false, reason: "Choose how much you want." };
  }
  const min = service.minimumQuantity ?? null;
  const max = service.maximumQuantity ?? null;
  const step = service.quantityIncrement ?? null;

  if (min !== null && value < min) {
    return { requested: value, accepted: value, ok: false, reason: `The smallest booking for this is ${formatQuantity(unit, min)}.` };
  }
  if (max !== null && value > max) {
    return { requested: value, accepted: value, ok: false, reason: `The largest booking for this is ${formatQuantity(unit, max)}.` };
  }
  if (step !== null && step > 0) {
    // Measured against the minimum where there is one, so a service sold in whole
    // hours from one hour accepts 1, 2, 3 rather than 0, 1, 2.
    const base = min ?? 0;
    const over = Math.round((value - base) * 100) / 100;
    const stepsIn = over / step;
    if (Math.abs(stepsIn - Math.round(stepsIn)) > 1e-9) {
      return { requested: value, accepted: value, ok: false, reason: `This is booked in steps of ${formatQuantity(unit, step)}.` };
    }
  }
  return { requested: value, accepted: value, ok: true, reason: null };
}

// ------------------------------------------------------------------- pricing

export interface ServiceQuote {
  unit: MeasurementUnit;
  quantity: number;
  // What it would cost with no plan at all, so a saving can be shown.
  listPaise: number;
  // What the plan does about it, and the rate that follows from that.
  planMode: PlanPricingMode | null;
  ratePaise: number;
  coveredQuantity: number;
  chargeableQuantity: number;
  basePaise: number;
  charges: { kind: ChargeKind; label: string; amountPaise: number }[];
  chargesPaise: number;
  totalPaise: number;
  // Whether the plan permits it at all.
  available: boolean;
  reason: string | null;
}

export interface QuoteContext {
  quantity: number;
  // The plan the resident is on, if any, and how much of this service they have
  // already used this cycle.
  planId?: string | null;
  usedQuantity?: number;
  // The day the work is for, so a weekend charge and a frequency rule can apply.
  date?: string | null;
  // Whether the work is at the resident's home, so a home visit charge can apply.
  atHome?: boolean;
  // Whether the resident asked for it urgently.
  emergency?: boolean;
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

// What one booking of this service comes to, all twelve steps' worth of
// configuration applied in one place so no screen has to reproduce any of it.
export function quoteService(
  service: ServiceDefinition & { unitPricePaise: number },
  context: QuoteContext,
): ServiceQuote {
  const unit = service.unit ?? "piece";
  const quantity = billableQuantity(unit, context.quantity, service.minimumQuantity);
  const listRate = Math.max(0, Math.trunc(service.unitPricePaise));
  const listPaise = Math.round(listRate * quantity);

  const rule = context.planId
    ? (service.planRules ?? []).find((r) => r.planId === context.planId) ?? null
    : null;

  const empty = {
    unit, quantity, listPaise,
    charges: [] as { kind: ChargeKind; label: string; amountPaise: number }[],
  };

  // A plan can say this service is simply not for its subscribers.
  if (rule?.mode === "not_available") {
    return {
      ...empty, planMode: rule.mode, ratePaise: 0,
      coveredQuantity: 0, chargeableQuantity: quantity, basePaise: 0,
      chargesPaise: 0, totalPaise: 0,
      available: false, reason: "Your plan does not include this service.",
    };
  }

  // The plan's frequency, where it has one, decides which days it may be booked on.
  if (rule?.mode === "included" && rule.frequency && context.date
      && !permitsDate(rule.frequency, rule.frequencyDays ?? [], context.date)) {
    const days = allowedWeekdays(rule.frequency, rule.frequencyDays ?? []).map((d) => WEEKDAY_LABELS[d]);
    return {
      ...empty, planMode: rule.mode, ratePaise: 0,
      coveredQuantity: 0, chargeableQuantity: quantity, basePaise: 0,
      chargesPaise: 0, totalPaise: 0,
      available: false, reason: `Your plan includes this on ${days.join(" and ")}.`,
    };
  }

  let ratePaise = listRate;
  let coveredQuantity = 0;
  let chargeableQuantity = quantity;
  let reason: string | null = null;
  let available = true;

  switch (rule?.mode) {
    case "included": {
      const included = normaliseQuantity(unit, rule.includedQuantity ?? 0);
      const used = normaliseQuantity(unit, context.usedQuantity ?? 0);
      const remaining = Math.max(0, normaliseQuantity(unit, included - used));
      coveredQuantity = Math.min(quantity, remaining);
      chargeableQuantity = normaliseQuantity(unit, quantity - coveredQuantity);
      // Beyond the allowance costs this plan's own additional rate, and only if the
      // plan allows going beyond it at all.
      if (chargeableQuantity > 0 && !rule.additionalUsageAllowed) {
        return {
          ...empty, planMode: rule.mode, ratePaise: 0,
          coveredQuantity, chargeableQuantity, basePaise: 0, chargesPaise: 0, totalPaise: 0,
          available: false,
          reason: `Your plan includes ${formatQuantity(unit, remaining)} of this and does not allow going beyond it.`,
        };
      }
      ratePaise = Math.max(0, Math.trunc(rule.additionalRatePaise ?? listRate));
      break;
    }
    case "fixed":
    case "discounted":
      ratePaise = Math.max(0, Math.trunc(rule.pricePaise ?? listRate));
      break;
    case "percentage_discount":
      ratePaise = Math.round(listRate * (1 - Math.min(100, Math.max(0, rule.discountPercent ?? 0)) / 100));
      break;
    case "additional_charge":
      ratePaise = Math.max(0, Math.trunc(rule.additionalRatePaise ?? listRate));
      break;
    default:
      // No plan, or a plan that says nothing about this service: the ordinary price,
      // unless a flat subscriber price is configured and the resident is on a plan.
      if (context.planId && service.subscriberUnitPricePaise != null) {
        ratePaise = Math.max(0, Math.trunc(service.subscriberUnitPricePaise));
      }
      break;
  }

  const basePaise = Math.round(ratePaise * chargeableQuantity);

  // The extras, each applied only where it actually applies.
  const charges = (service.additionalCharges ?? [])
    .filter((charge) => {
      if (charge.amountPaise <= 0) return false;
      if (charge.kind === "weekend") return Boolean(context.date && isWeekend(context.date));
      if (charge.kind === "home_visit") return Boolean(context.atHome ?? charge.appliesAtHome);
      if (charge.kind === "emergency") return Boolean(context.emergency);
      // An additional-quantity charge is per unit beyond what the plan covered.
      if (charge.kind === "additional_unit") return chargeableQuantity > 0;
      return true;
    })
    .map((charge) => ({
      kind: charge.kind,
      label: charge.label || CHARGE_LABELS[charge.kind],
      amountPaise: charge.kind === "additional_unit"
        ? Math.round(charge.amountPaise * chargeableQuantity)
        : charge.amountPaise,
    }));

  const chargesPaise = charges.reduce((sum, c) => sum + c.amountPaise, 0);

  return {
    unit, quantity, listPaise,
    planMode: rule?.mode ?? null,
    ratePaise, coveredQuantity, chargeableQuantity,
    basePaise, charges, chargesPaise,
    totalPaise: basePaise + chargesPaise,
    available, reason,
  };
}

// ------------------------------------------------------------- booking rules

export interface BookingRuleCheck {
  ok: boolean;
  reason: string | null;
}

// Whether a booking may be made at this moment, for this time, by this person.
export function checkBookingRules(
  service: { bookingRules?: ServiceBookingRules; operatingDays?: number[] },
  input: { scheduledFor: string; now?: Date; existingBookings?: number },
): BookingRuleCheck {
  const rules = { ...DEFAULT_BOOKING_RULES, ...(service.bookingRules ?? {}) };
  const now = input.now ?? new Date();
  const when = new Date(input.scheduledFor);
  if (Number.isNaN(when.getTime())) return { ok: false, reason: "That is not a time we can book." };

  const minutesAhead = (when.getTime() - now.getTime()) / 60_000;
  if (minutesAhead < 0) return { ok: false, reason: "That time has already passed." };

  if (rules.advanceBookingRequired && minutesAhead < rules.minAdvanceMinutes) {
    const hours = Math.round((rules.minAdvanceMinutes / 60) * 10) / 10;
    return { ok: false, reason: `This has to be booked at least ${hours} hour${hours === 1 ? "" : "s"} ahead.` };
  }
  if (minutesAhead > rules.maxAdvanceDays * 24 * 60) {
    return { ok: false, reason: `This can be booked at most ${rules.maxAdvanceDays} days ahead.` };
  }

  // The days the service actually operates on, which is a different question from
  // what a plan's frequency allows.
  const operating = service.operatingDays ?? [];
  if (operating.length && !operating.includes(when.getUTCDay())) {
    const days = [...operating].sort().map((d) => WEEKDAY_LABELS[d]);
    return { ok: false, reason: `This is only done on ${days.join(", ")}.` };
  }

  if (rules.maxBookingsPerUser != null && (input.existingBookings ?? 0) >= rules.maxBookingsPerUser) {
    return { ok: false, reason: `You already have ${rules.maxBookingsPerUser} of these booked.` };
  }

  return { ok: true, reason: null };
}

// Whether a cancellation is still accepted.
export function checkCancellation(
  service: { bookingRules?: ServiceBookingRules },
  input: { scheduledFor: string; now?: Date },
): BookingRuleCheck {
  const rules = { ...DEFAULT_BOOKING_RULES, ...(service.bookingRules ?? {}) };
  if (!rules.cancellationAllowed) return { ok: false, reason: "This service cannot be cancelled once booked." };
  const now = input.now ?? new Date();
  const minutesAhead = (new Date(input.scheduledFor).getTime() - now.getTime()) / 60_000;
  if (minutesAhead < rules.cancellationDeadlineMinutes) {
    const hours = Math.round((rules.cancellationDeadlineMinutes / 60) * 10) / 10;
    return { ok: false, reason: `This can be cancelled up to ${hours} hour${hours === 1 ? "" : "s"} before it starts.` };
  }
  return { ok: true, reason: null };
}

// ---------------------------------------------------- hourly slot continuity

// An hourly service booked for two hours needs two consecutive hours free, not two
// free hours somewhere in the day. Told outright rather than discovered when the
// second hour turns out to be taken.
export interface HourWindow {
  startTime: string;
  endTime: string;
  capacityRemaining: number;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

// The start times a booking of this many hours could actually take.
export function continuousStarts(windows: HourWindow[], hours: number): string[] {
  const wanted = Math.max(1, Math.ceil(hours));
  const open = windows
    .filter((w) => w.capacityRemaining > 0)
    .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));

  const starts: string[] = [];
  for (let i = 0; i + wanted <= open.length; i += 1) {
    let contiguous = true;
    for (let step = 1; step < wanted; step += 1) {
      // Each window has to begin exactly where the last one ended.
      if (open[i + step - 1].endTime !== open[i + step].startTime) { contiguous = false; break; }
    }
    if (contiguous) starts.push(open[i].startTime);
  }
  return starts;
}

export function hasContinuousAvailability(windows: HourWindow[], hours: number, startTime: string): boolean {
  return continuousStarts(windows, hours).includes(startTime);
}
