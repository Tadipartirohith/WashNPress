import { describe, it, expect } from "vitest";
import type { Plan, Subscription } from "../../src/domain/models";
import {
  allowances, allowanceFor, decideCoverage, recordUsage, rollCycle,
  AllowanceLedger, applyLedger, planIncludes,
} from "../../src/domain/plan-usage";

// The rule the requirements state most plainly, and the one a single shared garment
// cap could not keep: usage of one service must never reduce another's.

function rule(serviceId: string, serviceName: string, unit: "kg" | "piece", included: number, overage: number, extra = {}) {
  return {
    serviceId, serviceName, unit, includedQuantity: included,
    frequency: "weekly" as const, frequencyDays: [1],
    maxPerFrequency: null, maxPerCycle: null, carryForward: false,
    additionalUsage: "pay_per_use" as const, additionalRatePaise: overage,
    ...extra,
  };
}

const plan = {
  id: "plan-t", tier: "Test", garmentCap: 100, turnaroundHours: 24,
  services: [
    rule("wash", "Washing", "kg", 40, 6000),
    rule("iron", "Ironing", "piece", 30, 1500),
    rule("dryclean", "Dry cleaning", "piece", 5, 9000, { additionalUsage: "block" as const }),
    rule("carpet", "Carpet cleaning", "piece", 2, 25000, { additionalUsage: "admin_approval" as const }),
  ],
  monthlyPaise: 99900, annualDiscountPercent: 0, isActive: true,
} as unknown as Plan;

function subscription(usage: Record<string, number> = {}, carried: Record<string, number> = {}): Subscription {
  return {
    id: "sub-t", residentId: "res-t", planId: "plan-t", status: "active", cycle: "monthly",
    cycleStart: "2026-01-01T00:00:00.000Z", cycleEnd: "2026-02-01T00:00:00.000Z",
    garmentsUsed: 0, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
    serviceUsage: usage, carriedForward: carried,
  } as unknown as Subscription;
}

describe("each service has its own allowance in its own unit", () => {
  it("reports every covered service separately", () => {
    const shown = allowances(plan, subscription({ wash: 12 }));
    expect(shown.map((a) => `${a.serviceName}: ${a.remaining} ${a.unit}`)).toEqual([
      "Washing: 28 kg", "Ironing: 30 piece", "Dry cleaning: 5 piece", "Carpet cleaning: 2 piece",
    ]);
    expect(shown[0].remainingLabel).toBe("28 kg of 40 kg remaining");
  });

  it("does not let one service spend another's allowance", () => {
    // Thirty pieces of ironing, and washing is untouched by it.
    const after = recordUsage(subscription(), "iron", "piece", 30);
    expect(allowanceFor(plan, after, "iron")!.remaining).toBe(0);
    expect(allowanceFor(plan, after, "wash")!.remaining).toBe(40);
  });

  it("says nothing about a service the plan does not name", () => {
    expect(planIncludes(plan, "shoe_care")).toBe(false);
    expect(allowanceFor(plan, subscription(), "shoe_care")).toBeNull();
    expect(decideCoverage(plan, subscription(), "shoe_care", 2)).toBeNull();
  });
});

describe("asking for more than the plan includes", () => {
  it("charges the excess at that service's own rate, not one rate for everything", () => {
    const decision = decideCoverage(plan, subscription({ wash: 38 }), "wash", 5)!;
    expect(decision.split).toMatchObject({ covered: 2, additional: 3 });
    // Three kilograms over, at washing's 60.00 — not at dry cleaning's 90.00.
    expect(decision.additionalPaise).toBe(3 * 6000);
    expect(decision.allowed).toBe(true);
  });

  it("refuses outright where the plan says it may not be exceeded", () => {
    const decision = decideCoverage(plan, subscription({ dryclean: 5 }), "dryclean", 1)!;
    expect(decision.allowed).toBe(false);
    expect(decision.needsApproval).toBe(false);
    expect(decision.reason).toMatch(/does not allow going beyond it/);
  });

  it("asks for approval where the plan says so, and prices what it would cost", () => {
    const decision = decideCoverage(plan, subscription({ carpet: 2 }), "carpet", 1)!;
    expect(decision.allowed).toBe(false);
    expect(decision.needsApproval).toBe(true);
    expect(decision.additionalPaise).toBe(25000);
  });
});

describe("carrying an allowance into the next cycle", () => {
  const carryPlan = {
    ...plan,
    services: [rule("wash", "Washing", "kg", 40, 6000, { carryForward: true }), rule("iron", "Ironing", "piece", 30, 1500)],
  } as unknown as Plan;

  it("keeps what the plan allows to be kept and clears the rest", () => {
    const rolled = rollCycle(carryPlan, subscription({ wash: 25, iron: 10 }));
    // Fifteen kilograms of washing survive; the unused ironing does not.
    expect(rolled.carriedForward).toEqual({ wash: 15 });
    expect(rolled.serviceUsage).toEqual({});
    expect(allowanceFor(carryPlan, rolled, "wash")!.remaining).toBe(55);
  });

  it("never carries more than one cycle's worth", () => {
    const rolled = rollCycle(carryPlan, subscription({}, { wash: 40 }));
    // Forty carried plus forty included, all unused — still only forty carries again.
    expect(rolled.carriedForward!.wash).toBe(40);
  });
});

describe("the ledger, across several lines of one order", () => {
  it("draws one balance down rather than giving each line the full allowance", () => {
    const ledger = new AllowanceLedger(plan, subscription());
    // Shirts and bedsheets, both washed, in the same order.
    expect(ledger.take("wash", 30)).toMatchObject({ covered: 30, additional: 0 });
    expect(ledger.take("wash", 20)).toMatchObject({ covered: 10, additional: 10 });
  });

  it("keeps services apart while doing it", () => {
    const ledger = new AllowanceLedger(plan, subscription());
    ledger.take("wash", 40);
    expect(ledger.take("iron", 10)).toMatchObject({ covered: 10, additional: 0 });
  });

  it("writes back only what each service actually used", () => {
    const sub = subscription();
    const ledger = new AllowanceLedger(plan, sub);
    ledger.take("wash", 12.5);
    ledger.take("iron", 4);
    applyLedger(sub, ledger);
    expect(sub.serviceUsage).toEqual({ wash: 12.5, iron: 4 });
  });

  it("is inactive for a plan written before per-service allowances existed", () => {
    const legacy = { ...plan, services: undefined } as unknown as Plan;
    expect(new AllowanceLedger(legacy, subscription()).active).toBe(false);
  });
});
