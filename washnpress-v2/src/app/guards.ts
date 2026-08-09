import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session, Role } from "../domain/models";
import type { Container } from "../container";

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

export function hasRole(session: Session, role: Role): boolean {
  return session.roles.includes(role) || (role !== "admin" && session.roles.includes("admin"));
}

export async function requireRole(request: FastifyRequest, reply: FastifyReply, container: Container, role: Role): Promise<Session | null> {
  const session = await requireSession(request, reply, container);
  if (!session) return null;
  if (!hasRole(session, role)) { reply.code(403).send({ error: "forbidden", requires: role }); return null; }
  return session;
}

export { SESSION_COOKIE };
