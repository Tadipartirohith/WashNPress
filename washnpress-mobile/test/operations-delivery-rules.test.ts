import { describe, it, expect } from "vitest";
import {
  deliveryActionFor, deliveryBlocked, deliveryCountMismatch, deliveryMismatch, deliveryPayload,
  deliveryReasonToSend, deliveryRequest,
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
  it("blocks an empty count the way Web does (count === \"\")", () => {
    expect(deliveryBlocked("", 11, "")).toBe(true);
  });

  it("does not read an empty, not-yet-typed count as a mismatched zero", () => {
    // Number("") is 0, not NaN. Clearing the field to retype it must not flash a
    // false discrepancy warning while the operator is still typing.
    expect(deliveryCountMismatch("", 5)).toBe(false);
    expect(deliveryCountMismatch("0", 5)).toBe(true);
    expect(deliveryCountMismatch("5", 5)).toBe(false);
  });

  it("lets a matching count through without a reason, and does not send one", () => {
    expect(deliveryMismatch(11, 11)).toBe(false);
    expect(deliveryBlocked("11", 11, "")).toBe(false);
    expect(deliveryReasonToSend(11, 11, "should be ignored")).toBeUndefined();
    expect(deliveryPayload("11", 11, "should be ignored")).toEqual({
      deliveryCount: 11, discrepancyReason: undefined,
    });
  });

  it("requires a trimmed reason when the count is lower", () => {
    expect(deliveryMismatch(10, 11)).toBe(true);
    expect(deliveryBlocked("10", 11, "")).toBe(true);
    expect(deliveryBlocked("10", 11, "   ")).toBe(true);
    expect(deliveryBlocked("10", 11, "one left with the resident")).toBe(false);
  });

  it("requires a trimmed reason when the count is higher", () => {
    expect(deliveryMismatch(12, 11)).toBe(true);
    expect(deliveryBlocked("12", 11, "")).toBe(true);
    expect(deliveryBlocked("12", 11, "   ")).toBe(true);
    expect(deliveryBlocked("12", 11, "found an extra shirt")).toBe(false);
  });

  it("POSTs /deliver with Web's body: reason only on a mismatch, trimmed", () => {
    expect(deliveryRequest("ord-1", "11", 11, "ignored")).toEqual({
      method: "POST",
      path: "/v1/operations/orders/ord-1/deliver",
      body: { deliveryCount: 11, discrepancyReason: undefined },
    });
    expect(deliveryRequest("ord-1", "10", 11, "  one short  ")).toEqual({
      method: "POST",
      path: "/v1/operations/orders/ord-1/deliver",
      body: { deliveryCount: 10, discrepancyReason: "one short" },
    });
    expect(deliveryRequest("ord-1", "12", 11, "  one extra  ")).toEqual({
      method: "POST",
      path: "/v1/operations/orders/ord-1/deliver",
      body: { deliveryCount: 12, discrepancyReason: "one extra" },
    });
  });
});
