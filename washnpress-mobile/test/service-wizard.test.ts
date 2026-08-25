import { describe, it, expect } from "vitest";
import {
  serviceProblemsAt, allServiceProblems, serviceBody, serviceDraftFrom,
  emptyServiceDraft, emptyPlanRule, emptyTimeSlot,
  SERVICE_STEPS,
  type ServiceDraft,
} from "../src/portals/service-wizard-rules";
import type { Plan } from "../src/api/types";

// A car wash, a carpet clean and an hour of ironing were all "an offering with a name
// and a price". Twelve steps, because a service is twelve decisions — and each one
// checks its own answers so a mistake is caught where it was made.

const plans = [
  { id: "basic", tier: "Basic", name: "Basic", garmentCap: 0, turnaroundHours: 48, monthlyPaise: 49900, annualDiscountPercent: 0 },
  { id: "premium", tier: "Premium", name: "Premium", garmentCap: 0, turnaroundHours: 24, monthlyPaise: 129900, annualDiscountPercent: 0 },
] as Plan[];

function draft(over: Partial<ServiceDraft> = {}): ServiceDraft {
  return {
    ...emptyServiceDraft(),
    name: "Carpet cleaning",
    category: "home_care",
    unit: "sqft",
    price: "12",
    planRules: plans.map(emptyPlanRule),
    ...over,
  };
}

describe("step 1 — what the service is", () => {
  it("wants a name and a category", () => {
    expect(serviceProblemsAt(0, draft())).toEqual([]);
    expect(serviceProblemsAt(0, draft({ name: " " })).join(" ")).toMatch(/name/);
    expect(serviceProblemsAt(0, draft({ category: "" })).join(" ")).toMatch(/category/);
  });
});

describe("step 2 — how it is measured", () => {
  it("refuses a maximum below the minimum", () => {
    expect(serviceProblemsAt(1, draft({ minimumQuantity: "400", maximumQuantity: "100" })).join(" "))
      .toMatch(/cannot be below the minimum/);
  });

  it("refuses an increment of zero", () => {
    expect(serviceProblemsAt(1, draft({ quantityIncrement: "0" })).join(" ")).toMatch(/greater than zero/);
  });

  it("is happy with no limits at all", () => {
    expect(serviceProblemsAt(1, draft())).toEqual([]);
  });
});

describe("step 3 — what it costs", () => {
  it("wants a price", () => {
    expect(serviceProblemsAt(2, draft({ price: "" })).join(" ")).toMatch(/needs a price|Give the service a price/);
  });

  it("allows a free service, which is zero rather than blank", () => {
    expect(serviceProblemsAt(2, draft({ price: "0" }))).toEqual([]);
  });
});

describe("steps 4 and 5 — what each plan does about it", () => {
  it("wants a price where a plan charges a fixed one", () => {
    const rules = plans.map(emptyPlanRule);
    rules[0] = { ...rules[0], mode: "fixed", price: "" };
    expect(serviceProblemsAt(3, draft({ planRules: rules })).join(" ")).toMatch(/Basic needs a price/);
  });

  it("wants a percentage between nought and a hundred", () => {
    const rules = plans.map(emptyPlanRule);
    rules[0] = { ...rules[0], mode: "percentage_discount", discountPercent: "150" };
    expect(serviceProblemsAt(3, draft({ planRules: rules })).join(" ")).toMatch(/between 0 and 100/);
  });

  it("wants an allowance and a frequency where a plan includes it", () => {
    const rules = plans.map(emptyPlanRule);
    rules[1] = { ...rules[1], mode: "included" };
    const problems = serviceProblemsAt(4, draft({ planRules: rules }));
    expect(problems.join(" ")).toMatch(/Premium needs an included quantity/);
    expect(problems.join(" ")).toMatch(/Premium needs a frequency/);
  });

  it("asks nothing of step 5 when no plan includes the service", () => {
    expect(serviceProblemsAt(4, draft())).toEqual([]);
  });

  it("wants a price for additional usage where it is allowed", () => {
    const rules = plans.map(emptyPlanRule);
    rules[1] = { ...rules[1], mode: "included", includedQuantity: "4", frequency: "weekly", additionalUsageAllowed: true, additionalRate: "" };
    expect(serviceProblemsAt(4, draft({ planRules: rules })).join(" ")).toMatch(/allows additional usage, so give it a price/);
  });
});

