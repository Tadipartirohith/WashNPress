import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { UserConflictError } from "../../services/user-service";
import { staffDetailProblems } from "../../domain/staff-identity";
import { DuplicateSlotError, SlotInPastError, SlotInUseError, SlotTooSoonError, UnknownSlotWindowError, SLOT_WINDOWS, serviceDay, withinServiceDays } from "../../services/scheduling-service";
import { paginate } from "../paging";
import type { SupportTicket } from "../../domain/models";
import { ForbiddenScopeError } from "../../domain/access";
import { ISSUE_TYPES, ISSUE_PRIORITIES, IssueEscalationError, IssueService, IssueTransitionError, ConversationClosedError } from "../../services/issue-service";
import { StaffingError } from "../../services/staffing-service";
import { STATE_LABELS } from "../../domain/order-state-machine";
import { NotYourStaffError } from "../../services/user-service";
import { AssignmentError } from "../../domain/assignment";
import { ACTIVE_ORDER_STATES } from "../../services/assignment-service";

// The same details an admin has to provide, minus the society: a supervisor runs
// exactly one, and it is taken from the session rather than from the body. What
// they do choose is which of its blocks the operator covers.
//
// No verification codes: creating an account and authenticating as it are two
// different things, and the OTP belongs to the second. See domain/staff-identity.
const operatorSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(10).max(10),
  email: z.string().email(),
  blockIds: z.array(z.string().min(1)).default([]),
});
const operatorPatchSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "on_leave", "blocked"]).optional(),
  blockIds: z.array(z.string().min(1)).optional(),
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
// A tower is described by its name, its floors and its flats. Floors and flats are
// positive numbers: a tower of none of either is a typo, not a smaller building.
const blockSchema = z.object({
  name: z.string().min(1).max(60),
  floorCount: z.number().int().positive().optional(),
  flatCount: z.number().int().positive().optional(),
});
const blockPatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  floorCount: z.number().int().positive().optional(),
  flatCount: z.number().int().positive().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
const blockOperatorsSchema = z.object({ operatorUserIds: z.array(z.string().min(1)).max(20) });

