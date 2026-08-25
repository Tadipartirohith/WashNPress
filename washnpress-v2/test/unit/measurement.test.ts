import { describe, it, expect } from "vitest";
import {
  normaliseQuantity, formatQuantity, amountPaise, billableQuantity,
  splitAgainstAllowance, isFractional,
} from "../../src/domain/measurement";

// The platform used to count everything in garments. A bag of mixed washing is
// weighed, ironing is counted, at-home work is charged by the hour — and rounding
// one like the other is how a 2.5 kg bag became a 3 kg bill.

describe("a quantity is normalised for its own unit", () => {
  it("keeps kilograms fractional and pieces whole", () => {
    expect(isFractional("kg")).toBe(true);
    expect(isFractional("piece")).toBe(false);
    expect(normaliseQuantity("kg", 2.456)).toBe(2.46);
    expect(normaliseQuantity("piece", 2.9)).toBe(2);
  });

  it("never goes negative, whatever it is given", () => {
    expect(normaliseQuantity("kg", -4)).toBe(0);
    expect(normaliseQuantity("piece", Number.NaN)).toBe(0);
  });

  it("reads the way a person would say it", () => {
    expect(formatQuantity("kg", 4.5)).toBe("4.50 kg");
    expect(formatQuantity("kg", 4)).toBe("4 kg");
    expect(formatQuantity("piece", 1)).toBe("1 piece");
    expect(formatQuantity("piece", 6)).toBe("6 pieces");
    expect(formatQuantity("hour", 2)).toBe("2 hours");
  });
});

describe("what a quantity costs", () => {
  it("rounds once at the end rather than per unit", () => {
    // 2.5 kg at 60.50 is 15125 paise, not 2 x 6050 rounded up twice.
    expect(amountPaise("kg", 2.5, 6050)).toBe(15125);
  });

  it("bills a floor where the service sets one", () => {
    // Half a kilo of washing still occupies a machine.
    expect(billableQuantity("kg", 0.4, 1)).toBe(1);
    expect(billableQuantity("kg", 3.2, 1)).toBe(3.2);
    // No floor configured means what was measured is what is billed.
    expect(billableQuantity("kg", 0.4, null)).toBe(0.4);
    // Nothing at all is still nothing, floor or no floor.
    expect(billableQuantity("kg", 0, 2)).toBe(0);
  });
});

describe("splitting a request against an allowance", () => {
  it("covers what it can and leaves the rest outside", () => {
    const split = splitAgainstAllowance("kg", 8, 5);
    expect(split).toEqual({ requested: 8, covered: 5, additional: 3, remainingAfter: 0 });
  });

  it("covers everything when there is room", () => {
    expect(splitAgainstAllowance("kg", 3, 5)).toEqual({ requested: 3, covered: 3, additional: 0, remainingAfter: 2 });
  });

  it("treats an exhausted allowance as covering nothing", () => {
    expect(splitAgainstAllowance("piece", 4, 0)).toEqual({ requested: 4, covered: 0, additional: 4, remainingAfter: 0 });
  });

  it("splits fractionally where the unit is fractional", () => {
    const split = splitAgainstAllowance("kg", 5.5, 2.25);
    expect(split.covered).toBe(2.25);
    expect(split.additional).toBe(3.25);
  });
});
