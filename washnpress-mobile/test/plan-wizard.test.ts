import { describe, it, expect } from "vitest";
import { problemsAt, emptyDraft, rules, type Draft, type DraftService } from "../src/portals/plan-wizard-rules";

// A plan used to be a name, one garment allowance, a turnaround and a price. It is
// now a set of services each configured on its own terms, which is too much to ask
// for on one screen — so each step checks its own answers before moving on.

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

describe("step 1 — the plan itself", () => {
  it("wants a name, a price and a turnaround", () => {
    expect(problemsAt(0, draft())).toEqual([]);
    expect(problemsAt(0, draft({ name: "   " })).join(" ")).toMatch(/name/);
    expect(problemsAt(0, draft({ price: "" })).join(" ")).toMatch(/price/);
    expect(problemsAt(0, draft({ turnaround: "0" })).join(" ")).toMatch(/turnaround/);
  });

  it("allows a free plan, which is a price of zero rather than no price", () => {
    expect(problemsAt(0, draft({ price: "0" }))).toEqual([]);
  });
});

describe("step 2 — the services", () => {
  it("wants at least one", () => {
    expect(problemsAt(1, draft({ services: [] }))).toContain("Add at least one service.");
  });

  it("refuses the same service twice", () => {
    expect(problemsAt(1, draft({ services: [service(), service()] })).join(" ")).toMatch(/more than once/);
  });
});

describe("step 3 — measurement and allowance", () => {
  it("wants a quantity greater than zero for each", () => {
    expect(problemsAt(2, draft())).toEqual([]);
    expect(problemsAt(2, draft({ services: [service({ includedQuantity: "0" })] })).join(" ")).toMatch(/greater than zero/);
    expect(problemsAt(2, draft({ services: [service({ includedQuantity: "" })] })).join(" ")).toMatch(/greater than zero/);
  });
});

describe("step 4 — frequency", () => {
  it("is satisfied by a cadence that needs no days", () => {
    expect(problemsAt(3, draft({ services: [service({ frequency: "daily" })] }))).toEqual([]);
    expect(problemsAt(3, draft({ services: [service({ frequency: "alternate_days" })] }))).toEqual([]);
  });

  it("insists on exactly two days for twice a week", () => {
    expect(problemsAt(3, draft({ services: [service({ frequency: "twice_weekly", frequencyDays: [2] })] })).join(" "))
      .toMatch(/name two days/);
    expect(problemsAt(3, draft({ services: [service({ frequency: "twice_weekly", frequencyDays: [2, 5] })] }))).toEqual([]);
  });

  it("insists on exactly one for weekly", () => {
    expect(problemsAt(3, draft({ services: [service({ frequency: "weekly", frequencyDays: [1, 4] })] })).join(" "))
      .toMatch(/name one day/);
  });

  it("insists a custom cadence names something", () => {
    expect(problemsAt(3, draft({ services: [service({ frequency: "custom", frequencyDays: [] })] })).join(" "))
      .toMatch(/names no days/);
    expect(problemsAt(3, draft({ services: [service({ frequency: "custom", frequencyDays: [1, 3, 6] })] }))).toEqual([]);
  });
});

describe("step 5 — usage and additional pricing", () => {
  it("wants a rate where extra usage is charged for", () => {
    expect(problemsAt(4, draft({ services: [service({ additionalUsage: "pay_per_use", additionalRate: "" })] })).join(" "))
      .toMatch(/give it a rate/);
  });

  it("wants no rate where extra usage is not allowed at all", () => {
    expect(problemsAt(4, draft({ services: [service({ additionalUsage: "block", additionalRate: "" })] }))).toEqual([]);
  });

  it("refuses a negative charge", () => {
    expect(problemsAt(4, draft({ services: [service({ additionalRate: "-5" })] })).join(" "))
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
