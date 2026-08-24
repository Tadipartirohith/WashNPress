import type { Addon, GarmentService, OrderLine, Plan, PricingBasis } from "./models";

// Order pricing. A subscription is optional: a resident with a plan spends their
// garment allowance first and pays the plan's additional rate beyond it, while a
// resident without one pays the ordinary per garment price for everything.
//
// Service charges sit on top of either arrangement, and they are priced per garment
// category, because pressing a saree is not pressing a shirt. Each plan names the
// services it covers: a garment sent for a covered service spends allowance and
// carries no service charge, while one sent for a service the plan does not cover is
// billed per garment even when allowance remains.

// What one garment of this category costs for this service. A category the service
// has no explicit price for falls back to the service's own unit price.
// What this service costs per unit for this category, for this kind of customer.
//
// A subscriber and a non-subscriber are not the same customer. The plan is supposed
// to be worth having, and where an admin has configured a subscriber price it is
// that price that applies — falling back to the ordinary one where they have not,
// so a service written before subscriber pricing existed keeps behaving as it did.
export function servicePricePaise(
  service: GarmentService,
  category: string,
  audience: PricingAudience = "standard",
): number {
  if (audience === "subscriber") {
    const specific = service.subscriberPricesPaise?.[category];
    if (typeof specific === "number") return Math.max(0, Math.trunc(specific));
    if (typeof service.subscriberUnitPricePaise === "number") {
      return Math.max(0, Math.trunc(service.subscriberUnitPricePaise));
    }
  }
  const specific = service.pricesPaise?.[category];
  const price = typeof specific === "number" ? specific : service.unitPricePaise;
  return Math.max(0, Math.trunc(price));
}

// Which price list applies to the person ordering. Decided by the backend from the
// subscription, never sent by the client, because a price the client chooses is a
// price the client can change.
export type PricingAudience = "subscriber" | "standard";

export function audienceFor(hasActiveSubscription: boolean): PricingAudience {
  return hasActiveSubscription ? "subscriber" : "standard";
}

// What a service is measured in. A per-garment service is priced by how many
// garments; a per-kg one by how heavy the bag is; a per-job one is one price
// however much of it there is.
export function basisOf(service: Pick<GarmentService, "pricingBasis">): PricingBasis {
  return service.pricingBasis ?? "per_garment";
}

// The billable quantity for a line, in whatever the service is measured in. Weight
// is charged to two decimal places of a kilogram so a 2.5 kg bag is not rounded to
// three, and a per-job service is one whatever else is true.
export function billableUnits(
  service: Pick<GarmentService, "pricingBasis">,
  input: { quantity: number; weightKg?: number | null },
): number {
  switch (basisOf(service)) {
    case "per_kg": return Math.max(0, Math.round((input.weightKg ?? 0) * 100) / 100);
    case "per_job": return input.quantity > 0 ? 1 : 0;
    default: return Math.max(0, Math.trunc(input.quantity));
  }
}

// What a plan covers when nobody has said. A plan written before coverage existed
// has no list at all, and treating that as covering nothing would start charging
// for the ordinary wash and iron those plans have always included.
export const DEFAULT_COVERED_SERVICE_IDS = ["wash_iron", "wash_only"];

export function normalisePlan(plan: Plan): Plan {
  if (plan.coveredServiceIds) return plan;
  return { ...plan, coveredServiceIds: [...DEFAULT_COVERED_SERVICE_IDS] };
}

// What one garment of this category costs a resident paying as they go, before any
// service charge. A category with no price of its own falls back to the flat rate.
export function garmentPricePaise(prices: Record<string, number> | undefined, category: string, fallbackPaise: number): number {
  const specific = prices?.[category];
  const price = typeof specific === "number" ? specific : fallbackPaise;
  return Math.max(0, Math.trunc(price));
}

// The garment part of a pay-as-you-go order: each category at its own price.
export function garmentsChargePaise(
  items: { category: string; quantity: number }[],
  prices: Record<string, number> | undefined,
  fallbackPaise: number,
): number {
  return items.reduce(
    (sum, item) => sum + garmentPricePaise(prices, item.category, fallbackPaise) * Math.max(0, Math.trunc(item.quantity)),
    0,
  );
}

export function planCovers(plan: Plan | null, serviceId: string): boolean {
  if (!plan) return false;
  return normalisePlan(plan).coveredServiceIds.includes(serviceId);
}

export interface PricedLineInput {
  category: string;
  quantity: number;
  serviceId: string;
  addonIds?: string[];
  notes?: string;
  // For a service priced by weight. Ignored by everything measured per garment.
  weightKg?: number;
}

export interface LinePricing {
  // What the service costs per garment before the plan is applied, so the resident
  // can see what a plan saved them.
  listPricePaise: number;
  serviceUnitPricePaise: number;
  addonsPaise: number;
  linePricePaise: number;
}