describe("step 6 — how often it may be booked", () => {
  it("is happy with no restriction", () => {
    expect(serviceProblemsAt(5, draft({ frequency: "" }))).toEqual([]);
  });

  it("insists twice a week names two days", () => {
    expect(serviceProblemsAt(5, draft({ frequency: "twice_weekly", frequencyDays: [2] })).join(" "))
      .toMatch(/two days/);
  });
});

describe("step 7 — where it is offered", () => {
  it("wants the societies named where the scope says selected societies", () => {
    expect(serviceProblemsAt(6, draft({ availabilityScope: "selected_societies", societyIds: [] })).join(" "))
      .toMatch(/Choose the societies/);
  });

  it("wants at least one operating day", () => {
    expect(serviceProblemsAt(6, draft({ operatingDays: [] })).join(" ")).toMatch(/operating day/);
  });
});

describe("step 8 — the windows", () => {
  it("refuses a window that ends before it starts", () => {
    const slot = { ...emptyTimeSlot("Morning"), startTime: "12:00", endTime: "09:00" };
    expect(serviceProblemsAt(7, draft({ timeSlots: [slot] })).join(" ")).toMatch(/start before it ends/);
  });

  it("refuses a window open to nobody", () => {
    const slot = { ...emptyTimeSlot("Evening"), subscriberAvailable: false, nonSubscriberAvailable: false };
    expect(serviceProblemsAt(7, draft({ timeSlots: [slot] })).join(" ")).toMatch(/available to nobody/);
  });

  it("insists an hourly service has windows to book into", () => {
    expect(serviceProblemsAt(7, draft({ unit: "hour", timeSlots: [] })).join(" "))
      .toMatch(/booked into time slots/);
    expect(serviceProblemsAt(7, draft({ unit: "hour", timeSlots: [emptyTimeSlot()] }))).toEqual([]);
  });
});

describe("step 9 — who it is for", () => {
  it("wants the eligible plans named where it is for subscribers only", () => {
    expect(serviceProblemsAt(8, draft({ eligibility: "subscriber", eligiblePlanIds: [] })).join(" "))
      .toMatch(/Choose which plans/);
  });

  it("wants a price where anybody can buy it", () => {
    expect(serviceProblemsAt(8, draft({ eligibility: "both", price: "" })).join(" "))
      .toMatch(/needs a price/);
  });
});

describe("step 10 — when it may be booked", () => {
  it("wants a notice period where advance booking is required", () => {
    expect(serviceProblemsAt(9, draft({ advanceBookingRequired: true, minAdvanceMinutes: "" })).join(" "))
      .toMatch(/how far ahead/);
  });

  it("asks nothing about notice where it is not required", () => {
    expect(serviceProblemsAt(9, draft({ advanceBookingRequired: false, minAdvanceMinutes: "" }))).toEqual([]);
  });

  it("wants a horizon", () => {
    expect(serviceProblemsAt(9, draft({ maxAdvanceDays: "0" })).join(" ")).toMatch(/how many days ahead/);
  });
});

describe("step 11 — the extras", () => {
  it("wants an amount on every charge added", () => {
    expect(serviceProblemsAt(10, draft({ charges: [{ kind: "home_visit", label: "Home visit", amount: "" }] })).join(" "))
      .toMatch(/needs an amount/);
  });
});

describe("step 12 — the whole thing at once", () => {
  it("says nothing about a service that is complete", () => {
    expect(allServiceProblems(draft())).toEqual([]);
  });

  it("gathers problems from every step, without repeating them", () => {
    const broken = draft({ name: "", category: "", price: "", maxAdvanceDays: "0" });
    const problems = allServiceProblems(broken);
    expect(problems.join(" ")).toMatch(/name/);
    expect(problems.join(" ")).toMatch(/category/);
    expect(problems.join(" ")).toMatch(/how many days ahead/);
    expect(new Set(problems).size).toBe(problems.length);
  });

  it("has one entry per step, and a review step at the end", () => {
    expect(SERVICE_STEPS).toHaveLength(12);
    expect(SERVICE_STEPS[11]).toBe("Review and create");
  });
});

