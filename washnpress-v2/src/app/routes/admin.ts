import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { AreaConflictError } from "../../services/area-service";
import { UserConflictError } from "../../services/user-service";
import { SocietyConflictError } from "../../services/society-service";
import { ISSUE_TYPES, ISSUE_PRIORITIES, IssueTransitionError } from "../../services/issue-service";
import { StaffingError } from "../../services/staffing-service";
import { SlotInUseError } from "../../services/scheduling-service";
import { DEFAULT_GARMENT_CATEGORIES, DEFAULT_GARMENT_SERVICES } from "../../services/system-config-service";
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
  nonSubscriberGarmentRatePaise: z.number().int().nonnegative().optional(),
  garmentServices: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1),
    unitPricePaise: z.number().int().nonnegative(),
    isBase: z.boolean().default(false), isActive: z.boolean().default(true),
  })).min(1).optional(),
  garmentCategories: z.array(z.string().min(1)).min(1).optional(),
  defaultSlotCapacity: z.number().int().positive().optional(),
  defaultTurnaroundHours: z.number().int().positive().optional(),
  delayGraceHours: z.number().int().nonnegative().optional(),
  qcRequired: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
});
const issueStatusSchema = z.object({ status: z.enum(["assigned", "in_progress", "resolved", "closed"]), resolution: z.string().optional() });
const issueReplySchema = z.object({ body: z.string().min(1) });
const availabilitySchema = z.object({ status: z.enum(["active", "on_leave", "blocked"]), reassignToUserId: z.string().nullable().optional(), reason: z.string().optional() });
const slotPatchSchema = z.object({ window: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional(), capacityTotal: z.number().int().positive().optional(), isActive: z.boolean().optional() });
const operatorSchema = z.object({ fullName: z.string().min(2), phone: z.string().min(10).max(10), email: z.string().email().optional(), employeeId: z.string().optional(), areaId: z.string(), societyIds: z.array(z.string()).optional() });
const operatorPatchSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional(), employeeId: z.string().optional(), areaId: z.string().optional(), societyIds: z.array(z.string()).optional() });
const assignSchema = z.object({ operatorUserId: z.string().nullable().optional(), reason: z.string().optional() });

