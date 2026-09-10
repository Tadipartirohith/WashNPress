import { describe, it, expect } from "vitest";
import {
  expectedBack, hasCostToShow, lineCoverage, summaryLine, totalQuantity, allowanceLine,
  type SummaryLine, type AllowanceStanding,
} from "../src/portals/booking-summary-rules";

// The confirmation screen said everything: four cards, seventeen rows, the number of
// slots still free in the window being booked, the per-garment rate beyond an
// allowance. All true, none of it grouped, so the three questions somebody actually
// has on that screen — when are you coming, what am I sending, what will it cost —
// were spread across it.

const line = (over: Partial<SummaryLine> = {}): SummaryLine => ({
  id: "l1", category: "Shirts", serviceName: "Wash and iron", quantity: 4, ...over,
});

describe("how one line reads once the plan is applied", () => {
  it("says nothing when the plan has nothing to do with it", () => {
    expect(lineCoverage(line())).toBeNull();
  });

  it("says a line is covered", () => {
    expect(lineCoverage(line({ coveredQuantity: 4, additionalQuantity: 0 }))).toBe("Within your plan");
  });

  it("says a line is not", () => {
    expect(lineCoverage(line({ coveredQuantity: 0, additionalQuantity: 4 }))).toBe("Charged separately");
  });

  it("spells out a split, because that is the one that surprises people", () => {
    expect(lineCoverage(line({ coveredQuantity: 3, additionalQuantity: 1 })))
      .toBe("3 in your plan, 1 beyond it");
  });
});

describe("the one sentence for the whole booking", () => {
  const base = { hasSubscription: false, lines: [line({ quantity: 3 })] };

  it("says there is nothing yet, rather than saying zero", () => {
    expect(summaryLine({ ...base, lines: [] })).toBe("Nothing added yet.");
  });

  it("leads with what there is to pay", () => {
    expect(summaryLine({ ...base, chargeablePaise: 24900 })).toBe("3 garments, about ₹249 to pay.");
  });

  it("counts one garment as one", () => {
    expect(summaryLine({ ...base, lines: [line({ quantity: 1 })], chargeablePaise: 9900 }))
      .toBe("1 garment, about ₹99 to pay.");
  });

  it("says a covered booking is covered rather than printing zero", () => {
    // "₹0" reads as a figure that failed to load, not as a free collection.
    expect(summaryLine({ ...base, hasSubscription: true, chargeablePaise: 0 }))
      .toBe("3 garments, all within your plan.");
  });

  it("says nothing to pay when there is no plan and no charge", () => {
    expect(summaryLine({ ...base, chargeablePaise: 0 })).toBe("3 garments, nothing to pay now.");
  });

  it("counts across every line", () => {
    expect(totalQuantity([line({ quantity: 3 }), line({ id: "l2", quantity: 2 })])).toBe(5);
  });
});

describe("when it comes back", () => {
  // "48 hours" is arithmetic somebody has to do standing in their doorway.
  const monday = new Date("2026-09-07T09:00:00.000Z");

  it("says nothing when the turnaround is unknown", () => {
    expect(expectedBack(null, monday)).toBeNull();
    expect(expectedBack(0, monday)).toBeNull();
  });

  it("says today when it is today", () => {
    expect(expectedBack(4, monday)).toBe("Back later today");
  });

  it("says tomorrow rather than naming the day", () => {
    expect(expectedBack(24, monday)).toBe("Back tomorrow");
  });

  it("names the day inside a week", () => {
    expect(expectedBack(48, monday)).toMatch(/^Back by /);
  });

  it("falls back to weeks when it is a long way out", () => {
    expect(expectedBack(24 * 10, monday)).toMatch(/week/);
  });
});

describe("whether the cost block is worth drawing", () => {
  const lines = [line()];

  it("is not, when there is nothing to pay and no plan to explain", () => {
    // Otherwise the section says ₹0 three times.
    expect(hasCostToShow({ lines, hasSubscription: false, chargeablePaise: 0, servicesPaise: 0 })).toBe(false);
  });

  it("is, when something is chargeable", () => {
    expect(hasCostToShow({ lines, hasSubscription: false, chargeablePaise: 100 })).toBe(true);
  });

  it("is, when there is a plan, because what it covered is worth saying", () => {
    expect(hasCostToShow({ lines, hasSubscription: true, chargeablePaise: 0 })).toBe(true);
  });
});

// The remaining allowance was on Home and on the Plan screen and nowhere in the
// booking wizard — so the one moment the number decides anything was the one moment
// it was missing.

describe("how much of the plan is left, said where the booking is made", () => {
  function standing(over: Partial<AllowanceStanding> = {}): AllowanceStanding {
    return {
      hasSubscription: true, allowance: 30, remaining: 8,
      additionalRatePaise: 3000, nonSubscriberRatePaise: 5000, ...over,
    };
  }

  it("says how many are left and what the next one costs", () => {
    const said = allowanceLine(standing())!;
    expect(said).toContain("8 of 30");
    expect(said).toContain("₹30");
  });

  it("says the allowance is gone rather than showing a zero", () => {
    const said = allowanceLine(standing({ remaining: 0 }))!;
    expect(said).toMatch(/used up/i);
    expect(said).toContain("₹30");
  });

  it("quotes the non-subscriber rate to somebody with no plan", () => {
    // Two different rates, and quoting the wrong one is worse than quoting none.
    const said = allowanceLine(standing({ hasSubscription: false }))!;
    expect(said).toContain("₹50");
    expect(said).not.toContain("₹30");
  });

  it("says nothing at all until the pricing has landed", () => {
    // An allowance stated wrongly is worse than one not stated.
    expect(allowanceLine(null)).toBeNull();
  });

  it("gets the noun right for a single garment", () => {
    expect(allowanceLine(standing({ remaining: 1 }))).toContain("1 of 30 garment left");
  });
});