describe("what the wizard actually sends", () => {
  it("turns rupees into paise once", () => {
    const body = serviceBody(draft({ price: "12.50", subscriberPrice: "10" }));
    expect(body.unitPricePaise).toBe(1250);
    expect(body.subscriberUnitPricePaise).toBe(1000);
  });

  it("sends nothing rather than zero for a limit nobody typed", () => {
    // Zero would mean "none allowed", which is not what an empty box means.
    const body = serviceBody(draft());
    expect(body.minimumQuantity).toBeNull();
    expect(body.maximumQuantity).toBeNull();
    expect((body.bookingRules as Record<string, unknown>).maxBookingsPerUser).toBeNull();
  });

  it("sends every plan, including the ones that do not get the service", () => {
    // A plan not getting a service is a decision, not an absence of one.
    const body = serviceBody(draft());
    expect((body.planRules as unknown[]).length).toBe(2);
    expect((body.planRules as { mode: string }[]).every((r) => r.mode === "not_available")).toBe(true);
  });

  it("keeps each plan's allowance in the service's own unit", () => {
    const rules = plans.map(emptyPlanRule);
    rules[1] = { ...rules[1], mode: "included", includedQuantity: "4", frequency: "weekly", frequencyDays: [1], additionalUsageAllowed: true, additionalRate: "150" };
    const body = serviceBody(draft({ unit: "hour", planRules: rules }));
    const premium = (body.planRules as Record<string, unknown>[])[1];
    expect(premium).toMatchObject({ includedQuantity: 4, frequency: "weekly", additionalRatePaise: 15000 });
  });
});

describe("editing an existing service", () => {
  it("reads it back into the same wizard", () => {
    const stored = {
      id: "carpet", name: "Carpet cleaning", category: "home_care", isActive: false,
      unit: "sqft", minimumQuantity: 50, maximumQuantity: 2000, quantityIncrement: 10,
      unitPricePaise: 1200, subscriberUnitPricePaise: 1000,
      planRules: [{ planId: "premium", planName: "Premium", mode: "included", includedQuantity: 200, frequency: "weekly", frequencyDays: [1], additionalUsageAllowed: true, additionalRatePaise: 900 }],
      operatingDays: [1, 2, 3], mode: "at_home", eligibility: "both",
      bookingRules: { advanceBookingRequired: true, minAdvanceMinutes: 240, maxAdvanceDays: 14, cancellationAllowed: true, cancellationDeadlineMinutes: 120, reschedulingAllowed: true },
      additionalCharges: [{ kind: "home_visit", label: "Home visit", amountPaise: 5000 }],
    };
    const read = serviceDraftFrom(stored, plans);
    expect(read).toMatchObject({
      name: "Carpet cleaning", category: "home_care", active: false, unit: "sqft",
      minimumQuantity: "50", price: "12", subscriberPrice: "10",
      minAdvanceMinutes: "240", operatingDays: [1, 2, 3],
    });
    expect(read.charges).toEqual([{ kind: "home_visit", label: "Home visit", amount: "50" }]);
    // Every plan gets a row, so a plan added after the service was created is not
    // silently left out of the form.
    expect(read.planRules.map((r) => r.planId)).toEqual(["basic", "premium"]);
    expect(read.planRules[0].mode).toBe("not_available");
    expect(read.planRules[1]).toMatchObject({ mode: "included", includedQuantity: "200", additionalRate: "9" });
  });

  it("survives a round trip through the body it sends", () => {
    const original = draft({ minimumQuantity: "50", quantityIncrement: "10", charges: [{ kind: "weekend", label: "Weekend charge", amount: "20" }] });
    const body = serviceBody(original);
    const read = serviceDraftFrom({ ...body, id: "x" }, plans);
    expect(read.name).toBe(original.name);
    expect(read.minimumQuantity).toBe("50");
    expect(read.quantityIncrement).toBe("10");
    expect(read.charges[0].amount).toBe("20");
  });
});
