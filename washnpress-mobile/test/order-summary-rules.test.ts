import { describe, it, expect } from "vitest";
import {
  countStory, deliveryStory, isDiscrepant, paymentStory, summaryMoment,
  type SummaryOrder,
} from "../src/portals/order-summary-rules";

// Accepting an order and completing one both ended with the screen going quiet: the
// action disappeared, the pill changed, and nothing said what had just been agreed
// to. An operator who has taken eleven garments and quoted a charge had no record of
// it in front of them.

const order = (over: Partial<SummaryOrder> = {}): SummaryOrder => ({ state: "picked_up", ...over });

describe("when a summary is worth showing", () => {
  it("shows one once the garments have been collected", () => {
    expect(summaryMoment("picked_up")).toBe("collected");
  });

  it("keeps showing it through the middle of the process", () => {
    for (const state of ["in_wash", "ironing", "qc", "ready_for_delivery", "out_for_delivery"]) {
      expect(summaryMoment(state), state).toBe("collected");
    }
  });

  it("shows the finished one at the end", () => {
    expect(summaryMoment("delivered")).toBe("finished");
  });

  it("shows nothing before anything has been collected", () => {
    // Before pickup there is nothing to summarise; the operator is looking at what
    // to do, not at what was concluded.
    expect(summaryMoment("scheduled")).toBeNull();
    expect(summaryMoment("cancelled")).toBeNull();
  });
});

describe("what was actually taken", () => {
  it("says nothing before anything is accepted", () => {
    expect(countStory(order())).toBeNull();
  });

  it("says the count when there was no estimate to compare with", () => {
    expect(countStory(order({ acceptedCount: 11 }))).toBe("11 accepted");
  });

  it("says so when the count matched", () => {
    expect(countStory(order({ estimatedCount: 11, acceptedCount: 11 })))
      .toBe("11 accepted, exactly as estimated");
  });

  it("states the difference rather than leaving it to be worked out", () => {
    // The most disputed number in the platform. Two figures on two rows is an
    // invitation to do arithmetic badly.
    expect(countStory(order({ estimatedCount: 8, acceptedCount: 11 })))
      .toBe("11 accepted, 3 more than estimated");
    expect(countStory(order({ estimatedCount: 11, acceptedCount: 8 })))
      .toBe("8 accepted, 3 fewer than estimated");
  });

  it("copes with an accepted count of zero, which is a failed pickup and not a blank", () => {
    expect(countStory(order({ estimatedCount: 5, acceptedCount: 0 })))
      .toBe("0 accepted, 5 fewer than estimated");
  });
});

describe("what came back", () => {
  it("says nothing before delivery", () => {
    expect(deliveryStory(order({ acceptedCount: 11 }))).toBeNull();
  });

  it("says everything came back when it did", () => {
    expect(deliveryStory(order({ acceptedCount: 11, deliveryCount: 11 })))
      .toBe("11 delivered, all of them");
  });

  it("says how many are missing", () => {
    expect(deliveryStory(order({ acceptedCount: 11, deliveryCount: 9 })))
      .toBe("9 delivered, 2 short");
  });

  it("says when more came back than went out, which is its own problem", () => {
    expect(deliveryStory(order({ acceptedCount: 9, deliveryCount: 11 })))
      .toBe("11 delivered, 2 more than were collected");
  });
});

describe("whether the counts actually disagree", () => {
  it("is not a discrepancy when they match", () => {
    // A reason recorded against matching counts is a note. Calling it a discrepancy
    // raises an alarm about an order that is fine.
    expect(isDiscrepant(order({ acceptedCount: 11, deliveryCount: 11, discrepancyReason: "Left with neighbour" })))
      .toBe(false);
  });

  it("is one when they differ", () => {
    expect(isDiscrepant(order({ acceptedCount: 11, deliveryCount: 10 }))).toBe(true);
  });

  it("is not one before delivery, when there is nothing to compare", () => {
    expect(isDiscrepant(order({ acceptedCount: 11 }))).toBe(false);
  });
});

describe("what is still owed", () => {
  it("says there is nothing rather than showing an empty row", () => {
    expect(paymentStory(order({ totalPaise: 0 }))).toBe("Nothing to collect");
  });

  it("says paid", () => {
    expect(paymentStory(order({ totalPaise: 24900, paymentStatus: "paid" }))).toBe("Paid");
  });

  it("says outstanding when it has not been settled", () => {
    expect(paymentStory(order({ totalPaise: 24900, paymentStatus: "pending" }))).toBe("Payment outstanding");
    expect(paymentStory(order({ totalPaise: 24900 }))).toBe("Payment outstanding");
  });

  it("says a failure is a failure, not an absence", () => {
    expect(paymentStory(order({ totalPaise: 24900, paymentStatus: "failed" }))).toBe("Payment failed");
  });
});
