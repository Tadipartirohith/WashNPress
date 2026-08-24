import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { paginate } from "../paging";
import {
  SERVICE_KINDS, SERVICE_KIND_LABELS, SERVICE_REQUEST_STATUSES, ServiceTransitionError,
} from "../../domain/service-requests";
import {
  OfferingNotFoundError, OfferingInactiveError,
  VehicleDetailsRequiredError, HoursRequiredError,
} from "../../services/service-request-service";

// The services that are not laundry: booking one, working one, and managing what is
// offered. Kept in its own file because it is its own thing — an order route file
// full of vehicle washes would be a sign the model had gone wrong.

const bookSchema = z.object({
  offeringId: z.string().min(1),
  scheduledFor: z.string().min(1),
  vehicleType: z.string().optional(),
  vehicleNumber: z.string().optional(),
  estimatedHours: z.number().positive().max(12).optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});
const assignSchema = z.object({ staffUserId: z.string().min(1) });
const completeSchema = z.object({ actualHours: z.number().positive().max(24).optional(), note: z.string().optional() });
const cancelSchema = z.object({ reason: z.string().min(1) });
const offeringSchema = z.object({
  kind: z.enum(["vehicle_wash", "home_ironing"]),
  name: z.string().min(2),
  description: z.string().optional(),
  pricingBasis: z.enum(["per_job", "per_hour"]),
  unitPricePaise: z.number().int().nonnegative(),
  vehicleTypes: z.array(z.string()).optional(),
  minimumHours: z.number().positive().max(12).nullable().optional(),
  isActive: z.boolean().optional(),
});
const offeringPatchSchema = offeringSchema.partial().omit({ kind: true });

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
  app.get<{ Querystring: { offeringId?: string; estimatedHours?: string } }>("/v1/services/quote", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    if (!req.query.offeringId) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send({
        quote: await container.serviceRequests.quote(req.query.offeringId, {
          estimatedHours: req.query.estimatedHours ? Number(req.query.estimatedHours) : undefined,
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
        residentId: session.residentId, societyId: session.societyId, areaId: session.areaId,
        ...parsed.data,
      });
      await container.audit.record({ session, action: "service.requested", resource: "service_request", resourceId: request.id, newValue: request });
      return reply.code(201).send({ request: container.serviceRequests.describe(request) });
    } catch (error) {
      if (error instanceof OfferingNotFoundError) return reply.code(404).send({ error: "not_found" });
      if (error instanceof OfferingInactiveError) return reply.code(409).send({ error: "offering_inactive", message: error.message });
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

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/services", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const requests = await container.store.serviceRequests.all();
    let filtered = requests;
    if (req.query.status) filtered = filtered.filter((r) => r.status === req.query.status);
    if (req.query.kind) filtered = filtered.filter((r) => r.kind === req.query.kind);
    if (req.query.societyId) filtered = filtered.filter((r) => r.societyId === req.query.societyId);
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(filtered.map((r) => container.serviceRequests.describe(r)), req.query);
    return reply.send({
      requests: page.items,
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      summary: await container.serviceRequests.summary(null),
    });
  });

  app.get("/v1/admin/services/offerings", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const offerings = await container.store.offerings.all();
    return reply.send({ offerings: offerings.sort((a, b) => a.name.localeCompare(b.name)) });
  });

  app.post("/v1/admin/services/offerings", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = offeringSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const id = parsed.data.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (await container.store.offerings.get(id)) return reply.code(409).send({ error: "offering_exists" });
    const offering = await container.store.offerings.put({
      id,
      kind: parsed.data.kind,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() ?? null,
      pricingBasis: parsed.data.pricingBasis,
      unitPricePaise: parsed.data.unitPricePaise,
      vehicleTypes: parsed.data.vehicleTypes ?? [],
      minimumHours: parsed.data.minimumHours ?? null,
      isActive: parsed.data.isActive ?? true,
    });
    await container.audit.record({ session, action: "offering.created", resource: "offering", resourceId: offering.id, newValue: offering });
    return reply.code(201).send({ offering });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/services/offerings/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = offeringPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const existing = await container.store.offerings.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const updated = await container.store.offerings.put({
      ...existing,
      ...parsed.data,
      description: parsed.data.description?.trim() ?? existing.description,
      minimumHours: parsed.data.minimumHours === undefined ? existing.minimumHours : parsed.data.minimumHours,
    });
    await container.audit.record({ session, action: "offering.updated", resource: "offering", resourceId: updated.id, previousValue: existing, newValue: updated });
    return reply.send({ offering: updated });
  });
}