export class UnknownServiceError extends Error {
  constructor(serviceId: string) {
    super(`Unknown garment service: ${serviceId}`);
    this.name = "UnknownServiceError";
  }
}

export function baseService(services: GarmentService[]): GarmentService | null {
  return services.find((s) => s.isBase && s.isActive) ?? services.find((s) => s.isActive) ?? null;
}

export function findService(services: GarmentService[], serviceId: string): GarmentService {
  const service = services.find((s) => s.id === serviceId && s.isActive);
  if (!service) throw new UnknownServiceError(serviceId);
  return service;
}

export function priceLine(input: {
  category: string;
  quantity: number;
  service: GarmentService;
  addons: Addon[];
  // A plan that covers this service absorbs its charge; the garments still spend
  // allowance, which is accounted for when the order as a whole is priced.
  coveredByPlan?: boolean;
  // Which price list applies. Decided from the subscription by the backend.
  audience?: PricingAudience;
  // For a service priced by weight rather than by count.
  weightKg?: number | null;
}): LinePricing {
  const quantity = Math.max(0, Math.trunc(input.quantity));
  const listPricePaise = servicePricePaise(input.service, input.category, input.audience ?? "standard");
  const serviceUnitPricePaise = input.coveredByPlan ? 0 : listPricePaise;
  // Charged per garment, per kilogram or once for the job, depending on what the
  // service is actually measured in.
  const units = billableUnits(input.service, { quantity, weightKg: input.weightKg });
  // An add-on is priced once per garment in the line, so two dry cleaned shirts with
  // a stain treatment cost two treatments rather than one. Add-ons stay per garment
  // even where the service itself is weighed, because that is what they are.
  const addonsPaise = input.addons.reduce((sum, addon) => sum + Math.max(0, addon.pricePaise), 0) * quantity;
  return {
    listPricePaise,
    serviceUnitPricePaise,
    addonsPaise,
    linePricePaise: Math.round(serviceUnitPricePaise * units) + addonsPaise,
  };
}

export function buildLines(
  inputs: PricedLineInput[],
  services: GarmentService[],
  addonsById: Map<string, Addon>,
  makeId: () => string,
  // The resident's plan, if they have one, so each line records whether it was
  // covered at the moment it was booked.
  plan: Plan | null = null,
  // Which price list applies. A subscriber and a passer-by are not the same
  // customer, and the plan is supposed to be worth having.
  audience: PricingAudience = "standard",
): OrderLine[] {
  return inputs
    .filter((line) => line.quantity > 0)
    .map((line) => {
      const service = findService(services, line.serviceId);
      const addonIds = line.addonIds ?? [];
      const addons = addonIds.map((id) => addonsById.get(id)).filter((a): a is Addon => Boolean(a) && a!.isActive);
      const coveredByPlan = planCovers(plan, service.id);
      const { listPricePaise, ...pricing } = priceLine({
        category: line.category, quantity: line.quantity, service, addons, coveredByPlan,
        audience, weightKg: line.weightKg ?? null,
      });
      void listPricePaise;
      return {
        id: makeId(),
        category: line.category,
        quantity: Math.trunc(line.quantity),
        serviceId: service.id,
        serviceName: service.name,
        addonIds: addons.map((a) => a.id),
        // Snapshotted so a later catalogue change never rewrites an order in flight.
        requiresClean: service.requiresClean,
        cleanStage: service.cleanStage,
        requiresPress: service.requiresPress,
        coveredByPlan,
        // How this line is measured and, where it is weighed, how heavy it was.
        pricingBasis: basisOf(service),
        weightKg: basisOf(service) === "per_kg" ? Math.max(0, Math.round((line.weightKg ?? 0) * 100) / 100) : null,
        notes: line.notes ?? null,
        ...pricing,
      };
    });
}

export function linesTotalPaise(lines: OrderLine[]): number {
  return lines.reduce((sum, line) => sum + line.linePricePaise, 0);
}

export function linesQuantity(lines: OrderLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

// How many of the booked garments were sent for a service the plan covers.
export function coveredEligibleQuantity(lines: OrderLine[]): number | undefined {
  if (lines.length === 0) return undefined;
  return lines.reduce((sum, line) => sum + (line.coveredByPlan ? line.quantity : 0), 0);
}

// Collapses the lines back into the per category totals the operations screens and
// the order summary display.
export function linesToItems(lines: OrderLine[]): { category: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.category, (totals.get(line.category) ?? 0) + line.quantity);
  return [...totals.entries()].map(([category, quantity]) => ({ category, quantity }));
}

export interface OrderCharge {
  acceptedCount: number;
  subscriptionCoveredCount: number;
  additionalCount: number;
  ratePaise: number;
  garmentChargePaise: number;
  servicesPaise: number;
  totalPaise: number;
  payPerOrder: boolean;
}

