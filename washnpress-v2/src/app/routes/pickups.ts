import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";
import { SlotUnavailableError, CutoffPassedError } from "../../services/scheduling-service";

const bookSchema = z.object({
  slotId: z.string(),
  estimatedCount: z.number().int().nonnegative().optional(),
  specialInstructions: z.string().optional(),
  recurring: z.boolean().optional(),
  recurringDays: z.array(z.number()).optional(),
  addonIds: z.array(z.string()).optional(),
});
const rescheduleSchema = z.object({ pickupId: z.string(), slotId: z.string() });

export function registerPickupRoutes(app: FastifyInstance, container: Container): void {
  app.get<{ Querystring: { date?: string } }>("/v1/slots", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.societyId) return reply.code(409).send({ error: "onboarding_incomplete" });
    const date = req.query.date ?? new Date().toISOString().slice(0, 10);
    // A resident only ever sees slots belonging to their own society.
    return reply.send({ date, slots: await container.scheduling.listAvailableSlots(s.societyId, date) });
  });

  // The confirmation screen. Everything shown before the resident commits comes
  // from the backend so the figures cannot drift from what will actually apply.
  app.get<{ Querystring: { slotId?: string; estimatedCount?: string } }>("/v1/pickups/preview", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.residentId || !s.societyId) return reply.code(409).send({ error: "onboarding_incomplete" });
    const slotId = req.query.slotId;
    if (!slotId) return reply.code(400).send({ error: "invalid_request" });
    const slot = await container.store.slots.get(slotId);
    if (!slot || slot.societyId !== s.societyId) return reply.code(404).send({ error: "not_found" });
    const society = await container.store.societies.get(s.societyId);
    const resident = await container.store.residents.get(s.residentId);
    const usage = await container.subscriptions.usage(s.residentId);
    const config = await container.systemConfig.get();
    return reply.send({
      society: { id: society?.id ?? null, name: society?.name ?? null },
      pickupAddress: resident?.pickupAddress ?? resident?.address ?? null,
      slot: { id: slot.id, date: slot.date, window: slot.window, startTime: slot.startTime, endTime: slot.endTime, available: slot.capacityRemaining, full: slot.capacityRemaining <= 0 },
      subscription: usage,
      estimatedCount: req.query.estimatedCount ? Number(req.query.estimatedCount) : null,
      additionalGarmentRatePaise: config.additionalGarmentRatePaise,
      note: "The final quantity is confirmed by the operator at pickup, and the charge is calculated from it.",
    });
  });

  app.post("/v1/pickups", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.residentId || !s.societyId) return reply.code(409).send({ error: "onboarding_incomplete" });
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const r = await container.scheduling.book({ residentId: s.residentId, societyId: s.societyId, ...parsed.data });
      return reply.code(201).send({
        order: { id: r.order.id, orderCode: r.order.orderCode, state: r.order.state },
        pickup: { id: r.pickup.id, scheduledFor: r.pickup.scheduledFor },
        slot: { id: r.slot.id, capacityRemaining: r.slot.capacityRemaining },
      });
    } catch (e) {
      // A slot that filled up between page load and confirmation fails here rather
      // than overselling: the resident is asked to pick another slot.
      if (e instanceof SlotUnavailableError) return reply.code(409).send({ error: "slot_unavailable", message: "That slot just filled up. Please choose another." });
      throw e;
    }
  });

  app.get("/v1/pickups", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.residentId) return reply.send({ pickups: [] });
    const pickups = await container.store.pickups.find((p) => p.residentId === s.residentId);
    pickups.sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1));
    return reply.send({ pickups });
  });

  app.post("/v1/pickups/reschedule", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const pickup = await container.store.pickups.get(parsed.data.pickupId);
    if (!pickup || pickup.residentId !== s.residentId) return reply.code(404).send({ error: "not_found" });
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
    const pickup = await container.store.pickups.get((req.body ?? { pickupId: "" }).pickupId);
    if (!pickup || pickup.residentId !== s.residentId) return reply.code(404).send({ error: "not_found" });
    try { return reply.send({ pickup: await container.scheduling.cancel(pickup.id) }); }
    catch (e) { if (e instanceof CutoffPassedError) return reply.code(409).send({ error: "cutoff_passed" }); throw e; }
  });
}
