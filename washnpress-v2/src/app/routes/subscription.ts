import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";
import { InsufficientBalanceError } from "../../services/wallet-service";

const subscribeSchema = z.object({ planId: z.string(), cycle: z.enum(["monthly", "annual"]).default("monthly") });
const changeSchema = z.object({ planId: z.string() });
const pauseSchema = z.object({ until: z.string() });
const cancelSchema = z.object({ reason: z.string().min(1) });

export function registerSubscriptionRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/subscription", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.residentId) return reply.code(409).send({ error: "onboarding_incomplete" });
    return reply.send({
      subscription: await container.subscriptions.getActive(s.residentId),
      usage: await container.subscriptions.usage(s.residentId),
    });
  });

  // The usage panel: allowance, what the accepted quantities have consumed, and
  // what is left. Never derived in the client.
  app.get("/v1/subscription/usage", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.residentId) return reply.code(409).send({ error: "onboarding_incomplete" });
    return reply.send({ usage: await container.subscriptions.usage(s.residentId) });
  });

  app.post("/v1/subscription/subscribe", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const sub = await container.subscriptions.subscribe(s.residentId!, parsed.data.planId, parsed.data.cycle);
      return reply.code(201).send({ subscription: sub });
    } catch (e) {
      if (e instanceof InsufficientBalanceError) return reply.code(402).send({ error: "insufficient_balance", action: "top_up_wallet" });
      return reply.code(400).send({ error: "subscribe_failed", message: (e as Error).message });
    }
  });

  app.post("/v1/subscription/change", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.subscriptions.changePlan(s.residentId!, parsed.data.planId);
    return reply.send({ subscription: result.subscription, prorationPaise: result.prorationPaise, note: "Change takes effect next cycle" });
  });

  app.post("/v1/subscription/pause", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = pauseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ subscription: await container.subscriptions.pause(s.residentId!, parsed.data.until) });
  });

  app.post("/v1/subscription/cancel", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ subscription: await container.subscriptions.cancel(s.residentId!, parsed.data.reason) });
  });
}
