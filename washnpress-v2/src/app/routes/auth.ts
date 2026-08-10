import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { SESSION_COOKIE, requireSession } from "../guards";

const sendSchema = z.object({ phone: z.string() });
const verifySchema = z.object({ phone: z.string(), otp: z.string() });
const onboardSchema = z.object({ fullName: z.string().min(2), societyId: z.string(), unitNumber: z.string(), towerBlock: z.string().optional(), preferredWindows: z.array(z.string()).optional() });

export function registerAuthRoutes(app: FastifyInstance, container: Container): void {
  app.post("/v1/auth/otp/send", async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send(await container.auth.sendOtp(parsed.data.phone)); }
    catch (e) { return reply.code(400).send({ error: "otp_send_failed", message: (e as Error).message }); }
  });

  app.post("/v1/auth/otp/verify", async (req, reply) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.auth.verifyOtp(parsed.data.phone, parsed.data.otp);
    if ("error" in result) return reply.code(401).send({ error: "otp_invalid", reason: result.error });
    reply.header("set-cookie", `${SESSION_COOKIE}=${result.session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${container.config.auth.sessionTtlSeconds}`);
    return reply.send({ token: result.session.token, user: { id: result.user.id, phone: result.user.phone, roles: result.user.roles }, needsOnboarding: result.session.residentId === null });
  });

  app.post("/v1/auth/onboarding", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    const parsed = onboardSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const resident = await container.auth.completeOnboarding(session.userId, parsed.data);
    return reply.code(201).send({ resident });
  });

  app.get("/v1/auth/me", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    const user = await container.store.users.get(session.userId);
    return reply.send({ user, residentId: session.residentId, societyId: session.societyId, roles: session.roles });
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    await container.auth.logout(session.token);
    return reply.send({ loggedOut: true });
  });
}
