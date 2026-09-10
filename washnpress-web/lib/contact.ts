// The same email and phone rules the API enforces, so the form can say what is
// wrong before the request is made.
//
// Kept deliberately identical to washnpress-v2/src/domain/contact.ts. The frontend
// is not the authority — the API is, and it re-checks everything — but a form that
// applies a looser rule than the server sends people into a round trip to be told
// no, and one that applies a stricter rule refuses addresses that would have worked.
// Both happened: the supervisor's operator form used /.+@.+\..+/, which accepts
// "a@b.c" and an address with a space in it.
//
// The rest of the forms had nothing of their own and leaned on the browser, whose
// message for a two-@ address is "A part following '@' should not contain the symbol
// '@'" — a sentence about grammar, shown in the browser's own bubble, in a product
// that has an error style of its own.

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
// front. Somebody who types their number with +91 has given the right number.
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
// Silent while the field is empty and untouched: an error that appears before
// anybody has typed is an error about the form, not about the person's answer. A
// required field that is still blank is the submit button's problem, not this one's.
export function emailProblem(value: string, options: { required?: boolean } = {}): string | null {
  const email = normalizeEmail(value);
  if (!email) return options.required && value !== "" ? CONTACT_MESSAGES.email : null;
  return isEmail(email) ? null : CONTACT_MESSAGES.email;
}

export function phoneProblem(value: string): string | null {
  if (!value.trim()) return null;
  return isPhone(value) ? null : CONTACT_MESSAGES.phone;
}
