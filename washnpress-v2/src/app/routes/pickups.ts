import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";
import { SlotUnavailableError, CutoffPassedError } from "../../services/scheduling-service";

const bookSchema = z.object({ slotId: z.string(), specialInstructions: z.string().optional(), recurring: z.boolean().optional(), recurringDays: z.array(z.number()).optional(), addonIds: z.array(z.string()).optional() });
const rescheduleSchema = z.object({ pickupId: z.string(), slotId: z.string() });

export function registerPickupRoutes(app: FastifyInstance, container: Container): void {
  app.get<{ Querystring: { date?: string } }>("/v1/slots", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const date = req.query.date ?? new Date().toISOString().slice(0, 10);
    return reply.send({ slots: await container.scheduling.listAvailableSlots(s.societyId!, date) });
  });

  app.post("/v1/pickups", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const r = await container.scheduling.book({ residentId: s.residentId!, societyId: s.societyId!, ...parsed.data });
      return reply.code(201).send({ order: { id: r.order.id, orderCode: r.order.orderCode, state: r.order.state }, slot: { id: r.slot.id, capacityRemaining: r.slot.capacityRemaining } });
    } catch (e) {
      if (e instanceof SlotUnavailableError) return reply.code(409).send({ error: "slot_unavailable" });
      throw e;
    }
  });

  app.post("/v1/pickups/reschedule", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const r = await container.scheduling.reschedule(parsed.data.pickupId, parsed.data.slotId);
      return reply.send({ pickup: r.pickup });
    } catch (e) {
      if (e instanceof CutoffPassedError) return reply.code(409).send({ error: "cutoff_passed" });
      if (e instanceof SlotUnavailableError) return reply.code(409).send({ error: "slot_unavailable" });
      throw e;
    }
  });

  app.post<{ Body: { pickupId: string } }>("/v1/pickups/cancel", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    try { return reply.send({ pickup: await container.scheduling.cancel(req.body.pickupId) }); }
    catch (e) { if (e instanceof CutoffPassedError) return reply.code(409).send({ error: "cutoff_passed" }); throw e; }
  });
}
