import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { UserConflictError } from "../../services/user-service";
import { SocietyConflictError } from "../../services/society-service";
import { SlotInUseError } from "../../services/scheduling-service";
import { ISSUE_TYPES } from "../../services/issue-service";
import { STATE_LABELS } from "../../domain/order-state-machine";

const societySchema = z.object({ name: z.string().min(2), code: z.string().min(2).max(10), address: z.string().optional(), city: z.string().optional(), state: z.string().optional() });
const societyPatchSchema = z.object({ name: z.string().min(2).optional(), address: z.string().optional(), city: z.string().optional(), status: z.enum(["active", "coming_soon", "inactive"]).optional() });
const operatorSchema = z.object({ fullName: z.string().min(2), phone: z.string().min(10).max(10), email: z.string().email().optional(), employeeId: z.string().optional(), societyIds: z.array(z.string()).optional() });
const operatorPatchSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional(), employeeId: z.string().optional(), status: z.enum(["active", "blocked"]).optional(), societyIds: z.array(z.string()).optional() });
const slotSchema = z.object({ societyId: z.string(), date: z.string(), window: z.string(), startTime: z.string(), endTime: z.string(), capacityTotal: z.number().int().positive() });
const slotPatchSchema = z.object({ window: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional(), capacityTotal: z.number().int().positive().optional(), isActive: z.boolean().optional() });
const issueStatusSchema = z.object({ status: z.enum(["open", "under_review", "resolved"]), resolution: z.string().optional() });
const profileSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional() });

