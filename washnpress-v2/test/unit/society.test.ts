import { describe, it, expect } from "vitest";
import {
  addressFromLegacy, addressProblems, formatAddress, isPincode, normaliseAddress, societyKey,
} from "../../src/domain/society";

const complete = {
  house: "Kandula Residency", street: "Main Road", locality: "Madhapur",
  city: "Hyderabad", state: "Telangana", pincode: "500081",
};

describe("an address in the parts an address is made of", () => {
  it("is happy with all six", () => {
    expect(addressProblems(complete)).toEqual([]);
  });

  // A society is a complex, not a front door. The building duplicates the name it
  // is written under — "Aparna Apartments" with "House: Aparna Apartments" beneath
  // it — and the street is how an operator finds the gate rather than where the
  // society sits operationally. Both are kept and neither is required.
  it("does not ask a society for a house number", () => {
    expect(addressProblems({ ...complete, house: "" })).toEqual([]);
  });

  it("does not ask a society for a street", () => {
    expect(addressProblems({ ...complete, street: "" })).toEqual([]);
  });

  it("still needs the four that say where the society actually is", () => {
    expect(addressProblems({ ...complete, locality: "" })).toHaveLength(1);
    expect(addressProblems({ ...complete, city: "" })).toHaveLength(1);
    expect(addressProblems({ ...complete, state: "" })).toHaveLength(1);
    expect(addressProblems({ ...complete, pincode: "" })).toHaveLength(1);
  });

  it("says everything that is missing at once, not one field at a time", () => {
    // Four boxes and four trips round the loop is not a form anybody finishes.
    expect(addressProblems({})).toHaveLength(4);
  });

  it("knows a pincode from a number of about the right size", () => {
    expect(isPincode("500081")).toBe(true);
    expect(isPincode("50008")).toBe(false);
    expect(isPincode("5000812")).toBe(false);
    // No Indian pincode starts with a zero.
    expect(isPincode("050081")).toBe(false);
    expect(isPincode("50008a")).toBe(false);
  });

  it("does not treat spacing as something anybody typed on purpose", () => {
    expect(normaliseAddress({ ...complete, street: "  Main   Road " }).street).toBe("Main Road");
  });

  it("joins itself up for a card that has room for a line and not a form", () => {
    expect(formatAddress(complete))
      .toBe("Kandula Residency, Main Road, Madhapur, Hyderabad, Telangana - 500081");
  });

  it("leaves out what it does not have rather than printing empty commas", () => {
    expect(formatAddress({ house: "Tower 5", city: "Hyderabad" })).toBe("Tower 5, Hyderabad");
    expect(formatAddress(null)).toBe("");
  });
});

describe("reading an address stored before it had parts", () => {
  it("recovers the house and the street from one line", () => {
    const address = addressFromLegacy("Kavuri Hills, Madhapur Main Road", "Hyderabad", "Telangana");
    expect(address.house).toBe("Kavuri Hills");
    expect(address.street).toBe("Madhapur Main Road");
    expect(address.city).toBe("Hyderabad");
    expect(address.state).toBe("Telangana");
  });

  it("takes a pincode out of the line wherever in it that pincode sat", () => {
    expect(addressFromLegacy("Tower 5, Financial District, 500032", "Hyderabad", "Telangana").pincode)
      .toBe("500032");
  });

  it("invents nothing it was not given", () => {
    const address = addressFromLegacy(null, null, null);
    expect(address).toEqual({ house: "", street: "", locality: "", city: "", state: "", pincode: "" });
  });
});

describe("what makes two societies the same society", () => {
  it("is the name and the city together", () => {
    expect(societyKey("Green Meadows", "Hyderabad")).toBe(societyKey("green meadows", "hyderabad"));
    // There is a Green Meadows in more than one city, and neither is the other.
    expect(societyKey("Green Meadows", "Hyderabad")).not.toBe(societyKey("Green Meadows", "Bengaluru"));
  });
});
