import { describe, it, expect } from "vitest";
import { rupeesToPaise, paiseToRupees, addPaise, formatInr, assertPaise } from "../../src/domain/money";

describe("money", () => {
  it("converts rupees to integer paise", () => {
    expect(rupeesToPaise(10)).toBe(1000);
    expect(rupeesToPaise(10.55)).toBe(1055);
  });
  it("rejects negative or non finite rupees", () => {
    expect(() => rupeesToPaise(-1)).toThrow();
    expect(() => rupeesToPaise(Number.NaN)).toThrow();
  });
  it("round trips paise to rupees", () => {
    expect(paiseToRupees(1055)).toBeCloseTo(10.55);
  });
  it("adds paise and guards against non integers", () => {
    expect(addPaise(1000, 500)).toBe(1500);
    expect(() => assertPaise(10.5)).toThrow();
  });
  it("formats INR with two decimals", () => {
    expect(formatInr(1055)).toBe("₹10.55");
  });
});
