import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { paginate } from "../paging";
import {
  SERVICE_KINDS, SERVICE_KIND_LABELS, SERVICE_REQUEST_STATUSES, ServiceTransitionError,
  SlotUnavailableError,
} from "../../domain/service-requests";
import { OperatorBusyError } from "../../domain/operator-workload";
import {
  OfferingNotFoundError, OfferingInactiveError,
  VehicleDetailsRequiredError, HoursRequiredError, ServiceRuleError,
} from "../../services/service-request-service";

// The services that are not laundry: booking one, working one, and managing what is
// offered. Kept in its own file because it is its own thing — an order route file
// full of vehicle washes would be a sign the model had gone wrong.

const bookSchema = z.object({
  offeringId: z.string().min(1),
  // For a service measured in something other than hours: how many vehicles, rooms
  // or square feet.
  quantity: z.number().positive().optional(),
  scheduledFor: z.string().min(1),
  vehicleType: z.string().optional(),
  vehicleNumber: z.string().optional(),
  estimatedHours: z.number().positive().max(12).optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});
const rescheduleSchema = z.object({ scheduledFor: z.string().min(1) });
const assignSchema = z.object({ staffUserId: z.string().min(1) });
const completeSchema = z.object({ actualHours: z.number().positive().max(24).optional(), note: z.string().optional() });
const cancelSchema = z.object({ reason: z.string().min(1) });

