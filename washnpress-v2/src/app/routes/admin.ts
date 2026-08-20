import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { AreaConflictError } from "../../services/area-service";
import { UserConflictError } from "../../services/user-service";
import { SocietyConflictError } from "../../services/society-service";
import { ISSUE_TYPES } from "../../services/issue-service";
import { DEFAULT_GARMENT_CATEGORIES } from "../../services/system-config-service";
import { STATE_LABELS } from "../../domain/order-state-machine";

const areaSchema = z.object({ name: z.string().min(2), code: z.string().min(2).max(10), description: z.string().optional(), region: z.string().optional() });
const areaPatchSchema = z.object({ name: z.string().min(2).optional(), description: z.string().optional(), region: z.string().optional(), status: z.enum(["active", "inactive"]).optional() });
const supervisorSchema = z.object({ fullName: z.string().min(2), phone: z.string().min(10).max(10), email: z.string().email().optional(), employeeId: z.string().optional(), areaId: z.string().optional() });
const staffPatchSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional(), employeeId: z.string().optional(), status: z.enum(["active", "blocked"]).optional() });
const societySchema = z.object({ name: z.string().min(2), code: z.string().min(2).max(10), areaId: z.string(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional() });
const societyPatchSchema = z.object({ name: z.string().min(2).optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), areaId: z.string().optional(), status: z.enum(["active", "coming_soon", "inactive"]).optional() });
const planSchema = z.object({ tier: z.string().min(2), garmentCap: z.number().int().positive(), turnaroundHours: z.number().int().positive(), monthlyPaise: z.number().int().nonnegative(), annualDiscountPercent: z.number().min(0).max(100).optional() });
const planPatchSchema = z.object({ tier: z.string().min(2).optional(), garmentCap: z.number().int().positive().optional(), turnaroundHours: z.number().int().positive().optional(), monthlyPaise: z.number().int().nonnegative().optional(), annualDiscountPercent: z.number().min(0).max(100).optional(), isActive: z.boolean().optional() });
const slotSchema = z.object({ societyId: z.string(), date: z.string(), window: z.string(), startTime: z.string(), endTime: z.string(), capacityTotal: z.number().int().positive() });
const configSchema = z.object({
  additionalGarmentRatePaise: z.number().int().nonnegative().optional(),
  garmentCategories: z.array(z.string().min(1)).min(1).optional(),
  defaultSlotCapacity: z.number().int().positive().optional(),
  defaultTurnaroundHours: z.number().int().positive().optional(),
  delayGraceHours: z.number().int().nonnegative().optional(),
  qcRequired: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
});
const issueStatusSchema = z.object({ status: z.enum(["open", "under_review", "resolved"]), resolution: z.string().optional() });

