// The same email and phone rules the API enforces, so a field can answer before the
// request is made.
//
// Kept deliberately identical to washnpress-v2/src/domain/contact.ts. The app is not
// the authority — the API re-checks everything — but a screen that applies a looser
// rule sends somebody into a round trip to be told no, and a stricter one refuses
// what would have worked.
//
// The email pattern was pasted into staff-wizard.tsx and again into the resident
// profile screen, and the phone pattern existed in the wizard only, so onboarding and
// the login screen checked nothing at all. One copy now, tested, outside React.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/;

export const CONTACT_MESSAGES = {
  email: "Enter a valid email address.",
  phone: "Enter a valid 10-digit mobile number.",
} as const;

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

// Ten digits, however it was typed: punctuation out, an Indian country code off the
// front. Somebody who types their own number with +91 has given the right number,
// and refusing it teaches them to guess at the format instead.
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isEmail(value: string | null | undefined): boolean {
  return EMAIL.test(normalizeEmail(value));
}

export function isPhone(value: string | null | undefined): boolean {
  return INDIAN_MOBILE.test(normalizePhone(value));
}

// What to show under the field, or null when there is nothing to say.
//
// Silent while the field is empty: an error that appears before anybody has typed is
// an error about the form rather than about the person's answer. A required field
// that is still blank is what the submit button is for.
export function emailProblem(value: string): string | null {
  const email = normalizeEmail(value);
  // A blank address is not a wrong one. Whether a blank is allowed at all is
  // `contactReady`'s question, because it is the submit button that has to answer it.
  if (!email) return null;
  return isEmail(email) ? null : CONTACT_MESSAGES.email;
}

export function phoneProblem(value: string): string | null {
  if (!normalizePhone(value)) return null;
  return isPhone(value) ? null : CONTACT_MESSAGES.phone;
}

// Whether the two fields together are good enough to send.
//
// Separate from the per-field messages because "nothing typed yet" is not something
// to complain about but is something to stay disabled for.
// A date of birth, as the API takes it (YYYY-MM-DD), from the day, month and year it
// is chosen with. Null until all three are chosen, and null for a day that does not
// exist (31 April), one after `today`, or one before 1900: the bounds the API applies.
export function dateOfBirthFrom(
  year: string | undefined, month: string | undefined, day: string | undefined, today: string,
): string | null {
  if (!year || !month || !day) return null;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso >= "1900-01-01" && iso <= today ? iso : null;
}

export function contactReady(
  phone: string,
  email: string,
  options: { emailRequired?: boolean } = {},
): boolean {
  if (!isPhone(phone)) return false;
  const address = normalizeEmail(email);
  if (options.emailRequired) return isEmail(address);
  return address === "" || isEmail(address);
}
