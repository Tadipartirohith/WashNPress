import type { FastifyReply, FastifyRequest } from "fastify";
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

export { hasRole };

export async function requireRole(request: FastifyRequest, reply: FastifyReply, container: Container, role: Role): Promise<Session | null> {
  const session = await requireSession(request, reply, container);
  if (!session) return null;
  if (!hasRole(session, role)) { reply.code(403).send({ error: "forbidden", requires: role }); return null; }
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
