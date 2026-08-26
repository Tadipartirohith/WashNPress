import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";
import { InsufficientBalanceError } from "../../services/wallet-service";
import { AlreadySubscribedError } from "../../services/subscription-service";

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
      if (e instanceof AlreadySubscribedError) return reply.code(409).send({ error: "already_subscribed", message: e.message });
      return reply.code(400).send({ error: "subscribe_failed", message: (e as Error).message });
    }
  });

  // What changing to this plan would cost, and when it would happen. Writes
  // nothing, so a resident can be shown the consequence before agreeing to it.
  app.get<{ Querystring: { planId?: string } }>("/v1/subscription/change/quote", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.residentId) return reply.code(409).send({ error: "onboarding_incomplete" });
    if (!req.query.planId) return reply.code(400).send({ error: "invalid_request", message: "Which plan?" });
    const result = await container.subscriptions.quoteChange(s.residentId, req.query.planId);
    if (!result.ok) return reply.code(422).send({ error: "change_refused", message: result.reason });
    return reply.send({ quote: result.quote });
  });

  // Confirming it. The subscription does not move until the money does: a plan is
  // not changed in the database merely because somebody pressed a button.
  app.post("/v1/subscription/change", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.subscriptions.changePlan(s.residentId!, parsed.data.planId);

    if (result.status === "refused") {
      return reply.code(422).send({ error: "change_refused", message: result.reason });
    }
    if (result.status === "payment_failed") {
      // Said as plainly as it can be: nothing changed, and this is what is still
      // true. The old flow left the resident unable to tell.
      return reply.code(402).send({
        error: "payment_failed",
        message: `Payment failed. Your current plan is unchanged. ${result.reason}`,
        action: "top_up_wallet",
        quote: result.quote,
        amountDuePaise: result.quote.amountDuePaise,
      });
    }

    await container.audit.record({
      session: s,
      action: result.status === "applied" ? "subscription.plan_changed" : "subscription.change_scheduled",
      resource: "subscription", resourceId: result.subscription.id,
      previousValue: { planId: result.quote.currentPlanId },
      newValue: { planId: result.quote.newPlanId, effectiveFrom: result.quote.effectiveFrom },
    });

    return reply.send({
      status: result.status,
      subscription: result.subscription,
      usage: await container.subscriptions.usage(s.residentId!),
      quote: result.quote,
      paidPaise: result.quote.amountDuePaise,
      effectiveFrom: result.quote.effectiveFrom,
      planTier: result.quote.newPlanTier,
      note: result.status === "applied"
        ? `Plan upgraded successfully. You are now on ${result.quote.newPlanTier}.`
        : `Scheduled change. You stay on ${result.quote.currentPlanTier} until ${result.quote.effectiveFrom.slice(0, 10)}, when ${result.quote.newPlanTier} starts.`,
    });
  });

  // Calling off a scheduled change. The resident stays on the plan they are already
  // on, and the pending change disappears from the subscription page.
  app.delete("/v1/subscription/change", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.residentId) return reply.code(409).send({ error: "onboarding_incomplete" });
    const subscription = await container.subscriptions.cancelPlanChange(s.residentId);
    if (!subscription) return reply.code(404).send({ error: "no_active_subscription" });
    await container.audit.record({ session: s, action: "subscription.change_cancelled", resource: "subscription", resourceId: subscription.id, previousValue: null, newValue: subscription });
    return reply.send({ subscription: await container.subscriptions.usage(s.residentId) });
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
