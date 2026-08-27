import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { QuantityRequiredError, QuantityConfirmationRequiredError, UnknownOrderLineError, BatchNotFoundError } from "../../services/order-service";
import { IssueEscalationError, IssueService, IssueTransitionError, ISSUE_STATUSES, ISSUE_TYPES, ConversationClosedError } from "../../services/issue-service";
import { STATE_LABELS } from "../../domain/order-state-machine";
import { BatchStepOutOfOrderError, BatchNotReadyForQcError } from "../../domain/batches";
import { PickupNotDueError } from "../../services/scheduling-service";
import {
  QC_FAILURE_REASONS, QC_REASON_LABELS, QcFailureIncompleteError,
  qcFailureProblems, evidenceRequired, isSerious, type QcFailureReason,
} from "../../domain/qc";
import {
  DISCREPANCY_REASONS, DISCREPANCY_REASON_LABELS, DiscrepancyIncompleteError,
} from "../../domain/discrepancy";

const itemsSchema = z.object({ items: z.array(z.object({ category: z.string(), quantity: z.number().int().nonnegative() })) });
const advanceSchema = z.object({ to: z.enum(["in_wash", "ironing", "qc"]) });
const qcSchema = z.object({ pass: z.boolean(), reason: z.string().optional() });
const reprocessSchema = z.object({ to: z.enum(["in_wash", "ironing"]), note: z.string().optional() });
const deliverSchema = z.object({ deliveryCount: z.number().int().nonnegative(), discrepancyReason: z.string().optional() });
const failSchema = z.object({ reason: z.string().min(1) });
const issueReplySchema = z.object({ body: z.string().min(1).max(2000) });
const issueStatusSchema = z.object({
  status: z.enum(["open", "in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved", "closed"]),
  resolution: z.string().max(2000).optional(),
});
// What the operator confirms for each Garment + Service combination.
const acceptedLinesSchema = z.array(z.object({
  lineId: z.string().min(1),
  acceptedQuantity: z.number().int().nonnegative(),
  // What the scale said, for a service billed by weight rather than by count.
  acceptedMeasuredQuantity: z.number().nonnegative().max(1000).optional(),
}));
const pickedUpSchema = z.object({
  items: z.array(z.object({ category: z.string().min(1), quantity: z.number().int().nonnegative() })).optional(),
  lines: acceptedLinesSchema.optional(),
  // Collecting before the booked window is possible, but only when asked for
  // deliberately and explained. The scheduled time is preserved either way.
  early: z.boolean().optional(),
  earlyReason: z.string().min(1).optional(),
  // Why the count differs from what the resident declared. Required whenever it
  // does: an operator must not be able to confirm a mismatched pickup silently.
  discrepancyReason: z.enum([
    "not_handed_over", "resident_unavailable", "item_missing",
    "incorrect_quantity_declared", "extra_items_handed_over", "other",
  ]).optional(),
  discrepancyRemarks: z.string().optional(),
});
const batchStepSchema = z.object({ step: z.enum(["wash", "dry_clean", "premium", "iron"]) });
// A failed check has to say why. The reason decides where the work goes back to,
// whether a supervisor is involved and whether the resident hears about it — none of
// which can be worked out from "failed".
const batchQcSchema = z.object({
  passed: z.boolean(),
  reason: z.enum([
    "stain_not_removed", "improper_washing", "poor_ironing", "folding_issue",
    "garment_damage", "missing_garment", "wrong_garment", "packaging_issue", "other",
  ]).optional(),
  remarks: z.string().optional(),
  // Required for the failures that are a claim about the garment rather than about
  // the quality of the work. Which those are is decided by the domain.
  evidenceUrl: z.string().optional(),
});

const issueSchema = z.object({ orderId: z.string().optional(), type: z.string().min(1), description: z.string().min(1), priority: z.enum(["low", "normal", "high"]).optional() });
const profileSchema = z.object({ fullName: z.string().min(2).optional(), email: z.string().email().optional() });

