import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { SESSION_COOKIE, requireSession } from "../guards";

const sendSchema = z.object({ phone: z.string() });
const verifySchema = z.object({ phone: z.string(), otp: z.string() });
// Registering a handset for push. The app sends this on every start, not only on
// first install: an operating system rotates a push token, and an app that
// registered once would quietly stop being reachable weeks later with nothing on
// the screen to say so.
const deviceSchema = z.object({
  token: z.string().min(8).max(512),
  platform: z.enum(["ios", "android", "web"]),
  // Which of the two applications is asking. A resident's phone and a supervisor's
  // phone are different store listings, and one may not deliver the other's work.
  app: z.enum(["resident", "staff"]),
});

const onboardSchema = z.object({
  fullName: z.string().min(2),
  societyId: z.string(),
  unitNumber: z.string().min(1),
  email: z.string().email().optional(),
  towerBlock: z.string().optional(),
  // The block chosen from the society's own list. Which block somebody lives in is
  // what decides who collects from them, so it is a choice rather than free text;
  // towerBlock is still accepted for a client that predates blocks and is matched
  // against the society's blocks by name.
  blockId: z.string().optional(),
  address: z.string().optional(),
  pickupAddress: z.string().optional(),
  preferredWindows: z.array(z.string()).optional(),
});

// The role on the session decides which portal the client opens. Returning it at
// sign in means the app never has to guess, and never shows a portal the backend
// would refuse anyway.
function portalFor(roles: string[]): "admin" | "supervisor" | "operations" | "resident" {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("supervisor")) return "supervisor";
  if (roles.includes("operator")) return "operations";
  return "resident";
}

// One place that decides what a session cookie looks like. Secure is set outside
// development, so the cookie is never sent over plain HTTP in a deployed
// environment; SameSite=Lax keeps it off cross-site requests either way.
function sessionCookie(container: Container, token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    `SameSite=${container.config.app.env === "production" ? "Strict" : "Lax"}`,
    `Max-Age=${container.config.auth.sessionTtlSeconds}`,
  ];
  if (container.config.app.env !== "development" && container.config.app.env !== "test") parts.push("Secure");
  return parts.join("; ");
}

// The same cookie, already expired, which is how a cookie is actually removed.
function clearedSessionCookie(container: Container): string {
  const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
  if (container.config.app.env !== "development" && container.config.app.env !== "test") parts.push("Secure");
  return parts.join("; ");
}

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
    // Read before the login is stamped, because stamping it is what makes the next
    // one a returning login.
    const before = await container.users.byPhone(parsed.data.phone);
    const firstLogin = Boolean(before) && !before!.lastLoginAt;
    const result = await container.auth.verifyOtp(parsed.data.phone, parsed.data.otp);
    if ("error" in result) return reply.code(401).send({ error: "otp_invalid", reason: result.error });
    reply.header("set-cookie", sessionCookie(container, result.session.token));
    const isResident = result.user.roles.includes("resident");
    return reply.send({
      token: result.session.token,
      // Somebody signing in for the first time is not coming back, and should not be
      // greeted as though they were. The client used to say "Welcome back" to
      // everybody because it had no way to tell the difference.
      firstLogin,
      user: {
        id: result.user.id, phone: result.user.phone, fullName: result.user.fullName,
        roles: result.user.roles, societyIds: result.user.societyIds,
      },
      portal: portalFor(result.user.roles),
      // Only residents are onboarded through the app; staff accounts are provisioned.
      needsOnboarding: isResident && !result.resident?.onboardingCompleted,
    });
  });

  app.post("/v1/auth/onboarding", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    // Staff accounts are provisioned by an admin, so there is nothing for them to
    // onboard into and nothing here they should be able to write.
    if (!session.roles.includes("resident")) {
      return reply.code(403).send({
        error: "onboarding_not_applicable",
        message: "Only residents go through onboarding. Staff accounts are created by an admin.",
      });
    }
    const parsed = onboardSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const resident = await container.auth.completeOnboarding(session.userId, parsed.data);
      // The session carries the resident scope, so it is reissued once onboarding
      // completes and the caller swaps to the new token.
      const user = await container.store.users.get(session.userId);
      const refreshed = user ? await container.auth.issueSession(user) : null;
      if (refreshed) {
        reply.header("set-cookie", sessionCookie(container, refreshed.token));
      }
      return reply.code(201).send({ resident, token: refreshed?.token ?? null, onboardingCompleted: true });
    } catch (e) {
      return reply.code(400).send({ error: "onboarding_failed", message: (e as Error).message });
    }
  });

  app.get("/v1/auth/me", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    const user = await container.store.users.get(session.userId);
    const status = await container.auth.onboardingStatus(session.userId);
    return reply.send({
      user,
      // Whether this account has ever finished signing in before. /me is read on
      // every app start, so the greeting can be decided from one place.
      firstLogin: !user?.lastLoginAt,
      residentId: session.residentId, societyId: session.societyId,
      roles: session.roles,
      societyIds: session.societyIds, blockIds: session.blockIds ?? [],
      portal: portalFor(session.roles),
      needsOnboarding: session.roles.includes("resident") && !session.roles.includes("admin") && !status.completed,
    });
  });

  // ------------------------------------------------------------- devices

  app.post("/v1/auth/devices", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    const parsed = deviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const device = await container.devices.register({ userId: session.userId, ...parsed.data });
    return reply.send({ device: { platform: device.platform, app: device.app, lastSeenAt: device.lastSeenAt } });
  });

  app.delete("/v1/auth/devices", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    const parsed = z.object({ token: z.string().min(8).max(512) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    // Only this account's own handset. Otherwise knowing a token would be enough
    // to silence somebody else's phone.
    const found = await container.store.deviceTokens.get(parsed.data.token);
    if (found && found.userId !== session.userId) return reply.code(404).send({ error: "not_found" });
    await container.devices.revoke(parsed.data.token);
    return reply.send({ revoked: true });
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    // Signing out on a handset stops that handset being one of the places this
    // account is reachable. On a shared device the next person to sign in must not
    // be handed the last person's notifications.
    const body = z.object({ deviceToken: z.string().optional() }).safeParse(req.body);
    if (body.success && body.data.deviceToken) {
      const found = await container.store.deviceTokens.get(body.data.deviceToken);
      if (found?.userId === session.userId) await container.devices.revoke(body.data.deviceToken);
    }
    await container.auth.logout(session.token);
    // Deleting the server side session is what actually ends it, but a cookie client
    // kept the old cookie until it expired on its own. Expire it here as well, so
    // logging out leaves nothing behind on either side.
    reply.header("set-cookie", clearedSessionCookie(container));
    return reply.send({ loggedOut: true });
  });
}
