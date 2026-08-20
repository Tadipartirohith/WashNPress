import type { Addon, GarmentService, OrderLine } from "./models";

// Order pricing. A subscription is optional: a resident with a plan spends their
// garment allowance first and pays the plan's additional rate beyond it, while a
// resident without one pays the ordinary per garment price for everything.
//
// Service charges sit on top of either arrangement. The base service is priced at
// zero, so an ordinary wash and iron is what a plan covers; anything premium, such
// as dry cleaning, is charged per garment whether or not the resident subscribes.

export interface PricedLineInput {
  category: string;
  quantity: number;
  serviceId: string;
  addonIds?: string[];
  notes?: string;
}

export interface LinePricing {
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
  quantity: number;
  service: GarmentService;
  addons: Addon[];
}): LinePricing {
  const quantity = Math.max(0, Math.trunc(input.quantity));
  const serviceUnitPricePaise = Math.max(0, Math.trunc(input.service.unitPricePaise));
  // An add-on is priced once per garment in the line, so two dry cleaned shirts with
  // a stain treatment cost two treatments rather than one.
  const addonsPaise = input.addons.reduce((sum, addon) => sum + Math.max(0, addon.pricePaise), 0) * quantity;
  return {
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
): OrderLine[] {
  return inputs
    .filter((line) => line.quantity > 0)
    .map((line) => {
      const service = findService(services, line.serviceId);
      const addonIds = line.addonIds ?? [];
      const addons = addonIds.map((id) => addonsById.get(id)).filter((a): a is Addon => Boolean(a) && a!.isActive);
      const pricing = priceLine({ quantity: line.quantity, service, addons });
      return {
        id: makeId(),
        category: line.category,
        quantity: Math.trunc(line.quantity),
        serviceId: service.id,
        serviceName: service.name,
        addonIds: addons.map((a) => a.id),
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
  remainingAllowance: number;
  hasSubscription: boolean;
  additionalRatePaise: number;
  nonSubscriberRatePaise: number;
  servicesPaise: number;
}): OrderCharge {
  const accepted = Math.max(0, Math.trunc(input.acceptedCount));
  const servicesPaise = Math.max(0, Math.trunc(input.servicesPaise));

  if (!input.hasSubscription) {
    // No plan: every garment is billed at the ordinary per garment price.
    const ratePaise = Math.max(0, Math.trunc(input.nonSubscriberRatePaise));
    const garmentChargePaise = accepted * ratePaise;
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
  const covered = Math.min(accepted, remaining);
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
