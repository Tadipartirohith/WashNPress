import { describe, it, expect } from "vitest";
import { reserve, release } from "../../src/domain/slots";

const base = { id: "s1", capacityTotal: 2, capacityRemaining: 1, isActive: true };

describe("slots", () => {
  it("reserves one unit of capacity", () => {
    expect(reserve(base).capacityRemaining).toBe(0);
  });
  it("refuses a full slot", () => {
    expect(() => reserve({ ...base, capacityRemaining: 0 })).toThrow(/full/);
  });
  it("refuses an inactive slot", () => {
    expect(() => reserve({ ...base, isActive: false })).toThrow(/not active/);
  });
  it("never releases above the total capacity", () => {
    expect(release({ ...base, capacityRemaining: 2 }).capacityRemaining).toBe(2);
  });
});