// The whole charge for an order, from the accepted quantity and the chosen services.
export function priceOrder(input: {
  acceptedCount: number;
  // Garments booked for a service the plan covers. Only these may spend allowance;
  // anything sent for an uncovered service is billed however many are left.
  coveredEligibleCount?: number;
  remainingAllowance: number;
  hasSubscription: boolean;
  additionalRatePaise: number;
  nonSubscriberRatePaise: number;
  // The garment charge worked out per category by the caller. Supplied whenever the
  // categories are known, so a saree is not billed at the price of a shirt.
  garmentChargePaise?: number;
  servicesPaise: number;
}): OrderCharge {
  const accepted = Math.max(0, Math.trunc(input.acceptedCount));
  const servicesPaise = Math.max(0, Math.trunc(input.servicesPaise));

  if (!input.hasSubscription) {
    // No plan: every garment is billed at the price of its own category, falling
    // back to the flat rate when the categories are not known.
    const ratePaise = Math.max(0, Math.trunc(input.nonSubscriberRatePaise));
    const garmentChargePaise = input.garmentChargePaise != null
      ? Math.max(0, Math.trunc(input.garmentChargePaise))
      : accepted * ratePaise;
    return {
      acceptedCount: accepted,
      subscriptionCoveredCount: 0,
      additionalCount: accepted,
      ratePaise,
      garmentChargePaise,
      servicesPaise,
      totalPaise: garmentChargePaise + servicesPaise,
      payPerOrder: true,
    };
  }

  const remaining = Math.max(0, Math.trunc(input.remainingAllowance));
  // An order with no line detail predates per service coverage; all of it is eligible.
  const eligible = input.coveredEligibleCount == null
    ? accepted
    : Math.min(accepted, Math.max(0, Math.trunc(input.coveredEligibleCount)));
  const covered = Math.min(eligible, remaining);
  const additional = accepted - covered;
  const ratePaise = Math.max(0, Math.trunc(input.additionalRatePaise));
  const garmentChargePaise = additional * ratePaise;
  return {
    acceptedCount: accepted,
    subscriptionCoveredCount: covered,
    additionalCount: additional,
    ratePaise,
    garmentChargePaise,
    servicesPaise,
    totalPaise: garmentChargePaise + servicesPaise,
    payPerOrder: false,
  };
}

// ------------------------------------------------- garment + service pricing

// What one garment on this line costs: the garment's own price plus what the
// service adds to it. This is the rate the requirements call the "Garment + Service
// rate", and it is the only rate an additional garment on this line may be charged
// at. Billing every extra garment at one flat additional rate, whatever service it
// was sent for, is what let a dry cleaned shirt be charged like a washed one.
export function lineUnitPricePaise(
  line: Pick<OrderLine, "category" | "serviceUnitPricePaise">,
  garmentPrices: Record<string, number> | undefined,
  fallbackPaise: number,
): number {
  const garment = garmentPricePaise(garmentPrices, line.category, fallbackPaise);
  return garment + Math.max(0, Math.trunc(line.serviceUnitPricePaise ?? 0));
}

export type QuantityStatus = "matched" | "short" | "additional";

export interface LineReconciliation {
  lineId: string;
  category: string;
  serviceId: string;
  serviceName: string;
  requested: number;
  actual: number;
  difference: number;
  status: QuantityStatus;
  unitPricePaise: number;
  // What the extra garments on this line come to, at this line's own rate.
  additionalPaise: number;
}

// Requested against actual, per Garment + Service combination. The operator sees
// exactly which combination is short and which has extra, rather than a single
// order-level number that hides both.
export function reconcileLines(
  lines: OrderLine[],
  acceptedOf: (line: OrderLine) => number,
  garmentPrices: Record<string, number> | undefined,
  fallbackPaise: number,
): LineReconciliation[] {
  return lines.map((line) => {
    const requested = Math.max(0, Math.trunc(line.quantity));
    const actual = Math.max(0, Math.trunc(acceptedOf(line)));
    const difference = actual - requested;
    const unitPricePaise = lineUnitPricePaise(line, garmentPrices, fallbackPaise);
    return {
      lineId: line.id,
      category: line.category,
      serviceId: line.serviceId,
      serviceName: line.serviceName,
      requested,
      actual,
      difference,
      status: difference === 0 ? "matched" : difference < 0 ? "short" : "additional",
      unitPricePaise,
      additionalPaise: difference > 0 ? difference * unitPricePaise : 0,
    };
  });
}

// What the extra garments across the whole order come to, each at the rate of the
// combination it belongs to.
export function additionalChargeFromLines(reconciliation: LineReconciliation[]): number {
  return reconciliation.reduce((sum, row) => sum + row.additionalPaise, 0);
}
