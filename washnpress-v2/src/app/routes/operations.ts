import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { QuantityRequiredError } from "../../services/order-service";
import { ISSUE_TYPES } from "../../services/issue-service";
import { STATE_LABELS } from "../../domain/order-state-machine";

const itemsSchema = z.object({ items: z.array(z.object({ category: z.string(), quantity: z.number().int().nonnegative() })) });
const advanceSchema = z.object({ to: z.enum(["in_wash", "ironing", "qc"]) });
const qcSchema = z.object({ pass: z.boolean(), reason: z.string().optional() });
const reprocessSchema = z.object({ to: z.enum(["in_wash", "ironing"]), note: z.string().optional() });
const deliverSchema = z.object({ deliveryCount: z.number().int().nonnegative(), discrepancyReason: z.string().optional() });
const failSchema = z.object({ reason: z.string().min(1) });
const issueSchema = z.object({ orderId: z.string().optional(), type: z.string().min(1), description: z.string().min(1), priority: z.enum(["low", "normal", "high"]).optional() });
const profileSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional() });

// The operations portal. An operator works only the orders inside the societies
// they are assigned to; the state machine, the quantity split and the subscription
// maths all stay in the backend, so the operator only ever supplies observations.
export function registerOperationsRoutes(app: FastifyInstance, container: Container): void {
  const operator = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "operator");

  // ------------------------------------------------------------- dashboard

  app.get("/v1/operations/dashboard", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return reply.send(await container.dashboards.operations(session));
  });

  app.get("/v1/operations/config", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const config = await container.systemConfig.get();
    return reply.send({
      garmentCategories: config.garmentCategories,
      garmentServices: config.garmentServices.filter((g) => g.isActive),
      additionalGarmentRatePaise: config.additionalGarmentRatePaise,
      nonSubscriberGarmentRatePaise: config.nonSubscriberGarmentRatePaise,
      issueTypes: ISSUE_TYPES,
    });
  });

  // ------------------------------------------------------- today's bookings

  app.get<{ Querystring: { date?: string } }>("/v1/operations/pickups", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    const queue = await container.scheduling.pickupQueue({ societyIds, date: req.query.date });
    // The pickup queue only holds work that still needs collecting. Once an order
    // is picked up it moves to Active Orders and stays reachable there.
    return reply.send({ pickups: queue.filter((p) => p.status === "scheduled" || p.status === "rescheduled") });
  });

  // Kept at its original path so existing clients and the offline queue keep working.
  app.get("/v1/operations/bookings", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const orders = (await container.access.visibleOrders(session)).filter((o) => o.state === "scheduled");
    return reply.send({ orders: await container.orders.summarise(orders) });
  });

  app.get<{ Params: { id: string } }>("/v1/operations/orders/:id", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      return reply.send({ order: await container.orders.detail(order) });
    });
  });

  // --------------------------------------------------------- garment entry

  // The confirmation step. The operator sees the split the backend computed before
  // committing the pickup, and never types the covered quantity or the charge.
  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/garments/preview", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = itemsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      await container.access.requireOrder(session, req.params.id);
      return reply.send({ summary: await container.orders.previewSplit(req.params.id, parsed.data.items) });
    });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/picked-up", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = itemsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.markPickedUp(req.params.id, parsed.data.items, { userId: session.userId, session });
        await container.audit.record({
          session, action: "order.picked_up", resource: "order", resourceId: order.id,
          previousValue: { state: existing.state, acceptedCount: existing.acceptedCount },
          newValue: { state: order.state, acceptedCount: order.acceptedCount, subscriptionCoveredCount: order.subscriptionCoveredCount, additionalCount: order.additionalCount, additionalChargePaise: order.additionalChargePaise },
        });
        return reply.send({ order: await container.orders.detail(order) });
      } catch (error) {
        if (error instanceof QuantityRequiredError) return reply.code(400).send({ error: "quantity_required", message: error.message });
        return reply.code(409).send({ error: "illegal_transition", message: (error as Error).message });
      }
    });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/pickup-failed", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = failSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.failPickup(req.params.id, parsed.data.reason, { userId: session.userId, session });
        await container.audit.record({ session, action: "order.pickup_failed", resource: "order", resourceId: order.id, previousValue: { state: existing.state }, newValue: { state: order.state, reason: parsed.data.reason } });
        return reply.send({ order: await container.orders.detail(order) });
      } catch (error) {
        return reply.code(409).send({ error: "illegal_transition", message: (error as Error).message });
      }
    });
  });

  // ---------------------------------------------------------- processing

  const stageAction = (
    path: string,
    action: string,
    run: (orderId: string, session: { userId: string }) => Promise<{ id: string; state: string }>,
  ) => {
    app.post<{ Params: { id: string } }>(path, async (req, reply) => {
      const session = await operator(req, reply); if (!session) return;
      return withScope(reply, async () => {
        const existing = await container.access.requireOrder(session, req.params.id);
        try {
          const order = await run(req.params.id, session);
          await container.audit.record({ session, action, resource: "order", resourceId: order.id, previousValue: { state: existing.state }, newValue: { state: order.state } });
          const full = await container.store.orders.get(order.id);
          return reply.send({ order: await container.orders.detail(full!) });
        } catch (error) {
          return reply.code(409).send({ error: "illegal_transition", message: (error as Error).message });
        }
      });
    });
  };

  stageAction("/v1/operations/orders/:id/wash/start", "order.wash_started", (id, s) => container.orders.startWash(id, { userId: s.userId }));
  stageAction("/v1/operations/orders/:id/wash/complete", "order.wash_completed", (id, s) => container.orders.completeWash(id, { userId: s.userId }));
  stageAction("/v1/operations/orders/:id/ironing/start", "order.ironing_started", (id, s) => container.orders.startIroning(id, { userId: s.userId }));
  stageAction("/v1/operations/orders/:id/ironing/complete", "order.ironing_completed", (id, s) => container.orders.completeIroning(id, { userId: s.userId }));
  stageAction("/v1/operations/orders/:id/out-for-delivery", "order.out_for_delivery", (id, s) => container.orders.outForDelivery(id, { userId: s.userId }));

  // The generic advance action the offline queue replays.
  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/advance", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = advanceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.advanceStage(req.params.id, parsed.data.to, { userId: session.userId, session });
        await container.audit.record({ session, action: "order.stage_advanced", resource: "order", resourceId: order.id, previousValue: { state: existing.state }, newValue: { state: order.state } });
        return reply.send({ order: await container.orders.detail(order) });
      } catch (error) {
        return reply.code(409).send({ error: "illegal_transition", message: (error as Error).message });
      }
    });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/qc", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = qcSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (!parsed.data.pass && !parsed.data.reason) return reply.code(400).send({ error: "qc_reason_required", message: "Record why the quality check failed" });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.submitQc(req.params.id, parsed.data.pass, parsed.data.reason, { userId: session.userId, session });
        await container.audit.record({ session, action: parsed.data.pass ? "order.qc_passed" : "order.qc_failed", resource: "order", resourceId: order.id, previousValue: { state: existing.state }, newValue: { state: order.state, reason: order.qcReason } });
        return reply.send({ order: await container.orders.detail(order) });
      } catch (error) {
        return reply.code(409).send({ error: "qc_failed_transition", message: (error as Error).message });
      }
    });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/reprocess", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = reprocessSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.reprocess(req.params.id, parsed.data.to, { userId: session.userId, session });
        await container.audit.record({ session, action: "order.reprocessed", resource: "order", resourceId: order.id, previousValue: { state: existing.state }, newValue: { state: order.state } });
        return reply.send({ order: await container.orders.detail(order) });
      } catch (error) {
        return reply.code(409).send({ error: "illegal_transition", message: (error as Error).message });
      }
    });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/deliver", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = deliverSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.deliver(req.params.id, parsed.data.deliveryCount, parsed.data.discrepancyReason, { userId: session.userId, session });
        await container.audit.record({ session, action: "order.delivered", resource: "order", resourceId: order.id, previousValue: { state: existing.state }, newValue: { state: order.state, deliveryCount: parsed.data.deliveryCount } });
        return reply.send({ order: await container.orders.detail(order) });
      } catch (error) {
        return reply.code(409).send({ error: "delivery_blocked", message: (error as Error).message });
      }
    });
  });

  // ------------------------------------------------- work lists and history

  // Work nobody is holding. An operator going off duty puts their orders back here,
  // so a colleague can pick them up rather than the batch waiting for one person.
  app.get("/v1/operations/queue", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const orders = (await container.access.visibleOrders(session)).filter(
      (o) => !o.assignedOperatorUserId && !["delivered", "cancelled", "pickup_failed", "disputed"].includes(o.state),
    );
    return reply.send({ orders: await container.orders.summarise(orders) });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/claim", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      if (order.assignedOperatorUserId && order.assignedOperatorUserId !== session.userId) {
        return reply.code(409).send({ error: "already_assigned", message: "Another operator is already handling this order" });
      }
      const result = await container.orders.assignOperator(order.id, session.userId, { userId: session.userId, session }, "Claimed from the shared queue");
      await container.audit.record({
        session, action: "order.claimed", resource: "order", resourceId: order.id,
        previousValue: { assignedOperatorUserId: result.previousOperatorUserId },
        newValue: { assignedOperatorUserId: session.userId },
      });
      return reply.send({ order: await container.orders.detail(result.order) });
    });
  });

  app.get("/v1/operations/active", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const orders = await container.access.visibleOrders(session);
    const summaries = await container.orders.summarise(orders);
    const of = (state: string) => summaries.filter((o) => o.state === state);
    return reply.send({
      pickedUp: of("picked_up"),
      washing: of("in_wash"),
      ironingPending: of("ironing").filter((o) => !o.ironingStarted),
      ironing: of("ironing").filter((o) => o.ironingStarted),
      qc: of("qc"),
      qcFailed: of("qc_hold"),
      readyForDelivery: of("ready_for_delivery"),
      outForDelivery: of("out_for_delivery"),
      stateLabels: STATE_LABELS,
    });
  });

  app.get<{ Querystring: { state?: string; from?: string; to?: string } }>("/v1/operations/history", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const terminal = ["delivered", "cancelled", "pickup_failed", "disputed"];
    let orders = (await container.access.visibleOrders(session)).filter((o) => terminal.includes(o.state) || o.qcPassed === false);
    if (req.query.state) orders = orders.filter((o) => o.state === req.query.state);
    if (req.query.from) orders = orders.filter((o) => o.createdAt >= req.query.from!);
    if (req.query.to) orders = orders.filter((o) => o.createdAt <= req.query.to!);
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return reply.send({ orders: await container.orders.summarise(orders) });
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/operations/search", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const term = (req.query.q ?? "").trim().toLowerCase();
    let orders = await container.access.visibleOrders(session);
    if (req.query.societyId) orders = orders.filter((o) => o.societyId === req.query.societyId);
    if (req.query.state) orders = orders.filter((o) => o.state === req.query.state);
    if (req.query.from) orders = orders.filter((o) => o.createdAt >= req.query.from!);
    if (req.query.to) orders = orders.filter((o) => o.createdAt <= req.query.to!);
    if (term) {
      const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
      const residents = new Map((await container.store.residents.all()).map((r) => [r.id, r]));
      orders = orders.filter((o) => {
        if (o.orderCode.toLowerCase().includes(term)) return true;
        const resident = residents.get(o.residentId);
        const user = resident ? users.get(resident.userId) : null;
        return (user?.fullName ?? "").toLowerCase().includes(term) || (user?.phone ?? "").includes(term);
      });
    }
    return reply.send({ orders: await container.orders.summarise(orders) });
  });

  // ---------------------------------------------------------------- issues

  app.get<{ Querystring: { status?: string } }>("/v1/operations/issues", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    return reply.send({ issues: await container.issues.list({ societyIds, status: req.query.status as never }), issueTypes: ISSUE_TYPES });
  });

  app.post("/v1/operations/issues", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      const order = parsed.data.orderId ? await container.access.requireOrder(session, parsed.data.orderId) : null;
      const issue = await container.issues.create({
        residentId: order?.residentId ?? null, orderId: order?.id ?? null,
        societyId: order?.societyId ?? null, areaId: order?.areaId ?? session.areaId,
        category: parsed.data.type, description: parsed.data.description, priority: parsed.data.priority ?? "normal",
        reportedByUserId: session.userId, reportedByRole: "operator",
      });
      await container.audit.record({ session, action: "issue.created", resource: "issue", resourceId: issue.id, newValue: issue });
      await container.notifications.notifyRoleInArea(issue.areaId, "supervisor", {
        type: "issue.created", orderId: issue.orderId, title: "New operational issue", body: `${parsed.data.type}: ${parsed.data.description}`,
      });
      return reply.code(201).send({ issue });
    });
  });

  // -------------------------------------------------- profile and earnings

  app.get("/v1/operations/profile", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const user = await container.store.users.get(session.userId);
    if (!user) return reply.code(404).send({ error: "not_found" });
    return reply.send({ profile: await container.users.decorate(user) });
  });

  app.patch("/v1/operations/profile", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    // Area and society assignment are supervisor controlled, so they are ignored here.
    const user = await container.auth.updateStaffProfile(session.userId, parsed.data);
    return reply.send({ profile: await container.users.decorate(user) });
  });

  app.get<{ Params: { unitId: string } }>("/v1/operations/units/:unitId/earnings", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const unit = await container.store.units.get(req.params.unitId);
    if (!unit) return reply.code(404).send({ error: "not_found" });
    if (!(await container.access.canSeeSociety(session, unit.societyId))) {
      return reply.code(403).send({ error: "forbidden_scope", message: "Unit belongs to another area" });
    }
    const earnings = await container.earnings.forUnit(req.params.unitId);
    if (!earnings) return reply.code(404).send({ error: "not_found" });
    return reply.send({ earnings });
  });
}
