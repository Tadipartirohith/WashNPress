import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";

const rateSchema = z.object({ rating: z.number().min(1).max(5), comment: z.string().optional() });
const disputeSchema = z.object({ description: z.string().min(1) });

export function registerOrderRoutes(app: FastifyInstance, container: Container): void {
  app.get<{ Params: { id: string } }>("/v1/orders/:id", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      return reply.send({ order: await container.orders.detail(order) });
    });
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id/tracking", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    return withScope(reply, async () => {
      await container.access.requireOrder(session, req.params.id);
      return reply.send(await container.orders.tracking(req.params.id));
    });
  });

  app.post<{ Params: { id: string } }>("/v1/orders/:id/rate", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    const parsed = rateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      await container.access.requireOrder(session, req.params.id);
      return reply.send({ order: await container.orders.rate(req.params.id, parsed.data.rating, parsed.data.comment) });
    });
  });

  app.post<{ Params: { id: string } }>("/v1/orders/:id/dispute", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    const parsed = disputeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      await container.access.requireOrder(session, req.params.id);
      try {
        return reply.send({ order: await container.orders.raiseDispute(req.params.id, parsed.data.description, { userId: session.userId, session }) });
      } catch (error) {
        return reply.code(409).send({ error: "illegal_transition", message: (error as Error).message });
      }
    });
  });
}
