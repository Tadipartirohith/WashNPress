import type { Role, User } from "./models";

// Who a staff member is, and how the platform knows the details are real.
//
// A staff account used to be created from a name typed into one box and an employee
// id typed into another. Both were wrong in their own way: one box cannot hold a
// first name and a surname without the person entering it deciding where the split
// is, and an employee id typed by hand collides with an existing one sooner or
// later.
//
// The phone number is not proved here. Creating an account and authenticating as
// that account are two different things, and they were run together: an admin
// filling in a form had to hold an OTP sent to somebody else's phone before the
// account could exist at all. The number is proved by the person who owns it, with
// the OTP they receive the first time they sign in.

// A name, kept in the two parts it is actually made of.
export interface StaffName { firstName: string; lastName: string }

export function fullNameOf(name: StaffName): string {
  return `${name.firstName.trim()} ${name.lastName.trim()}`.trim();
}

// Reading a name recorded before it was kept in two parts. Everything up to the
// last space is the first name, which is the only split a machine can make and the
// one most likely to be right.
export function splitFullName(fullName: string | null | undefined): StaffName {
  const trimmed = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const at = trimmed.lastIndexOf(" ");
  if (at < 0) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, at), lastName: trimmed.slice(at + 1) };
}

export function nameOf(user: Pick<User, "fullName" | "firstName" | "lastName">): StaffName {
  if (user.firstName || user.lastName) {
    return { firstName: user.firstName ?? "", lastName: user.lastName ?? "" };
  }
  return splitFullName(user.fullName);
}

// The prefix each role's employee ids carry, so a number says what it belongs to.
const ROLE_PREFIX: Partial<Record<Role, string>> = {
  supervisor: "SUP",
  operator: "WNP-OPS",
  admin: "WNP-ADM",
  support: "SUP",
};

// Three digits, so the hundredth supervisor sorts after the ninety-ninth rather
// than between the ninth and the tenth.
const WIDTH = 3;

// The next employee id for a role.
//
// Generated rather than typed. A number somebody types is a number somebody
// eventually types twice, and the collision surfaces as two people with one id
// rather than as an error at the moment it was made.
export function nextEmployeeId(role: Role, existing: (string | null | undefined)[]): string {
  const prefix = ROLE_PREFIX[role] ?? "WNP-STF";
  const used = new Set(existing.filter((id): id is string => Boolean(id)).map((id) => id.toUpperCase()));
  const taken = [...used]
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.slice(prefix.length + 1)))
    .filter((n) => Number.isFinite(n));
  let next = (taken.length ? Math.max(...taken) : 0) + 1;
  // A gap-free sequence is not the point; an unused one is. Anything already taken
  // by an id that does not follow the pattern is skipped rather than reused.
  while (used.has(`${prefix}-${String(next).padStart(WIDTH, "0")}`)) next += 1;
  return `${prefix}-${String(next).padStart(WIDTH, "0")}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string | null | undefined): boolean {
  return typeof value === "string" && EMAIL.test(value.trim());
}

// What is wrong with the details somebody has entered, said all at once rather than
// one field at a time.
//
// An address is only insisted on where the role needs one. A supervisor is reached
// on their phone and signs in with it, so an email is somewhere to send them things
// rather than something the account cannot exist without; an operator's is asked
// for. An address that is given is checked either way — an optional field is not a
// field where anything goes.
export function staffDetailProblems(
  input: { firstName?: string; lastName?: string; phone?: string; email?: string },
  options: { emailRequired?: boolean } = {},
): string[] {
  const problems: string[] = [];
  if (!input.firstName?.trim()) problems.push("A first name is needed");
  if (!input.lastName?.trim()) problems.push("A last name is needed");
  if (!/^[6-9][0-9]{9}$/.test((input.phone ?? "").trim())) problems.push("A ten digit mobile number is needed");
  const email = (input.email ?? "").trim();
  if (options.emailRequired && !email) problems.push("An email address is needed");
  else if (email && !isEmail(email)) problems.push("A valid email address is needed");
  return problems;
}