export function registerServiceRoutes(app: FastifyInstance, container: Container): void {
  const resident = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "resident");
  const operator = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "operator");
  const admin = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "admin");

  // -------------------------------------------------------- what is offered

  // Public, like the plan list: somebody deciding whether to sign up should be able
  // to see what is available.
  app.get<{ Querystring: { kind?: string } }>("/v1/services/offerings", async (req, reply) => {
    const kind = SERVICE_KINDS.includes(req.query.kind as never) ? (req.query.kind as never) : undefined;
    return reply.send({
      offerings: await container.serviceRequests.offerings(kind),
      kinds: SERVICE_KINDS.map((k) => ({ key: k, label: SERVICE_KIND_LABELS[k] })),
    });
  });

  // What a booking would cost, before anybody commits to it.
  // Which start times a booking of this many hours could actually take. An hourly
  // service booked for two hours needs two consecutive hours free.
  app.get<{ Querystring: { offeringId?: string; date?: string; hours?: string } }>("/v1/services/slots", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const offeringId = req.query.offeringId;
    const date = req.query.date;
    if (!offeringId || !date) return reply.code(400).send({ error: "invalid_request" });
    const subscriber = session.residentId
      ? (await container.store.subscriptions.find((s) => s.residentId === session.residentId && s.status === "active")).length > 0
      : false;
    try {
      return reply.send(await container.serviceRequests.availableStarts(
        offeringId, date, Number(req.query.hours ?? 1) || 1, subscriber,
      ));
    } catch (error) {
      if (error instanceof OfferingNotFoundError) return reply.code(404).send({ error: "not_found" });
      throw error;
    }
  });

  app.get<{ Querystring: { offeringId?: string; estimatedHours?: string; quantity?: string; date?: string; atHome?: string; emergency?: string } }>("/v1/services/quote", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    if (!req.query.offeringId) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send({
        quote: await container.serviceRequests.quote(req.query.offeringId, {
          estimatedHours: req.query.estimatedHours ? Number(req.query.estimatedHours) : undefined,
          quantity: req.query.quantity ? Number(req.query.quantity) : undefined,
          // The plan the resident is on and the day the work is for both change the
          // figure, so both are part of the question rather than applied afterwards.
          residentId: session.residentId ?? undefined,
          date: req.query.date ?? null,
          atHome: req.query.atHome === "true",
          emergency: req.query.emergency === "true",
        }),
      });
    } catch (error) {
      if (error instanceof OfferingNotFoundError) return reply.code(404).send({ error: "not_found" });
      throw error;
    }
  });

  // ------------------------------------------------------ booking one, as a resident

  app.post("/v1/services/requests", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    if (!session.residentId || !session.societyId) return reply.code(409).send({ error: "onboarding_incomplete" });
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const request = await container.serviceRequests.create({
        residentId: session.residentId, societyId: session.societyId,
        ...parsed.data,
      });
      await container.audit.record({ session, action: "service.requested", resource: "service_request", resourceId: request.id, newValue: request });
      return reply.code(201).send({ request: container.serviceRequests.describe(request) });
    } catch (error) {
      if (error instanceof OfferingNotFoundError) return reply.code(404).send({ error: "not_found" });
      if (error instanceof OfferingInactiveError) return reply.code(409).send({ error: "offering_inactive", message: error.message });
      // The service's own rules refusing the booking is a different thing from the
      // service being unavailable: the resident can fix it by asking for something
      // else, so the reason is said rather than a bare refusal.
      if (error instanceof ServiceRuleError) return reply.code(409).send({ error: "service_rule", message: error.message });
      // Somebody else took the space, or the time was never on offer. Both are the
      // slot refusing rather than the service, and both are worth naming: the
      // resident's next move is to pick another window, not to give up.
      if (error instanceof SlotUnavailableError) {
        return reply.code(409).send({ error: "slot_full", reason: error.refusal, message: error.message });
      }
      if (error instanceof VehicleDetailsRequiredError) return reply.code(400).send({ error: "vehicle_required", message: error.message });
      if (error instanceof HoursRequiredError) return reply.code(400).send({ error: "hours_required", message: error.message });
      throw error;
    }
  });

  app.get("/v1/services/requests", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const requests = await container.serviceRequests.listForResident(session.residentId!);
    return reply.send({ requests: requests.map((r) => container.serviceRequests.describe(r)) });
  });

  // Moving a booking rather than giving it up.
  //
  // A resident who cannot make Tuesday still wants the car washed. Cancelling and
  // booking again loses the history and the place in the queue, and a service that
  // does not allow cancellation would refuse it outright.
  app.post<{ Params: { id: string } }>("/v1/services/requests/:id/reschedule", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const existing = await container.store.serviceRequests.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.residentId !== session.residentId) return reply.code(403).send({ error: "forbidden" });
    try {
      const request = await container.serviceRequests.reschedule(
        req.params.id, { userId: session.userId }, parsed.data.scheduledFor,
      );
      await container.audit.record({
        session, action: "service.rescheduled", resource: "service_request",
        resourceId: request.id, previousValue: { scheduledFor: existing.scheduledFor },
        newValue: { scheduledFor: request.scheduledFor },
      });
      return reply.send({ request: container.serviceRequests.describe(request) });
    } catch (error) {
      if (error instanceof ServiceRuleError) return reply.code(409).send({ error: "service_rule", message: error.message });
      if (error instanceof SlotUnavailableError) {
        return reply.code(409).send({ error: "slot_full", reason: error.refusal, message: error.message });
      }
      if (error instanceof OfferingNotFoundError) return reply.code(404).send({ error: "not_found" });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/v1/services/requests/:id/cancel", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const existing = await container.store.serviceRequests.get(req.params.id);
    if (!existing || existing.residentId !== session.residentId) return reply.code(404).send({ error: "not_found" });
    try {
      const request = await container.serviceRequests.cancel(req.params.id, { userId: session.userId }, parsed.data.reason);
      await container.audit.record({ session, action: "service.cancelled", resource: "service_request", resourceId: request.id, newValue: { reason: parsed.data.reason } });
      return reply.send({ request: container.serviceRequests.describe(request) });
    } catch (error) {
      if (error instanceof ServiceRuleError) return reply.code(409).send({ error: "service_rule", message: error.message });
      if (error instanceof ServiceTransitionError) return reply.code(409).send({ error: "illegal_transition", message: error.message });
      throw error;
    }
  });

  // ---------------------------------------------------- working one, as operations

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/operations/services", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    const requests = await container.serviceRequests.listForScope({
      societyIds,
      status: req.query.status as never,
      kind: req.query.kind as never,
      assignedToUserId: req.query.mine === "true" ? session.userId : undefined,
    });
    const page = paginate(requests.map((r) => container.serviceRequests.describe(r)), req.query);
    return reply.send({
      requests: page.items,
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      statuses: SERVICE_REQUEST_STATUSES,
      kinds: SERVICE_KINDS.map((k) => ({ key: k, label: SERVICE_KIND_LABELS[k] })),
    });
  });

  // An operator takes a job, or a supervisor hands it to somebody.
  app.post<{ Params: { id: string } }>("/v1/operations/services/:id/assign", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = assignSchema.safeParse(req.body ?? { staffUserId: session.userId });
    const staffUserId = parsed.success ? parsed.data.staffUserId : session.userId;
    return withScope(reply, async () => {
      const existing = await container.store.serviceRequests.get(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await container.access.requireSociety(session, existing.societyId);
      try {
        const request = await container.serviceRequests.assign(req.params.id, staffUserId, { userId: session.userId });
        await container.audit.record({ session, action: "service.assigned", resource: "service_request", resourceId: request.id, newValue: { assignedToUserId: staffUserId } });
        return reply.send({ request: container.serviceRequests.describe(request) });
      } catch (error) {
        if (error instanceof ServiceTransitionError) return reply.code(409).send({ error: "illegal_transition", message: error.message });
        // The operator is somewhere else at that hour. What is in the way is named,
        // because a supervisor's next move is to pick a different operator or move
        // the booking, and neither is possible from a bare refusal.
        if (error instanceof OperatorBusyError) {
          return reply.code(409).send({
            error: "operator_busy",
            message: error.message,
            clashes: error.clashes.map((c) => ({ kind: c.kind, label: c.label, reference: c.reference, start: c.start, end: c.end })),
          });
        }
        throw error;
      }
    });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/services/:id/start", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const existing = await container.store.serviceRequests.get(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await container.access.requireSociety(session, existing.societyId);
      try {
        const request = await container.serviceRequests.start(req.params.id, { userId: session.userId });
        return reply.send({ request: container.serviceRequests.describe(request) });
      } catch (error) {
        if (error instanceof ServiceTransitionError) return reply.code(409).send({ error: "illegal_transition", message: error.message });
        throw error;
      }
    });
  });

  // Completing an hourly job records what it actually took, which is what is charged.
  app.post<{ Params: { id: string } }>("/v1/operations/services/:id/complete", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = completeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      const existing = await container.store.serviceRequests.get(req.params.id);
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await container.access.requireSociety(session, existing.societyId);
      try {
        const request = await container.serviceRequests.complete(req.params.id, { userId: session.userId }, parsed.data);
        await container.audit.record({
          session, action: "service.completed", resource: "service_request", resourceId: request.id,
          previousValue: { quotedPaise: existing.quotedPaise, estimatedHours: existing.estimatedHours },
          newValue: { finalPaise: request.finalPaise, actualHours: request.actualHours },
        });
        return reply.send({ request: container.serviceRequests.describe(request) });
      } catch (error) {
        if (error instanceof ServiceTransitionError) return reply.code(409).send({ error: "illegal_transition", message: error.message });
        throw error;
      }
    });
  });

  // ------------------------------------------------------- managing what is offered

  // The bookings made against those services. This used to be /v1/admin/services,
  // which is the path the catalogue needs and never described a list of bookings.
  // This answered what each booking *was* — its service, its status, its price —
  // and nothing about who it belonged to or who was doing it. So an admin could
  // see that a car wash had been booked and could not see which resident had
  // booked it, which operator had accepted it, or what had happened to it since.
  // A service that is created and then disappears into an operator's queue is not
  // a workflow anybody can manage.
  //
  // It carries the resident and where they live, the assigned operator and when
  // they took it, every operator who has ever held it, and each stage with the
  // person responsible for it.
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/service-requests", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    let rows = await container.serviceRequests.listForStaff(null, {
      status: req.query.status, offeringId: req.query.offeringId,
      operatorUserId: req.query.operatorUserId, societyId: req.query.societyId,
      from: req.query.from, to: req.query.to,
    });
    // Still accepted, because a client filtering by the kind of service rather
    // than by a particular one should not stop working.
    if (req.query.kind) rows = rows.filter((r) => r.kind === req.query.kind);
    const page = paginate(rows, req.query);
    return reply.send({
      requests: page.items,
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      offerings: await container.serviceRequests.offerings(),
      summary: await container.serviceRequests.summary(null),
      // The operators a booking could be narrowed to. Sent with the rows because a
      // list drawn from the rows on this page can only offer the operators who
      // happen to appear on it, which is the wrong list on every page but the first.
      operators: (await container.store.users.find((u) => u.roles.includes("operator")))
        .map((u) => ({ id: u.id, name: u.fullName ?? u.phone })),
    });
  });

  // Creating and changing a service now goes through the service wizard, at
  // /v1/admin/services. It configures measurement, pricing, plan rules, allowances,
  // frequency, availability, time slots, eligibility, booking rules and additional
  // charges — none of which the three routes that used to be here could express, and
  // two ways of making a service with two different sets of rules is worse than one.
}
