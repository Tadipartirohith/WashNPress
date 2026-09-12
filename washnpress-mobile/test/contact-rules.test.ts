import { describe, it, expect } from "vitest";
import {
  contactReady, dateOfBirthFrom, emailProblem, isEmail, isPhone, normalizePhone, phoneProblem,
} from "../src/contact-rules";

describe("a date of birth chosen from day, month and year", () => {
  const today = "2026-09-13";

  it("builds the date the API takes", () => {
    expect(dateOfBirthFrom("1990", "5", "17", today)).toBe("1990-05-17");
    expect(dateOfBirthFrom("2000", "02", "29", today)).toBe("2000-02-29");
  });

  it("is nothing until all three are chosen", () => {
    expect(dateOfBirthFrom("1990", "5", undefined, today)).toBeNull();
    expect(dateOfBirthFrom(undefined, "5", "17", today)).toBeNull();
  });

  it("refuses a day the month does not have", () => {
    expect(dateOfBirthFrom("1990", "4", "31", today)).toBeNull();
    expect(dateOfBirthFrom("1999", "2", "29", today)).toBeNull();
  });

  it("refuses a date after today or before 1900", () => {
    expect(dateOfBirthFrom("2026", "9", "14", today)).toBeNull();
    expect(dateOfBirthFrom("2026", "9", "13", today)).toBe("2026-09-13");
    expect(dateOfBirthFrom("1899", "12", "31", today)).toBeNull();
  });
});

// The email pattern was pasted into the staff wizard and again into the resident
// profile screen; the phone pattern existed in the wizard alone, so onboarding and
// the login screen checked nothing. These are the rules, and they are the same ones
// the API applies — a screen that asks a different question than the server sends
// somebody into a round trip to be told no.

describe("what counts as an email address", () => {
  it("takes an ordinary address", () => {
    expect(isEmail("lavanya@gmail.com")).toBe(true);
    expect(isEmail("lavanya.m@company.co.in")).toBe(true);
  });

  it("refuses the address from the report", () => {
    expect(isEmail("lavanaya@deepthi@gmail.com")).toBe(false);
  });

  it("refuses an address missing a side, a dot or a real tail", () => {
    expect(isEmail("lavanya@")).toBe(false);
    expect(isEmail("@gmail.com")).toBe(false);
    expect(isEmail("ravi@washnpress")).toBe(false);
    expect(isEmail("ravi@washnpress.c")).toBe(false);
  });

  it("refuses a space inside the address but ignores space around it", () => {
    expect(isEmail("ravi ram@gmail.com")).toBe(false);
    expect(isEmail("  ravi@gmail.com  ")).toBe(true);
  });
});

describe("what counts as a mobile number", () => {
  it("takes ten digits starting 6, 7, 8 or 9", () => {
    expect(isPhone("9876543210")).toBe(true);
    expect(isPhone("6000000000")).toBe(true);
  });

  it("refuses the wrong length, the wrong start and letters", () => {
    expect(isPhone("987654321")).toBe(false);
    expect(isPhone("98765432101")).toBe(false);
    expect(isPhone("1234567890")).toBe(false);
    expect(isPhone("98765abc10")).toBe(false);
  });

  it("accepts the number however it was punctuated", () => {
    for (const n of ["+91 9876543210", "919876543210", "+91-98765-43210", "09876543210"]) {
      expect(isPhone(n)).toBe(true);
    }
  });

  it("reduces every spelling of one number to the same digits", () => {
    const forms = ["9876543210", "+91 9876543210", "919876543210", "09876543210"];
    expect(new Set(forms.map(normalizePhone))).toEqual(new Set(["9876543210"]));
  });
});

describe("what the field says while somebody is typing", () => {
  it("says nothing at all until there is something to judge", () => {
    // An error shown before anybody has typed is an error about the form.
    expect(emailProblem("")).toBeNull();
    expect(phoneProblem("")).toBeNull();
    // Whether a blank is allowed at all is the submit button's question, asked
    // through contactReady, not the field's.
    expect(emailProblem("   ")).toBeNull();
  });

  it("names the problem in the words the product uses", () => {
    expect(emailProblem("lavanaya@deepthi@gmail.com")).toBe("Enter a valid email address.");
    expect(phoneProblem("12345")).toBe("Enter a valid 10-digit mobile number.");
  });

  it("goes quiet once the answer is right", () => {
    expect(emailProblem("ravi@gmail.com")).toBeNull();
    expect(phoneProblem("+91 9876543210")).toBeNull();
  });
});

describe("whether the form may be submitted", () => {
  it("needs a real number in every case", () => {
    expect(contactReady("12345", "ravi@gmail.com")).toBe(false);
    expect(contactReady("9876543210", "ravi@gmail.com")).toBe(true);
  });

  it("lets an optional address be left out but not left wrong", () => {
    expect(contactReady("9876543210", "")).toBe(true);
    expect(contactReady("9876543210", "   ")).toBe(true);
    expect(contactReady("9876543210", "nope")).toBe(false);
  });

  it("insists on an address where the role needs one", () => {
    // An operator is asked for one; a supervisor is reached on their phone.
    expect(contactReady("9876543210", "", { emailRequired: true })).toBe(false);
    expect(contactReady("9876543210", "ravi@gmail.com", { emailRequired: true })).toBe(true);
  });
});
