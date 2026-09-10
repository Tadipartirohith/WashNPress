// The one place that decides whether an email address or a phone number is usable,
// and what two of them have to look like to count as the same.
//
// The rules existed already — they were just written down four times. The phone
// pattern lived in `staff-identity` and again in `otp`; the email pattern lived in
// `staff-identity`, and again in the staff wizard and the resident profile screen on
// mobile. Four copies of a rule is four chances for a route to enforce a slightly
// different one, which is what happened: creating an operator ran the strict check,
// editing one ran zod's `.email()`, and onboarding ran neither.
//
// Normalisation is the half that was missing entirely. Nothing trimmed a phone
// number or stripped a country code before storing it, and `byPhone` compared raw
// strings, so `+91 9876543210` and `9876543210` were two different people to this
// system and the same person to everybody else.

// A valid address, as far as this product is concerned.
//
// Deliberately not the RFC grammar: the address has to survive a round trip through
// a mail server, not through a parser. One `@`, something before it, something after
// it with a dot and a two-letter-or-longer tail. `lavanya@deepthi@gmail.com` fails on
// the second `@`, which is the address in the report.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// An Indian mobile number: ten digits starting 6, 7, 8 or 9.
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/;

// The address as it should be stored: no surrounding whitespace.
//
// Case is left alone. `Ravi@Example.com` is the address the person typed and is what
// they should see on their profile; folding case is a question about whether two
// addresses match, and that is `sameEmail`'s job, not this one's.
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

// The number as it should be stored: ten digits, however it was typed.
//
// Everything that is not a digit goes — spaces, dashes, brackets, a leading plus —
// and then an Indian country code is taken off the front if one is left. `+91 98765
// 43210`, `919876543210` and `9876543210` all normalise to the same ten digits, so
// they can no longer become three accounts.
//
// A number this cannot make sense of is returned digits-only rather than repaired.
// Validation is a separate question, and a normaliser that quietly invents a valid
// number is worse than one that hands back something obviously wrong.
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isEmail(value: string | null | undefined): boolean {
  return typeof value === "string" && EMAIL.test(normalizeEmail(value));
}

// Whether a number is one this product can send an OTP to.
//
// Normalised first, so a number that is only unusable because of how it was typed is
// accepted. The rule itself is unchanged.
export function isIndianMobile(value: string | null | undefined): boolean {
  return INDIAN_MOBILE.test(normalizePhone(value));
}

// Whether two addresses are the same address.
//
// Case-insensitive, because mail servers are, and because somebody typing their own
// address a second time will not capitalise it the same way. Blank is never the same
// as anything, including another blank: two accounts without an address are not two
// accounts with the same one.
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeEmail(a).toLowerCase();
  const right = normalizeEmail(b).toLowerCase();
  return left !== "" && left === right;
}

// Whether two numbers reach the same phone.
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return left !== "" && left === right;
}

// What to tell somebody, in the words the issue asks for. Kept here so that every
// portal says the same sentence about the same problem.
export const CONTACT_MESSAGES = {
  email: "Enter a valid email address.",
  phone: "Enter a valid 10-digit mobile number.",
  emailTaken: "This email address is already registered. Please use a different email.",
  phoneTaken: "This phone number is already registered. Please use a different phone number.",
  emailTakenByOther: "This email address is already registered to another user.",
} as const;
