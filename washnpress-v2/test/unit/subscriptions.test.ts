import { describe, it, expect } from "vitest";
import { cyclePricePaise, cycleLengthDays, computeProrationPaise } from "../../src/domain/subscriptions";
import type { Plan } from "../../src/domain/models";

const basic: Plan = { id: "b", tier: "Basic", garmentCap: 40, turnaroundHours: 48, monthlyPaise: 50000, annualDiscountPercent: 10, isActive: true, coveredServiceIds: ["wash_iron"] };

describe("subscriptions domain", () => {
  it("prices a monthly cycle at the monthly price", () => {
    expect(cyclePricePaise(basic, "monthly")).toBe(50000);
  });
  it("applies the annual discount", () => {
    expect(cyclePricePaise(basic, "annual")).toBe(Math.round(50000 * 12 * 0.9));
  });
  it("cycle length is 30 or 365 days", () => {
    expect(cycleLengthDays("monthly")).toBe(30);
    expect(cycleLengthDays("annual")).toBe(365);
  });
  it("proration for an upgrade is positive and a downgrade is negative", () => {
    const up = computeProrationPaise({ currentCyclePaise: 50000, newCyclePaise: 90000, daysRemaining: 15, cycleDays: 30 });
    const down = computeProrationPaise({ currentCyclePaise: 90000, newCyclePaise: 50000, daysRemaining: 15, cycleDays: 30 });
    expect(up).toBe(20000);
    expect(down).toBe(-20000);
  });
});
