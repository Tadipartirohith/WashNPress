import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, requireSession } from "../guards";

const createSchema = z.object({ orderId: z.string().optional(), category: z.string(), description: z.string().min(1) });
const replySchema = z.object({ body: z.string().min(1) });

export function registerSupportRoutes(app: FastifyInstance, container: Container): void {
  app.post("/v1/support/tickets", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const ticket = await container.support.create({ residentId: s.residentId, orderId: parsed.data.orderId, category: parsed.data.category, description: parsed.data.description });
    return reply.code(201).send({ ticket });
  });

  app.get("/v1/support/tickets", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    return reply.send({ tickets: await container.support.listByResident(s.residentId!) });
  });

  app.post<{ Params: { id: string } }>("/v1/support/tickets/:id/reply", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const ticket = await container.support.reply(req.params.id, session.userId, parsed.data.body);
    if (!ticket) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ticket });
  });
}
