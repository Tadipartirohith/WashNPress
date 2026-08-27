import { describe, it, expect } from "vitest";
import { problemsAt, emptyDraft, rules, STEPS, type Draft, type DraftService } from "../src/portals/plan-wizard-rules";

// A plan used to be a name, one garment allowance, a turnaround and a price. It is
// now a set of services each configured on its own terms.
//
// That took six steps, five of which walked the same list of services from a
// different angle each time — which ones, in what unit, how often, and what happens
// past the allowance. Somebody configuring three services walked the list four
// times. It is one step now, so the checks that were spread across five run in one
// place; the step is named rather than numbered, because a position moves the
// moment a step is added and nothing fails to compile when it does.

// The index of a step, by name.
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
  return { ...emptyDraft(), name: "Premium Care", price: "1299", turnaround: "48", services: [service()], ...over };
}

describe("two steps, not six", () => {
  it("sets the plan up and then reviews it", () => {
    expect([...STEPS]).toEqual(["Plan and services", "Review and create"]);
  });

  it("asks nothing of the review that the setup step did not already ask", () => {
    // The review is where somebody looks at what they built, not another gate.
    expect(problemsAt(at("Review and create"), draft({ name: "", services: [] }))).toEqual([]);
  });
});

describe("the plan itself", () => {
  it("wants a name, a price and a turnaround", () => {
    expect(problemsAt(setup, draft())).toEqual([]);
    expect(problemsAt(setup, draft({ name: "   " })).join(" ")).toMatch(/name/);
    expect(problemsAt(setup, draft({ price: "" })).join(" ")).toMatch(/price/);
    expect(problemsAt(setup, draft({ turnaround: "0" })).join(" ")).toMatch(/turnaround/);
  });

  it("allows a free plan, which is a price of zero rather than no price", () => {
    expect(problemsAt(setup, draft({ price: "0" }))).toEqual([]);
  });
});

describe("the services it is made of", () => {
  it("wants at least one", () => {
    expect(problemsAt(setup, draft({ services: [] }))).toContain("Add at least one service.");
  });

  it("refuses the same service twice", () => {
    expect(problemsAt(setup, draft({ services: [service(), service()] })).join(" ")).toMatch(/more than once/);
  });

  it("wants an allowance greater than zero for each", () => {
    expect(problemsAt(setup, draft({ services: [service({ includedQuantity: "0" })] })).join(" ")).toMatch(/greater than zero/);
    expect(problemsAt(setup, draft({ services: [service({ includedQuantity: "" })] })).join(" ")).toMatch(/greater than zero/);
  });

  it("is satisfied by a cadence that needs no days", () => {
    expect(problemsAt(setup, draft({ services: [service({ frequency: "daily" })] }))).toEqual([]);
    expect(problemsAt(setup, draft({ services: [service({ frequency: "alternate_days" })] }))).toEqual([]);
  });

  it("insists on exactly two days for twice a week", () => {
    expect(problemsAt(setup, draft({ services: [service({ frequency: "twice_weekly", frequencyDays: [2] })] })).join(" "))
      .toMatch(/name two days/);
    expect(problemsAt(setup, draft({ services: [service({ frequency: "twice_weekly", frequencyDays: [2, 5] })] }))).toEqual([]);
  });

  it("insists on exactly one for weekly", () => {
    expect(problemsAt(setup, draft({ services: [service({ frequency: "weekly", frequencyDays: [1, 4] })] })).join(" "))
      .toMatch(/name one day/);
  });

  it("insists a custom cadence names something", () => {
    expect(problemsAt(setup, draft({ services: [service({ frequency: "custom", frequencyDays: [] })] })).join(" "))
      .toMatch(/names no days/);
    expect(problemsAt(setup, draft({ services: [service({ frequency: "custom", frequencyDays: [1, 3, 6] })] }))).toEqual([]);
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
        service({ serviceId: "iron_only", serviceName: "Iron only", unit: "piece", includedQuantity: "30", additionalRate: "10", frequency: "twice_weekly", frequencyDays: [2, 5] }),
      ],
    }));
    expect(sent[0]).toMatchObject({ serviceId: "wash_iron", unit: "kg", includedQuantity: 40, additionalRatePaise: 5000 });
    expect(sent[1]).toMatchObject({ serviceId: "iron_only", unit: "piece", includedQuantity: 30, additionalRatePaise: 1000, frequencyDays: [2, 5] });
  });

  it("sends no ceiling where none was typed, rather than zero", () => {
    // Zero would mean "nothing is allowed", which is not what an empty box means.
    expect(rules(draft())[0].maxPerFrequency).toBeNull();
    expect(rules(draft({ services: [service({ maxPerFrequency: "5" })] }))[0].maxPerFrequency).toBe(5);
  });
});
