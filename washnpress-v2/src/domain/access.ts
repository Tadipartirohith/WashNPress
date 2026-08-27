import type { Role, Session } from "./models";

// One place that answers "what is this session allowed to see". Every route asks
// this rather than re-deriving the rule, so a society boundary cannot be missed on
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
  societyIds: string[] | null;
  // Which blocks inside those societies. null means the whole of every society
  // above, which is what a supervisor has and what an operator with no block
  // assignment used to have.
  blockIds: string[] | null;
  residentId: string | null;
}

export function scopeFor(session: Session): Scope {
  if (isAdmin(session)) return { societyIds: null, blockIds: null, residentId: null };
  if (isSupervisor(session)) {
    // A supervisor runs exactly one society, and the whole of it. The boundary
    // used to be an area — one person answering for every society in it — and a
    // supervisor with no society assigned inherited the area rather than being
    // held to nothing. There is no area to fall back to now: a supervisor who has
    // not been given a society reaches no society, which is what an empty
    // assignment ought to mean.
    return { societyIds: session.societyIds ?? [], blockIds: null, residentId: null };
  }
  if (isOperator(session)) {
    // An operator works the blocks their supervisor gave them, inside the one
    // society that supervisor runs. Blocks are the assignment, so an operator with
    // none reaches nothing rather than the whole society.
    return {
      societyIds: session.societyIds ?? [],
      blockIds: session.blockIds ?? [],
      residentId: null,
    };
  }
  return { societyIds: [], blockIds: null, residentId: session.residentId };
}

export function allowsSociety(scope: Scope, societyId: string | null | undefined): boolean {
  if (scope.societyIds === null) return true;
  if (!societyId) return false;
  return scope.societyIds.includes(societyId);
}

// Whether a piece of work in an allowed society is also in an allowed block.
//
// A block that is not known — an order raised before blocks existed, or a resident
// who never recorded which tower they live in — is inside the society but outside
// any narrower assignment, so an operator restricted to two of three blocks does not
// silently pick it up.
export function allowsBlock(scope: Scope, blockId: string | null | undefined): boolean {
  if (scope.blockIds === null) return true;
  if (!blockId) return false;
  return scope.blockIds.includes(blockId);
}

// The whole chain in one question: society, then block.
export function allowsWork(
  scope: Scope,
  work: { societyId?: string | null; blockId?: string | null },
): boolean {
  return allowsSociety(scope, work.societyId) && allowsBlock(scope, work.blockId);
}

export function assert(condition: boolean, message?: string): void {
  if (!condition) throw new ForbiddenScopeError(message);
}
