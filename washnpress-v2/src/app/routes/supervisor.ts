import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope, refuseUnprovenStaff } from "../guards";
import { UserConflictError } from "../../services/user-service";
import { AreaNotActiveError, AreaNotFoundError, SocietyConflictError } from "../../services/society-service";
import { SlotInPastError, SlotInUseError, SlotTooSoonError, UnknownSlotWindowError, SLOT_WINDOWS, serviceDay } from "../../services/scheduling-service";
import { paginate } from "../paging";
import type { SupportTicket } from "../../domain/models";
import { ForbiddenScopeError } from "../../domain/access";
import { ISSUE_TYPES, ISSUE_PRIORITIES, IssueEscalationError, IssueService, IssueTransitionError, ConversationClosedError } from "../../services/issue-service";
import { StaffingError } from "../../services/staffing-service";
import { STATE_LABELS } from "../../domain/order-state-machine";
import { NotYourStaffError } from "../../services/user-service";
import { AssignmentError } from "../../domain/assignment";

const societySchema = z.object({ name: z.string().min(2), code: z.string().min(2).max(10), address: z.string().min(3), city: z.string().optional(), state: z.string().optional() });
const societyPatchSchema = z.object({ name: z.string().min(2).optional(), address: z.string().optional(), city: z.string().optional(), status: z.enum(["active", "coming_soon", "inactive"]).optional() });
// The same details an admin has to provide, minus the area: a supervisor creates
// operators in their own, which is taken from the session rather than the body.
const operatorSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(10).max(10),
  email: z.string().email(),
  phoneVerificationId: z.string().min(1),
  emailVerificationId: z.string().min(1),
  societyIds: z.array(z.string()).optional(),
});
const operatorPatchSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "on_leave", "blocked"]).optional(),
  societyIds: z.array(z.string()).optional(),
});
// The window decides the times, so startTime and endTime are accepted for
// compatibility and ignored. See SLOT_WINDOWS.
const slotSchema = z.object({
  societyId: z.string(), date: z.string(),
  window: z.enum(["Morning", "Afternoon", "Evening"]),
  startTime: z.string().optional(), endTime: z.string().optional(),
  capacityTotal: z.number().int().positive(),
  // Held for residents on a plan. Left out, a slot is open to everybody.
  subscribersOnly: z.boolean().optional(),
});
// Times are not editable: they follow from the window. See SLOT_WINDOWS.
const slotPatchSchema = z.object({ window: z.enum(["Morning", "Afternoon", "Evening"]).optional(), capacityTotal: z.number().int().positive().optional(), isActive: z.boolean().optional(), subscribersOnly: z.boolean().optional() });
const issueStatusSchema = z.object({ status: z.enum(["in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved", "closed"]), resolution: z.string().optional() });
const issueReplySchema = z.object({ body: z.string().min(1) });
const issuePrioritySchema = z.object({ priority: z.enum(["low", "normal", "high", "emergency"]) });
const availabilitySchema = z.object({ status: z.enum(["active", "on_leave", "blocked"]), reassignToUserId: z.string().nullable().optional(), reason: z.string().optional() });
const verificationSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
});
const profileSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional() });
const blockSchema = z.object({ name: z.string().min(1).max(60), flatCount: z.number().int().nonnegative().optional() });
const blockPatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  flatCount: z.number().int().nonnegative().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
const blockOperatorsSchema = z.object({ operatorUserIds: z.array(z.string().min(1)).max(20) });

