// What a service is measured in, and what that means for pricing an order.
//
// The platform used to price everything by the garment: one price table keyed by
// category, one allowance counted in garments. That was never true of the business —
// a bag of mixed washing is weighed, ironing is counted, at-home work is charged by
// the hour, and a car wash is one job — and it made "40 garments" mean something
// different for a household of shirts than for a household of bedsheets.
//
// A unit is now a property of the service. Ordinary laundry is weighed, which is the
// default; anything genuinely counted stays counted.

export type MeasurementUnit =
  | "kg"
  | "piece"
  | "hour"
  | "job"
  | "vehicle"
  | "room"
  | "sqft"
  | "pair"
  | "item";

export const MEASUREMENT_UNITS: MeasurementUnit[] = [
  "kg", "piece", "hour", "job", "vehicle", "room", "sqft", "pair", "item",
];

export const UNIT_LABELS: Record<MeasurementUnit, string> = {
  kg: "Kilogram",
  piece: "Piece",
  hour: "Hour",
  job: "Job",
  vehicle: "Vehicle",
  room: "Room",
  sqft: "Square foot",
  pair: "Pair",
  item: "Item",
};

// How a quantity in this unit reads to a person: "4.5 kg", "6 pieces", "2 hours".
export const UNIT_SUFFIX: Record<MeasurementUnit, { one: string; many: string }> = {
  kg: { one: "kg", many: "kg" },
  piece: { one: "piece", many: "pieces" },
  hour: { one: "hour", many: "hours" },
  job: { one: "job", many: "jobs" },
  vehicle: { one: "vehicle", many: "vehicles" },
  room: { one: "room", many: "rooms" },
  sqft: { one: "sq ft", many: "sq ft" },
  pair: { one: "pair", many: "pairs" },
  item: { one: "item", many: "items" },
};

// Some units are naturally fractional and some are not. Half a kilogram is a real
// quantity; half a piece is not, and rounding one like the other is how a 2.5 kg bag
// became a 3 kg bill.
export const FRACTIONAL_UNITS: MeasurementUnit[] = ["kg", "hour", "sqft"];

export function isFractional(unit: MeasurementUnit): boolean {
  return FRACTIONAL_UNITS.includes(unit);
}

// A quantity, normalised for its unit. Fractional units keep two decimal places;
// counted units are whole. Never negative.
export function normaliseQuantity(unit: MeasurementUnit, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return isFractional(unit) ? Math.round(quantity * 100) / 100 : Math.trunc(quantity);
}

export function formatQuantity(unit: MeasurementUnit, quantity: number): string {
  const value = normaliseQuantity(unit, quantity);
  const suffix = value === 1 ? UNIT_SUFFIX[unit].one : UNIT_SUFFIX[unit].many;
  // A whole number of kilograms reads better without the decimals.
  const shown = isFractional(unit) && value % 1 !== 0 ? value.toFixed(2) : String(value);
  return `${shown} ${suffix}`;
}

// What a quantity costs at a rate. Rounded to the paisa at the end rather than per
// unit, so 2.5 kg at ₹60.50 is not quietly rounded twice.
export function amountPaise(unit: MeasurementUnit, quantity: number, ratePaise: number): number {
  const billable = normaliseQuantity(unit, quantity);
  return Math.round(billable * Math.max(0, ratePaise));
}

// Some services will not weigh a bag below a floor: half a kilo of washing still
// occupies a machine. Configuration rather than a rule in code.
export function billableQuantity(
  unit: MeasurementUnit,
  quantity: number,
  minimumBillable?: number | null,
): number {
  const actual = normaliseQuantity(unit, quantity);
  if (actual <= 0) return 0;
  const floor = minimumBillable ?? 0;
  return floor > 0 ? Math.max(actual, normaliseQuantity(unit, floor)) : actual;
}

// ------------------------------------------------------------------ allowances

// How much of a service's allowance a request would use, and what falls outside it.
// The split is the whole point: what a plan covers is not charged, what exceeds it is
// charged at the overage rate for that service — never at one rate for everything.
export interface AllowanceSplit {
  requested: number;
  covered: number;
  additional: number;
  remainingAfter: number;
}

export function splitAgainstAllowance(
  unit: MeasurementUnit,
  requested: number,
  remainingAllowance: number,
): AllowanceSplit {
  const want = normaliseQuantity(unit, requested);
  const have = Math.max(0, normaliseQuantity(unit, remainingAllowance));
  const covered = Math.min(want, have);
  const additional = normaliseQuantity(unit, want - covered);
  return {
    requested: want,
    covered,
    additional,
    remainingAfter: normaliseQuantity(unit, have - covered),
  };
}

// What happens when somebody asks for more than their plan includes. Configuration,
// because "block it", "charge for it" and "ask an admin" are all reasonable answers
// and which one applies is a business decision rather than a technical one.
export type AdditionalUsageBehaviour = "block" | "pay_per_use" | "admin_approval";

export const ADDITIONAL_USAGE_BEHAVIOURS: AdditionalUsageBehaviour[] = [
  "block", "pay_per_use", "admin_approval",
];

export const ADDITIONAL_USAGE_LABELS: Record<AdditionalUsageBehaviour, string> = {
  block: "Not allowed",
  pay_per_use: "Charged as extra",
  admin_approval: "Needs approval",
};

export class AllowanceExceededError extends Error {
  constructor(readonly serviceName: string, readonly unit: MeasurementUnit, readonly remaining: number) {
    super(
      remaining > 0
        ? `Your plan has ${formatQuantity(unit, remaining)} of ${serviceName} left, which is less than you asked for.`
        : `Your plan has no ${serviceName} allowance left this cycle.`,
    );
    this.name = "AllowanceExceededError";
  }
}

export class AdditionalUsageNeedsApprovalError extends Error {
  constructor(readonly serviceName: string) {
    super(`Going beyond your ${serviceName} allowance needs approval. We have asked for it.`);
    this.name = "AdditionalUsageNeedsApprovalError";
  }
}
