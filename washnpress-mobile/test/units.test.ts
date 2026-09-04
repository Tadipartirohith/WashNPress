import { describe, it, expect } from "vitest";
import {
  formatQuantity, perUnitLabel, measurementLabel, parseMeasurement, isMeasured, unitOf,
  sanitizeDecimalInput,
} from "../src/api/units";

// The screens used to say a bare number beside every service, which meant one thing
// per kilogram and quite another per shirt. What a service is measured in now comes
// from the service itself and is said out loud.

describe("saying a quantity in its own unit", () => {
  it("reads the way a person would say it", () => {
    expect(formatQuantity("kg", 4.5)).toBe("4.50 kg");
    expect(formatQuantity("kg", 4)).toBe("4 kg");
    expect(formatQuantity("piece", 1)).toBe("1 piece");
    expect(formatQuantity("piece", 6)).toBe("6 pieces");
  });

  it("says what a price is per, so 80.00 is never ambiguous", () => {
    expect(perUnitLabel("kg")).toBe("per kg");
    expect(perUnitLabel("piece")).toBe("per piece");
    expect(perUnitLabel("hour")).toBe("per hour");
  });

  it("asks for the measurement in the words that fit the unit", () => {
    expect(measurementLabel("kg")).toBe("Approximate weight (kg)");
    expect(measurementLabel("hour")).toBe("How many hours");
  });
});

describe("which services have to be measured", () => {
  it("counts pieces and measures everything else", () => {
    expect(isMeasured("piece")).toBe(false);
    expect(isMeasured("kg")).toBe(true);
    expect(isMeasured("hour")).toBe(true);
  });

  it("treats a service with no stated unit as counted, the way it always was", () => {
    expect(unitOf({ unit: undefined })).toBe("piece");
    expect(unitOf(null)).toBe("piece");
    expect(unitOf({ unit: "kg" })).toBe("kg");
  });
});

describe("reading what the resident typed", () => {
  it("takes a decimal weight", () => {
    expect(parseMeasurement("4.5", "kg")).toBe(4.5);
    expect(parseMeasurement("4.567", "kg")).toBe(4.57);
  });

  it("ignores anything that is not part of a number", () => {
    expect(parseMeasurement("about 3 kg", "kg")).toBe(3);
  });

  it("treats an empty or nonsensical box as nothing given rather than as zero", () => {
    // Zero would book a bag that weighs nothing, which is not what a blank box means.
    expect(parseMeasurement("", "kg")).toBeNull();
    expect(parseMeasurement("kg", "kg")).toBeNull();
    expect(parseMeasurement("0", "kg")).toBeNull();
  });

  it("keeps a counted unit whole", () => {
    expect(parseMeasurement("2.8", "piece")).toBe(2);
  });
});

// The weight box rejects invalid characters as they are typed rather than silently
// correcting them after the fact — the bug where "-5" was quietly turned into 5 and
// the order was still added.
describe("keeping the weight box to a valid number", () => {
  it("drops a minus sign, so a negative can never be entered", () => {
    expect(sanitizeDecimalInput("-5")).toBe("5");
    expect(sanitizeDecimalInput("-")).toBe("");
  });

  it("drops letters and symbols", () => {
    expect(sanitizeDecimalInput("@")).toBe("");
    expect(sanitizeDecimalInput("#")).toBe("");
    expect(sanitizeDecimalInput("4a.5kg")).toBe("4.5");
  });

  it("allows a single decimal point and collapses extras", () => {
    expect(sanitizeDecimalInput("4.5")).toBe("4.5");
    expect(sanitizeDecimalInput("4.5.6")).toBe("4.56");
  });

  it("leaves a plain number untouched", () => {
    expect(sanitizeDecimalInput("12")).toBe("12");
  });
});
