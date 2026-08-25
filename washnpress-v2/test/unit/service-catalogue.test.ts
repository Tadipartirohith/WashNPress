import { describe, it, expect } from "vitest";
import {
  serviceProblems, checkQuantity, quoteService, checkBookingRules, checkCancellation,
  continuousStarts, hasContinuousAvailability, DEFAULT_BOOKING_RULES,
  type ServiceDefinition,
} from "../../src/domain/service-catalogue";

// A car wash, a carpet clean and an hour of ironing were all "an offering with a name
// and a price". That was enough to book one and no more: it could not say a car wash
// is per vehicle and carpet cleaning is per square foot, that ironing is sold in whole
// hours between one and four, or that Premium includes four hours a month.

function service(over: Partial<ServiceDefinition> = {}): ServiceDefinition & { unitPricePaise: number } {
  return {
    name: "Car washing", category: "vehicle_care", unit: "vehicle",
    unitPricePaise: 39900, eligibility: "both",
    ...over,
  } as ServiceDefinition & { unitPricePaise: number };
}

describe("a service has to say enough to be worth storing", () => {
  it("accepts one that does", () => {
    expect(serviceProblems(service())).toEqual([]);
  });

  it("names every problem at once", () => {
    const problems = serviceProblems({ name: "", unitPricePaise: -1 } as ServiceDefinition);
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(problems.join(" ")).toMatch(/needs a name/);
    expect(problems.join(" ")).toMatch(/needs a category/);
    expect(problems.join(" ")).toMatch(/measurement unit/);
  });

  it("refuses a maximum below the minimum", () => {
    expect(serviceProblems(service({ minimumQuantity: 4, maximumQuantity: 2 })).join(" "))
      .toMatch(/cannot be below the minimum/);
  });

  it("refuses a slot that ends before it starts, or is open to nobody", () => {
    const problems = serviceProblems(service({
      timeSlots: [
        { window: "Morning", startTime: "11:00", endTime: "09:00", capacity: 1, subscriberAvailable: true, nonSubscriberAvailable: true },
        { window: "Evening", startTime: "17:00", endTime: "20:00", capacity: 1, subscriberAvailable: false, nonSubscriberAvailable: false },
      ],
    }));
    expect(problems.join(" ")).toMatch(/start before it ends/);
    expect(problems.join(" ")).toMatch(/available to nobody/);
  });

  it("insists a plan that includes the service says how much and how often", () => {
    const problems = serviceProblems(service({
      planRules: [{ planId: "p", planName: "Premium", mode: "included" }],
    }));
    expect(problems.join(" ")).toMatch(/included quantity greater than zero/);
    expect(problems.join(" ")).toMatch(/needs a frequency/);
  });
});

describe("the quantities a service will accept", () => {
  const hourly = service({ unit: "hour", minimumQuantity: 1, maximumQuantity: 4, quantityIncrement: 1, unitPricePaise: 20000 });

  it("takes what is inside the range and on the increment", () => {
    expect(checkQuantity(hourly, 2).ok).toBe(true);
    expect(checkQuantity(hourly, 4).ok).toBe(true);
  });

  it("refuses less than the minimum and more than the maximum", () => {
    expect(checkQuantity(hourly, 0.5).reason).toMatch(/smallest booking/);
    expect(checkQuantity(hourly, 5).reason).toMatch(/largest booking/);
  });

  it("refuses something off the increment", () => {
    // Ironing sold in whole hours does not take ninety minutes.
    expect(checkQuantity(hourly, 1.5).reason).toMatch(/steps of/);
  });

  it("measures the increment from the minimum, not from zero", () => {
    const halves = service({ unit: "hour", minimumQuantity: 1.5, quantityIncrement: 0.5 });
    expect(checkQuantity(halves, 2).ok).toBe(true);
    expect(checkQuantity(halves, 2.25).ok).toBe(false);
  });
});

