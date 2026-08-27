import { describe, it, expect } from "vitest";
import {
  serviceProblemsAt, allServiceProblems, serviceBody, serviceDraftFrom,
  emptyServiceDraft, emptyPlanRule,
  eligibilityFor, offeredToSubscribers, offeredToOthers, unitForCategory,
  SERVICE_STEPS,
  type ServiceDraft,
} from "../src/portals/service-wizard-rules";
import type { Plan } from "../src/api/types";

// A service is a list of decisions, asked a step at a time, and each step checks its
// own answers so a mistake is caught where it was made.
//
// There used to be sixteen steps. Four of them described one arrangement between
// them — who a service is for, what a subscriber pays, how often, and what each plan
// includes — so reading any one told you a quarter of the answer. They are one step
// now, and the ones nobody was answering are gone.

const plans = [
  { id: "basic", tier: "Basic", name: "Basic", garmentCap: 0, turnaroundHours: 48, monthlyPaise: 49900, annualDiscountPercent: 0 },
  { id: "premium", tier: "Premium", name: "Premium", garmentCap: 0, turnaroundHours: 24, monthlyPaise: 129900, annualDiscountPercent: 0 },
] as Plan[];

// Which step a rule belongs to, by name. Hard-coded positions moved a rule onto
// the wrong screen the moment a step was inserted before it.
function at(name: (typeof SERVICE_STEPS)[number], over: Partial<ServiceDraft> = {}): string[] {
  return serviceProblemsAt(SERVICE_STEPS.indexOf(name), draft(over));
}

function draft(over: Partial<ServiceDraft> = {}): ServiceDraft {
  return {
    ...emptyServiceDraft(),
    name: "Carpet cleaning",
    category: "home_care",
    unit: "job",
    price: "12",
    planRules: plans.map(emptyPlanRule),
    ...over,
  };
}

describe("step 1 — what the service is", () => {
  it("wants a name and a category", () => {
    expect(at("Basic details")).toEqual([]);
    expect(at("Basic details", { name: " " }).join(" ")).toMatch(/name/);
    expect(at("Basic details", { category: "" }).join(" ")).toMatch(/category/);
  });
});

describe("what a service is measured in", () => {
  it("follows from what the service is, rather than being a screen of its own", () => {
    // A vehicle service is per vehicle; everything else is a fixed price for the
    // job. Asking was a step that only ever had one right answer.
    expect(unitForCategory("vehicle_care")).toBe("vehicle");
    expect(unitForCategory("home_care")).toBe("job");
    expect(unitForCategory("other")).toBe("job");
  });
});

describe("step 1 — what the service is", () => {
  it("asks for a vehicle type only where one means something", () => {
    expect(at("Basic details", { category: "vehicle_care", vehicleTypes: [] }).join(" "))
      .toMatch(/bike or a car/);
    expect(at("Basic details", { category: "vehicle_care", vehicleTypes: ["Car"] })).toEqual([]);
    // A carpet clean is neither.
    expect(at("Basic details", { category: "home_care", vehicleTypes: [] })).toEqual([]);
  });
});

describe("who it is for, as the two things it is offered to", () => {
  it("reads two boxes as the three arrangements they describe", () => {
    expect(eligibilityFor(true, true)).toBe("both");
    expect(eligibilityFor(true, false)).toBe("subscriber");
    expect(eligibilityFor(false, true)).toBe("non_subscriber");
    // Neither ticked is a service offered to nobody, which is not an arrangement.
    expect(eligibilityFor(false, false)).toBe("");
  });

  it("reads them back the same way", () => {
    expect(offeredToSubscribers("both")).toBe(true);
    expect(offeredToSubscribers("non_subscriber")).toBe(false);
    expect(offeredToOthers("both")).toBe(true);
    expect(offeredToOthers("subscriber")).toBe(false);
  });
});

