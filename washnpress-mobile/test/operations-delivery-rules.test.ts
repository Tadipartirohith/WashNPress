import { describe, it, expect } from "vitest";
import {
  deliveryActionFor, deliveryBlocked, deliveryMismatch, deliveryReasonToSend,
} from "../src/portals/operations-delivery-rules";

// The web BatchDrawer shows "Send out for delivery" only once every batch has
// passed, and "Mark delivered" only once the bag is on the way. A different
// delivered count needs a reason; a matching one must not invent one.

describe("which delivery action a batched order offers", () => {
  it("sends out a ready order and confirms one that is already out", () => {
    expect(deliveryActionFor("ready_for_delivery")).toBe("out_for_delivery");
    expect(deliveryActionFor("out_for_delivery")).toBe("deliver");
  });

  it("offers neither while the bags are still in the facility", () => {
    expect(deliveryActionFor("picked_up")).toBeNull();
    expect(deliveryActionFor("qc")).toBeNull();
    expect(deliveryActionFor("delivered")).toBeNull();
    expect(deliveryActionFor(undefined)).toBeNull();
  });
});

describe("confirming the delivered count", () => {
  it("blocks an empty or impossible count", () => {
    expect(deliveryBlocked("", 11, "")).toBe(true);
    expect(deliveryBlocked("  ", 11, "")).toBe(true);
    expect(deliveryBlocked("x", 11, "")).toBe(true);
    expect(deliveryBlocked("-1", 11, "dropped one")).toBe(true);
  });

  it("blocks a different count until a reason is typed", () => {
    expect(deliveryMismatch(10, 11)).toBe(true);
    expect(deliveryBlocked("10", 11, "")).toBe(true);
    expect(deliveryBlocked("10", 11, "one left with the resident")).toBe(false);
  });

  it("lets a matching count through without a reason, and does not send one", () => {
    expect(deliveryMismatch(11, 11)).toBe(false);
    expect(deliveryBlocked("11", 11, "")).toBe(false);
    expect(deliveryReasonToSend(11, 11, "should be ignored")).toBeUndefined();
    expect(deliveryReasonToSend(10, 11, "one left with the resident")).toBe("one left with the resident");
  });
});
