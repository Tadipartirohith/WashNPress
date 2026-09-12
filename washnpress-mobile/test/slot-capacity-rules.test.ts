import { describe, it, expect } from "vitest";
import { slotCapacityProblem } from "../src/portals/slot-capacity-rules";

// A slot's capacity is the number of households one round can serve. The server holds
// it to 2-30; these are the refusals an admin sees before the request is ever sent.
describe("how large a slot may be", () => {
  it("accepts both ends of the range", () => {
    expect(slotCapacityProblem("2")).toBeNull();
    expect(slotCapacityProblem("30")).toBeNull();
  });

  it("says the smallest and the largest a slot may be", () => {
    expect(slotCapacityProblem("1")).toBe("Capacity must be at least 2.");
    expect(slotCapacityProblem("31")).toBe("Capacity cannot exceed 30.");
  });

  it("refuses a fraction of a booking", () => {
    expect(slotCapacityProblem("2.5")).toBe("Capacity must be a whole number.");
  });

  it("refuses nothing, a word, zero and a negative number", () => {
    expect(slotCapacityProblem("")).toBe("Capacity is required.");
    expect(slotCapacityProblem("abc")).toBe("Capacity must be a number.");
    expect(slotCapacityProblem("0")).toBe("Capacity must be at least 2.");
    expect(slotCapacityProblem("-5")).toBe("Capacity must be at least 2.");
  });
});