// The supervisor portal. Every route here is bound to the supervisor's own area:
// the scope comes from the session, never from a query parameter, so asking for
// another area's society or order id fails the same way a missing one does.
export function registerSupervisorRoutes(app: FastifyInstance, container: Container): void {
  const supervisor = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "supervisor");

  // Whether this supervisor may touch this issue at all. The area is always checked;
  // the society only when the issue has one. Before this an issue with no society —
  // an operator's own, say — skipped the check entirely, so knowing its id was enough
  // to read or answer an issue belonging to another area.
  async function requireReachableIssue(
    session: { userId: string; areaId: string | null },
    issue: SupportTicket,
  ): Promise<void> {
    const societyIds = await container.access.visibleSocietyIds(session as never);
    const allowed = IssueService.canSee(issue, {
      userId: session.userId, role: "supervisor", areaId: session.areaId, societyIds,
    });
    if (!allowed) throw new ForbiddenScopeError("That issue is outside your area.");
  }

  // ------------------------------------------------------------- dashboard

  app.get("/v1/supervisor/dashboard", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return reply.send(await container.dashboards.supervisor(session));
  });

  // ---------------------------------------------------------- my society

  // A supervisor runs one society. This says which, and lays out its towers, how
  // many flats are in each, who covers them and how much work each is carrying.
  //
  // A supervisor cannot change which society is theirs — that is an admin's
  // decision, made from Admin → Societies — but everything inside it is theirs to
  // arrange, which is what this endpoint and the two below it are for.
  app.get("/v1/supervisor/society", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const mine = await container.access.visibleSocieties(session);
    // A supervisor waiting to be given a society is told so plainly rather than
    // shown an empty screen with no explanation.
    if (mine.length === 0) {
      return reply.send({ society: null, blocks: [], supervisor: null, operatorOptions: [], unassignedResidentCount: 0 });
    }
    const allocation = await container.assignments.allocation(mine[0].id);
    if (!allocation) return reply.code(404).send({ error: "not_found" });
    // Only operators who already work this supervisor's own area may be put on its
    // blocks; a supervisor cannot reach into another area's staff.
    const operators = await container.store.users.find((u) =>
      u.roles.includes("operator") && u.status !== "blocked" && u.status !== "deleted"
      && (u.verificationStatus ?? "approved") === "approved"
      && (u.areaId === session.areaId || u.societyIds.includes(mine[0].id)));
    return reply.send({
      ...allocation,
      // Said explicitly so the screen can render the society as fixed rather than
      // as something with a dropdown behind it.
      canChangeSociety: false,
      operatorOptions: operators.map((u) => ({ id: u.id, fullName: u.fullName, phone: u.phone, status: u.status })),
    });
  });

  app.post<{ Params: { id: string } }>("/v1/supervisor/societies/:id/blocks", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      await container.access.requireSociety(session, req.params.id);
      const parsed = blockSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      try {
        const block = await container.assignments.createBlock({ societyId: req.params.id, ...parsed.data, session });
        return reply.code(201).send({ block });
      } catch (error) {
        if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_refused", message: error.message });
        throw error;
      }
    });
  });

  app.patch<{ Params: { blockId: string } }>("/v1/supervisor/blocks/:blockId", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const block = await container.store.blocks.get(req.params.blockId);
      if (!block) return reply.code(404).send({ error: "not_found" });
      await container.access.requireSociety(session, block.societyId);
      const parsed = blockPatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      try {
        return reply.send({ block: await container.assignments.updateBlock(req.params.blockId, parsed.data, session) });
      } catch (error) {
        if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_refused", message: error.message });
        throw error;
      }
    });
  });

  app.put<{ Params: { blockId: string } }>("/v1/supervisor/blocks/:blockId/operators", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const block = await container.store.blocks.get(req.params.blockId);
      if (!block) return reply.code(404).send({ error: "not_found" });
      // The society boundary is checked from the session, so a block id from
      // somebody else's society fails exactly as a missing one does.
      await container.access.requireSociety(session, block.societyId);
      const parsed = blockOperatorsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      try {
        const updated = await container.assignments.setBlockOperators({
          blockId: req.params.blockId, operatorUserIds: parsed.data.operatorUserIds, session,
        });
        return reply.send({ block: updated });
      } catch (error) {
        if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_refused", message: error.message });
        throw error;
      }
    });
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
      // A supervisor runs one society. If they are not yet running one — the case a
      // supervisor registering the first society in a new area is actually in — the
      // society they just created becomes theirs. If they already run one it is left
      // waiting for an admin to assign somebody, and they are told that, rather than
      // it silently disappearing from a list they expected it to be in.
      // Asked of the assignment itself rather than of what they can see: a
      // supervisor holding no society still sees their whole area, which is the
      // fallback that keeps them working, not evidence that they run any of it.
      const alreadyRunning = (session.societyIds ?? []).some((id) => id !== society.id);
      if (!alreadyRunning) {
        const mine = await container.assignments.assignSupervisor({
          societyId: society.id, supervisorUserId: session.userId, session,
        });
        return reply.code(201).send({ society: await container.societies.summary(mine) });
      }
      return reply.code(201).send({
        society: await container.societies.summary(society),
        note: "You already run a society, so this one is waiting for an admin to assign a supervisor to it.",
      });
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
      return reply.send({ slotWindows: SLOT_WINDOWS, slots: await container.scheduling.listSlots({
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
        if (error instanceof UnknownSlotWindowError) return reply.code(400).send({ error: "unknown_slot_window", message: error.message });
        if (error instanceof SlotTooSoonError) return reply.code(422).send({ error: "slot_too_soon", message: error.message });
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
      // The area is the supervisor's own, so the state is a fact about it rather
      // than something the caller states; the check still runs so the same rule
      // applies here as on the admin route.
      const area = session.areaId ? await container.areas.get(session.areaId) : null;
      const refused = await refuseUnprovenStaff(
        container, { ...parsed.data, region: area?.region ?? "" }, area,
      );
      if (refused) return reply.code(refused.code).send(refused.body);
      try {
        const user = await container.users.createStaff({
          role: "operator",
          firstName: parsed.data.firstName, lastName: parsed.data.lastName,
          phone: parsed.data.phone, email: parsed.data.email,
          phoneVerifiedAt: new Date().toISOString(),
          emailVerifiedAt: new Date().toISOString(),
          areaId: session.areaId, societyIds: parsed.data.societyIds,
        });
        container.verifications.consume(parsed.data.phoneVerificationId);
        container.verifications.consume(parsed.data.emailVerificationId);
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

  // QC monitoring. Every quality check in this supervisor's society, narrowable by
  // order, status, society, operator and day, and paged — a busy society produces
  // more checks in a week than anybody wants to scroll through to find one.
  app.get<{
    Querystring: {
      q?: string; status?: string; societyId?: string; operatorUserId?: string;
      date?: string; limit?: string; offset?: string;
    };
  }>("/v1/supervisor/qc", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const orders = await container.access.visibleOrders(session);
    const relevant = orders.filter((o) => o.qcAttempts > 0 || o.state === "qc" || o.state === "qc_hold");
    const summaries = await container.orders.summarise(relevant);
    // When the check actually happened, taken from the order's own history rather
    // than from when the order was booked. A screen showing "checked on" against a
    // booking date is showing the wrong date with a confident label.
    const checkedAt = new Map(relevant.map((o) => {
      const entry = [...(o.timeline ?? [])].reverse()
        .find((t) => t.state === "qc" || t.state === "qc_hold");
      return [o.id, entry?.at ?? o.createdAt];
    }));
    // How many times this order has been through a check. The summary does not
    // carry it, and it is the difference between a first look and a second one.
    const attempts = new Map(relevant.map((o) => [o.id, o.qcAttempts ?? 0]));
    const rows = summaries.map((o) => ({
      ...o,
      // Pending is a check that has not happened yet; recheck is a second look at
      // something that has already been through once, which is a different thing to
      // be told about at a glance. Held for rework reads as failed, because that is
      // what the check said.
      qcStatus: o.state === "qc"
        ? ((attempts.get(o.id) ?? 0) > 0 ? "recheck" : "pending")
        : o.state === "qc_hold" ? "failed"
          : o.qcPassed === true ? "passed"
            : o.qcPassed === false ? "failed" : "pending",
      qcCheckedAt: checkedAt.get(o.id) ?? o.createdAt,
    }));

    const needle = (req.query.q ?? "").trim().toLowerCase();
    const filtered = rows.filter((o) => {
      if (req.query.status && o.qcStatus !== req.query.status) return false;
      if (req.query.societyId && o.societyId !== req.query.societyId) return false;
      if (req.query.operatorUserId && o.assignedOperatorUserId !== req.query.operatorUserId) return false;
      // The day the check happened, which for an order still in QC is the day it
      // arrived there.
      if (req.query.date && serviceDay(o.qcCheckedAt) !== req.query.date) return false;
      if (needle) {
        const haystack = [o.orderCode, o.residentName, o.societyName].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const page = paginate(filtered, req.query);
    // The options a screen needs to build its own filters, taken from what is
    // actually in the list rather than from the whole platform.
    const societies = new Map<string, string>();
    const operators = new Map<string, string>();
    for (const row of rows) {
      if (row.societyId) societies.set(row.societyId, row.societyName ?? row.societyId);
      if (row.assignedOperatorUserId) operators.set(row.assignedOperatorUserId, row.operatorName ?? row.assignedOperatorUserId);
    }
    return reply.send({
      qc: page.items,
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      filters: {
        statuses: ["pending", "passed", "recheck", "failed"],
        societies: Array.from(societies, ([id, name]) => ({ id, name })),
        operators: Array.from(operators, ([id, name]) => ({ id, name })),
      },
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
        // The area, not just the societies. An operator's issue that is not about a
        // particular order has no society, and their supervisor must still see it.
        viewer: req.query.societyId
          ? undefined
          : { userId: session.userId, role: "supervisor", areaId: session.areaId, societyIds },
        societyIds, status: req.query.status as never, type: req.query.type,
        priority: req.query.priority as never,
        emergencyOnly: req.query.emergency === "true",
        openOnly: req.query.open === "true",
      });
      return reply.send({
        issues: await container.issues.details(issues, { userId: session.userId, roles: session.roles, residentId: session.residentId }),
        issueTypes: ISSUE_TYPES, priorities: ISSUE_PRIORITIES,
      });
    });
  });

  app.get<{ Params: { id: string } }>("/v1/supervisor/issues/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      await requireReachableIssue(session, issue);
      return reply.send({ issue: await container.issues.detail(issue, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
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
      await requireReachableIssue(session, issue);
      let updated;
      try {
        updated = await container.issues.reply(
          req.params.id, session.userId, "supervisor", parsed.data.body,
          { roles: session.roles, residentId: session.residentId },
        );
      } catch (error) {
        // Read-only rather than forbidden: a supervisor who escalated to the admin can
        // still see the conversation but cannot add to it.
        if (error instanceof ConversationClosedError) {
          return reply.code(409).send({ error: "conversation_read_only", message: error.message });
        }
        throw error;
      }
      if (!updated) return reply.code(404).send({ error: "not_found" });
      if (updated.residentId) {
        await container.notifications.notifyResident(updated.residentId, {
          type: "issue.replied", orderId: updated.orderId,
          title: "Support replied to your ticket", body: parsed.data.body,
        });
      }
      return reply.send({ issue: await container.issues.detail(updated, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/issues/:id/priority", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = issuePrioritySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      await requireReachableIssue(session, issue);
      const result = await container.issues.setPriority(req.params.id, parsed.data.priority);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "issue.priority_changed", resource: "issue", resourceId: req.params.id, previousValue: { priority: result.previous.priority }, newValue: { priority: parsed.data.priority } });
      return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
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
      await requireReachableIssue(session, issue);
      const result = await container.issues.assign(req.params.id, userId);
      if (!result) return reply.code(409).send({ error: "ticket_closed" });
      await container.audit.record({ session, action: "issue.assigned", resource: "issue", resourceId: req.params.id, previousValue: { assignedToUserId: result.previous.assignedToUserId }, newValue: { assignedToUserId: userId } });
      return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/issues/:id/status", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = issueStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return withScope(reply, async () => {
      await requireReachableIssue(session, issue);
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
        return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
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
      await requireReachableIssue(session, issue);
      try {
        const result = await container.issues.escalateOneLevel(req.params.id, note, session.userId, "supervisor");
        if (!result) return reply.code(409).send({ error: "ticket_closed" });
        await container.audit.record({ session, action: "issue.escalated", resource: "issue", resourceId: req.params.id, previousValue: { responsibleRole: result.previous.responsibleRole }, newValue: { responsibleRole: result.target, note } });
        return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
      } catch (error) {
        // There is nothing above the admin. Saying so is better than a 500.
        if (error instanceof IssueEscalationError) return reply.code(409).send({ error: "cannot_escalate", message: error.message });
        throw error;
      }
    });
  });

  // --------------------------------------------------- verifying my operators

  // A supervisor vouches for the operators in their own area. They cannot do it
  // until they have been vouched for themselves, which is what stops the chain
  // being started from the middle.
  app.get<{ Querystring: { status?: string } }>("/v1/supervisor/operators/pending", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const wanted = req.query.status ?? "pending";
    const staff = await container.store.users.find((u) =>
      u.roles.includes("operator") &&
      u.areaId === session.areaId &&
      (u.verificationStatus ?? "approved") === wanted);
    return reply.send({ operators: await container.users.decorateAll(staff), status: wanted });
  });

  app.post<{ Params: { id: string }; Body: { status?: string; note?: string } }>("/v1/supervisor/operators/:id/verification", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = verificationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const actor = await container.store.users.get(session.userId);
    if (!actor) return reply.code(401).send({ error: "unauthorized" });
    try {
      const result = await container.users.setVerification(req.params.id, parsed.data.status, actor, parsed.data.note);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({
        session, action: `staff.${parsed.data.status}`, resource: "user", resourceId: req.params.id,
        previousValue: { verificationStatus: result.previous.verificationStatus ?? null },
        newValue: { verificationStatus: parsed.data.status, note: parsed.data.note ?? null },
      });
      return reply.send({ operator: await container.users.decorate(result.current) });
    } catch (error) {
      if (error instanceof NotYourStaffError) return reply.code(403).send({ error: "not_your_staff", message: error.message });
      throw error;
    }
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
