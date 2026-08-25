import { describe, it, expect } from "vitest";
import type { Plan, PlanServiceRule, Subscription } from "../../src/domain/models";
import { planProblems, assertValidPlan, InvalidPlanError, planPricing, assessOrder, firstRefusal } from "../../src/domain/plan-usage";
import { allowedWeekdays, permitsDate, occurrencesBetween, validateRecurrence, InvalidRecurrenceError } from "../../src/domain/recurrence";

function rule(over: Partial<PlanServiceRule> = {}): PlanServiceRule {
  return {
    serviceId: "wash", serviceName: "Washing", unit: "kg", includedQuantity: 40,
    frequency: "daily", frequencyDays: [], maxPerFrequency: null, maxPerCycle: null,
    carryForward: false, additionalUsage: "pay_per_use", additionalRatePaise: 6000,
    ...over,
  };
}

describe("a plan has to say enough to be worth storing", () => {
  it("accepts one that does", () => {
    expect(planProblems({ name: "Premium Care", monthlyPaise: 129900, services: [rule()] })).toEqual([]);
  });

  it("names every problem at once rather than one at a time", () => {
    // A wizard that reveals the next problem only after the last is fixed is a
    // wizard somebody abandons.
    const problems = planProblems({
      name: "  ", monthlyPaise: -1,
      services: [rule({ includedQuantity: 0, additionalRatePaise: -5 })],
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(problems.join(" ")).toMatch(/needs a name/);
    expect(problems.join(" ")).toMatch(/cannot be negative/);
    expect(problems.join(" ")).toMatch(/greater than zero/);
  });

  it("insists on at least one service", () => {
    expect(planProblems({ name: "Empty", monthlyPaise: 100, services: [] }))
      .toContain("A plan needs at least one service.");
  });

  it("refuses the same service twice", () => {
    const problems = planProblems({ name: "Doubled", monthlyPaise: 100, services: [rule(), rule()] });
    expect(problems.join(" ")).toMatch(/more than once/);
  });

  it("refuses a custom cadence that names no day", () => {
    const problems = planProblems({
      name: "Custom", monthlyPaise: 100,
      services: [rule({ frequency: "custom", frequencyDays: [] })],
    });
    expect(problems.join(" ")).toMatch(/names no days/);
  });

  it("throws with every problem attached, not only the first", () => {
    try {
      assertValidPlan({ name: "", monthlyPaise: 0, services: [] });
      expect.unreachable("an empty plan should not validate");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPlanError);
      expect((error as InvalidPlanError).problems.length).toBeGreaterThan(1);
    }
  });
});

describe("what a plan actually costs", () => {
  it("takes the discount off before adding the tax", () => {
    // 1299.00, less 10%, plus 18% on what is left.
    const p = planPricing({ monthlyPaise: 129900, discountPercent: 10, taxPercent: 18 });
    expect(p.discountPaise).toBe(12990);
    expect(p.taxPaise).toBe(Math.round((129900 - 12990) * 0.18));
    expect(p.payablePaise).toBe(129900 - 12990 + p.taxPaise);
  });

  it("is just the price when neither applies", () => {
    expect(planPricing({ monthlyPaise: 49900 }).payablePaise).toBe(49900);
  });

  it("never lets a discount take the price below nothing", () => {
    expect(planPricing({ monthlyPaise: 10000, discountPercent: 100 }).payablePaise).toBe(0);
  });
});

describe("which days a frequency permits", () => {
  it("allows every day for the cadences that are not made of weekdays", () => {
    expect(allowedWeekdays("daily", [])).toHaveLength(7);
    expect(allowedWeekdays("alternate_days", [])).toHaveLength(7);
    expect(allowedWeekdays("one_time", [])).toHaveLength(7);
  });

  it("allows only the named days otherwise", () => {
    expect(allowedWeekdays("twice_weekly", [2, 5])).toEqual([2, 5]);
    expect(allowedWeekdays("custom", [1, 3, 6])).toEqual([1, 3, 6]);
  });

  it("answers whether a given date is one of them", () => {
    // 2026-03-03 is a Tuesday, 2026-03-04 a Wednesday.
    expect(permitsDate("twice_weekly", [2, 5], "2026-03-03")).toBe(true);
    expect(permitsDate("twice_weekly", [2, 5], "2026-03-04")).toBe(false);
    expect(permitsDate("daily", [], "2026-03-04")).toBe(true);
  });
});

describe("the daily and custom cadences", () => {
  it("generates every day for daily", () => {
    const dates = occurrencesBetween({ frequency: "daily", days: [], startDate: "2026-03-01" }, "2026-03-01", "2026-03-05");
    expect(dates).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
  });

  it("generates exactly the named days for custom", () => {
    // Mondays and Wednesdays across one week.
    const dates = occurrencesBetween({ frequency: "custom", days: [1, 3], startDate: "2026-03-01" }, "2026-03-01", "2026-03-08");
    expect(dates).toEqual(["2026-03-02", "2026-03-04"]);
  });

  it("refuses a custom schedule that names no day", () => {
    expect(() => validateRecurrence("custom", [])).toThrow(InvalidRecurrenceError);
    expect(() => validateRecurrence("custom", [1])).not.toThrow();
  });
});

describe("assessing a whole order against a plan", () => {
  const plan = {
    id: "p", tier: "T", garmentCap: 0, turnaroundHours: 24, monthlyPaise: 0,
    annualDiscountPercent: 0, isActive: true,
    services: [
      rule({ serviceId: "wash", serviceName: "Washing", unit: "kg", includedQuantity: 40 }),
      rule({ serviceId: "iron", serviceName: "Ironing", unit: "piece", includedQuantity: 30, additionalUsage: "block", additionalRatePaise: 1500 }),
      rule({ serviceId: "dry", serviceName: "Dry cleaning", unit: "piece", includedQuantity: 5, frequency: "twice_weekly", frequencyDays: [2, 5], additionalRatePaise: 9000 }),
    ],
  } as unknown as Plan;

  const sub = {
    id: "s", residentId: "r", planId: "p", status: "active", cycle: "monthly",
    cycleStart: "", cycleEnd: "", garmentsUsed: 0, autoRenew: true,
    pendingPlanId: null, pauseUntil: null, cancelReason: null, serviceUsage: {},
  } as unknown as Subscription;

  it("lets two lines of one service share a single balance", () => {
    const seen = assessOrder(plan, sub, [
      { serviceId: "wash", serviceName: "Washing", unit: "kg", quantity: 30 },
      { serviceId: "wash", serviceName: "Washing", unit: "kg", quantity: 20 },
    ]);
    expect(seen[0]).toMatchObject({ covered: 30, additional: 0, allowed: true });
    expect(seen[1]).toMatchObject({ covered: 10, additional: 10, allowed: true });
    // The overage is at washing's own rate.
    expect(seen[1].additionalPaise).toBe(10 * 6000);
  });

  it("refuses going beyond a service the plan says may not be exceeded", () => {
    const seen = assessOrder(plan, sub, [
      { serviceId: "iron", serviceName: "Ironing", unit: "piece", quantity: 35 },
    ]);
    expect(seen[0].allowed).toBe(false);
    expect(firstRefusal(seen)?.reason).toMatch(/does not allow going beyond it/);
  });

  it("refuses a day the plan does not collect that service on", () => {
    // A Wednesday, against a service collected Tuesdays and Fridays.
    const seen = assessOrder(plan, sub, [
      { serviceId: "dry", serviceName: "Dry cleaning", unit: "piece", quantity: 2 },
    ], "2026-03-04");
    expect(seen[0].allowed).toBe(false);
    expect(seen[0].reason).toMatch(/Tuesday and Friday/);
  });

  it("allows the same request on a day it does collect", () => {
    const seen = assessOrder(plan, sub, [
      { serviceId: "dry", serviceName: "Dry cleaning", unit: "piece", quantity: 2 },
    ], "2026-03-03");
    expect(seen[0].allowed).toBe(true);
    expect(firstRefusal(seen)).toBeNull();
  });

  it("leaves a service the plan does not name alone", () => {
    const seen = assessOrder(plan, sub, [
      { serviceId: "shoe_care", serviceName: "Shoe care", unit: "pair", quantity: 2 },
    ]);
    // Not covered, not refused: bought at the ordinary price like anyone else.
    expect(seen[0]).toMatchObject({ inPlan: false, allowed: true, covered: 0 });
  });
});