describe("step 2 — who it is for, what they pay, and how often", () => {
  it("refuses a service offered to nobody", () => {
    expect(at("Customer and pricing", { eligibility: "" }).join(" ")).toMatch(/offered to nobody/);
  });

  it("wants a price where anybody without a plan can buy it", () => {
    expect(at("Customer and pricing", { eligibility: "both", price: "" }).join(" "))
      .toMatch(/needs a price/);
  });

  it("allows a free service, which is zero rather than blank", () => {
    expect(at("Customer and pricing", { price: "0" })).toEqual([]);
  });

  it("asks nothing about a non-subscriber price where nobody without a plan may buy it", () => {
    expect(at("Customer and pricing", {
      eligibility: "subscriber", eligiblePlanIds: ["basic"], price: "",
    })).toEqual([]);
  });

  it("wants the eligible plans named where it is for subscribers only", () => {
    expect(at("Customer and pricing", { eligibility: "subscriber", eligiblePlanIds: [] }).join(" "))
      .toMatch(/Choose which plans/);
  });

  it("wants a price where a plan charges a fixed one", () => {
    const rules = plans.map(emptyPlanRule);
    rules[0] = { ...rules[0], mode: "fixed", price: "" };
    expect(at("Customer and pricing", { planRules: rules }).join(" ")).toMatch(/Basic needs a price/);
  });

  it("wants a percentage between nought and a hundred", () => {
    const rules = plans.map(emptyPlanRule);
    rules[0] = { ...rules[0], mode: "percentage_discount", discountPercent: "150" };
    expect(at("Customer and pricing", { planRules: rules }).join(" ")).toMatch(/between 0 and 100/);
  });

  it("wants an allowance and a frequency where a plan includes it", () => {
    const rules = plans.map(emptyPlanRule);
    rules[1] = { ...rules[1], mode: "included" };
    const problems = at("Customer and pricing", { planRules: rules });
    expect(problems.join(" ")).toMatch(/Premium needs an included quantity/);
    expect(problems.join(" ")).toMatch(/Premium needs a frequency/);
  });

  it("wants a price for additional usage where it is allowed", () => {
    const rules = plans.map(emptyPlanRule);
    rules[1] = { ...rules[1], mode: "included", includedQuantity: "4", frequency: "weekly", additionalUsageAllowed: true, additionalRate: "" };
    expect(at("Customer and pricing", { planRules: rules }).join(" ")).toMatch(/allows additional usage, so give it a price/);
  });

  it("insists twice a week names two days", () => {
    expect(at("Customer and pricing", { frequency: "twice_weekly", frequencyDays: [2] }).join(" "))
      .toMatch(/two days/);
  });

  it("is happy with no frequency restriction at all", () => {
    expect(at("Customer and pricing", { frequency: "" })).toEqual([]);
  });
});

describe("step 3 — where it is offered", () => {
  it("wants the societies named where the scope says selected societies", () => {
    expect(at("Availability", { availabilityScope: "selected_societies", societyIds: [] }).join(" "))
      .toMatch(/Choose the societies/);
  });

  it("wants at least one operating day", () => {
    expect(at("Availability", { operatingDays: [] }).join(" ")).toMatch(/operating day/);
  });
});

describe("step 5 — the extras", () => {
  it("wants an amount on every charge added", () => {
    expect(at("Additional charges", { charges: [{ kind: "home_visit", label: "Home visit", amount: "" }] }).join(" "))
      .toMatch(/needs an amount/);
  });
});

describe("step 7 — the whole thing at once", () => {
  it("says nothing about a service that is complete", () => {
    expect(allServiceProblems(draft())).toEqual([]);
  });

  it("gathers problems from every step, without repeating them", () => {
    const broken = draft({ name: "", category: "", price: "", operatingDays: [] });
    const problems = allServiceProblems(broken);
    expect(problems.join(" ")).toMatch(/name/);
    expect(problems.join(" ")).toMatch(/category/);
    expect(problems.join(" ")).toMatch(/operating day/);
    expect(new Set(problems).size).toBe(problems.length);
  });

  it("numbers its steps with no gaps where a step was removed", () => {
    // Five of the sixteen were deleted outright and four were merged. Leaving the
    // survivors at their old positions would show Step 1, Step 4, Step 8.
    expect(SERVICE_STEPS.length).toBe(7);
  });

  it("ends with the review, and names each step once", () => {
    // The count is not the point; that the last step is the review is, because
    // nothing is published before somebody has seen the whole configuration.
    expect(SERVICE_STEPS[SERVICE_STEPS.length - 1]).toBe("Review and publish");
    expect(new Set(SERVICE_STEPS).size).toBe(SERVICE_STEPS.length);
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