describe("what a booking costs, with everything applied", () => {
  it("is the ordinary price with no plan", () => {
    const quote = quoteService(service(), { quantity: 1 });
    expect(quote.totalPaise).toBe(39900);
    expect(quote.planMode).toBeNull();
  });

  it("charges nothing inside a plan's allowance", () => {
    const withPlan = service({
      unit: "hour", unitPricePaise: 20000,
      planRules: [{
        planId: "premium", planName: "Premium", mode: "included",
        includedQuantity: 4, frequency: "weekly", frequencyDays: [], additionalUsageAllowed: true, additionalRatePaise: 15000,
      }],
    });
    const quote = quoteService(withPlan, { quantity: 2, planId: "premium", usedQuantity: 0 });
    expect(quote.coveredQuantity).toBe(2);
    expect(quote.chargeableQuantity).toBe(0);
    expect(quote.totalPaise).toBe(0);
  });

  it("charges this plan's own rate beyond the allowance", () => {
    const withPlan = service({
      unit: "hour", unitPricePaise: 20000,
      planRules: [{
        planId: "premium", planName: "Premium", mode: "included",
        includedQuantity: 4, frequency: "weekly", additionalUsageAllowed: true, additionalRatePaise: 15000,
      }],
    });
    // Three used already, so one of the two asked for is covered.
    const quote = quoteService(withPlan, { quantity: 2, planId: "premium", usedQuantity: 3 });
    expect(quote.coveredQuantity).toBe(1);
    expect(quote.chargeableQuantity).toBe(1);
    // ₹150, not the ₹200 an hour costs without a plan.
    expect(quote.totalPaise).toBe(15000);
  });

  it("refuses going beyond an allowance a plan does not let you exceed", () => {
    const withPlan = service({
      unit: "hour", unitPricePaise: 20000,
      planRules: [{
        planId: "basic", planName: "Basic", mode: "included",
        includedQuantity: 2, frequency: "weekly", additionalUsageAllowed: false,
      }],
    });
    const quote = quoteService(withPlan, { quantity: 3, planId: "basic", usedQuantity: 0 });
    expect(quote.available).toBe(false);
    expect(quote.reason).toMatch(/does not allow going beyond it/);
  });

  it("applies a fixed plan price, and a percentage discount, per plan", () => {
    const withPlans = service({
      planRules: [
        { planId: "basic", planName: "Basic", mode: "fixed", pricePaise: 30000 },
        { planId: "standard", planName: "Standard", mode: "percentage_discount", discountPercent: 25 },
      ],
    });
    expect(quoteService(withPlans, { quantity: 1, planId: "basic" }).totalPaise).toBe(30000);
    expect(quoteService(withPlans, { quantity: 1, planId: "standard" }).totalPaise).toBe(Math.round(39900 * 0.75));
  });

  it("says outright when a plan does not offer the service at all", () => {
    const withPlans = service({ planRules: [{ planId: "basic", planName: "Basic", mode: "not_available" }] });
    const quote = quoteService(withPlans, { quantity: 1, planId: "basic" });
    expect(quote.available).toBe(false);
    expect(quote.reason).toMatch(/does not include this service/);
  });

  it("refuses a day the plan does not collect it on", () => {
    const withPlans = service({
      planRules: [{
        planId: "premium", planName: "Premium", mode: "included",
        includedQuantity: 4, frequency: "twice_weekly", frequencyDays: [2, 5], additionalUsageAllowed: true, additionalRatePaise: 100,
      }],
    });
    // 2026-03-04 is a Wednesday.
    const quote = quoteService(withPlans, { quantity: 1, planId: "premium", date: "2026-03-04" });
    expect(quote.available).toBe(false);
    expect(quote.reason).toMatch(/Tuesday and Friday/);
  });

  it("adds the extras that actually apply, and only those", () => {
    const withCharges = service({
      unitPricePaise: 20000, unit: "hour",
      additionalCharges: [
        { kind: "home_visit", label: "Home visit", amountPaise: 5000 },
        { kind: "weekend", label: "Weekend charge", amountPaise: 2000 },
        { kind: "emergency", label: "Emergency", amountPaise: 10000 },
      ],
    });
    // A Wednesday, at home, not urgent: the home visit applies and nothing else.
    const weekday = quoteService(withCharges, { quantity: 2, date: "2026-03-04", atHome: true });
    expect(weekday.charges.map((c) => c.kind)).toEqual(["home_visit"]);
    expect(weekday.totalPaise).toBe(40000 + 5000);

    // A Saturday adds the weekend charge on top.
    const weekend = quoteService(withCharges, { quantity: 2, date: "2026-03-07", atHome: true });
    expect(weekend.charges.map((c) => c.kind).sort()).toEqual(["home_visit", "weekend"]);
    expect(weekend.totalPaise).toBe(40000 + 5000 + 2000);
  });

  it("charges an additional-quantity extra per unit beyond the allowance", () => {
    const withCharges = service({
      unit: "hour", unitPricePaise: 20000,
      planRules: [{ planId: "p", planName: "P", mode: "included", includedQuantity: 1, frequency: "weekly", additionalUsageAllowed: true, additionalRatePaise: 15000 }],
      additionalCharges: [{ kind: "additional_unit", label: "Additional hour", amountPaise: 1000 }],
    });
    const quote = quoteService(withCharges, { quantity: 3, planId: "p", usedQuantity: 0 });
    expect(quote.chargeableQuantity).toBe(2);
    // Two hours at the plan's rate, plus the per-hour extra twice.
    expect(quote.totalPaise).toBe(2 * 15000 + 2 * 1000);
  });
});