// The operations portal. An operator works only the orders inside the societies
// they are assigned to; the state machine, the quantity split and the subscription
// maths all stay in the backend, so the operator only ever supplies observations.
export function registerOperationsRoutes(app: FastifyInstance, container: Container): void {
  const operator = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "operator");

  // ------------------------------------------------------------- dashboard

  // The blocks this operator covers, and how much work is in each. An operator used
  // to be given a whole society — three towers and a hundred and twenty flats — and
  // had no way to see which part of it was theirs, because there was no such thing
  // as a part of it.
  app.get("/v1/operations/blocks", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return reply.send({ blocks: await container.assignments.blocksFor(session.userId) });
  });

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
    // is picked up it moves to Active Orders and stays reachable there. With no date
    // asked for, everything still pending up to today is returned, so a collection
    // missed yesterday cannot vanish behind a date filter; the oldest sorts first.
    const pending = queue.filter((p) => p.status === "scheduled" || p.status === "rescheduled");
    pending.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
    return reply.send({
      pickups: pending,
      overdueCount: pending.filter((p) => p.overdue).length,
      // What may actually be worked right now, as against what is merely booked.
      dueNowCount: pending.filter((p) => p.dueNow).length,
      upcomingCount: pending.filter((p) => !p.dueNow).length,
      date: req.query.date ?? null,
    });
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

  // What the operator is asked to confirm before a pickup can be completed: each
  // Garment + Service combination, what was requested, and what actually turned up.
  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/reconcile", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = z.object({ lines: acceptedLinesSchema.optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      await container.access.requireOrder(session, req.params.id);
      return reply.send({ reconciliation: await container.orders.reconcile(req.params.id, parsed.data.lines ?? []) });
    });
  });

  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/picked-up", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = pickedUpSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.markPickedUp(
          req.params.id, parsed.data.items ?? [], { userId: session.userId, session }, parsed.data.lines ?? [],
          {
            early: parsed.data.early, earlyReason: parsed.data.earlyReason,
            // Required whenever the count differs from what the resident declared.
            discrepancy: {
              reason: parsed.data.discrepancyReason,
              remarks: parsed.data.discrepancyRemarks,
            },
          },
        );
        await container.audit.record({
          session, action: "order.picked_up", resource: "order", resourceId: order.id,
          previousValue: { state: existing.state, acceptedCount: existing.acceptedCount },
          newValue: { state: order.state, acceptedCount: order.acceptedCount, subscriptionCoveredCount: order.subscriptionCoveredCount, additionalCount: order.additionalCount, additionalChargePaise: order.additionalChargePaise },
        });
        return reply.send({ order: await container.orders.detail(order) });
      } catch (error) {
        if (error instanceof QuantityRequiredError) return reply.code(400).send({ error: "quantity_required", message: error.message });
        // The count differs from what the resident declared, and the operator has not
        // said why. Both numbers are real; a mismatch is a discrepancy to be recorded
        // rather than something to resolve silently in the operator's favour.
        if (error instanceof DiscrepancyIncompleteError) {
          return reply.code(400).send({ error: "discrepancy_incomplete", message: error.message, problems: error.problems });
        }
        // A pickup cannot be completed until every combination has been confirmed,
        // because an unconfirmed combination cannot be priced or processed.
        if (error instanceof QuantityConfirmationRequiredError) {
          return reply.code(400).send({ error: "quantity_confirmation_required", message: error.message, lineIds: error.lineIds });
        }
        if (error instanceof UnknownOrderLineError) {
          return reply.code(400).send({ error: "unknown_order_line", message: error.message });
        }
        // Refused rather than quietly allowed, and the answer says when it may be done.
        if (error instanceof PickupNotDueError) {
          return reply.code(409).send({ error: "pickup_not_due", message: error.message, availableFrom: error.availableFrom });
        }
        return reply.code(409).send({ error: "illegal_transition", message: (error as Error).message });
      }
    });
  });

  // ---------------------------------------------- processing, batch by batch

  // The batches this order is being worked as. Each is one Garment + Service
  // combination with its own sequence, its own progress and its own QC.
  app.get<{ Params: { id: string } }>("/v1/operations/orders/:id/batches", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return withScope(reply, async () => {
      await container.access.requireOrder(session, req.params.id);
      return reply.send({ batches: await container.orders.batches(req.params.id) });
    });
  });

  // Complete the step this batch is on. Steps inside a batch are sequential, so
  // ironing cannot be marked done on a batch that has not finished washing; the
  // other batches are unaffected and carry on at their own pace.
  app.post<{ Params: { id: string; batchId: string } }>("/v1/operations/orders/:id/batches/:batchId/advance", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = batchStepSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.advanceBatch(req.params.id, req.params.batchId, parsed.data.step, { userId: session.userId, session });
        await container.audit.record({
          session, action: "order.batch_advanced", resource: "order", resourceId: order.id,
          previousValue: { state: existing.state, batchId: req.params.batchId },
          newValue: { state: order.state, batchId: req.params.batchId, step: parsed.data.step },
        });
        return reply.send({ order: await container.orders.detail(order), batches: await container.orders.batches(order.id) });
      } catch (error) {
        if (error instanceof BatchNotFoundError) return reply.code(404).send({ error: "batch_not_found" });
        if (error instanceof BatchStepOutOfOrderError) return reply.code(409).send({ error: "step_out_of_order", message: error.message });
        if (error instanceof QcFailureIncompleteError) {
          return reply.code(400).send({ error: "qc_failure_incomplete", message: error.message, problems: error.problems });
        }
        if (error instanceof BatchNotReadyForQcError) return reply.code(409).send({ error: "not_ready_for_qc", message: error.message });
        throw error;
      }
    });
  });

  // Who a pickup can be given to: the operators who actually cover the societies this
  // person can see. Assigning to somebody who cannot reach the society is how a
  // pickup ends up with a name against it and nobody able to do it.
  app.get("/v1/operations/assignable-operators", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    const staff = await container.store.users.find(
      (u) => u.roles.includes("operator") && u.status === "active" && u.verificationStatus !== "rejected",
    );
    const reachable = staff.filter((u) => (u.societyIds ?? []).some((id) => societyIds.has(id)));
    reachable.sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
    return reply.send({
      operators: reachable.map((u) => ({
        userId: u.id, fullName: u.fullName, phone: u.phone,
        employeeId: u.employeeId,
        societyIds: u.societyIds ?? [], blockIds: u.blockIds ?? [],
      })),
    });
  });

  // Giving a pickup to an operator. Operations could only ever claim one for
  // themselves, so "assign this to Ravi" had nowhere to go and the pickup stayed
  // Unassigned however many times somebody tried.
  app.post<{ Params: { id: string } }>("/v1/operations/orders/:id/assign", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = z.object({
      operatorUserId: z.string().min(1).nullable(),
      reason: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);

      if (parsed.data.operatorUserId) {
        // The person being assigned has to be able to reach the society, or the
        // assignment is a name on a screen and nothing more.
        const target = await container.store.users.get(parsed.data.operatorUserId);
        if (!target || !target.roles.includes("operator")) {
          return reply.code(404).send({ error: "not_found", message: "No such operator." });
        }
        const covers = (target.societyIds ?? []).includes(existing.societyId);
        if (!covers) {
          return reply.code(409).send({
            error: "operator_out_of_scope",
            message: `${target.fullName ?? "That operator"} does not cover this society.`,
          });
        }
      }

      const result = await container.orders.assignOperator(
        req.params.id, parsed.data.operatorUserId,
        { userId: session.userId, session },
        parsed.data.reason?.trim() || undefined,
      );
      await container.audit.record({
        session, action: parsed.data.operatorUserId ? "order.assigned" : "order.unassigned",
        resource: "order", resourceId: req.params.id,
        previousValue: { assignedOperatorUserId: result.previousOperatorUserId },
        newValue: { assignedOperatorUserId: parsed.data.operatorUserId },
      });
      // The assigned operator is told, so the work reaches them rather than waiting
      // to be discovered in a list.
      if (parsed.data.operatorUserId && parsed.data.operatorUserId !== result.previousOperatorUserId) {
        await container.notifications.notifyUser(parsed.data.operatorUserId, {
          type: "order.assigned", orderId: result.order.id,
          title: "A pickup was assigned to you",
          body: `Order ${result.order.orderCode} is yours to collect.`,
        });
      }
      // The order as it now reads, so the field shows the new name immediately rather
      // than after a refresh.
      return reply.send({ order: await container.orders.detail(result.order) });
    });
  });

  // Why a collected quantity can differ from the declared one. Sent by the backend so
  // the screen never keeps its own copy of a list somebody has to choose from.
  app.get("/v1/operations/discrepancy-reasons", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return reply.send({
      reasons: DISCREPANCY_REASONS.map((reason) => ({ key: reason, label: DISCREPANCY_REASON_LABELS[reason] })),
    });
  });

  // The reasons a check can fail, and what each one means. Sent by the backend so the
  // operator's screen never keeps its own copy of a list that decides where work goes.
  app.get("/v1/operations/qc-reasons", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    return reply.send({
      reasons: QC_FAILURE_REASONS.map((reason) => ({
        key: reason,
        label: QC_REASON_LABELS[reason],
        evidenceRequired: evidenceRequired(reason),
        serious: isSerious(reason),
      })),
    });
  });

  // QC one batch, once that batch's own processing is done. It does not wait for
  // the rest of the order.
  app.post<{ Params: { id: string; batchId: string } }>("/v1/operations/orders/:id/batches/:batchId/qc", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = batchQcSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    if (!parsed.data.passed) {
      // Everything missing at once, so the operator fixes the form in one go rather
      // than being told about the photograph only after they supply the remarks.
      const problems = qcFailureProblems(parsed.data);
      if (problems.length) {
        return reply.code(400).send({ error: "qc_failure_incomplete", message: problems[0], problems });
      }
    }
    return withScope(reply, async () => {
      const existing = await container.access.requireOrder(session, req.params.id);
      try {
        const order = await container.orders.qcBatch(
          req.params.id, req.params.batchId, parsed.data.passed,
          { userId: session.userId, session },
          parsed.data.passed
            ? undefined
            : {
                reason: parsed.data.reason as QcFailureReason,
                remarks: parsed.data.remarks ?? "",
                evidenceUrl: parsed.data.evidenceUrl ?? null,
              },
        );
        await container.audit.record({
          session, action: parsed.data.passed ? "order.batch_qc_passed" : "order.batch_qc_failed",
          resource: "order", resourceId: order.id,
          previousValue: { state: existing.state, batchId: req.params.batchId },
          newValue: { state: order.state, batchId: req.params.batchId, reason: parsed.data.reason ?? null, remarks: parsed.data.remarks ?? null },
        });
        return reply.send({ order: await container.orders.detail(order), batches: await container.orders.batches(order.id) });
      } catch (error) {
        if (error instanceof BatchNotFoundError) return reply.code(404).send({ error: "batch_not_found" });
        if (error instanceof BatchNotReadyForQcError) return reply.code(409).send({ error: "not_ready_for_qc", message: error.message });
        throw error;
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

  // An operator works tickets rather than only reading them: they can take one,
  // investigate it, answer the resident, resolve it and close it. Everything they
  // do lands on the same ticket the supervisor and the resident are looking at.
  app.get<{ Querystring: { status?: string; type?: string; societyId?: string; orderId?: string; from?: string; to?: string; mine?: string } }>("/v1/operations/issues", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const societyIds = await container.access.visibleSocietyIds(session);
    const { status, type, societyId, orderId, from, to, mine } = req.query;
    // Narrowing to one society still has to stay inside what this operator can see.
    const scoped = societyId && societyIds.has(societyId) ? new Set([societyId]) : societyIds;
    const issues = await container.issues.list({
      // Scoped by who is asking rather than by society alone, so an operator sees the
      // issues they raised themselves as well as the ones for their societies.
      viewer: { userId: session.userId, role: "operator", societyIds },
      societyIds: scoped,
      status: status && status !== "all" ? (status as never) : undefined,
      type: type && type !== "all" ? type : undefined,
      orderId: orderId || undefined,
      from: from || undefined,
      to: to || undefined,
      assignedToUserId: mine === "true" ? session.userId : undefined,
    });
    return reply.send({
      issues,
      issueTypes: ISSUE_TYPES,
      statuses: ISSUE_STATUSES,
      // The counts the filter chips render, taken before the filter is applied.
      counts: await issueCounts(container, societyIds, session),
    });
  });

  // How many tickets are in each state across everything this operator can see.
  async function issueCounts(c: typeof container, societyIds: Set<string>, session: { userId: string }) {
    const all = await c.issues.list({
      viewer: { userId: session.userId, role: "operator", societyIds },
    });
    const counts: Record<string, number> = { all: all.length };
    for (const status of ISSUE_STATUSES) counts[status] = all.filter((i) => i.status === status).length;
    return counts;
  }

  // One rule for whether an operator may touch a ticket, used by every action below.
  async function reachableTicket(session: { userId: string }, id: string) {
    const ticket = await container.store.tickets.get(id);
    if (!ticket) return { ticket: null, allowed: false };
    const societyIds = await container.access.visibleSocietyIds(session as never);
    const allowed = IssueService.canSee(ticket, {
      userId: session.userId, role: "operator", societyIds,
    });
    return { ticket, allowed };
  }

  app.get<{ Params: { id: string } }>("/v1/operations/issues/:id", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const { ticket, allowed } = await reachableTicket(session, req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not_found" });
    if (!allowed) return reply.code(403).send({ error: "forbidden_scope" });
    return reply.send({ issue: await container.issues.detail(ticket, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
  });

  // An operator who cannot resolve a resident's issue passes it to the supervisor.
  app.post<{ Params: { id: string } }>("/v1/operations/issues/:id/escalate", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const note = String((req.body as { note?: string } | null)?.note ?? "");
    const { ticket, allowed } = await reachableTicket(session, req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not_found" });
    if (!allowed) return reply.code(403).send({ error: "forbidden_scope" });
    try {
      const result = await container.issues.escalateOneLevel(req.params.id, note, session.userId, "operator");
      if (!result) return reply.code(409).send({ error: "ticket_closed" });
      await container.audit.record({ session, action: "issue.escalated", resource: "issue", resourceId: req.params.id, previousValue: { responsibleRole: result.previous.responsibleRole }, newValue: { responsibleRole: result.target } });
      await container.notifications.notifyRoleInSociety(result.current.societyId, "supervisor", {
        type: "issue.escalated", orderId: result.current.orderId,
        title: "Issue escalated to you", body: note || "An operator could not resolve this issue.",
      });
      return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
    } catch (error) {
      if (error instanceof IssueEscalationError) return reply.code(409).send({ error: "cannot_escalate", message: error.message });
      throw error;
    }
  });

  // Taking a ticket. An operator assigns it to themselves rather than to anybody
  // else, so ownership is something they accept rather than something they hand out.
  app.post<{ Params: { id: string } }>("/v1/operations/issues/:id/take", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const { ticket: issue, allowed } = await reachableTicket(session, req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    if (!allowed) return reply.code(403).send({ error: "forbidden_scope" });
    {
      const result = await container.issues.assign(req.params.id, session.userId);
      if (!result) return reply.code(409).send({ error: "ticket_closed", message: "That ticket is already closed." });
      await container.audit.record({ session, action: "issue.assigned", resource: "issue", resourceId: req.params.id, previousValue: { assignedToUserId: result.previous.assignedToUserId }, newValue: { assignedToUserId: session.userId } });
      return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
    }
  });

  app.post<{ Params: { id: string } }>("/v1/operations/issues/:id/reply", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = issueReplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { ticket: issue, allowed } = await reachableTicket(session, req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    if (!allowed) return reply.code(403).send({ error: "forbidden_scope" });
    if (issue.status === "closed") return reply.code(409).send({ error: "ticket_closed" });
    {
      let updated;
      try {
        updated = await container.issues.reply(
          req.params.id, session.userId, "operator", parsed.data.body,
          { roles: session.roles, residentId: session.residentId },
        );
      } catch (error) {
        // Read-only rather than forbidden: an operator who escalated this issue can
        // still see the conversation, they just cannot add to it while the supervisor
        // holds it.
        if (error instanceof ConversationClosedError) {
          return reply.code(409).send({ error: "conversation_read_only", message: error.message });
        }
        throw error;
      }
      if (!updated) return reply.code(404).send({ error: "not_found" });
      // The resident sees the answer in their own support screen, so a reply here is
      // a reply to them and not a note filed somewhere they cannot reach.
      if (updated.residentId) {
        await container.notifications.notifyResident(updated.residentId, {
          type: "issue.replied", orderId: updated.orderId,
          title: "Support replied to your ticket", body: parsed.data.body,
        });
      }
      return reply.send({ issue: await container.issues.detail(updated, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/operations/issues/:id/status", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = issueStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { ticket: issue, allowed } = await reachableTicket(session, req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    if (!allowed) return reply.code(403).send({ error: "forbidden_scope" });
    {
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
    }
  });

  app.post("/v1/operations/issues", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      const order = parsed.data.orderId ? await container.access.requireOrder(session, parsed.data.orderId) : null;
      const issue = await container.issues.create({
        residentId: order?.residentId ?? null, orderId: order?.id ?? null,
        societyId: order?.societyId ?? null,
        category: parsed.data.type, description: parsed.data.description, priority: parsed.data.priority ?? "normal",
        reportedByUserId: session.userId, reportedByRole: "operator",
      });
      await container.audit.record({ session, action: "issue.created", resource: "issue", resourceId: issue.id, newValue: issue });
      await container.notifications.notifyRoleInSociety(issue.societyId, "supervisor", {
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
    // Society and block assignment are supervisor controlled, so they are ignored here.
    const user = await container.auth.updateStaffProfile(session.userId, parsed.data);
    return reply.send({ profile: await container.users.decorate(user) });
  });

  app.get<{ Params: { unitId: string }; Querystring: { from?: string; to?: string } }>("/v1/operations/units/:unitId/earnings", async (req, reply) => {
    const session = await operator(req, reply); if (!session) return;
    const unit = await container.store.units.get(req.params.unitId);
    if (!unit) return reply.code(404).send({ error: "not_found" });
    if (!(await container.access.canSeeSociety(session, unit.societyId))) {
      return reply.code(403).send({ error: "forbidden_scope", message: "Unit belongs to another society" });
    }
    const earnings = await container.earnings.forUnit(req.params.unitId, { from: req.query.from, to: req.query.to });
    if (!earnings) return reply.code(404).send({ error: "not_found" });
    return reply.send({ earnings });
  });
}
