import { describe, it, expect } from "vitest";
import {
  PICKUP_FAIL_HINT, PICKUP_FAIL_REASON_LABEL, PICKUP_FAIL_SUBMIT, PICKUP_FAIL_TITLE,
  canRecordPickupFailure, pickupFailAfterError, pickupFailAfterSuccess, pickupFailFormReset,
  pickupFailReasonToSend, pickupFailRequest, pickupFailSubmitBlocked, pickupRowActions,
} from "../src/portals/operations-pickup-row-rules";

describe("Failed is available the way Web's PickupsTab enables it", () => {
  it("offers Failed only when the pickup has an order, regardless of status", () => {
    expect(pickupRowActions({ orderId: "ord-1" }).failed).toBe(true);
    expect(pickupRowActions({ orderId: null }).failed).toBe(false);
    expect(pickupRowActions({}).failed).toBe(false);
  });
});

describe("Failed pickup reason matches Web PickupFailedModal", () => {
  it("uses Web's free-text copy, not a hardcoded list", () => {
    expect(PICKUP_FAIL_TITLE).toBe("Record a failed pickup");
    expect(PICKUP_FAIL_REASON_LABEL).toBe("Why couldn't this be collected");
    expect(PICKUP_FAIL_HINT).toMatch(/silently dropped/);
    expect(PICKUP_FAIL_SUBMIT).toBe("Record failure");
  });

  it("accepts a typed reason", () => {
    expect(canRecordPickupFailure("ord-1", "Resident out")).toBe(true);
    expect(pickupFailReasonToSend("Resident out")).toBe("Resident out");
    expect(pickupFailSubmitBlocked(false, "ord-1", "Resident out")).toBe(false);
  });

  it("rejects an empty reason", () => {
    expect(canRecordPickupFailure("ord-1", "")).toBe(false);
    expect(pickupFailRequest("ord-1", "")).toBeNull();
    expect(pickupFailSubmitBlocked(false, "ord-1", "")).toBe(true);
  });

  it("rejects a whitespace-only reason", () => {
    expect(canRecordPickupFailure("ord-1", "   ")).toBe(false);
    expect(pickupFailReasonToSend("   ")).toBeNull();
    expect(pickupFailRequest("ord-1", "   ")).toBeNull();
    expect(pickupFailSubmitBlocked(false, "ord-1", "\t\n")).toBe(true);
  });

  it("POSTs /pickup-failed with Web's trimmed { reason } body", () => {
    expect(pickupFailRequest("ord-9", "  Resident unavailable  ")).toEqual({
      method: "POST",
      path: "/v1/operations/orders/ord-9/pickup-failed",
      body: { reason: "Resident unavailable" },
    });
  });

  it("stays on the form when the server refuses, and closes after success or cancel", () => {
    expect(pickupFailAfterError("That order is already collected.")).toEqual({
      error: "That order is already collected.", failing: "keep",
    });
    expect(pickupFailAfterSuccess()).toEqual({
      note: "Pickup failure recorded", reason: "", failing: null,
    });
    expect(pickupFailFormReset()).toEqual({ reason: "", error: null, failing: null });
  });

  it("does not submit while busy", () => {
    expect(pickupFailSubmitBlocked(true, "ord-1", "Resident out")).toBe(true);
  });
});
