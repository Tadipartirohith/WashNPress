import { describe, it, expect } from "vitest";
import { problemsAt, emptyDraft, rules, STEPS, type Draft, type DraftService } from "../src/portals/plan-wizard-rules";

// A plan is a name, a price, a validity, and a set of services each with an allowance
// and a rule for going past it. It used to also ask for a turnaround, a cadence per
// service, a per-collection ceiling and a carry-forward toggle; those are gone — an
// allowance is a quantity per cycle, and the extra questions only got in the way.
//
// The step is named rather than numbered, because a position moves the moment a step
// is added and nothing fails to compile when it does.

const at = (name: (typeof STEPS)[number]) => STEPS.indexOf(name);
const setup = at("Plan and services");

function service(over: Partial<DraftService> = {}): DraftService {
  return {
    serviceId: "wash_iron", serviceName: "Wash and Iron", unit: "kg",
    includedQuantity: "40", frequency: "daily", frequencyDays: [],
    maxPerFrequency: "", carryForward: false,
    additionalUsage: "pay_per_use", additionalRate: "50",
    ...over,
  };
}

function draft(over: Partial<Draft> = {}): Draft {
  return { ...emptyDraft(), name: "Premium Care", price: "1299", services: [service()], ...over };
}

describe("two steps, not six", () => {
  it("sets the plan up and then reviews it", () => {
    expect([...STEPS]).toEqual(["Plan and services", "Review and create"]);
  });

  it("asks nothing of the review that the setup step did not already ask", () => {
    expect(problemsAt(at("Review and create"), draft({ name: "", services: [] }))).toEqual([]);
  });
});

describe("the plan itself", () => {
  it("wants a name and a price greater than zero", () => {
    expect(problemsAt(setup, draft())).toEqual([]);
    expect(problemsAt(setup, draft({ name: "   " })).join(" ")).toMatch(/name/);
    expect(problemsAt(setup, draft({ price: "" })).join(" ")).toMatch(/price/);
    // A plan has to cost something: a price of zero is refused, not a free plan.
    expect(problemsAt(setup, draft({ price: "0" })).join(" ")).toMatch(/price/);
  });

  it("holds tax and discount to a percentage", () => {
    expect(problemsAt(setup, draft({ taxPercent: "150" })).join(" ")).toMatch(/tax/i);
    expect(problemsAt(setup, draft({ discountPercent: "-5" })).join(" ")).toMatch(/discount/i);
    expect(problemsAt(setup, draft({ taxPercent: "5", discountPercent: "10" }))).toEqual([]);
  });

  it("no longer asks for a turnaround", () => {
    // The field is gone from the flow entirely; a plan with a zero turnaround is fine.
    expect(problemsAt(setup, draft({ turnaround: "0" }))).toEqual([]);
  });
});

describe("the services it is made of", () => {
  it("wants at least one", () => {
    expect(problemsAt(setup, draft({ services: [] }))).toContain("Choose at least one service.");
  });

  it("refuses the same service twice", () => {
    expect(problemsAt(setup, draft({ services: [service(), service()] })).join(" ")).toMatch(/more than once/);
  });

  it("wants an allowance greater than zero for each", () => {
    expect(problemsAt(setup, draft({ services: [service({ includedQuantity: "0" })] })).join(" ")).toMatch(/allowance/);
    expect(problemsAt(setup, draft({ services: [service({ includedQuantity: "" })] })).join(" ")).toMatch(/allowance/);
  });

  it("does not ask for a cadence any more", () => {
    // Frequency and days are gone from a plan; an allowance is a quantity per cycle.
    expect(problemsAt(setup, draft({ services: [service({ frequency: "twice_weekly", frequencyDays: [] })] }))).toEqual([]);
    expect(problemsAt(setup, draft({ services: [service({ frequency: "weekly", frequencyDays: [] })] }))).toEqual([]);
  });

  it("wants a rate where extra usage is charged for", () => {
    expect(problemsAt(setup, draft({ services: [service({ additionalUsage: "pay_per_use", additionalRate: "" })] })).join(" "))
      .toMatch(/give it a rate/);
  });

  it("wants no rate where extra usage is not allowed at all", () => {
    expect(problemsAt(setup, draft({ services: [service({ additionalUsage: "block", additionalRate: "" })] }))).toEqual([]);
  });

  it("refuses a negative charge", () => {
    expect(problemsAt(setup, draft({ services: [service({ additionalRate: "-5" })] })).join(" "))
      .toMatch(/negative/);
  });
});

describe("what the wizard actually sends", () => {
  it("converts rupees to paise and keeps each service in its own unit", () => {
    const sent = rules(draft({
      services: [
        service({ serviceId: "wash_iron", unit: "kg", includedQuantity: "40", additionalRate: "50" }),
        service({ serviceId: "iron_only", serviceName: "Iron only", unit: "piece", includedQuantity: "30", additionalRate: "10" }),
      ],
    }));
    expect(sent[0]).toMatchObject({ serviceId: "wash_iron", unit: "kg", includedQuantity: 40, additionalRatePaise: 5000 });
    expect(sent[1]).toMatchObject({ serviceId: "iron_only", unit: "piece", includedQuantity: 30, additionalRatePaise: 1000 });
  });

  it("sends fixed, unrestrictive values for the fields a plan no longer configures", () => {
    // Frequency, per-collection ceiling and carry-forward are not asked for, so they
    // are always sent the same non-restrictive way regardless of any stale draft value.
    const sent = rules(draft({ services: [service({ frequency: "twice_weekly", frequencyDays: [2, 5], maxPerFrequency: "5", carryForward: true })] }));
    expect(sent[0].frequency).toBe("daily");
    expect(sent[0].frequencyDays).toEqual([]);
    expect(sent[0].maxPerFrequency).toBeNull();
    expect(sent[0].carryForward).toBe(false);
  });
});
