import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { UserConflictError } from "../../services/user-service";
import { AreaNotActiveError, AreaNotFoundError, SocietyConflictError } from "../../services/society-service";
import { SlotInPastError, SlotInUseError } from "../../services/scheduling-service";
import { ISSUE_TYPES, ISSUE_PRIORITIES, IssueTransitionError } from "../../services/issue-service";
import { StaffingError } from "../../services/staffing-service";
import { STATE_LABELS } from "../../domain/order-state-machine";

const societySchema = z.object({ name: z.string().min(2), code: z.string().min(2).max(10), address: z.string().min(3), city: z.string().optional(), state: z.string().optional() });
const societyPatchSchema = z.object({ name: z.string().min(2).optional(), address: z.string().optional(), city: z.string().optional(), status: z.enum(["active", "coming_soon", "inactive"]).optional() });
const operatorSchema = z.object({ fullName: z.string().min(2), phone: z.string().min(10).max(10), email: z.string().email().optional(), employeeId: z.string().optional(), societyIds: z.array(z.string()).optional() });
const operatorPatchSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional(), employeeId: z.string().optional(), status: z.enum(["active", "on_leave", "blocked"]).optional(), societyIds: z.array(z.string()).optional() });
const slotSchema = z.object({ societyId: z.string(), date: z.string(), window: z.string(), startTime: z.string(), endTime: z.string(), capacityTotal: z.number().int().positive() });
const slotPatchSchema = z.object({ window: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional(), capacityTotal: z.number().int().positive().optional(), isActive: z.boolean().optional() });
const issueStatusSchema = z.object({ status: z.enum(["assigned", "in_progress", "resolved", "closed"]), resolution: z.string().optional() });
const issueReplySchema = z.object({ body: z.string().min(1) });
const issuePrioritySchema = z.object({ priority: z.enum(["low", "normal", "high", "emergency"]) });
const availabilitySchema = z.object({ status: z.enum(["active", "on_leave", "blocked"]), reassignToUserId: z.string().nullable().optional(), reason: z.string().optional() });
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
    // Said plainly, because "409" on its own does not tell a supervisor what to do.
    if (!session.areaId) {
      return reply.code(409).send({
        error: "no_area_assigned",
        message: "You cannot create a society because no area is assigned to your account.",
      });
    }
    const parsed = societySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      // The area is taken from the session, so a supervisor cannot create a society
      // inside somebody else's area by supplying a different areaId.
      const society = await container.societies.create({ ...parsed.data, areaId: session.areaId });
      await container.audit.record({ session, action: "society.created", resource: "society", resourceId: society.id, newValue: society });
      return reply.code(201).send({ society: await container.societies.summary(society) });
    } catch (error) {
      if (error instanceof AreaNotFoundError) return reply.code(404).send({ error: "area_not_found", message: error.message });
      if (error instanceof AreaNotActiveError) return reply.code(422).send({ error: "area_not_active", message: error.message });
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

  // Days that have already gone are left out unless includePast is asked for, so
  // the schedule shows slots that can still be worked rather than dead ones.
  app.get<{ Querystring: { societyId?: string; from?: string; to?: string; includePast?: string } }>("/v1/supervisor/slots", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      if (req.query.societyId) await container.access.requireSociety(session, req.query.societyId);
      const societyIds = await container.access.visibleSocietyIds(session);
      return reply.send({ slots: await container.scheduling.listSlots({
        societyIds, societyId: req.query.societyId, from: req.query.from, to: req.query.to,
        includePast: req.query.includePast === "true",
      }) });
    });
  });

  app.post("/v1/supervisor/slots", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = slotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      await container.access.requireSociety(session, parsed.data.societyId);
      try {
        const slot = await container.scheduling.createSlot(parsed.data);
        await container.audit.record({ session, action: "slot.created", resource: "slot", resourceId: slot.id, newValue: slot });
        return reply.code(201).send({ slot });
      } catch (error) {
        if (error instanceof SlotInPastError) return reply.code(400).send({ error: "slot_in_past", message: error.message });
        throw error;
      }
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

  // How many operators in this area are in each availability state.
  async function operatorCounts(c: typeof container, areaId: string | null) {
    const all = await c.store.users.find((u) => u.roles.includes("operator") && u.areaId === areaId);
    return {
      all: all.length,
      active: all.filter((u) => u.status === "active").length,
      on_leave: all.filter((u) => u.status === "on_leave").length,
      blocked: all.filter((u) => u.status === "blocked").length,
    };
  }

  // Filtering by availability and by name or phone, because a supervisor looking for
  // who is on leave should not have to read the whole list to find out.
  app.get<{ Querystring: { status?: string; q?: string } }>("/v1/supervisor/operators", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const { status, q } = req.query;
    const needle = q?.trim().toLowerCase() ?? "";
    const operators = await container.store.users.find((u) => {
      if (!u.roles.includes("operator") || u.areaId !== session.areaId) return false;
      if (status && status !== "all" && u.status !== status) return false;
      if (!needle) return true;
      return (u.fullName ?? "").toLowerCase().includes(needle) || (u.phone ?? "").includes(needle);
    });
    return reply.send({
      operators: await container.users.decorateAll(operators),
      // The counts the filter chips render, taken before the filter is applied so
      // they do not change as the supervisor narrows the list.
      counts: await operatorCounts(container, session.areaId),
    });
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
      const { status, ...rest } = parsed.data;
      const result = await container.users.update(req.params.id, rest);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({
        session, action: parsed.data.societyIds ? "operator.reassigned" : "operator.updated",
        resource: "user", resourceId: req.params.id, previousValue: result.previous, newValue: result.current,
      });
      // A status change goes through the staffing service so open work is handed
      // over in the same step rather than being stranded behind the person.
      if (status && status !== result.previous.status) {
        const handover = await container.staffing.setAvailability({ userId: req.params.id, status, session });
        return reply.send({
          operator: await container.users.decorate(handover.user),
          reassigned: handover.reassigned, returnedToQueue: handover.unassigned,
        });
      }
      return reply.send({ operator: await container.users.decorate(result.current) });
    });
  });

  // What an operator is still holding, and who could take it on.
  app.get<{ Params: { id: string } }>("/v1/supervisor/operators/:id/handover", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const target = await container.store.users.get(req.params.id);
    if (!target || !target.roles.includes("operator")) return reply.code(404).send({ error: "not_found" });
    if (target.areaId !== session.areaId) return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another area" });
    return reply.send(await container.staffing.workloadHandoverPreview(req.params.id));
  });

  // Taking an operator off duty never deletes them and never strands their work.
  app.post<{ Params: { id: string } }>("/v1/supervisor/operators/:id/availability", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const target = await container.store.users.get(req.params.id);
    if (!target || !target.roles.includes("operator")) return reply.code(404).send({ error: "not_found" });
    if (target.areaId !== session.areaId) return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another area" });
    try {
      const result = await container.staffing.setAvailability({
        userId: req.params.id, status: parsed.data.status,
        reassignToUserId: parsed.data.reassignToUserId ?? null,
        reason: parsed.data.reason, session,
      });
      return reply.send({
        operator: await container.users.decorate(result.user),
        reassigned: result.reassigned, returnedToQueue: result.unassigned,
      });
    } catch (error) {
      if (error instanceof StaffingError) return reply.code(409).send({ error: "handover_failed", message: error.message });
      throw error;
    }
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

  app.post<{ Params: { id: string }; Body: { operatorUserId: string | null; reason?: string } }>("/v1/supervisor/orders/:id/assign", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const body = req.body ?? { operatorUserId: null };
    // A null operator deliberately returns the order to the shared queue, which is
    // how work is freed when the person holding it becomes unavailable.
    const operatorUserId = body.operatorUserId ? String(body.operatorUserId) : null;
    if (operatorUserId) {
      const operator = await container.store.users.get(operatorUserId);
      if (!operator || operator.areaId !== session.areaId) return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another area" });
      if (operator.status !== "active") return reply.code(409).send({ error: "operator_unavailable", message: "That operator is not currently available" });
    }
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      try {
        const moved = await container.staffing.reassignOrder(order.id, operatorUserId, session, body.reason);
        const refreshed = await container.store.orders.get(order.id);
        return reply.send({ order: await container.orders.detail(refreshed!), reassigned: moved });
      } catch (error) {
        if (error instanceof StaffingError) return reply.code(409).send({ error: "assignment_failed", message: (error as Error).message });
        throw error;
      }
    });
  });

  // -------------------------------------------------- pickups and processing

  // Pickups for a day, optionally narrowed to one society. Narrowing still has to
  // stay inside the area, so an unknown society id gives the whole area rather than
  // somebody else's.
  app.get<{ Querystring: { date?: string; societyId?: string } }>("/v1/supervisor/pickups", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    const { societyId } = req.query;
    const scoped = societyId && societyIds.has(societyId) ? new Set([societyId]) : societyIds;
    const societies = await container.store.societies.find((sc) => societyIds.has(sc.id));
    return reply.send({
      pickups: await container.scheduling.pickupQueue({ societyIds: scoped, date: req.query.date }),
      // The societies the filter can offer, which is exactly what this supervisor
      // is responsible for.
      societies: societies.map((sc) => ({ id: sc.id, name: sc.name })),
    });
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

  app.get<{ Querystring: { status?: string; type?: string; societyId?: string; priority?: string; emergency?: string; open?: string } }>("/v1/supervisor/issues", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyIds = req.query.societyId
      ? new Set([req.query.societyId])
      : await container.access.visibleSocietyIds(session);
    return withScope(reply, async () => {
      if (req.query.societyId) await container.access.requireSociety(session, req.query.societyId);
      const issues = await container.issues.list({
        societyIds, status: req.query.status as never, type: req.query.type,
        priority: req.query.priority as never,
        emergencyOnly: req.query.emergency === "true",
        openOnly: req.query.open === "true",
      });
      return reply.send({
        issues: await container.issues.details(issues),
        issueTypes: ISSUE_TYPES, priorities: ISSUE_PRIORITIES,
      });
    });
  });

  app.get<{ Params: { id: string } }>("/v1/supervisor/issues/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      if (issue.societyId) await container.access.requireSociety(session, issue.societyId);
      return reply.send({ issue: await container.issues.detail(issue) });
    });
  });

  // The supervisor speaks to the resident through the ticket, so the whole exchange
  // stays on the record instead of happening informally with the operator.
  app.post<{ Params: { id: string } }>("/v1/supervisor/issues/:id/reply", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = issueReplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    if (issue.status === "closed") return reply.code(409).send({ error: "ticket_closed" });
    return withScope(reply, async () => {
      if (issue.societyId) await container.access.requireSociety(session, issue.societyId);
      const updated = await container.issues.reply(req.params.id, session.userId, "supervisor", parsed.data.body);
      if (!updated) return reply.code(404).send({ error: "not_found" });
      if (updated.residentId) {
        await container.notifications.notifyResident(updated.residentId, {
          type: "issue.replied", orderId: updated.orderId,
          title: "Support replied to your ticket", body: parsed.data.body,
        });
      }
      return reply.send({ issue: await container.issues.detail(updated) });
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/issues/:id/priority", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = issuePrioritySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      if (issue.societyId) await container.access.requireSociety(session, issue.societyId);
      const result = await container.issues.setPriority(req.params.id, parsed.data.priority);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "issue.priority_changed", resource: "issue", resourceId: req.params.id, previousValue: { priority: result.previous.priority }, newValue: { priority: parsed.data.priority } });
      return reply.send({ issue: await container.issues.detail(result.current) });
    });
  });

  app.post<{ Params: { id: string }; Body: { userId: string } }>("/v1/supervisor/issues/:id/assign", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const userId = String((req.body ?? {}).userId ?? "");
    if (!userId) return reply.code(400).send({ error: "invalid_request" });
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    const target = await container.store.users.get(userId);
    if (!target || target.areaId !== session.areaId) return reply.code(403).send({ error: "forbidden_scope", message: "That user is outside your area" });
    return withScope(reply, async () => {
      if (issue.societyId) await container.access.requireSociety(session, issue.societyId);
      const result = await container.issues.assign(req.params.id, userId);
      if (!result) return reply.code(409).send({ error: "ticket_closed" });
      await container.audit.record({ session, action: "issue.assigned", resource: "issue", resourceId: req.params.id, previousValue: { assignedToUserId: result.previous.assignedToUserId }, newValue: { assignedToUserId: userId } });
      return reply.send({ issue: await container.issues.detail(result.current) });
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
      try {
        const result = await container.issues.setStatus(req.params.id, parsed.data.status, { resolution: parsed.data.resolution, actorUserId: session.userId });
        if (!result) return reply.code(404).send({ error: "not_found" });
        await container.audit.record({ session, action: parsed.data.status === "resolved" ? "issue.resolved" : "issue.status_changed", resource: "issue", resourceId: req.params.id, previousValue: { status: result.previous.status }, newValue: { status: parsed.data.status, resolution: parsed.data.resolution ?? null } });
        if (parsed.data.status === "resolved" && result.current.residentId) {
          await container.notifications.notifyResident(result.current.residentId, {
            type: "issue.resolved", orderId: result.current.orderId,
            title: "Your support ticket was resolved",
            body: result.current.resolution ?? "The issue has been resolved. Close the ticket if you are satisfied.",
          });
        }
        return reply.send({ issue: await container.issues.detail(result.current) });
      } catch (error) {
        if (error instanceof IssueTransitionError) return reply.code(409).send({ error: "illegal_ticket_transition", message: error.message });
        throw error;
      }
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
      const result = await container.issues.escalate(req.params.id, note, session.userId, "supervisor");
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "issue.escalated", resource: "issue", resourceId: req.params.id, previousValue: { escalatedToAdmin: false }, newValue: { escalatedToAdmin: true, note } });
      return reply.send({ issue: await container.issues.detail(result.current) });
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
