import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";

const pickedUpSchema = z.object({ items: z.array(z.object({ category: z.string(), quantity: z.number().int().nonnegative() })) });
const advanceSchema = z.object({ to: z.enum(["in_wash", "ironing", "qc"]) });
const qcSchema = z.object({ pass: z.boolean(), reason: z.string().optional() });
const deliverSchema = z.object({ deliveryCount: z.number().int().nonnegative(), discrepancyReason: z.string().optional() });

export function registerOperationsRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/operations/bookings", async (req, reply) => {
    const s = await requireRole(req, reply, container, "operator"); if (!s) return;
    const orders = await container.store.orders.find((o) => o.state === "scheduled");
    return reply.send({ orders });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/picked-up", async (req, reply) => {
    const s = await requireRole(req, reply, container, "operator"); if (!s) return;
    const parsed = pickedUpSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ order: await container.orders.markPickedUp(req.params.id, parsed.data.items) });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/advance", async (req, reply) => {
    const s = await requireRole(req, reply, container, "operator"); if (!s) return;
    const parsed = advanceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send({ order: await container.orders.advanceStage(req.params.id, parsed.data.to) }); }
    catch (e) { return reply.code(409).send({ error: "illegal_transition", message: (e as Error).message }); }
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/qc", async (req, reply) => {
    const s = await requireRole(req, reply, container, "operator"); if (!s) return;
    const parsed = qcSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send({ order: await container.orders.submitQc(req.params.id, parsed.data.pass, parsed.data.reason) }); }
    catch (e) { return reply.code(409).send({ error: "qc_failed_transition", message: (e as Error).message }); }
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/out-for-delivery", async (req, reply) => {
    const s = await requireRole(req, reply, container, "operator"); if (!s) return;
    try { return reply.send({ order: await container.orders.outForDelivery(req.params.id) }); }
    catch (e) { return reply.code(409).send({ error: "illegal_transition", message: (e as Error).message }); }
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/deliver", async (req, reply) => {
    const s = await requireRole(req, reply, container, "operator"); if (!s) return;
    const parsed = deliverSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try { return reply.send({ order: await container.orders.deliver(req.params.id, parsed.data.deliveryCount, parsed.data.discrepancyReason) }); }
    catch (e) { return reply.code(409).send({ error: "delivery_blocked", message: (e as Error).message }); }
  });

  app.get<{ Params: { unitId: string } }>("/v1/operations/units/:unitId/earnings", async (req, reply) => {
    const s = await requireRole(req, reply, container, "operator"); if (!s) return;
    const earnings = await container.earnings.forUnit(req.params.unitId);
    if (!earnings) return reply.code(404).send({ error: "not_found" });
    return reply.send({ earnings });
  });
}
