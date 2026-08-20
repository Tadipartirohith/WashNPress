import { describe, it, expect } from "vitest";
import { buildLines, linesQuantity, linesTotalPaise, linesToItems, priceOrder, findService, UnknownServiceError } from "../../src/domain/pricing";
import type { Addon, GarmentService } from "../../src/domain/models";

const SERVICES: GarmentService[] = [
  { id: "wash_iron", name: "Wash and Iron", unitPricePaise: 0, isBase: true, isActive: true },
  { id: "dryclean_iron", name: "Dry Clean and Iron", unitPricePaise: 8000, isBase: false, isActive: true },
  { id: "retired", name: "Retired service", unitPricePaise: 100, isBase: false, isActive: false },
];

const ADDONS = new Map<string, Addon>([
  ["addon-stain", { id: "addon-stain", name: "Stain treatment", pricePaise: 2500, isActive: true }],
  ["addon-off", { id: "addon-off", name: "Withdrawn", pricePaise: 9900, isActive: false }],
]);

let counter = 0;
const nextId = () => `line-${++counter}`;

describe("order line pricing", () => {
  it("splits one category across two services, the specification example", () => {
    const lines = buildLines(
      [
        { category: "Shirts", quantity: 4, serviceId: "dryclean_iron" },
        { category: "Shirts", quantity: 6, serviceId: "wash_iron" },
      ],
      SERVICES, ADDONS, nextId,
    );
    expect(lines).toHaveLength(2);
    expect(linesQuantity(lines)).toBe(10);
    // Only the dry cleaned half carries a service charge.
    expect(lines[0].linePricePaise).toBe(4 * 8000);
    expect(lines[1].linePricePaise).toBe(0);
    expect(linesTotalPaise(lines)).toBe(32000);
    // The category totals still reconcile for the operations screens.
    expect(linesToItems(lines)).toEqual([{ category: "Shirts", quantity: 10 }]);
  });

  it("prices an add-on once per garment in the line and ignores inactive ones", () => {
    const [line] = buildLines(
      [{ category: "Sarees", quantity: 3, serviceId: "dryclean_iron", addonIds: ["addon-stain", "addon-off", "missing"] }],
      SERVICES, ADDONS, nextId,
    );
    expect(line.addonIds).toEqual(["addon-stain"]);
    expect(line.addonsPaise).toBe(3 * 2500);
    expect(line.linePricePaise).toBe(3 * 8000 + 3 * 2500);
  });

  it("refuses an unknown or withdrawn service rather than pricing it at zero", () => {
    expect(() => findService(SERVICES, "nope")).toThrow(UnknownServiceError);
    expect(() => findService(SERVICES, "retired")).toThrow(UnknownServiceError);
  });

  it("drops empty lines", () => {
    expect(buildLines([{ category: "Shirts", quantity: 0, serviceId: "wash_iron" }], SERVICES, ADDONS, nextId)).toHaveLength(0);
  });
});

describe("order charge", () => {
  it("spends the allowance first and bills the rest at the plan rate", () => {
    const charge = priceOrder({
      acceptedCount: 20, remainingAllowance: 5, hasSubscription: true,
      additionalRatePaise: 2000, nonSubscriberRatePaise: 3000, servicesPaise: 0,
    });
    expect(charge.subscriptionCoveredCount).toBe(5);
    expect(charge.additionalCount).toBe(15);
    expect(charge.garmentChargePaise).toBe(15 * 2000);
    expect(charge.totalPaise).toBe(30000);
    expect(charge.payPerOrder).toBe(false);
  });

  it("bills every garment at the ordinary rate when there is no plan", () => {
    const charge = priceOrder({
      acceptedCount: 15, remainingAllowance: 0, hasSubscription: false,
      additionalRatePaise: 2000, nonSubscriberRatePaise: 3000, servicesPaise: 0,
    });
    // Subscription is optional, so this is the ordinary price, not an overage rate.
    expect(charge.payPerOrder).toBe(true);
    expect(charge.subscriptionCoveredCount).toBe(0);
    expect(charge.ratePaise).toBe(3000);
    expect(charge.totalPaise).toBe(45000);
  });

  it("adds service charges on top of either arrangement", () => {
    const subscriber = priceOrder({
      acceptedCount: 10, remainingAllowance: 40, hasSubscription: true,
      additionalRatePaise: 2000, nonSubscriberRatePaise: 3000, servicesPaise: 32000,
    });
    // The plan covers the wash; the dry cleaning is still charged.
    expect(subscriber.garmentChargePaise).toBe(0);
    expect(subscriber.totalPaise).toBe(32000);

    const guest = priceOrder({
      acceptedCount: 10, remainingAllowance: 0, hasSubscription: false,
      additionalRatePaise: 2000, nonSubscriberRatePaise: 3000, servicesPaise: 32000,
    });
    expect(guest.totalPaise).toBe(10 * 3000 + 32000);
  });

  it("never produces a negative charge from odd inputs", () => {
    const charge = priceOrder({
      acceptedCount: -4, remainingAllowance: -1, hasSubscription: true,
      additionalRatePaise: -50, nonSubscriberRatePaise: 3000, servicesPaise: -10,
    });
    expect(charge.acceptedCount).toBe(0);
    expect(charge.totalPaise).toBe(0);
  });
});
