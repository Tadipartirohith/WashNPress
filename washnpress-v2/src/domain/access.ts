import type { Role, Session } from "./models";

// One place that answers "what is this session allowed to see". Every route asks
// this rather than re-deriving the rule, so an area boundary cannot be missed on
// one endpoint while being enforced on another.
export class ForbiddenScopeError extends Error {
  constructor(message = "Resource is outside your permitted scope") {
    super(message);
    this.name = "ForbiddenScopeError";
  }
}

export function isAdmin(session: Session): boolean {
  return session.roles.includes("admin");
}
export function isSupervisor(session: Session): boolean {
  return session.roles.includes("supervisor");
}
export function isOperator(session: Session): boolean {
  return session.roles.includes("operator");
}
export function isResident(session: Session): boolean {
  return session.roles.includes("resident");
}

export function hasRole(session: Session, role: Role): boolean {
  // Admin is the highest role and implies every non-admin capability.
  return session.roles.includes(role) || (role !== "admin" && session.roles.includes("admin"));
}

export interface Scope {
  // null means unrestricted (admin).
  areaIds: string[] | null;
  societyIds: string[] | null;
  residentId: string | null;
}

export function scopeFor(session: Session): Scope {
  if (isAdmin(session)) return { areaIds: null, societyIds: null, residentId: null };
  if (isSupervisor(session)) {
    return { areaIds: session.areaId ? [session.areaId] : [], societyIds: null, residentId: null };
  }
  if (isOperator(session)) {
    // An operator is bound to the societies they are assigned to. No assignment
    // means no societies — not, as it used to, every society in the area. Area-wide
    // cover is a deliberate grant an admin makes, never the default a new account
    // falls into.
    return {
      areaIds: session.areaId ? [session.areaId] : [],
      societyIds: session.areaWideAccess ? null : session.societyIds,
      residentId: null,
    };
  }
  return { areaIds: [], societyIds: [], residentId: session.residentId };
}

export function allowsArea(scope: Scope, areaId: string | null | undefined): boolean {
  if (scope.areaIds === null) return true;
  if (!areaId) return false;
  return scope.areaIds.includes(areaId);
}

export function allowsSociety(scope: Scope, societyId: string | null | undefined, societyAreaId: string | null | undefined): boolean {
  if (scope.areaIds !== null && !allowsArea(scope, societyAreaId)) return false;
  if (scope.societyIds === null) return true;
  if (!societyId) return false;
  return scope.societyIds.includes(societyId);
}

export function assert(condition: boolean, message?: string): void {
  if (!condition) throw new ForbiddenScopeError(message);
}