// The supervisor portal. Every route here is bound to the supervisor's own area:
// the scope comes from the session, never from a query parameter, so asking for
// another area's society or order id fails the same way a missing one does.
export function registerSupervisorRoutes(app: FastifyInstance, container: Container): void {
  const supervisor = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "supervisor");

  // ------------------------------------------------------------- dashboard

  app.get("/v1/supervisor/dashboard", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return reply.send(await container.dashboards.supervisor(session));
  });

  // -------------------------------------------------------------- societies

  app.get<{ Querystring: { q?: string; status?: string } }>("/v1/supervisor/societies", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    let societies = await container.access.visibleSocieties(session);
    if (req.query.status) societies = societies.filter((s) => s.status === req.query.status);
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      societies = societies.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
    }
    return reply.send({ societies: await container.societies.summaries(societies) });
  });

  app.post("/v1/supervisor/societies", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    if (!session.areaId) return reply.code(409).send({ error: "no_area_assigned" });
    const parsed = societySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      // The area is taken from the session, so a supervisor cannot create a society
      // inside somebody else's area by supplying a different areaId.
      const society = await container.societies.create({ ...parsed.data, areaId: session.areaId });
      await container.audit.record({ session, action: "society.created", resource: "society", resourceId: society.id, newValue: society });
      return reply.code(201).send({ society: await container.societies.summary(society) });
    } catch (error) {
      if (error instanceof SocietyConflictError) return reply.code(409).send({ error: "society_conflict", message: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/supervisor/societies/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const society = await container.access.requireSociety(session, req.params.id);
      const residents = await container.store.residents.find((r) => r.societyId === society.id);
      const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
      const subscriptions = await container.store.subscriptions.all();
      const orders = await container.store.orders.find((o) => o.societyId === society.id);
      return reply.send({
        society: await container.societies.summary(society),
        residents: residents.map((r) => {
          const user = users.get(r.userId);
          const sub = subscriptions.find((s) => s.residentId === r.id && s.status === "active") ?? null;
          return {
            id: r.id, fullName: user?.fullName ?? null, phone: user?.phone ?? null,
            unitNumber: r.unitNumber, towerBlock: r.towerBlock, status: user?.status ?? null,
            onboardingCompleted: r.onboardingCompleted, subscriptionId: sub?.id ?? null, planId: sub?.planId ?? null,
          };
        }),
        operators: await container.users.decorateAll(await container.store.users.find((u) => u.roles.includes("operator") && u.societyIds.includes(society.id))),
        slots: await container.scheduling.listSlots({ societyId: society.id }),
        orders: await container.orders.summarise(orders),
        issues: await container.issues.list({ societyIds: new Set([society.id]) }),
      });
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/societies/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = societyPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      await container.access.requireSociety(session, req.params.id);
      const result = await container.societies.update(req.params.id, parsed.data);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "society.updated", resource: "society", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
      return reply.send({ society: await container.societies.summary(result.current) });
    });
  });

  // ------------------------------------------------------------------ slots

  app.get<{ Querystring: { societyId?: string; from?: string; to?: string } }>("/v1/supervisor/slots", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      if (req.query.societyId) await container.access.requireSociety(session, req.query.societyId);
      const societyIds = await container.access.visibleSocietyIds(session);
      return reply.send({ slots: await container.scheduling.listSlots({ societyIds, societyId: req.query.societyId, from: req.query.from, to: req.query.to }) });
    });
  });

  app.post("/v1/supervisor/slots", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = slotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      await container.access.requireSociety(session, parsed.data.societyId);
      const slot = await container.scheduling.createSlot(parsed.data);
      await container.audit.record({ session, action: "slot.created", resource: "slot", resourceId: slot.id, newValue: slot });
      return reply.code(201).send({ slot });
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/slots/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = slotPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const existing = await container.store.slots.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      await container.access.requireSociety(session, existing.societyId);
      try {
        const result = await container.scheduling.updateSlot(req.params.id, parsed.data);
        if (!result) return reply.code(404).send({ error: "not_found" });
        await container.audit.record({ session, action: "slot.updated", resource: "slot", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
        return reply.send({ slot: result.current });
      } catch (error) {
        if (error instanceof SlotInUseError) return reply.code(409).send({ error: "slot_in_use", message: error.message });
        throw error;
      }
    });
  });

  app.post<{ Params: { id: string } }>("/v1/supervisor/slots/:id/cancel", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const existing = await container.store.slots.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      await container.access.requireSociety(session, existing.societyId);
      const result = await container.scheduling.cancelSlot(req.params.id);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "slot.cancelled", resource: "slot", resourceId: req.params.id, previousValue: existing, newValue: result.slot });
      return reply.send(result);
    });
  });

  // -------------------------------------------------------------- operators

  app.get("/v1/supervisor/operators", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const operators = await container.store.users.find((u) => u.roles.includes("operator") && u.areaId === session.areaId);
    return reply.send({ operators: await container.users.decorateAll(operators) });
  });

  app.post("/v1/supervisor/operators", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    if (!session.areaId) return reply.code(409).send({ error: "no_area_assigned" });
    const parsed = operatorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      for (const societyId of parsed.data.societyIds ?? []) await container.access.requireSociety(session, societyId);
      try {
        const user = await container.users.createStaff({ role: "operator", ...parsed.data, areaId: session.areaId });
        await container.audit.record({ session, action: "operator.created", resource: "user", resourceId: user.id, newValue: user });
        return reply.code(201).send({ operator: await container.users.decorate(user) });
      } catch (error) {
        if (error instanceof UserConflictError) return reply.code(409).send({ error: "user_conflict", message: error.message });
        throw error;
      }
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/operators/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = operatorPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const target = await container.store.users.get(req.params.id);
    if (!target || !target.roles.includes("operator")) return reply.code(404).send({ error: "not_found" });
    // A supervisor may only touch operators inside their own area.
    if (target.areaId !== session.areaId) return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another area" });
    return withScope(reply, async () => {
      for (const societyId of parsed.data.societyIds ?? []) await container.access.requireSociety(session, societyId);
      const result = await container.users.update(req.params.id, parsed.data);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({
        session, action: parsed.data.societyIds ? "operator.reassigned" : "operator.updated",
        resource: "user", resourceId: req.params.id, previousValue: result.previous, newValue: result.current,
      });
      return reply.send({ operator: await container.users.decorate(result.current) });
    });
  });

  app.get("/v1/supervisor/workload", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    if (!session.areaId) return reply.send({ workload: [] });
    return reply.send({ workload: await container.users.operatorWorkload(session.areaId) });
  });

  // ----------------------------------------------------------------- orders

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/supervisor/orders", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    let orders = await container.access.visibleOrders(session);
    const q = req.query;
    if (q.societyId) orders = orders.filter((o) => o.societyId === q.societyId);
    if (q.state) orders = orders.filter((o) => o.state === q.state);
    if (q.operatorUserId) orders = orders.filter((o) => o.assignedOperatorUserId === q.operatorUserId);
    if (q.from) orders = orders.filter((o) => o.createdAt >= q.from!);
    if (q.to) orders = orders.filter((o) => o.createdAt <= q.to!);
    if (q.orderCode) orders = orders.filter((o) => o.orderCode.toLowerCase().includes(q.orderCode!.toLowerCase()));
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return reply.send({ orders: await container.orders.summarise(orders), stateLabels: STATE_LABELS });
  });

  app.get<{ Params: { id: string } }>("/v1/supervisor/orders/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      return reply.send({ order: await container.orders.detail(order) });
    });
  });

  app.post<{ Params: { id: string }; Body: { operatorUserId: string } }>("/v1/supervisor/orders/:id/assign", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const operatorUserId = String((req.body ?? {}).operatorUserId ?? "");
    if (!operatorUserId) return reply.code(400).send({ error: "invalid_request" });
    const operator = await container.store.users.get(operatorUserId);
    if (!operator || operator.areaId !== session.areaId) return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another area" });
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      const previous = order.assignedOperatorUserId;
      const updated = await container.orders.assignOperator(order.id, operatorUserId);
      await container.audit.record({ session, action: "order.operator_assigned", resource: "order", resourceId: order.id, previousValue: { assignedOperatorUserId: previous }, newValue: { assignedOperatorUserId: operatorUserId } });
      return reply.send({ order: await container.orders.detail(updated) });
    });
  });

  // -------------------------------------------------- pickups and processing

  app.get<{ Querystring: { date?: string } }>("/v1/supervisor/pickups", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    return reply.send({ pickups: await container.scheduling.pickupQueue({ societyIds, date: req.query.date }) });
  });

  app.get("/v1/supervisor/processing", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const orders = await container.access.visibleOrders(session);
    const summaries = await container.orders.summarise(orders);
    const of = (state: string) => summaries.filter((o) => o.state === state);
    return reply.send({
      waitingForWashing: of("picked_up"),
      washing: of("in_wash"),
      ironingPending: of("ironing").filter((o) => !o.ironingStarted),
      ironing: of("ironing").filter((o) => o.ironingStarted),
      waitingForQc: of("qc"),
      qcFailed: of("qc_hold"),
      readyForDelivery: of("ready_for_delivery"),
      outForDelivery: of("out_for_delivery"),
    });
  });

  app.get("/v1/supervisor/qc", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const orders = await container.access.visibleOrders(session);
    const relevant = orders.filter((o) => o.qcAttempts > 0 || o.state === "qc" || o.state === "qc_hold");
    const summaries = await container.orders.summarise(relevant);
    return reply.send({
      qc: summaries.map((o) => ({
        ...o,
        qcStatus: o.state === "qc" ? "pending" : o.qcPassed === true ? "passed" : o.qcPassed === false ? "failed" : "pending",
      })),
    });
  });

  app.get("/v1/supervisor/delayed", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const orders = await container.access.visibleOrders(session);
    const summaries = await container.orders.summarise(orders);
    return reply.send({ orders: summaries.filter((o) => o.delayed) });
  });

  // ---------------------------------------------------------------- issues

  app.get<{ Querystring: { status?: string; type?: string; societyId?: string } }>("/v1/supervisor/issues", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyIds = req.query.societyId
      ? new Set([req.query.societyId])
      : await container.access.visibleSocietyIds(session);
    return withScope(reply, async () => {
      if (req.query.societyId) await container.access.requireSociety(session, req.query.societyId);
      const issues = await container.issues.list({ societyIds, status: req.query.status as never, type: req.query.type });
      return reply.send({ issues, issueTypes: ISSUE_TYPES });
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/issues/:id/status", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = issueStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      if (issue.societyId) await container.access.requireSociety(session, issue.societyId);
      const result = await container.issues.setStatus(req.params.id, parsed.data.status, { resolution: parsed.data.resolution, assignedToUserId: session.userId });
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: parsed.data.status === "resolved" ? "issue.resolved" : "issue.status_changed", resource: "issue", resourceId: req.params.id, previousValue: { status: result.previous.status }, newValue: { status: parsed.data.status, resolution: parsed.data.resolution ?? null } });
      return reply.send({ issue: result.current });
    });
  });

  app.post<{ Params: { id: string }; Body: { note: string } }>("/v1/supervisor/issues/:id/escalate", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const note = String((req.body ?? {}).note ?? "").trim();
    if (!note) return reply.code(400).send({ error: "invalid_request" });
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      if (issue.societyId) await container.access.requireSociety(session, issue.societyId);
      const result = await container.issues.escalate(req.params.id, note, session.userId);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "issue.escalated", resource: "issue", resourceId: req.params.id, previousValue: { escalatedToAdmin: false }, newValue: { escalatedToAdmin: true, note } });
      return reply.send({ issue: result.current });
    });
  });

  // ---------------------------------------------------------------- reports

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/supervisor/reports", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const filter = { from: req.query.from, to: req.query.to, societyId: req.query.societyId, operatorUserId: req.query.operatorUserId, state: req.query.state };
    const [bySociety, byOperator, residents, subscriptions, issues, revenue] = await Promise.all([
      container.reports.bySociety(session, filter),
      container.reports.byOperator(session, filter),
      container.reports.residentStatistics(session),
      container.reports.subscriptionReport(session),
      container.reports.issueReport(session, filter),
      container.reports.revenueReport(session, filter),
    ]);
    return reply.send({ bySociety, byOperator, residents, subscriptions, issues, revenue });
  });

  // ----------------------------------------------------------------- search

  // Global search within the supervisor's permitted scope. Entering an order id
  // from another area returns nothing, exactly as if the order did not exist.
  app.get<{ Querystring: { q?: string } }>("/v1/supervisor/search", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const term = (req.query.q ?? "").trim().toLowerCase();
    if (!term) return reply.send({ orders: [], residents: [], societies: [], operators: [] });
    const orders = await container.access.visibleOrders(session);
    const societies = await container.access.visibleSocieties(session);
    const societyIds = new Set(societies.map((s) => s.id));
    const residents = await container.store.residents.find((r) => societyIds.has(r.societyId));
    const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
    const matchingResidents = residents.filter((r) => {
      const user = users.get(r.userId);
      return (user?.fullName ?? "").toLowerCase().includes(term) || (user?.phone ?? "").includes(term) || r.unitNumber.toLowerCase().includes(term);
    });
    const residentIds = new Set(matchingResidents.map((r) => r.id));
    const matchingOrders = orders.filter((o) => o.orderCode.toLowerCase().includes(term) || o.id === term || residentIds.has(o.residentId));
    const operators = (await container.store.users.find((u) => u.roles.includes("operator") && u.areaId === session.areaId))
      .filter((u) => (u.fullName ?? "").toLowerCase().includes(term) || (u.employeeId ?? "").toLowerCase().includes(term));
    return reply.send({
      orders: await container.orders.summarise(matchingOrders),
      residents: matchingResidents.map((r) => ({ id: r.id, fullName: users.get(r.userId)?.fullName ?? null, phone: users.get(r.userId)?.phone ?? null, unitNumber: r.unitNumber, societyId: r.societyId })),
      societies: societies.filter((s) => s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term)),
      operators: await container.users.decorateAll(operators),
    });
  });

  // ---------------------------------------------------------------- profile

  app.get("/v1/supervisor/profile", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const user = await container.store.users.get(session.userId);
    if (!user) return reply.code(404).send({ error: "not_found" });
    return reply.send({ profile: await container.users.decorate(user) });
  });

  app.patch("/v1/supervisor/profile", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    // Area assignment stays admin controlled, so it is not accepted here.
    const user = await container.auth.updateStaffProfile(session.userId, parsed.data);
    return reply.send({ profile: await container.users.decorate(user) });
  });
}
