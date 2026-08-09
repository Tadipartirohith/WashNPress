import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";

const rateSchema = z.object({ rating: z.number().min(1).max(5), comment: z.string().optional() });
const disputeSchema = z.object({ description: z.string().min(1) });

export function registerOrderRoutes(app: FastifyInstance, container: Container): void {
  app.get<{ Params: { id: string } }>("/v1/orders/:id", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const order = await container.store.orders.get(req.params.id);
    if (!order) return reply.code(404).send({ error: "not_found" });
    return reply.send({ order });
  });

  app.get<{ Params: { id: string } }>("/v1/orders/:id/tracking", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    return reply.send(await container.orders.tracking(req.params.id));
  });

  app.post<{ Params: { id: string } }>("/v1/orders/:id/rate", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = rateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ order: await container.orders.rate(req.params.id, parsed.data.rating, parsed.data.comment) });
  });

  app.post<{ Params: { id: string } }>("/v1/orders/:id/dispute", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = disputeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ order: await container.orders.raiseDispute(req.params.id, parsed.data.description) });
  });
}