describe("when a booking may be made", () => {
  const now = new Date("2026-03-04T09:00:00.000Z");
  const rules = { bookingRules: { ...DEFAULT_BOOKING_RULES, minAdvanceMinutes: 120, maxAdvanceDays: 7 } };

  it("refuses one made with too little notice", () => {
    const check = checkBookingRules(rules, { scheduledFor: "2026-03-04T10:00:00.000Z", now });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/at least 2 hours ahead/);
  });

  it("accepts one made with enough", () => {
    expect(checkBookingRules(rules, { scheduledFor: "2026-03-04T12:00:00.000Z", now }).ok).toBe(true);
  });

  it("refuses one too far ahead", () => {
    const check = checkBookingRules(rules, { scheduledFor: "2026-04-04T12:00:00.000Z", now });
    expect(check.reason).toMatch(/at most 7 days ahead/);
  });

  it("refuses a day the service does not operate on", () => {
    // Weekdays only; 2026-03-07 is a Saturday.
    const check = checkBookingRules({ ...rules, operatingDays: [1, 2, 3, 4, 5] }, { scheduledFor: "2026-03-07T12:00:00.000Z", now });
    expect(check.reason).toMatch(/only done on/);
  });

  it("refuses somebody who already has as many as they may have", () => {
    const capped = { bookingRules: { ...DEFAULT_BOOKING_RULES, maxBookingsPerUser: 2 } };
    const check = checkBookingRules(capped, { scheduledFor: "2026-03-06T12:00:00.000Z", now, existingBookings: 2 });
    expect(check.reason).toMatch(/already have 2/);
  });
});

describe("when a booking may still be cancelled", () => {
  const now = new Date("2026-03-04T09:00:00.000Z");

  it("accepts one well before the deadline", () => {
    expect(checkCancellation({ bookingRules: DEFAULT_BOOKING_RULES }, { scheduledFor: "2026-03-04T15:00:00.000Z", now }).ok).toBe(true);
  });

  it("refuses one inside it", () => {
    const check = checkCancellation({ bookingRules: DEFAULT_BOOKING_RULES }, { scheduledFor: "2026-03-04T09:30:00.000Z", now });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/up to 1 hour before/);
  });

  it("refuses outright where the service does not allow cancelling", () => {
    const check = checkCancellation({ bookingRules: { ...DEFAULT_BOOKING_RULES, cancellationAllowed: false } }, { scheduledFor: "2026-03-09T09:00:00.000Z", now });
    expect(check.reason).toMatch(/cannot be cancelled/);
  });
});

describe("an hourly booking needs consecutive hours", () => {
  const windows = [
    { startTime: "09:00", endTime: "10:00", capacityRemaining: 1 },
    { startTime: "10:00", endTime: "11:00", capacityRemaining: 0 },
    { startTime: "11:00", endTime: "12:00", capacityRemaining: 1 },
    { startTime: "12:00", endTime: "13:00", capacityRemaining: 1 },
  ];

  it("offers every open hour for a one hour booking", () => {
    expect(continuousStarts(windows, 1)).toEqual(["09:00", "11:00", "12:00"]);
  });

  it("offers only a run of two for a two hour booking", () => {
    // 09:00 cannot work because 10:00 is taken.
    expect(continuousStarts(windows, 2)).toEqual(["11:00"]);
  });

  it("offers nothing where no run is long enough", () => {
    expect(continuousStarts(windows, 3)).toEqual([]);
    expect(hasContinuousAvailability(windows, 2, "09:00")).toBe(false);
    expect(hasContinuousAvailability(windows, 2, "11:00")).toBe(true);
  });

  it("does not treat a gap in the day as continuous", () => {
    const gapped = [
      { startTime: "09:00", endTime: "10:00", capacityRemaining: 1 },
      { startTime: "14:00", endTime: "15:00", capacityRemaining: 1 },
    ];
    expect(continuousStarts(gapped, 2)).toEqual([]);
  });
});
