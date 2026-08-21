import type { Addon, GarmentService, OrderLine, Plan } from "./models";

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
export function servicePricePaise(service: GarmentService, category: string): number {
  const specific = service.pricesPaise?.[category];
  const price = typeof specific === "number" ? specific : service.unitPricePaise;
  return Math.max(0, Math.trunc(price));
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
}): LinePricing {
  const quantity = Math.max(0, Math.trunc(input.quantity));
  const listPricePaise = servicePricePaise(input.service, input.category);
  const serviceUnitPricePaise = input.coveredByPlan ? 0 : listPricePaise;
  // An add-on is priced once per garment in the line, so two dry cleaned shirts with
  // a stain treatment cost two treatments rather than one.
  const addonsPaise = input.addons.reduce((sum, addon) => sum + Math.max(0, addon.pricePaise), 0) * quantity;
  return {
    listPricePaise,
    serviceUnitPricePaise,
    addonsPaise,
    linePricePaise: serviceUnitPricePaise * quantity + addonsPaise,
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
