import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodError } from "zod";
import type { Session, Role } from "../domain/models";
import type { Container } from "../container";
import { ForbiddenScopeError, hasRole } from "../domain/access";

const SESSION_COOKIE = "wnp_session";

export function tokenFromRequest(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookie = request.headers.cookie ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply, container: Container): Promise<Session | null> {
  const session = await container.auth.sessionFromToken(tokenFromRequest(request));
  if (!session) { reply.code(401).send({ error: "unauthorized" }); return null; }
  return session;
}

// For endpoints that are readable without signing in but say more when you have.
// A bad or expired token is treated as no token rather than as an error, because
// the answer is still a perfectly good public one.
export async function optionalSession(request: FastifyRequest, container: Container): Promise<Session | null> {
  const token = tokenFromRequest(request);
  if (!token) return null;
  try {
    return await container.auth.sessionFromToken(token);
  } catch {
    return null;
  }
}

export { hasRole };

// Roles that have to be vouched for before the portal opens to them. A resident
// verifies themselves by onboarding; an admin is the root of the chain.
const VERIFIED_ROLES: Role[] = ["supervisor", "operator"];

export async function requireRole(request: FastifyRequest, reply: FastifyReply, container: Container, role: Role): Promise<Session | null> {
  const session = await requireSession(request, reply, container);
  if (!session) return null;
  if (!hasRole(session, role)) { reply.code(403).send({ error: "forbidden", requires: role }); return null; }

  // A refusal is still a refusal (ST1-I108).
  //
  // Waiting to be approved is no longer a state anybody is put in: whoever creates a
  // staff account is the person who vouched for it, so it is approved as it is made,
  // and the "Pending verification" screen that used to hold new operators out of the
  // portal is gone. What remains is an explicit rejection, which is somebody saying
  // no on purpose — that has to keep working, and it is enforced here rather than by
  // hiding a screen, because a hidden screen is still a reachable endpoint.
  if (VERIFIED_ROLES.includes(role) && !hasRole(session, "admin")) {
    const user = await container.store.users.get(session.userId);
    if ((user?.verificationStatus ?? "approved") === "rejected") {
      reply.code(403).send({
        error: "verification_rejected",
        message: "Your account was not approved. Speak to whoever manages your society.",
        verificationStatus: "rejected",
      });
      return null;
    }
  }
  return session;
}

// Some endpoints are open to more than one staff role, for example an orders list
// that both a supervisor and an admin may read with different visible scopes.
export async function requireAnyRole(request: FastifyRequest, reply: FastifyReply, container: Container, roles: Role[]): Promise<Session | null> {
  const session = await requireSession(request, reply, container);
  if (!session) return null;
  if (!roles.some((role) => hasRole(session, role))) {
    reply.code(403).send({ error: "forbidden", requiresAny: roles });
    return null;
  }
  return session;
}

// The one way a route refuses a body it could not parse.
//
// Over a hundred routes answered `{ error: "invalid_request" }` and nothing else, so
// whoever filled in the form was told the request was invalid and never which of the
// fourteen boxes to go back to. Some routes had been given `details` one at a time,
// which helps a client that knows to look for it, but the sentence a person actually
// reads is `message` — that is the first thing `humanMessage` reaches for in both
// clients — and nothing was putting one there.
//
// So: the machine code stays, `details` carries zod's per-field errors for a form
// that highlights boxes, and `message` carries the first of those sentences for the
// one line of text under the button. The field chosen for `message` is the first one
// zod reported, which for an object body follows the schema's own field order.
export function invalidRequest(reply: FastifyReply, error: ZodError): FastifyReply {
  const flattened = error.flatten();
  const firstField = Object.values(flattened.fieldErrors).find((messages) => messages && messages.length)?.[0];
  const message = firstField ?? flattened.formErrors[0];
  return reply.code(400).send({ error: "invalid_request", message, details: flattened });
}

// Wraps a handler so a scope violation always becomes a 403 with the same shape,
// rather than each route remembering to catch it.
export async function withScope<T>(reply: FastifyReply, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ForbiddenScopeError) {
      reply.code(403).send({ error: "forbidden_scope", message: error.message });
      return undefined;
    }
    throw error;
  }
}

export { SESSION_COOKIE };