// The admin portal. Admin is the highest role and is never restricted to an area,
// so these routes read the whole platform. Everything that changes state is
// written to the audit log with its before and after value.
export function registerAdminRoutes(app: FastifyInstance, container: Container): void {
  const admin = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "admin");

  // ------------------------------------------------------------- dashboard

  app.get("/v1/admin/dashboard", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send(await container.dashboards.admin());
  });

  // ------------------------------------------------------------------ areas

  app.get("/v1/admin/areas", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const areas = await container.areas.list();
    return reply.send({ areas: await Promise.all(areas.map((a) => container.areas.summary(a))) });
  });

  app.post("/v1/admin/areas", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = areaSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const area = await container.areas.create(parsed.data);
      await container.audit.record({ session, action: "area.created", resource: "area", resourceId: area.id, newValue: area });
      return reply.code(201).send({ area });
    } catch (error) {
      if (error instanceof AreaConflictError) return reply.code(409).send({ error: "area_conflict", message: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/admin/areas/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const area = await container.areas.get(req.params.id);
    if (!area) return reply.code(404).send({ error: "not_found" });
    const societies = await container.areas.societiesIn(area.id);
    const operators = await container.store.users.find((u) => u.roles.includes("operator") && u.areaId === area.id);
    const orders = await container.store.orders.find((o) => o.areaId === area.id);
    return reply.send({
      area: await container.areas.summary(area),
      societies: await container.societies.summaries(societies),
      operators: await container.users.decorateAll(operators),
      orders: await container.orders.summarise(orders),
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/areas/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = areaPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.areas.update(req.params.id, parsed.data);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "area.updated", resource: "area", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
    return reply.send({ area: result.current });
  });

  app.post<{ Params: { id: string }; Body: { supervisorUserId: string } }>("/v1/admin/areas/:id/supervisor", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const supervisorUserId = String((req.body ?? {}).supervisorUserId ?? "");
    if (!supervisorUserId) return reply.code(400).send({ error: "invalid_request" });
    try {
      const result = await container.areas.assignSupervisor(req.params.id, supervisorUserId);
      await container.audit.record({
        session, action: result.previousSupervisorUserId ? "area.supervisor_reassigned" : "area.supervisor_assigned",
        resource: "area", resourceId: req.params.id,
        previousValue: { supervisorUserId: result.previousSupervisorUserId }, newValue: { supervisorUserId },
      });
      return reply.send({ area: result.area, supervisor: await container.users.decorate(result.supervisor) });
    } catch (error) {
      if (error instanceof AreaConflictError) return reply.code(409).send({ error: "assignment_failed", message: error.message });
      throw error;
    }
  });

  // ------------------------------------------------------------ supervisors

  app.get("/v1/admin/supervisors", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const supervisors = await container.users.listByRole("supervisor");
    return reply.send({ supervisors: await container.users.decorateAll(supervisors) });
  });

  app.post("/v1/admin/supervisors", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = supervisorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const user = await container.users.createStaff({ role: "supervisor", ...parsed.data, areaId: null });
      await container.audit.record({ session, action: "supervisor.created", resource: "user", resourceId: user.id, newValue: user });
      if (parsed.data.areaId) {
        const assigned = await container.areas.assignSupervisor(parsed.data.areaId, user.id);
        await container.audit.record({ session, action: "area.supervisor_assigned", resource: "area", resourceId: parsed.data.areaId, newValue: { supervisorUserId: user.id } });
        return reply.code(201).send({ supervisor: await container.users.decorate(assigned.supervisor) });
      }
      return reply.code(201).send({ supervisor: await container.users.decorate(user) });
    } catch (error) {
      if (error instanceof UserConflictError) return reply.code(409).send({ error: "user_conflict", message: error.message });
      if (error instanceof AreaConflictError) return reply.code(409).send({ error: "assignment_failed", message: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/admin/supervisors/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const user = await container.store.users.get(req.params.id);
    if (!user || !user.roles.includes("supervisor")) return reply.code(404).send({ error: "not_found" });
    const societies = user.areaId ? await container.areas.societiesIn(user.areaId) : [];
    const operators = user.areaId ? await container.store.users.find((u) => u.roles.includes("operator") && u.areaId === user.areaId) : [];
    const orders = user.areaId ? await container.store.orders.find((o) => o.areaId === user.areaId) : [];
    return reply.send({
      supervisor: await container.users.decorate(user),
      societies: await container.societies.summaries(societies),
      operators: await container.users.decorateAll(operators),
      orders: await container.orders.summarise(orders),
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/supervisors/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = staffPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.users.update(req.params.id, parsed.data);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "supervisor.updated", resource: "user", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
    return reply.send({ supervisor: await container.users.decorate(result.current) });
  });

  // ------------------------------------------------------------- societies

  app.get<{ Querystring: { areaId?: string; supervisorUserId?: string; q?: string } }>("/v1/admin/societies", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let societies = await container.store.societies.all();
    if (req.query.areaId) societies = societies.filter((s) => s.areaId === req.query.areaId);
    if (req.query.supervisorUserId) {
      const areas = await container.store.areas.find((a) => a.supervisorUserId === req.query.supervisorUserId);
      const areaIds = new Set(areas.map((a) => a.id));
      societies = societies.filter((s) => (s.areaId ? areaIds.has(s.areaId) : false));
    }
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      societies = societies.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
    }
    return reply.send({ societies: await container.societies.summaries(societies) });
  });

  app.post("/v1/admin/societies", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = societySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const society = await container.societies.create(parsed.data);
      await container.audit.record({ session, action: "society.created", resource: "society", resourceId: society.id, newValue: society });
      return reply.code(201).send({ society: await container.societies.summary(society) });
    } catch (error) {
      if (error instanceof SocietyConflictError) return reply.code(409).send({ error: "society_conflict", message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/societies/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = societyPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.societies.update(req.params.id, parsed.data);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({
      session, action: parsed.data.status ? "society.status_changed" : "society.updated",
      resource: "society", resourceId: req.params.id, previousValue: result.previous, newValue: result.current,
    });
    return reply.send({ society: await container.societies.summary(result.current) });
  });

  app.get<{ Params: { id: string } }>("/v1/admin/societies/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const society = await container.store.societies.get(req.params.id);
    if (!society) return reply.code(404).send({ error: "not_found" });
    const residents = await container.store.residents.find((r) => r.societyId === society.id);
    const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
    const orders = await container.store.orders.find((o) => o.societyId === society.id);
    return reply.send({
      society: await container.societies.summary(society),
      residents: residents.map((r) => ({ ...r, fullName: users.get(r.userId)?.fullName ?? null, phone: users.get(r.userId)?.phone ?? null, status: users.get(r.userId)?.status ?? null })),
      operators: await container.users.decorateAll(await container.store.users.find((u) => u.roles.includes("operator") && u.societyIds.includes(society.id))),
      slots: await container.scheduling.listSlots({ societyId: society.id }),
      orders: await container.orders.summarise(orders),
    });
  });

  // ------------------------------------------------------------------ users

  app.get<{ Querystring: { role?: string; status?: string; q?: string; areaId?: string; societyId?: string } }>("/v1/admin/users", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let users = await container.store.users.all();
    if (req.query.role) users = users.filter((u) => u.roles.includes(req.query.role as never));
    if (req.query.status) users = users.filter((u) => u.status === req.query.status);
    if (req.query.areaId) users = users.filter((u) => u.areaId === req.query.areaId);
    if (req.query.societyId) users = users.filter((u) => u.societyIds.includes(req.query.societyId!));
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      users = users.filter((u) => (u.fullName ?? "").toLowerCase().includes(q) || u.phone.includes(q) || (u.email ?? "").toLowerCase().includes(q));
    }
    const residents = new Map((await container.store.residents.all()).map((r) => [r.userId, r]));
    const societies = new Map((await container.store.societies.all()).map((s) => [s.id, s]));
    const decorated = await container.users.decorateAll(users);
    return reply.send({
      users: decorated.map((u) => {
        const resident = residents.get(u.id);
        return {
          ...u,
          residentSocietyId: resident?.societyId ?? null,
          residentSocietyName: resident ? societies.get(resident.societyId)?.name ?? null : null,
          unitNumber: resident?.unitNumber ?? null,
          onboardingCompleted: resident?.onboardingCompleted ?? null,
        };
      }),
    });
  });

  app.patch<{ Params: { id: string }; Body: { status?: "active" | "blocked" } }>("/v1/admin/users/:id/status", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const status = (req.body ?? {}).status;
    if (status !== "active" && status !== "blocked") return reply.code(400).send({ error: "invalid_request" });
    if (req.params.id === session.userId) return reply.code(409).send({ error: "cannot_change_own_status" });
    const result = await container.users.setStatus(req.params.id, status);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({
      session, action: status === "active" ? "user.activated" : "user.deactivated",
      resource: "user", resourceId: req.params.id,
      previousValue: { status: result.previous.status }, newValue: { status },
    });
    return reply.send({ user: await container.users.decorate(result.current) });
  });

  // ----------------------------------------------------------------- orders

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/orders", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    let orders = await container.store.orders.all();
    const q = req.query;
    if (q.areaId) orders = orders.filter((o) => o.areaId === q.areaId);
    if (q.societyId) orders = orders.filter((o) => o.societyId === q.societyId);
    if (q.state) orders = orders.filter((o) => o.state === q.state);
    if (q.residentId) orders = orders.filter((o) => o.residentId === q.residentId);
    if (q.from) orders = orders.filter((o) => o.createdAt >= q.from!);
    if (q.to) orders = orders.filter((o) => o.createdAt <= q.to!);
    if (q.supervisorUserId) {
      const areas = await container.store.areas.find((a) => a.supervisorUserId === q.supervisorUserId);
      const areaIds = new Set(areas.map((a) => a.id));
      orders = orders.filter((o) => (o.areaId ? areaIds.has(o.areaId) : false));
    }
    if (q.orderCode) orders = orders.filter((o) => o.orderCode.toLowerCase().includes(q.orderCode!.toLowerCase()));
    if (q.resident) {
      const term = q.resident.toLowerCase();
      const users = await container.store.users.all();
      const residents = await container.store.residents.all();
      const matching = new Set(residents
        .filter((r) => {
          const user = users.find((u) => u.id === r.userId);
          return (user?.fullName ?? "").toLowerCase().includes(term) || (user?.phone ?? "").includes(term);
        })
        .map((r) => r.id));
      orders = orders.filter((o) => matching.has(o.residentId));
    }
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return reply.send({ orders: await container.orders.summarise(orders), stateLabels: STATE_LABELS });
  });

  app.get<{ Params: { id: string } }>("/v1/admin/orders/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      return reply.send({ order: await container.orders.detail(order) });
    });
  });

  // ------------------------------------------------------------------ plans

  app.get("/v1/admin/plans", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ plans: await container.subscriptions.planUsage() });
  });

  app.post("/v1/admin/plans", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const plan = await container.subscriptions.createPlan(parsed.data);
    await container.audit.record({ session, action: "plan.created", resource: "plan", resourceId: plan.id, newValue: plan });
    return reply.code(201).send({ plan });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/plans/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = planPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.subscriptions.updatePlan(req.params.id, parsed.data);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "plan.updated", resource: "plan", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
    return reply.send({ plan: result.current });
  });

  // ------------------------------------------------------------------ slots

  app.get<{ Querystring: { societyId?: string; from?: string; to?: string } }>("/v1/admin/slots", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ slots: await container.scheduling.listSlots({ societyId: req.query.societyId, from: req.query.from, to: req.query.to }) });
  });

  app.post("/v1/admin/slots", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = slotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const slot = await container.scheduling.createSlot(parsed.data);
    await container.audit.record({ session, action: "slot.created", resource: "slot", resourceId: slot.id, newValue: slot });
    return reply.code(201).send({ slot });
  });

  // --------------------------------------------------------------- reports

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/reports", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const filter = { from: req.query.from, to: req.query.to, areaId: req.query.areaId, societyId: req.query.societyId, supervisorUserId: req.query.supervisorUserId, state: req.query.state };
    const [byArea, bySociety, bySupervisor, byOperator, residents, subscriptions, issues, revenue] = await Promise.all([
      container.reports.byArea(session, filter),
      container.reports.bySociety(session, filter),
      container.reports.bySupervisor(session, filter),
      container.reports.byOperator(session, filter),
      container.reports.residentStatistics(session),
      container.reports.subscriptionReport(session),
      container.reports.issueReport(session, filter),
      container.reports.revenueReport(session, filter),
    ]);
    return reply.send({ byArea, bySociety, bySupervisor, byOperator, residents, subscriptions, issues, revenue });
  });

  app.get("/v1/admin/reports/subscriptions", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.subscriptions()); });
  app.get("/v1/admin/reports/revenue", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.revenue()); });
  app.get("/v1/admin/reports/operations", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.operations()); });
  app.get("/v1/admin/reports/sustainability", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.sustainability()); });
  app.get("/v1/admin/reports/garment-risk", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.garmentRisk()); });

  // ---------------------------------------------------------------- issues

  app.get<{ Querystring: { status?: string; type?: string; areaId?: string; escalated?: string } }>("/v1/admin/issues", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const issues = await container.issues.list({
      status: req.query.status as never, type: req.query.type, areaId: req.query.areaId,
      escalatedOnly: req.query.escalated === "true",
    });
    return reply.send({ issues, issueTypes: ISSUE_TYPES });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/issues/:id/status", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = issueStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await container.issues.setStatus(req.params.id, parsed.data.status, { resolution: parsed.data.resolution });
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "issue.status_changed", resource: "issue", resourceId: req.params.id, previousValue: { status: result.previous.status }, newValue: { status: parsed.data.status } });
    return reply.send({ issue: result.current });
  });

  // ----------------------------------------------------------------- audit

  app.get<{ Querystring: { resource?: string; resourceId?: string; actor?: string; action?: string; from?: string; to?: string; limit?: string } }>("/v1/admin/audit", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const entries = await container.audit.list({
      resource: req.query.resource, resourceId: req.query.resourceId, actor: req.query.actor,
      action: req.query.action, from: req.query.from, to: req.query.to,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return reply.send({ entries });
  });

  // ---------------------------------------------------------------- config

  app.get("/v1/admin/config", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ config: await container.systemConfig.get(), defaultGarmentCategories: DEFAULT_GARMENT_CATEGORIES });
  });

  app.patch("/v1/admin/config", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const result = await container.systemConfig.update(parsed.data, session.userId);
    await container.audit.record({ session, action: "system_config.changed", resource: "system_config", resourceId: result.current.id, previousValue: result.previous, newValue: result.current });
    return reply.send({ config: result.current });
  });
}
