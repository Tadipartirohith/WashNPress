import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session, Role } from "../domain/models";
import type { Container } from "../container";
import type { Area } from "../domain/models";
import { stateFor } from "../domain/regions";
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

  // Signing in is not the same as being allowed in. Enforced here rather than by
  // hiding screens, because a hidden screen is still a reachable endpoint.
  if (VERIFIED_ROLES.includes(role) && !hasRole(session, "admin")) {
    const user = await container.store.users.get(session.userId);
    const status = user?.verificationStatus ?? "approved";
    if (status !== "approved") {
      reply.code(403).send({
        error: status === "rejected" ? "verification_rejected" : "verification_pending",
        message: status === "rejected"
          ? "Your account was not approved. Speak to whoever manages your area."
          : "Your account is pending verification. Please wait for your supervisor or admin to approve your access.",
        verificationStatus: status,
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

// A staff account may only be created against details that have been proved, and in
// an area that is actually in the state that was chosen.
//
// The verification is checked against the value it was obtained for, so proving one
// number and then submitting another is refused: otherwise the proof is a token that
// says "somebody verified something", which is not the claim being made.
//
// The state check has to happen here as well as in the form. A form that reloads the
// area list when the state changes still sends whatever ids it was given, and a
// caller that is not the form sends whatever it likes.
export async function refuseUnprovenStaff(
  container: Container,
  input: {
    phone: string; email: string;
    phoneVerificationId: string; emailVerificationId: string;
    region: string;
  },
  area?: Area | null,
): Promise<{ code: number; body: Record<string, unknown> } | null> {
  if (!container.verifications.proves(input.phoneVerificationId, "phone", input.phone)) {
    return {
      code: 422,
      body: {
        error: "phone_not_verified",
        message: "Confirm the code sent to that mobile number before creating the account.",
      },
    };
  }
  if (!container.verifications.proves(input.emailVerificationId, "email", input.email)) {
    return {
      code: 422,
      body: {
        error: "email_not_verified",
        message: "Confirm the code sent to that email address before creating the account.",
      },
    };
  }
  const region = stateFor(input.region);
  if (!region) {
    return { code: 422, body: { error: "unknown_region", message: "Choose the state this person works in." } };
  }
  if (area && area.region !== region) {
    return {
      code: 422,
      body: {
        error: "area_outside_region",
        message: `${area.name} is in ${area.region}, not ${region}.`,
      },
    };
  }
  return null;
}
