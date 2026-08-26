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
  // Which blocks inside those societies. null means the whole of every society
  // above, which is what an operator with no block assignment has always had.
  blockIds: string[] | null;
  residentId: string | null;
}

export function scopeFor(session: Session): Scope {
  if (isAdmin(session)) return { areaIds: null, societyIds: null, blockIds: null, residentId: null };
  if (isSupervisor(session)) {
    // A supervisor runs one society. This used to be an area — one person answering
    // for every society in it — and a supervisor who has been given a society is
    // now held to it, exactly as an operator is held to theirs. A supervisor with
    // no society assigned yet still sees their area, so an account created before
    // it was assigned is not locked out of the platform on the way to being given
    // one; the moment a society is assigned, the area stops being the boundary.
    const societyIds = session.societyIds ?? [];
    return {
      areaIds: session.areaId ? [session.areaId] : [],
      societyIds: societyIds.length > 0 ? societyIds : null,
      blockIds: null,
      residentId: null,
    };
  }
  if (isOperator(session)) {
    // An operator is bound to the societies they are assigned to, and within those
    // to the blocks they are given. No society assignment means no societies — not,
    // as it used to, every society in the area. Area-wide cover is a deliberate
    // grant an admin makes, never the default a new account falls into.
    const blockIds = session.blockIds ?? [];
    return {
      areaIds: session.areaId ? [session.areaId] : [],
      societyIds: session.areaWideAccess ? null : session.societyIds,
      blockIds: blockIds.length > 0 ? blockIds : null,
      residentId: null,
    };
  }
  return { areaIds: [], societyIds: [], blockIds: null, residentId: session.residentId };
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

// Whether a piece of work in an allowed society is also in an allowed block.
//
// A block that is not known — an order raised before blocks existed, or a resident
// who never recorded which tower they live in — is inside the society but outside
// any narrower assignment, so an operator restricted to two of three blocks does not
// silently pick it up. An operator with no block assignment covers all of them,
// including the unknown ones, which is what their assignment has always meant.
export function allowsBlock(scope: Scope, blockId: string | null | undefined): boolean {
  if (scope.blockIds === null) return true;
  if (!blockId) return false;
  return scope.blockIds.includes(blockId);
}

// The whole chain in one question: area, then society, then block.
export function allowsWork(
  scope: Scope,
  work: { areaId?: string | null; societyId?: string | null; blockId?: string | null },
): boolean {
  return allowsSociety(scope, work.societyId, work.areaId) && allowsBlock(scope, work.blockId);
}

export function assert(condition: boolean, message?: string): void {
  if (!condition) throw new ForbiddenScopeError(message);
}
