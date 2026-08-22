import type { Society, User } from "./models";

// A record that has been in the database for a while may predate a field, or may have
// been written by a tool or an import that did not set one. The code above the store
// is entitled to assume the shape in models.ts is real: it calls `.map` on arrays and
// `.toLowerCase` on strings without checking, and it should be able to.
//
// So the store fills the gaps on the way out. One record missing one field then costs
// that record a sensible default, rather than costing the whole endpoint a 500 and
// every user of that screen their data.
//
// This is not a substitute for writing records correctly. It is a floor under reads.

export function normaliseUser(user: User): User {
  if (Array.isArray(user.societyIds) && Array.isArray(user.roles) && user.status) return user;
  return {
    ...user,
    // An account with no roles can sign in and see nothing, which is the safe
    // reading of a missing value. An account with no societies covers none.
    roles: Array.isArray(user.roles) ? user.roles : [],
    societyIds: Array.isArray(user.societyIds) ? user.societyIds : [],
    status: user.status ?? "active",
    fullName: user.fullName ?? null,
    email: user.email ?? null,
    employeeId: user.employeeId ?? null,
    areaId: user.areaId ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function normaliseSociety(society: Society): Society {
  if (typeof society.name === "string" && typeof society.code === "string" && society.status) return society;
  return {
    ...society,
    // A society with no name still has an id, and showing it as unnamed is far more
    // useful than refusing to list any society at all.
    name: typeof society.name === "string" ? society.name : "",
    code: typeof society.code === "string" ? society.code : "",
    areaId: society.areaId ?? null,
    address: society.address ?? null,
    city: society.city ?? "",
    state: society.state ?? "",
    status: society.status ?? "active",
  };
}
