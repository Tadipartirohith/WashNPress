import { describe, it, expect } from "vitest";
import { splitGarments, splitWithoutSubscription, remainingAllowance, totalQuantity } from "../../src/domain/garments";

describe("garment quantity rules", () => {
  it("totals the categories the operator entered", () => {
    expect(totalQuantity([
      { category: "Shirts", quantity: 8 },
      { category: "Trousers", quantity: 5 },
      { category: "Bedsheets", quantity: 4 },
      { category: "Other", quantity: 3 },
    ])).toBe(20);
  });

  it("splits the specification example: 5 remaining, 20 accepted", () => {
    const split = splitGarments({ acceptedCount: 20, remainingAllowance: 5, additionalRatePaise: 2000 });
    expect(split.subscriptionCoveredCount).toBe(5);
    expect(split.additionalCount).toBe(15);
    expect(split.additionalChargePaise).toBe(15 * 2000);
  });

  it("covers everything when the allowance is larger than the pickup", () => {
    const split = splitGarments({ acceptedCount: 12, remainingAllowance: 40, additionalRatePaise: 2000 });
    expect(split.subscriptionCoveredCount).toBe(12);
    expect(split.additionalCount).toBe(0);
    expect(split.additionalChargePaise).toBe(0);
  });

  it("bills every garment when there is no subscription", () => {
    const split = splitWithoutSubscription(6, 2500);
    expect(split.subscriptionCoveredCount).toBe(0);
    expect(split.additionalCount).toBe(6);
    expect(split.additionalChargePaise).toBe(15000);
  });

  it("never reports a negative remaining allowance", () => {
    expect(remainingAllowance(40, 45)).toBe(0);
    const split = splitGarments({ acceptedCount: 3, remainingAllowance: -5, additionalRatePaise: 1000 });
    expect(split.subscriptionCoveredCount).toBe(0);
    expect(split.additionalCount).toBe(3);
  });
});
