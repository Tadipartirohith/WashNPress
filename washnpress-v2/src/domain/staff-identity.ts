import type { Role, User } from "./models";

// Who a staff member is, and how the platform knows the details are real.
//
// A staff account used to be created from a name typed into one box, an employee id
// typed into another, and a phone number nobody had checked. All three were wrong in
// their own way: one box cannot hold a first name and a surname without the person
// entering it deciding where the split is, an employee id typed by hand collides
// with an existing one sooner or later, and a phone number nobody has verified is a
// staff account that cannot be signed into and nobody finds out until they try.

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
  supervisor: "WNP-SUP",
  operator: "WNP-OPS",
  admin: "WNP-ADM",
  support: "WNP-SUP",
};

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
  while (used.has(`${prefix}-${String(next).padStart(2, "0")}`)) next += 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string | null | undefined): boolean {
  return typeof value === "string" && EMAIL.test(value.trim());
}

// What is wrong with the details somebody has entered, said all at once rather than
// one field at a time.
export function staffDetailProblems(input: {
  firstName?: string; lastName?: string; phone?: string; email?: string;
}): string[] {
  const problems: string[] = [];
  if (!input.firstName?.trim()) problems.push("A first name is needed");
  if (!input.lastName?.trim()) problems.push("A last name is needed");
  if (!/^[6-9][0-9]{9}$/.test((input.phone ?? "").trim())) problems.push("A ten digit mobile number is needed");
  if (!isEmail(input.email)) problems.push("A valid email address is needed");
  return problems;
}