// The supervisor portal. Every route here is bound to the one society the
// supervisor runs:
// the scope comes from the session, never from a query parameter, so asking for
// another society's id, or an order inside it, fails the same way a missing one does.
export function registerSupervisorRoutes(app: FastifyInstance, container: Container): void {
  const supervisor = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "supervisor");

  // Whether this supervisor may touch this issue at all. An issue belongs to the
  // society it was raised in, and a supervisor runs one society; an issue with no
  // society at all belongs to nobody in particular and stays with the admin.
  async function requireReachableIssue(
    session: { userId: string },
    issue: SupportTicket,
  ): Promise<void> {
    const societyIds = await container.access.visibleSocietyIds(session as never);
    const allowed = IssueService.canSee(issue, {
      userId: session.userId, role: "supervisor", societyIds,
    });
    if (!allowed) throw new ForbiddenScopeError("That issue is outside your society.");
  }

  // The one society this supervisor runs. Everything they can do is inside it, so
  // asking once and refusing plainly beats each route re-deriving it and failing in
  // its own way.
  async function mySociety(session: { societyIds?: string[] }): Promise<string | null> {
    return session.societyIds?.[0] ?? null;
  }

  // Whether a staff account works the society this supervisor runs. A supervisor
  // between assignments runs none, so nobody is theirs — which is what an empty
  // assignment ought to mean.
  async function inMySociety(
    session: { societyIds?: string[] },
    user: { societyIds?: string[] },
  ): Promise<boolean> {
    const societyId = await mySociety(session);
    return Boolean(societyId) && (user.societyIds ?? []).includes(societyId!);
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
    // Only operators who already work this supervisor's own society may be put on
    // its blocks; a supervisor cannot reach into another society's staff.
    const operators = await container.store.users.find((u) =>
      u.roles.includes("operator") && u.status !== "blocked" && u.status !== "deleted"
      && (u.verificationStatus ?? "approved") === "approved"
      && (u.societyIds ?? []).includes(mine[0].id));
    return reply.send({
      ...allocation,
      // The society with its live counts, not the bare stored record.
      //
      // `allocation` returns the row as it sits in the table, which has a name, an
      // address in parts and a status — and none of the counts the card asks for.
      // So My Society rendered an address of "—", "None yet" for towers that
      // existed, and zero residents, staff, orders and slots for a society running
      // normally, while the detail page one tap away — which has always called
      // `summary` — showed the real figures. Every count here is filtered by this
      // society's own id, so a supervisor sees their society and no other.
      society: await container.societies.summary(allocation.society),
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

  // One tower, and everybody who lives in it.
  //
  // A block card used to be a set of management actions and nothing else, so a
  // supervisor asking the ordinary question — who lives in Tower B — had to go to
  // Residents and filter, if they could. Seeing a block and changing it are two
  // different things, and only one of them was on offer.
  app.get<{ Params: { blockId: string } }>("/v1/supervisor/blocks/:blockId", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const block = await container.store.blocks.get(req.params.blockId);
      if (!block) return reply.code(404).send({ error: "not_found" });
      // A block id from somebody else's society fails exactly as a missing one does.
      const society = await container.access.requireSociety(session, block.societyId);

      const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
      const plans = new Map((await container.store.plans.all()).map((p) => [p.id, p]));
      const subscriptions = await container.store.subscriptions.all();
      // Residents of this block and no other. Selecting Tower A must never list
      // somebody from Tower B, which is the whole point of the screen.
      const residents = await container.store.residents.find((r) => r.blockId === block.id);
      const orders = await container.store.orders.find((o) => o.blockId === block.id);
      const live = orders.filter((o) => ACTIVE_ORDER_STATES.includes(o.state));

      return reply.send({
        block: {
          id: block.id, name: block.name, status: block.status,
          societyId: society.id, societyName: society.name,
          flatCount: block.flatCount, floorCount: block.floorCount ?? 0,
          residentCount: residents.length,
          activeOrderCount: live.length,
          operators: (block.operatorUserIds ?? [])
            .map((id) => users.get(id))
            .filter((u): u is NonNullable<typeof u> => Boolean(u))
            .map((u) => ({ id: u.id, fullName: u.fullName, phone: u.phone, status: u.status })),
        },
        residents: residents.map((r) => {
          const user = users.get(r.userId);
          const sub = subscriptions.find((sn) => sn.residentId === r.id && sn.status === "active") ?? null;
          const mine = live.filter((o) => o.residentId === r.id);
          return {
            id: r.id, fullName: user?.fullName ?? null, phone: user?.phone ?? null,
            unitNumber: r.unitNumber,
            planName: sub ? plans.get(sub.planId)?.name ?? plans.get(sub.planId)?.tier ?? null : null,
            activeOrderCount: mine.length,
            // The state of the one they are waiting on. Two open orders is rare and
            // the newest is the one somebody is asking about.
            orderState: mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.state ?? null,
          };
        }).sort((a, b) => (a.unitNumber ?? "").localeCompare(b.unitNumber ?? "", undefined, { numeric: true })),
      });
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

  // The one society this supervisor runs. Kept as a list because the shape is what
  // every client already reads, and because a supervisor between assignments has
  // none rather than having one that is wrong.
  //
  // Creating and editing a society is the admin's: a society is what an admin gives
  // a supervisor, so a supervisor who could create one could give themselves work
  // nobody assigned them.
  app.get("/v1/supervisor/societies", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societies = await container.access.visibleSocieties(session);
    return reply.send({ societies: await container.societies.summaries(societies) });
  });

  app.get<{ Params: { id: string } }>("/v1/supervisor/societies/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const society = await container.access.requireSociety(session, req.params.id);
      const residents = await container.store.residents.find((r) => r.societyId === society.id);
      const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
      const subscriptions = await container.store.subscriptions.all();
      const orders = await container.store.orders.find((o) => o.societyId === society.id);
      const blockNames = new Map((await container.assignments.blocksOf(society.id)).map((b) => [b.id, b.name]));
      return reply.send({
        society: await container.societies.summary(society),
        residents: residents.map((r) => {
          const user = users.get(r.userId);
          const sub = subscriptions.find((s) => s.residentId === r.id && s.status === "active") ?? null;
          return {
            id: r.id, fullName: user?.fullName ?? null, phone: user?.phone ?? null,
            unitNumber: r.unitNumber,
            // What the block actually is, not only what the resident typed.
            blockId: r.blockId ?? null,
            towerBlock: (r.blockId ? blockNames.get(r.blockId) : null) ?? r.towerBlock,
            status: user?.status ?? null,
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

  // ---------------------------------------------------------------- services

  // The service bookings inside this supervisor's society.
  //
  // A booking used to enter the operator's queue and vanish: a supervisor could
  // not see who had booked a car wash, who had accepted it, or what stage it was
  // at, and had to ask the operator. Scoped to their own society by the same rule
  // as everything else here.
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/supervisor/services", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    const scope = new Set(societyIds);
    const rows = await container.serviceRequests.listForStaff(scope, {
      status: req.query.status, offeringId: req.query.offeringId,
      operatorUserId: req.query.operatorUserId,
      from: req.query.from, to: req.query.to,
    });
    const page = paginate(rows, req.query);
    return reply.send({
      requests: page.items,
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      offerings: await container.serviceRequests.offerings(),
      summary: await container.serviceRequests.summary(new Set(societyIds)),
      // Only the operators working this supervisor's societies: a filter offering
      // people they have never met is a longer list and a worse one.
      operators: (await container.store.users.find(
        (u) => u.roles.includes("operator") && u.societyIds.some((id) => scope.has(id)),
      )).map((u) => ({ id: u.id, name: u.fullName ?? u.phone })),
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
        if (error instanceof DuplicateSlotError) return reply.code(409).send({ error: "slot_exists", message: error.message });
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

  // An operator covers blocks of the society their supervisor runs. A block from
  // anywhere else is not a narrower permission but a wider one, so it is refused
  // here as well as in the form — a form that reloads its block list still sends
  // whatever ids it was given, and a caller that is not the form sends what it likes.
  async function refuseForeignBlocks(
    societyId: string,
    blockIds: string[],
  ): Promise<{ code: number; body: Record<string, unknown> } | null> {
    for (const id of blockIds) {
      const block = await container.store.blocks.get(id);
      if (!block) return { code: 404, body: { error: "block_not_found", message: "That block no longer exists." } };
      if (block.societyId !== societyId) {
        return {
          code: 403,
          body: { error: "forbidden_scope", message: `${block.name} is not a block of your society.` },
        };
      }
    }
    return null;
  }

  // Both sides of a block assignment, or the block's list of operators and the
  // operator's list of blocks disagree and the screen shows one of them.
  async function setBlockMembership(
    operatorUserId: string,
    blockIds: string[],
    session: Parameters<typeof container.audit.record>[0]["session"],
  ) {
    const wanted = new Set(blockIds);
    for (const block of await container.store.blocks.all()) {
      const listed = block.operatorUserIds.includes(operatorUserId);
      if (wanted.has(block.id) === listed) continue;
      await container.store.blocks.put({
        ...block,
        operatorUserIds: wanted.has(block.id)
          ? [...block.operatorUserIds, operatorUserId]
          : block.operatorUserIds.filter((id) => id !== operatorUserId),
      });
    }
    await container.audit.record({
      session, action: "operator.blocks_assigned", resource: "user", resourceId: operatorUserId,
      previousValue: null, newValue: { blockIds },
    });
  }

  // How many operators in this society are in each availability state.
  async function operatorCounts(c: typeof container, societyId: string | null) {
    if (!societyId) return { all: 0, active: 0, on_leave: 0, blocked: 0 };
    const all = await c.store.users.find(
      (u) => u.roles.includes("operator") && (u.societyIds ?? []).includes(societyId));
    return {
      all: all.length,
      active: all.filter((u) => u.status === "active").length,
      on_leave: all.filter((u) => u.status === "on_leave").length,
      blocked: all.filter((u) => u.status === "blocked").length,
    };
  }

  // Filtering by availability and by name or phone, because a supervisor looking for
  // who is on leave should not have to read the whole list to find out.
  app.get<{ Querystring: { status?: string; q?: string; blockId?: string } }>("/v1/supervisor/operators", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyId = await mySociety(session);
    const { status, q, blockId } = req.query;
    const needle = q?.trim().toLowerCase() ?? "";
    const operators = societyId ? await container.store.users.find((u) => {
      if (!u.roles.includes("operator") || !(u.societyIds ?? []).includes(societyId)) return false;
      if (status && status !== "all" && u.status !== status) return false;
      if (blockId && !(u.blockIds ?? []).includes(blockId)) return false;
      if (!needle) return true;
      return (u.fullName ?? "").toLowerCase().includes(needle) || (u.phone ?? "").includes(needle);
    }) : [];
    return reply.send({
      operators: await container.users.decorateAll(operators),
      // The blocks the filter and the creation form both offer, so the screen does
      // not fetch the society's allocation separately to render a dropdown.
      blocks: societyId
        ? (await container.assignments.blocksOf(societyId))
          .map((b) => ({
            id: b.id, name: b.name, flatCount: b.flatCount, floorCount: b.floorCount ?? 0, status: b.status,
          }))
        : [],
      // The counts the filter chips render, taken before the filter is applied so
      // they do not change as the supervisor narrows the list.
      counts: await operatorCounts(container, societyId),
    });
  });

  app.post("/v1/supervisor/operators", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyId = await mySociety(session);
    // Said plainly, because "409" on its own does not tell a supervisor what to do.
    if (!societyId) {
      return reply.code(409).send({
        error: "no_society_assigned",
        message: "You cannot create an operator because no society is assigned to your account.",
      });
    }
    const parsed = operatorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const problems = staffDetailProblems(parsed.data, { emailRequired: true });
    if (problems.length) return reply.code(422).send({ error: "invalid_details", problems });
    const refused = await refuseForeignBlocks(societyId, parsed.data.blockIds);
    if (refused) return reply.code(refused.code).send(refused.body);
    try {
      const user = await container.users.createStaff({
        role: "operator",
        firstName: parsed.data.firstName, lastName: parsed.data.lastName,
        phone: parsed.data.phone, email: parsed.data.email,
        // The society is the supervisor's own, taken from the session rather than
        // from the body, so an operator cannot be created into somebody else's.
        societyIds: [societyId], blockIds: parsed.data.blockIds,
      });
      await setBlockMembership(user.id, parsed.data.blockIds, session);
      await container.audit.record({ session, action: "operator.created", resource: "user", resourceId: user.id, newValue: user });
      return reply.code(201).send({ operator: await container.users.decorate(user) });
    } catch (error) {
      if (error instanceof UserConflictError) return reply.code(409).send({ error: "user_conflict", message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/supervisor/operators/:id", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = operatorPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const societyId = await mySociety(session);
    const target = await container.store.users.get(req.params.id);
    if (!target || !target.roles.includes("operator")) return reply.code(404).send({ error: "not_found" });
    // A supervisor may only touch operators inside their own society.
    if (!societyId || !(target.societyIds ?? []).includes(societyId)) {
      return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another society" });
    }
    if (parsed.data.blockIds) {
      const refused = await refuseForeignBlocks(societyId, parsed.data.blockIds);
      if (refused) return reply.code(refused.code).send(refused.body);
    }
    return withScope(reply, async () => {
      const { status, ...rest } = parsed.data;
      let result;
      try {
        result = await container.users.update(req.params.id, rest);
      } catch (error) {
        if (error instanceof UserConflictError) return reply.code(409).send({ error: "user_conflict", message: error.message });
        throw error;
      }
      if (!result) return reply.code(404).send({ error: "not_found" });
      if (parsed.data.blockIds) await setBlockMembership(req.params.id, parsed.data.blockIds, session);
      await container.audit.record({
        session, action: parsed.data.blockIds ? "operator.reassigned" : "operator.updated",
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
    if (!(await inMySociety(session, target))) {
      return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another society" });
    }
    return reply.send(await container.staffing.workloadHandoverPreview(req.params.id));
  });

  // Taking an operator off duty never deletes them and never strands their work.
  app.post<{ Params: { id: string } }>("/v1/supervisor/operators/:id/availability", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const target = await container.store.users.get(req.params.id);
    if (!target || !target.roles.includes("operator")) return reply.code(404).send({ error: "not_found" });
    if (!(await inMySociety(session, target))) {
      return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another society" });
    }
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
    const societyId = await mySociety(session);
    if (!societyId) return reply.send({ workload: [] });
    return reply.send({ workload: await container.users.operatorWorkload(societyId) });
  });

  // ----------------------------------------------------------------- orders

  // Status, block, operator, resident and a date range: the five things a
  // supervisor actually looks an order up by. Every option offered comes from
  // inside their own society, so the filter row cannot name somebody else's block.
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/supervisor/orders", async (req, reply) => {
    const session = await supervisor(req, reply); if (!session) return;
    const societyId = await mySociety(session);
    let orders = await container.access.visibleOrders(session);
    const q = req.query;
    if (q.societyId) orders = orders.filter((o) => o.societyId === q.societyId);
    if (q.blockId && q.blockId !== "all") orders = orders.filter((o) => o.blockId === q.blockId);
    if (q.state && q.state !== "all") orders = orders.filter((o) => o.state === q.state);
    if (q.operatorUserId && q.operatorUserId !== "all") orders = orders.filter((o) => o.assignedOperatorUserId === q.operatorUserId);
    if (q.residentId && q.residentId !== "all") orders = orders.filter((o) => o.residentId === q.residentId);
    // The operation's day rather than an exact timestamp, so a "to" date includes
    // the whole of that day instead of stopping at midnight going into it.
    if (q.from || q.to) orders = orders.filter((o) => withinServiceDays(o.createdAt, q.from, q.to));
    if (q.orderCode) orders = orders.filter((o) => o.orderCode.toLowerCase().includes(q.orderCode!.toLowerCase()));
    if (q.resident) {
      const term = q.resident.toLowerCase();
      const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
      const matching = new Set((await container.store.residents.all())
        .filter((r) => {
          const user = users.get(r.userId);
          return (user?.fullName ?? "").toLowerCase().includes(term)
            || (user?.phone ?? "").includes(term)
            || r.unitNumber.toLowerCase().includes(term);
        })
        .map((r) => r.id));
      orders = orders.filter((o) => matching.has(o.residentId));
    }
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
    const residentRows = societyId
      ? (await container.store.residents.find((r) => r.societyId === societyId))
        .map((r) => ({
          id: r.id,
          fullName: users.get(r.userId)?.fullName ?? null,
          unitNumber: r.unitNumber,
        }))
        .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""))
      : [];
    return reply.send({
      orders: await container.orders.summarise(orders),
      stateLabels: STATE_LABELS,
      // Everything the filter row offers, sent with the rows so the screen renders
      // its own controls without three more calls.
      filters: {
        blocks: societyId
          ? (await container.assignments.blocksOf(societyId)).map((b) => ({ id: b.id, name: b.name }))
          : [],
        operators: societyId
          ? (await container.store.users.find(
              (u) => u.roles.includes("operator") && (u.societyIds ?? []).includes(societyId)))
            .map((u) => ({ id: u.id, fullName: u.fullName }))
          : [],
        residents: residentRows,
      },
    });
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
      if (!operator || !(await inMySociety(session, operator))) {
        return reply.code(403).send({ error: "forbidden_scope", message: "Operator belongs to another society" });
      }
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
          : { userId: session.userId, role: "supervisor", societyIds },
        societyIds, status: req.query.status as never, type: req.query.type,
        priority: req.query.priority as never,
        emergencyOnly: req.query.emergency === "true",
        openOnly: req.query.open === "true",
      });
      // Who a ticket can be handed to. Held to this supervisor's own societies,
      // which is the same boundary the assign route enforces — offering a person
      // the server will then refuse is worse than not offering them.
      const assignable = (await container.store.users.find(
        (u) => u.status === "active"
          && u.roles.some((r) => r !== "resident")
          && u.societyIds.some((id) => societyIds.has(id)),
      )).map((u) => ({
        id: u.id,
        name: u.fullName ?? u.phone,
        role: u.roles.find((r) => r !== "resident") ?? null,
      }));
      return reply.send({
        issues: await container.issues.details(issues, { userId: session.userId, roles: session.roles, residentId: session.residentId }),
        issueTypes: ISSUE_TYPES, priorities: ISSUE_PRIORITIES,
        assignees: assignable,
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
    if (!target || !(await inMySociety(session, target))) {
      return reply.code(403).send({ error: "forbidden_scope", message: "That user is outside your society" });
    }
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
      (u.societyIds ?? []).includes(session.societyIds?.[0] ?? "") &&
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
  // from another society returns nothing, exactly as if the order did not exist.
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
    const operators = (await container.store.users.find(
      (u) => u.roles.includes("operator") && (u.societyIds ?? []).includes(session.societyIds?.[0] ?? "")))
      .filter((u) => (u.fullName ?? "").toLowerCase().includes(term) || (u.employeeId ?? "").toLowerCase().includes(term));
    return reply.send({
      orders: await container.orders.summarise(matchingOrders),
      residents: matchingResidents.map((r) => ({ id: r.id, fullName: users.get(r.userId)?.fullName ?? null, phone: users.get(r.userId)?.phone ?? null, unitNumber: r.unitNumber, societyId: r.societyId })),
      societies: societies.filter((s) => s.name.toLowerCase().includes(term)),
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
