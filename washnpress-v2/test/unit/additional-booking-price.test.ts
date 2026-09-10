import { describe, it, expect } from "vitest";
import type { Plan, Subscription } from "../../src/domain/models";
import { assessOrder, decideCoverage } from "../../src/domain/plan-usage";

// What a plan charges for going past its allowance is the plan's own number.
//
// It was never asked for. The web wizard took the rate from the service catalogue
// for weighed services and set it to zero for per-piece ones, so every per-piece
// plan shipped giving overage away free; mobile pre-filled the field with the
// service price, and a pre-filled field is a field nobody reads. The rate is typed
// now, per plan and per service, and this is what it buys: the charge follows the
// plan, not the price list.

const plan = (additionalRatePaise: number, includedQuantity = 20, unit: "kg" | "piece" = "kg"): Plan => ({
  id: "plan-x", tier: "custom", turnaroundHours: 48, garmentCap: includedQuantity,
  monthlyPaise: 600000, annualDiscountPercent: 0, isActive: true,
  coveredServiceIds: ["wash-iron"],
  services: [{
    serviceId: "wash-iron", serviceName: "Wash and Iron", unit,
    includedQuantity, frequency: "daily", frequencyDays: [],
    maxPerFrequency: null, maxPerCycle: null, carryForward: false,
    additionalUsage: "pay_per_use", additionalRatePaise,
  }],
} as Plan);

const subscription = (used = 0): Subscription => ({
  id: "sub-x", residentId: "res-x", planId: "plan-x", status: "active",
  cycle: "monthly", cycleStart: "2026-09-01", cycleEnd: "2026-09-30",
  garmentsUsed: used, autoRenew: true,
  serviceUsage: { "wash-iron": used },
  pendingPlanId: null, pauseUntil: null, cancelReason: null,
});

describe("charging for what the plan did not include", () => {
  it("works the example out of the issue", () => {
    // 20 KG included, ₹100/KG beyond it, 25 KG used → 5 KG extra → ₹500.
    const decision = decideCoverage(plan(10000), subscription(), "wash-iron", 25);
    expect(decision!.split.covered).toBe(20);
    expect(decision!.split.additional).toBe(5);
    expect(decision!.additionalPaise).toBe(50000);
    expect(decision!.allowed).toBe(true);
  });

  it("uses the plan's rate rather than what the service costs on the list", () => {
    // The point of the field. Two plans including the same service can charge
    // differently for going over it, and neither has to match the catalogue.
    const cheap = decideCoverage(plan(5000), subscription(), "wash-iron", 25);
    const dear = decideCoverage(plan(15000), subscription(), "wash-iron", 25);
    expect(cheap!.additionalPaise).toBe(25000);
    expect(dear!.additionalPaise).toBe(75000);
  });

  it("charges nothing extra while the allowance covers it", () => {
    const decision = decideCoverage(plan(10000), subscription(), "wash-iron", 18);
    expect(decision!.split.additional).toBe(0);
    expect(decision!.additionalPaise).toBe(0);
  });

  it("counts from what has already been used this cycle", () => {
    // 20 included, 18 already used, 5 more asked for: 2 covered and 3 charged.
    const decision = decideCoverage(plan(10000), subscription(18), "wash-iron", 5);
    expect(decision!.split.covered).toBe(2);
    expect(decision!.split.additional).toBe(3);
    expect(decision!.additionalPaise).toBe(30000);
  });

  it("prices a per-piece service by the piece", () => {
    // The unit follows the service, so ₹15 a piece over a 50-piece allowance is
    // ₹75 for five pieces — and is charged at all, which a rate of zero is not.
    const decision = decideCoverage(plan(1500, 50, "piece"), subscription(), "wash-iron", 55);
    expect(decision!.split.additional).toBe(5);
    expect(decision!.additionalPaise).toBe(7500);
  });

  it("charges nothing when the rate is zero, which is why it may not be left empty", () => {
    // This was the state every per-piece plan shipped in: overage allowed, and free.
    const decision = decideCoverage(plan(0, 50, "piece"), subscription(), "wash-iron", 55);
    expect(decision!.split.additional).toBe(5);
    expect(decision!.additionalPaise).toBe(0);
  });

  it("carries the plan's rate through a whole order", () => {
    const [line] = assessOrder(plan(10000), subscription(), [
      { serviceId: "wash-iron", serviceName: "Wash and Iron", unit: "kg", quantity: 25 },
    ]);
    expect(line.additionalPaise).toBe(50000);
    expect(line.allowed).toBe(true);
  });
});