// The admin portal. Admin is the highest role and is never restricted to an area,
// so these routes read the whole platform. Everything that changes state is
// written to the audit log with its before and after value.
export function registerAdminRoutes(app: FastifyInstance, container: Container): void {
  const admin = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "admin");

  // ------------------------------------------------------- supervisor cover

  // Areas whose supervisor is unavailable. The admin covers these, which is why the
  // slot, society and operator endpoints below exist at admin level too.
  app.get("/v1/admin/coverage", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const areas = await container.areas.list();
    const coverage = await Promise.all(areas.map((a) => container.staffing.areaCoverage(a.id)));
    const rows = coverage.filter((c): c is NonNullable<typeof c> => Boolean(c));
    return reply.send({ coverage: rows, needingCover: rows.filter((c) => c.needsAdminCover) });
  });

  // Taking any staff member off duty. The account is kept and an operator's open
  // work is handed over in the same step.
  app.post<{ Params: { id: string } }>("/v1/admin/users/:id/availability", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (req.params.id === session.userId) return reply.code(409).send({ error: "cannot_change_own_status" });
    try {
      const result = await container.staffing.setAvailability({
        userId: req.params.id, status: parsed.data.status,
        reassignToUserId: parsed.data.reassignToUserId ?? null,
        reason: parsed.data.reason, session,
      });
      return reply.send({
        user: await container.users.decorate(result.user),
        reassigned: result.reassigned, returnedToQueue: result.unassigned,
      });
    } catch (error) {
      if (error instanceof StaffingError) return reply.code(409).send({ error: "handover_failed", message: error.message });
      throw error;
    }
  });

  // Operations staff, system wide. Admin can create and move them in any area so a
  // supervisor being unavailable never blocks operations.
  app.get<{ Querystring: { areaId?: string; societyId?: string; status?: string } }>("/v1/admin/operators", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let operators = await container.users.listByRole("operator");
    if (req.query.areaId) operators = operators.filter((u) => u.areaId === req.query.areaId);
    if (req.query.societyId) operators = operators.filter((u) => u.societyIds.includes(req.query.societyId!));
    if (req.query.status) operators = operators.filter((u) => u.status === req.query.status);
    return reply.send({ operators: await container.users.decorateAll(operators) });
  });

  app.post("/v1/admin/operators", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = operatorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const area = await container.areas.get(parsed.data.areaId);
    if (!area) return reply.code(404).send({ error: "area_not_found" });
    try {
      const user = await container.users.createStaff({ role: "operator", ...parsed.data });
      await container.audit.record({ session, action: "operator.created", resource: "user", resourceId: user.id, newValue: user });
      return reply.code(201).send({ operator: await container.users.decorate(user) });
    } catch (error) {
      if (error instanceof UserConflictError) return reply.code(409).send({ error: "user_conflict", message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/operators/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = operatorPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const target = await container.store.users.get(req.params.id);
    if (!target || !target.roles.includes("operator")) return reply.code(404).send({ error: "not_found" });
    const result = await container.users.update(req.params.id, parsed.data);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "operator.updated", resource: "user", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
    return reply.send({ operator: await container.users.decorate(result.current) });
  });

  app.post<{ Params: { id: string } }>("/v1/admin/orders/:id/assign", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = assignSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const order = await container.store.orders.get(req.params.id);
    if (!order) return reply.code(404).send({ error: "not_found" });
    try {
      const moved = await container.staffing.reassignOrder(order.id, parsed.data.operatorUserId ?? null, session, parsed.data.reason);
      const refreshed = await container.store.orders.get(order.id);
      return reply.send({ order: await container.orders.detail(refreshed!), reassigned: moved });
    } catch (error) {
      if (error instanceof StaffingError) return reply.code(409).send({ error: "assignment_failed", message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/slots/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = slotPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
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

  app.post<{ Params: { id: string } }>("/v1/admin/slots/:id/cancel", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const existing = await container.store.slots.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const result = await container.scheduling.cancelSlot(req.params.id);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "slot.cancelled", resource: "slot", resourceId: req.params.id, previousValue: existing, newValue: result.slot });
    return reply.send(result);
  });

  // --------------------------------------------------------------- dashboard

  app.get("/v1/admin/dashboard", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send(await container.dashboards.admin());
  });

  // ------------------------------------------------------------------ areas

  app.get<{ Querystring: { status?: string } }>("/v1/admin/areas", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let areas = await container.areas.list();
    if (req.query.status) areas = areas.filter((a) => a.status === req.query.status);
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

  app.get<{ Querystring: { status?: string; assigned?: string } }>("/v1/admin/supervisors", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let supervisors = await container.users.listByRole("supervisor");
    if (req.query.status) supervisors = supervisors.filter((u) => u.status === req.query.status);
    // The dashboard's "unassigned supervisors" tile drills straight into this.
    if (req.query.assigned === "false") supervisors = supervisors.filter((u) => !u.areaId);
    if (req.query.assigned === "true") supervisors = supervisors.filter((u) => Boolean(u.areaId));
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

  app.get<{ Querystring: { areaId?: string; supervisorUserId?: string; q?: string; status?: string } }>("/v1/admin/societies", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let societies = await container.store.societies.all();
    if (req.query.areaId) societies = societies.filter((s) => s.areaId === req.query.areaId);
    if (req.query.supervisorUserId) {
      const areas = await container.store.areas.find((a) => a.supervisorUserId === req.query.supervisorUserId);
      const areaIds = new Set(areas.map((a) => a.id));
      societies = societies.filter((s) => (s.areaId ? areaIds.has(s.areaId) : false));
    }
    if (req.query.status) societies = societies.filter((s) => s.status === req.query.status);
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

  app.get<{ Querystring: { role?: string; status?: string; q?: string; areaId?: string; societyId?: string; onboarding?: string } }>("/v1/admin/users", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let users = await container.store.users.all();
    if (req.query.role) users = users.filter((u) => u.roles.includes(req.query.role as never));
    if (req.query.status) users = users.filter((u) => u.status === req.query.status);
    if (req.query.areaId) users = users.filter((u) => u.areaId === req.query.areaId);
    if (req.query.societyId) users = users.filter((u) => u.societyIds.includes(req.query.societyId!));
    const residentRecords = await container.store.residents.all();
    if (req.query.onboarding) {
      const want = req.query.onboarding === "completed";
      const byUser = new Map(residentRecords.map((r) => [r.userId, r]));
      users = users.filter((u) => Boolean(byUser.get(u.id)?.onboardingCompleted) === want);
    }
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
    if (q.operatorUserId) orders = orders.filter((o) => o.assignedOperatorUserId === q.operatorUserId);
    if (q.unassigned === "true") orders = orders.filter((o) => !o.assignedOperatorUserId);
    if (q.payment) {
      orders = q.payment === "pending"
        ? orders.filter((o) => o.additionalChargeStatus === "pending" || o.additionalChargeStatus === "failed")
        : orders.filter((o) => o.additionalChargeStatus === q.payment);
    }
    if (q.today === "true") {
      const today = new Date().toISOString().slice(0, 10);
      orders = orders.filter((o) => o.createdAt.slice(0, 10) === today);
    }
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
    let summaries = await container.orders.summarise(orders);
    // Delayed is derived rather than stored, so it is filtered after summarising.
    if (q.delayed === "true") summaries = summaries.filter((o) => o.delayed);
    return reply.send({ orders: summaries, stateLabels: STATE_LABELS });
  });

  // The subscription tiles on the dashboard drill into this.
  app.get<{ Querystring: { status?: string; planId?: string } }>("/v1/admin/subscriptions", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let subs = await container.store.subscriptions.all();
    if (req.query.status) subs = subs.filter((s) => s.status === req.query.status);
    if (req.query.planId) subs = subs.filter((s) => s.planId === req.query.planId);
    const plans = new Map((await container.store.plans.all()).map((p) => [p.id, p]));
    const residents = new Map((await container.store.residents.all()).map((r) => [r.id, r]));
    const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
    const societies = new Map((await container.store.societies.all()).map((s) => [s.id, s]));
    return reply.send({
      subscriptions: subs.map((sub) => {
        const resident = residents.get(sub.residentId);
        const user = resident ? users.get(resident.userId) : null;
        const plan = plans.get(sub.planId);
        return {
          ...sub,
          planTier: plan?.tier ?? null, monthlyPaise: plan?.monthlyPaise ?? null,
          allowance: plan?.garmentCap ?? null,
          remaining: plan ? Math.max(0, plan.garmentCap - sub.garmentsUsed) : null,
          residentName: user?.fullName ?? null, residentPhone: user?.phone ?? null,
          societyName: resident ? societies.get(resident.societyId)?.name ?? null : null,
        };
      }),
    });
  });

  // The revenue tiles drill into this rather than showing only a total.
  app.get<{ Querystring: { from?: string; to?: string } }>("/v1/admin/revenue", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const filter = { from: req.query.from, to: req.query.to };
    const summary = await container.reports.revenueReport(session, filter);
    let orders = await container.store.orders.all();
    if (filter.from) orders = orders.filter((o) => o.createdAt >= filter.from!);
    if (filter.to) orders = orders.filter((o) => o.createdAt <= filter.to!);
    const charged = orders.filter((o) => (o.additionalChargePaise ?? 0) > 0);
    return reply.send({
      summary,
      byPlan: (await container.subscriptions.planUsage()).map((p) => ({
        planId: p.id, tier: p.tier, activeSubscribers: p.activeSubscribers, revenuePaise: p.revenuePaise,
      })),
      additionalCharges: await container.orders.summarise(charged),
      pendingCharges: await container.orders.summarise(
        charged.filter((o) => o.additionalChargeStatus === "pending" || o.additionalChargeStatus === "failed"),
      ),
    });
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

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/issues", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const issues = await container.issues.list({
      status: req.query.status as never, type: req.query.type, areaId: req.query.areaId,
      priority: req.query.priority as never,
      escalatedOnly: req.query.escalated === "true",
      emergencyOnly: req.query.emergency === "true",
      openOnly: req.query.open === "true",
      from: req.query.from, to: req.query.to,
    });
    const filtered = req.query.societyId ? issues.filter((t) => t.societyId === req.query.societyId) : issues;
    return reply.send({
      issues: await container.issues.details(filtered),
      issueTypes: ISSUE_TYPES, priorities: ISSUE_PRIORITIES,
    });
  });

  // Everything the admin support dashboard reports: volumes, ageing, average
  // resolution time and supervisor by supervisor performance.
  app.get<{ Querystring: { from?: string; to?: string } }>("/v1/admin/issues/analytics", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const issues = await container.issues.list({ from: req.query.from, to: req.query.to });
    return reply.send({ analytics: await container.issues.analytics(issues) });
  });

  app.get<{ Params: { id: string } }>("/v1/admin/issues/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return reply.send({ issue: await container.issues.detail(issue) });
  });

  app.post<{ Params: { id: string } }>("/v1/admin/issues/:id/reply", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = issueReplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const updated = await container.issues.reply(req.params.id, session.userId, "admin", parsed.data.body);
    if (!updated) return reply.code(404).send({ error: "not_found_or_closed" });
    if (updated.residentId) {
      await container.notifications.notifyResident(updated.residentId, {
        type: "issue.replied", orderId: updated.orderId,
        title: "Support replied to your ticket", body: parsed.data.body,
      });
    }
    return reply.send({ issue: await container.issues.detail(updated) });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/issues/:id/status", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = issueStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const result = await container.issues.setStatus(req.params.id, parsed.data.status, { resolution: parsed.data.resolution, actorUserId: session.userId });
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "issue.status_changed", resource: "issue", resourceId: req.params.id, previousValue: { status: result.previous.status }, newValue: { status: parsed.data.status } });
      return reply.send({ issue: await container.issues.detail(result.current) });
    } catch (error) {
      if (error instanceof IssueTransitionError) return reply.code(409).send({ error: "illegal_ticket_transition", message: error.message });
      throw error;
    }
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
    return reply.send({ config: await container.systemConfig.get(), defaultGarmentCategories: DEFAULT_GARMENT_CATEGORIES, defaultGarmentServices: DEFAULT_GARMENT_SERVICES });
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
