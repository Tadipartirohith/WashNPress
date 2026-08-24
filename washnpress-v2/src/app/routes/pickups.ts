import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";
import { SlotUnavailableError, CutoffPassedError, SlotInPastError, BookingClosedError } from "../../services/scheduling-service";
import { UnknownServiceError } from "../../domain/pricing";

// One garment category can be split across several services in the same order, so
// four shirts can go for dry cleaning while six get an ordinary wash.
const lineSchema = z.object({
  category: z.string().min(1),
  quantity: z.number().int().positive(),
  serviceId: z.string().min(1),
  addonIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const bookSchema = z.object({
  slotId: z.string(),
  lines: z.array(lineSchema).optional(),
  estimatedCount: z.number().int().nonnegative().optional(),
  specialInstructions: z.string().optional(),
  recurring: z.boolean().optional(),
  recurringDays: z.array(z.number()).optional(),
  addonIds: z.array(z.string()).optional(),
});
const rescheduleSchema = z.object({ pickupId: z.string(), slotId: z.string() });
// Cancellation is validated the same way the reschedule beside it always was. An
// invalid body used to fall through to a lookup on an empty id and answer 404,
// which told the caller the pickup did not exist rather than that they had asked
// the question wrongly.
const cancelSchema = z.object({ pickupId: z.string().min(1) });

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
  app.get<{ Querystring: { slotId?: string; estimatedCount?: string; lines?: string } }>("/v1/pickups/preview", async (req, reply) => {
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

    // The requested splits are priced by the same code that prices the booking, so
    // the figure shown here is the figure that gets stored.
    let quote = { lines: [] as Awaited<ReturnType<typeof container.scheduling.quoteLines>>["lines"], estimatedCount: 0, servicesPaise: 0 };
    if (req.query.lines) {
      try {
        quote = await container.scheduling.quoteLines(JSON.parse(req.query.lines));
      } catch (error) {
        if (error instanceof UnknownServiceError) return reply.code(400).send({ error: "unknown_service", message: error.message });
        return reply.code(400).send({ error: "invalid_request", message: "lines must be a JSON array" });
      }
    }

    const estimatedCount = quote.estimatedCount || (req.query.estimatedCount ? Number(req.query.estimatedCount) : 0);
    const perGarmentRate = usage ? config.additionalGarmentRatePaise : config.nonSubscriberGarmentRatePaise;
    const covered = usage ? Math.min(estimatedCount, usage.remaining) : 0;
    return reply.send({
      society: { id: society?.id ?? null, name: society?.name ?? null },
      pickupAddress: resident?.pickupAddress ?? resident?.address ?? null,
      slot: { id: slot.id, date: slot.date, window: slot.window, startTime: slot.startTime, endTime: slot.endTime, available: slot.capacityRemaining, full: slot.capacityRemaining <= 0 },
      subscription: usage,
      // Subscription is optional: without a plan every garment is simply priced at
      // the ordinary per garment rate rather than the plan overage rate.
      hasSubscription: Boolean(usage),
      lines: quote.lines,
      servicesPaise: quote.servicesPaise,
      estimatedCount: estimatedCount || null,
      perGarmentRatePaise: perGarmentRate,
      additionalGarmentRatePaise: config.additionalGarmentRatePaise,
      nonSubscriberGarmentRatePaise: config.nonSubscriberGarmentRatePaise,
      estimatedCoveredCount: covered,
      estimatedChargeablePaise: Math.max(0, estimatedCount - covered) * perGarmentRate + quote.servicesPaise,
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
        order: { id: r.order.id, orderCode: r.order.orderCode, state: r.order.state, lines: r.order.lines, servicesPaise: r.order.servicesPaise },
        pickup: { id: r.pickup.id, scheduledFor: r.pickup.scheduledFor },
        slot: { id: r.slot.id, capacityRemaining: r.slot.capacityRemaining },
      });
    } catch (e) {
      // A slot that filled up between page load and confirmation fails here rather
      // than overselling: the resident is asked to pick another slot.
      if (e instanceof SlotInPastError) return reply.code(409).send({ error: "slot_in_past", message: "That pickup slot has already passed. Please choose an upcoming one." });
      if (e instanceof BookingClosedError) return reply.code(409).send({ error: "booking_closed", message: e.message });
      if (e instanceof SlotUnavailableError) return reply.code(409).send({ error: "slot_unavailable", message: "That slot just filled up. Please choose another." });
      if (e instanceof UnknownServiceError) return reply.code(400).send({ error: "unknown_service", message: (e as Error).message });
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
      if (e instanceof SlotInPastError) return reply.code(409).send({ error: "slot_in_past", message: "That pickup slot has already passed. Please choose an upcoming one." });
      if (e instanceof BookingClosedError) return reply.code(409).send({ error: "booking_closed", message: e.message });
      if (e instanceof SlotUnavailableError) return reply.code(409).send({ error: "slot_unavailable" });
      throw e;
    }
  });

  app.post("/v1/pickups/cancel", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const pickup = await container.store.pickups.get(parsed.data.pickupId);
    if (!pickup || pickup.residentId !== s.residentId) return reply.code(404).send({ error: "not_found" });
    try { return reply.send({ pickup: await container.scheduling.cancel(pickup.id) }); }
    catch (e) { if (e instanceof CutoffPassedError) return reply.code(409).send({ error: "cutoff_passed" }); throw e; }
  });
}
