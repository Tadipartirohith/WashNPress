import { describe, it, expect } from "vitest";
import {
  isEmail, isIndianMobile, normalizeEmail, normalizePhone, sameEmail, samePhone,
} from "../../src/domain/contact";

// The rules used to be written down four times — the phone pattern in staff-identity
// and again in otp, the email pattern in staff-identity and twice more on mobile —
// and the create and edit paths ran different ones. These are the rules.

describe("what counts as an email address", () => {
  it("takes an ordinary address", () => {
    expect(isEmail("lavanya@gmail.com")).toBe(true);
    expect(isEmail("lavanya.m@company.co.in")).toBe(true);
  });

  it("refuses the address from the report", () => {
    // Two @s. The browser caught this one and said "A part following '@' should not
    // contain the symbol '@'", which is not a sentence to show anybody.
    expect(isEmail("lavanaya@deepthi@gmail.com")).toBe(false);
  });

  it("refuses an address with nothing on one side of the @", () => {
    expect(isEmail("lavanya@")).toBe(false);
    expect(isEmail("@gmail.com")).toBe(false);
  });

  it("insists on a domain with a dot and a real tail", () => {
    expect(isEmail("ravi@washnpress")).toBe(false);
    expect(isEmail("ravi@washnpress.c")).toBe(false);
  });

  it("refuses whitespace inside the address", () => {
    expect(isEmail("ravi ram@gmail.com")).toBe(false);
  });

  it("looks past whitespace around it", () => {
    // The field is trimmed before it is judged, so a leading space is not an error
    // to correct — it is one to ignore.
    expect(isEmail("  ravi@gmail.com  ")).toBe(true);
  });

  it("has nothing to accept when there is nothing there", () => {
    expect(isEmail("")).toBe(false);
    expect(isEmail(null)).toBe(false);
    expect(isEmail(undefined)).toBe(false);
  });
});

describe("what counts as a mobile number", () => {
  it("takes ten digits starting 6, 7, 8 or 9", () => {
    for (const n of ["9876543210", "8000000000", "7000000000", "6000000000"]) {
      expect(isIndianMobile(n)).toBe(true);
    }
  });

  it("refuses the wrong number of digits", () => {
    expect(isIndianMobile("987654321")).toBe(false);
    expect(isIndianMobile("98765432101")).toBe(false);
  });

  it("refuses a number that starts wrong", () => {
    expect(isIndianMobile("1234567890")).toBe(false);
    expect(isIndianMobile("5876543210")).toBe(false);
  });

  it("refuses letters", () => {
    // z.string().min(10).max(10) accepted this, which is what the schemas used to be.
    expect(isIndianMobile("98765abc10")).toBe(false);
    expect(isIndianMobile("abcdefghij")).toBe(false);
  });

  it("accepts the number however it was punctuated", () => {
    // The person's number is the same number whether or not they typed the country
    // code; refusing it teaches them to guess at the format instead.
    for (const n of ["+91 9876543210", "919876543210", "+91-98765-43210", "09876543210", "98765 43210"]) {
      expect(isIndianMobile(n)).toBe(true);
    }
  });
});

describe("normalising, which is what stops two accounts becoming three", () => {
  it("reduces every spelling of one number to the same digits", () => {
    const forms = ["9876543210", "+91 9876543210", "919876543210", "+91-98765-43210", "09876543210"];
    expect(new Set(forms.map(normalizePhone))).toEqual(new Set(["9876543210"]));
  });

  it("hands back what it has rather than inventing a valid number", () => {
    // A normaliser that repairs is a normaliser that quietly creates the wrong
    // account. This one strips punctuation and stops.
    expect(normalizePhone("12345")).toBe("12345");
    expect(normalizePhone("abc")).toBe("");
  });

  it("trims an address without touching its case", () => {
    // Case is what the person typed and what they should see on their profile.
    // Whether two addresses match is a different question, asked by sameEmail.
    expect(normalizeEmail("  Ravi@Example.com  ")).toBe("Ravi@Example.com");
  });
});

describe("whether two contact details are the same one", () => {
  it("folds case when comparing addresses", () => {
    expect(sameEmail("Ravi@X.com", "ravi@x.com ")).toBe(true);
  });

  it("does not make two blanks the same address", () => {
    // Two accounts with no address are not two accounts sharing one.
    expect(sameEmail("", "")).toBe(false);
    expect(sameEmail(null, undefined)).toBe(false);
    expect(sameEmail("  ", "")).toBe(false);
  });

  it("sees through the punctuation when comparing numbers", () => {
    expect(samePhone("+91 9876543210", "9876543210")).toBe(true);
    expect(samePhone("919876543210", "9876543210")).toBe(true);
  });

  it("keeps two different numbers different", () => {
    expect(samePhone("9876543210", "9876543211")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });
});
