import { Account } from "../domain/accounts";
import { generateQrBatchCode } from "../domain/codes";
import { remainingAllowance, totalQuantity } from "../domain/garments";
import {
  coveredEligibleQuantity, garmentsChargePaise, linesTotalPaise, priceOrder,
  reconcileLines, additionalChargeFromLines,
  type OrderCharge, type LineReconciliation,
} from "../domain/pricing";
import {
  batchesForLines, completeStep, recordQc, describeBatch, orderStageFromBatches,
} from "../domain/batches";
import { canTransition, transition, timelineStages, ACTIVE_STATES, PROCESSING_STATES, type OrderState } from "../domain/order-state-machine";
import {
  allowedNext, isAllowedNext, lifecycleFor, lineStages, orderRequirement,
  CLEAN_STAGE_ACTIONS, CLEAN_STAGE_LABELS, type ProcessingRequirement,
} from "../domain/processing";
import type { BatchStep, GarmentItem, Order, OrderLine, Session } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import { pickupWindowOpen, pickupAvailableFrom, PickupNotDueError } from "./scheduling-service";
import type { NotificationService } from "./notification-service";
import type { IssueService } from "./issue-service";
import type { SubscriptionService } from "./subscription-service";
import type { SystemConfigService } from "./system-config-service";
import type { WalletService } from "./wallet-service";
import { InsufficientBalanceError } from "./wallet-service";

export class OrderNotFoundError extends Error {
  constructor() { super("Order not found"); this.name = "OrderNotFoundError"; }
}
// A quantity confirmation that names a line the order does not have.
export class UnknownOrderLineError extends Error {
  constructor(readonly lineId: string) {
    super(`This order has no line ${lineId}.`);
    this.name = "UnknownOrderLineError";
  }
}

// A pickup cannot be completed until every Garment + Service combination has been
// confirmed, because an unconfirmed combination cannot be priced or processed.
export class QuantityConfirmationRequiredError extends Error {
  constructor(readonly lineIds: string[]) {
    super("Confirm the quantity received for every garment and service before completing the pickup.");
    this.name = "QuantityConfirmationRequiredError";
  }
}

export class BatchNotFoundError extends Error {
  constructor() { super("No such processing batch on this order."); this.name = "BatchNotFoundError"; }
}

// What the operator confirms for one Garment + Service combination.
export interface LineQuantity { lineId: string; acceptedQuantity: number }

// The per category totals the rest of the system still works in, built from what
// was actually accepted rather than from what was booked.
function linesToAcceptedItems(lines: OrderLine[]): { category: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const quantity = line.acceptedQuantity ?? line.quantity;
    if (quantity <= 0) continue;
    totals.set(line.category, (totals.get(line.category) ?? 0) + quantity);
  }
  return [...totals.entries()].map(([category, quantity]) => ({ category, quantity }));
}

export class QuantityRequiredError extends Error {
  constructor() { super("Enter the actual garment quantity before confirming the pickup"); this.name = "QuantityRequiredError"; }
}

export interface OrderActor { userId: string; session?: Session }

export class OrderService {
  constructor(
    private readonly store: DataStore,
    private readonly notifications: NotificationService,
    private readonly issues: IssueService,
    private readonly subscriptions: SubscriptionService,
    private readonly systemConfig: SystemConfigService,
    private readonly wallet: WalletService,
  ) {}

  // What this particular batch has to go through, from the services its garments
  // were sent for. An order with no lines keeps the original wash and iron path.
  private requirementOf(order: Order): ProcessingRequirement {
    return orderRequirement(order.lines ?? []);
  }

  private async apply(order: Order, to: OrderState, ctx: Record<string, unknown> = {}, note?: string, actorUserId?: string): Promise<Order> {
    // Processing stages are additionally checked against what the garments in this
    // order actually need, so an Iron Only batch can never be sent to be washed.
    if ((to === "in_wash" || to === "ironing" || to === "qc") && !isAllowedNext(order.state, to, this.requirementOf(order))) {
      throw new Error(`Order ${order.orderCode} does not require ${to === "qc" ? "further processing" : to} from ${order.state}`);
    }
    const next = transition(order.state, to, ctx);
    order.state = next;
    order.timeline.push({ state: next, at: new Date().toISOString(), note, actorUserId: actorUserId ?? null });
    return this.store.orders.put(order);
  }

  private async get(orderId: string): Promise<Order> {
    const order = await this.store.orders.get(orderId);
    if (!order) throw new OrderNotFoundError();
    return order;
  }

  // ---------------------------------------------------------------- quantities

  // Rules 1 to 3. The operator supplies only the accepted quantity; the covered
  // quantity, the additional quantity and the charge are all derived here. A
  // resident without an active plan pays the ordinary per garment price instead.
  async previewSplit(orderId: string, items: GarmentItem[]): Promise<OrderCharge & { planTier: string | null; remainingAllowance: number; additionalRatePaise: number; additionalChargePaise: number; subscriptionCoveredCount: number; additionalCount: number; acceptedCount: number }> {
    const order = await this.get(orderId);
    const config = await this.systemConfig.get();
    const accepted = totalQuantity(items);
    const subscription = order.subscriptionId ? await this.store.subscriptions.get(order.subscriptionId) : null;
    const plan = subscription ? await this.store.plans.get(subscription.planId) : null;
    const hasSubscription = Boolean(subscription && plan && subscription.status === "active");
    const remaining = hasSubscription ? remainingAllowance(plan!.garmentCap, subscription!.garmentsUsed) : 0;
    const charge = priceOrder({
      acceptedCount: accepted,
      // Garments sent for a service the plan does not cover are billed even while
      // allowance remains, so only the covered ones are eligible to spend it.
      coveredEligibleCount: coveredEligibleQuantity(order.lines ?? []),
      remainingAllowance: remaining,
      hasSubscription,
      additionalRatePaise: config.additionalGarmentRatePaise,
      nonSubscriberRatePaise: config.nonSubscriberGarmentRatePaise,
      // Priced per category, so a saree is not billed at the price of a shirt.
      garmentChargePaise: garmentsChargePaise(items, config.garmentPricesPaise, config.nonSubscriberGarmentRatePaise),
      servicesPaise: linesTotalPaise(order.lines ?? []),
    });
    return {
      ...charge,
      // Kept under their original names so existing clients and tests keep working.
      additionalRatePaise: charge.ratePaise,
      additionalChargePaise: charge.totalPaise,
      planTier: plan?.tier ?? null,
      remainingAllowance: remaining,
    };
  }

  // ------------------------------------------------- garment + service batches

  // What the operator is being asked to confirm: every Garment + Service
  // combination the resident ordered, side by side with what actually turned up.
  // Two shirts for washing and two for dry cleaning are two rows, not four shirts,
  // because they cost different amounts and go through different machines.
  async reconcile(orderId: string, accepted: LineQuantity[] = []): Promise<{
    lines: LineReconciliation[];
    requestedTotal: number;
    actualTotal: number;
    additionalPaise: number;
    confirmed: boolean;
  }> {
    const order = await this.get(orderId);
    const config = await this.systemConfig.get();
    const byLine = new Map(accepted.map((a) => [a.lineId, Math.max(0, Math.trunc(a.acceptedQuantity))]));
    const acceptedOf = (line: OrderLine) =>
      byLine.has(line.id) ? byLine.get(line.id)! : line.acceptedQuantity ?? line.quantity;

    const lines = reconcileLines(order.lines ?? [], acceptedOf, config.garmentPricesPaise, config.nonSubscriberGarmentRatePaise);
    return {
      lines,
      requestedTotal: lines.reduce((sum, l) => sum + l.requested, 0),
      actualTotal: lines.reduce((sum, l) => sum + l.actual, 0),
      // Each line's extras at that line's own rate, never at one flat rate.
      additionalPaise: additionalChargeFromLines(lines),
      confirmed: (order.lines ?? []).every((l) => l.acceptedQuantity !== null && l.acceptedQuantity !== undefined),
    };
  }

  // The batches an order is being worked as, ready to render.
  async batches(orderId: string) {
    const order = await this.get(orderId);
    return (order.batches ?? []).map(describeBatch);
  }

  // Move one batch on by one step. Only that batch moves: the others carry on at
  // their own pace, which is the whole point of splitting them.
  async advanceBatch(orderId: string, batchId: string, step: BatchStep, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    const batch = (order.batches ?? []).find((b) => b.id === batchId);
    if (!batch) throw new BatchNotFoundError();
    completeStep(batch, step, actor.userId);
    order.batches = [...order.batches];
    return this.syncOrderToBatches(order, actor, `${batch.serviceName} ${step} completed for ${batch.quantity} x ${batch.category}`);
  }

  // QC for one batch, once that batch's own steps are done. A batch does not wait
  // for the rest of the order to catch up.
  async qcBatch(orderId: string, batchId: string, passed: boolean, actor: OrderActor, reason?: string): Promise<Order> {
    const order = await this.get(orderId);
    const batch = (order.batches ?? []).find((b) => b.id === batchId);
    if (!batch) throw new BatchNotFoundError();
    recordQc(batch, passed, actor.userId, reason);
    order.batches = [...order.batches];
    const note = passed
      ? `QC passed for ${batch.quantity} x ${batch.category} (${batch.serviceName})`
      : `QC failed for ${batch.quantity} x ${batch.category} (${batch.serviceName}): ${batch.qcReason}`;
    return this.syncOrderToBatches(order, actor, note);
  }

  // The order's own state follows from its batches rather than being set beside
  // them, so an order can never claim to be ready for delivery while a batch is
  // still in a machine.
  private async syncOrderToBatches(order: Order, actor: OrderActor, note: string): Promise<Order> {
    const stage = orderStageFromBatches(order.batches ?? []);
    const target: OrderState | null = stage.anyFailed
      ? "qc_hold"
      : stage.allComplete
        ? "ready_for_delivery"
        : null;

    if (target && target !== order.state) {
      order.qcPassed = stage.anyFailed ? false : stage.allComplete ? true : order.qcPassed;
      if (stage.anyFailed) {
        order.qcReason = (order.batches ?? []).find((b) => b.status === "qc_failed")?.qcReason ?? null;
        order.qcAttempts += 1;
      } else if (stage.allComplete) {
        order.qcReason = null;
      }
      // Forced, because the order state is a summary of the batches rather than a
      // separate machine that has to be walked one legal step at a time.
      order.timeline.push({ state: target, at: new Date().toISOString(), note, actorUserId: actor.userId });
      order.state = target;
      const saved = await this.store.orders.put(order);
      if (target === "ready_for_delivery") {
        await this.notifications.notifyResident(saved.residentId, {
          type: "order.ready", orderId: saved.id, title: "Ready for delivery",
          body: `Order ${saved.orderCode} has finished processing and passed quality control.`,
        });
      }
      return saved;
    }

    order.timeline.push({ state: order.state, at: new Date().toISOString(), note, actorUserId: actor.userId });
    return this.store.orders.put(order);
  }

  // ------------------------------------------------------------------- pickup

  // Rule 4. Subscription usage is finalised from the accepted quantity at pickup,
  // never from the booking estimate the resident entered.
  async markPickedUp(
    orderId: string,
    items: GarmentItem[],
    actor: OrderActor,
    acceptedLines: LineQuantity[] = [],
    options: { early?: boolean; earlyReason?: string } = {},
  ): Promise<Order> {
    const order = await this.get(orderId);

    // A pickup cannot be worked before the window the resident booked. Without this
    // an order could be collected, processed, checked and delivered a day before its
    // own scheduled date, leaving a timeline that describes something that did not
    // happen. An early collection is still possible, but it has to be asked for
    // deliberately and it is recorded as such.
    const pickup = order.pickupId ? await this.store.pickups.get(order.pickupId) : null;
    const slot = pickup ? await this.store.slots.get(pickup.slotId) : null;
    if (slot && !pickupWindowOpen(slot) && !options.early) {
      throw new PickupNotDueError(pickupAvailableFrom(slot));
    }
    const early = Boolean(slot && !pickupWindowOpen(slot) && options.early);

    const hasLines = (order.lines ?? []).length > 0;

    // When the order has Garment + Service lines, the operator confirms each one.
    // The pickup cannot be completed on a bare per-category total, because that
    // total cannot say which service the garments were for and therefore cannot
    // price them. An order booked before lines existed still accepts items alone.
    if (hasLines && acceptedLines.length) {
      const known = new Set(order.lines.map((l) => l.id));
      for (const entry of acceptedLines) {
        if (!known.has(entry.lineId)) throw new UnknownOrderLineError(entry.lineId);
      }
      const missing = order.lines.filter((l) => !acceptedLines.some((a) => a.lineId === l.id));
      if (missing.length) throw new QuantityConfirmationRequiredError(missing.map((l) => l.id));
      const byLine = new Map(acceptedLines.map((a) => [a.lineId, Math.max(0, Math.trunc(a.acceptedQuantity))]));
      order.lines = order.lines.map((line) => ({ ...line, acceptedQuantity: byLine.get(line.id) ?? 0 }));
      items = linesToAcceptedItems(order.lines);
    } else if (hasLines) {
      // A per category total can only be attributed when the category was sent for
      // exactly one service. Where a category is split across services — two shirts
      // washed and two dry cleaned — the total says nothing about which is which,
      // and guessing is what produced the wrong price and the wrong machine.
      const perCategory = new Map<string, OrderLine[]>();
      for (const line of order.lines) {
        perCategory.set(line.category, [...(perCategory.get(line.category) ?? []), line]);
      }
      const ambiguous = [...perCategory.values()].filter((group) => group.length > 1).flat();
      if (ambiguous.length) throw new QuantityConfirmationRequiredError(ambiguous.map((l) => l.id));

      const given = new Map(items.map((i) => [i.category, Math.max(0, Math.trunc(i.quantity))]));
      order.lines = order.lines.map((line) => ({
        ...line,
        acceptedQuantity: given.has(line.category) ? given.get(line.category)! : 0,
      }));
      items = linesToAcceptedItems(order.lines);
    }

    const accepted = totalQuantity(items);
    if (!items.length || accepted <= 0) throw new QuantityRequiredError();

    const split = await this.previewSplit(orderId, items);
    order.items = items;
    order.pickupCount = accepted;
    order.acceptedCount = accepted;
    order.subscriptionCoveredCount = split.subscriptionCoveredCount;
    order.additionalCount = split.additionalCount;
    order.additionalRatePaise = split.ratePaise;
    order.servicesPaise = split.servicesPaise;
    order.payPerOrder = split.payPerOrder;
    order.additionalChargePaise = split.totalPaise;
    order.additionalChargeStatus = split.totalPaise > 0 ? "pending" : "none";

    // One batch per Garment + Service combination that actually arrived, each with
    // the sequence its own service needs. A combination received as nothing makes
    // no batch, because there is nothing to process.
    order.batches = batchesForLines(
      order.lines ?? [],
      (line) => line.acceptedQuantity ?? line.quantity,
      (_line, index) => `${order.id}-b${index + 1}`,
    );
    order.qrBatchCode = order.qrBatchCode ?? generateQrBatchCode();
    order.assignedOperatorUserId = order.assignedOperatorUserId ?? actor.userId;
    // The actual collection time, kept separately from the time it was scheduled
    // for. The schedule is what was agreed; this is what happened.
    order.pickedUpAt = new Date().toISOString();
    order.scheduledPickupAt = pickup?.scheduledFor ?? null;
    order.earlyPickup = early;
    order.earlyPickupReason = early ? (options.earlyReason?.trim() || "Collected early") : null;
    order.expectedCompletionAt = await this.computeExpectedCompletion(order);

    const note = early
      ? `Accepted ${accepted} garments early (QR ${order.qrBatchCode}): ${order.earlyPickupReason}`
      : `Accepted ${accepted} garments (QR ${order.qrBatchCode})`;
    const updated = await this.apply(order, "picked_up", {}, note, actor.userId);

    if (order.subscriptionId && split.subscriptionCoveredCount > 0) {
      await this.subscriptions.deductGarments(order.subscriptionId, split.subscriptionCoveredCount);
    }
    if (split.totalPaise > 0) await this.settleAdditionalCharge(updated);

    if (pickup) { pickup.status = "completed"; await this.store.pickups.put(pickup); }

    await this.notifications.notifyResident(order.residentId, {
      type: "order.picked_up", orderId: order.id, title: "Garments collected",
      body: split.payPerOrder
        ? `${accepted} garments collected for order ${order.orderCode}. Charged at the pay per garment rate.`
        : `${accepted} garments collected for order ${order.orderCode}. ${split.subscriptionCoveredCount} covered by your plan, ${split.additionalCount} additional.`,
    });
    await this.notifications.notifyRoleInArea(order.areaId, "supervisor", {
      type: "order.picked_up", orderId: order.id, title: "Pickup completed",
      body: `Order ${order.orderCode} picked up with ${accepted} garments.`,
    });
    return updated;
  }

  // The charge is taken from the wallet when it can cover it. If it cannot, the
  // charge stays pending and the resident is told, rather than blocking the pickup.
  private async settleAdditionalCharge(order: Order): Promise<void> {
    const amount = order.additionalChargePaise ?? 0;
    if (amount <= 0) return;
    try {
      await this.wallet.charge(order.residentId, amount, Account.AddonRevenue, `addl-garments-${order.id}`);
      order.additionalChargeStatus = "paid";
    } catch (error) {
      order.additionalChargeStatus = error instanceof InsufficientBalanceError ? "pending" : "failed";
      await this.notifications.notifyResident(order.residentId, {
        type: "payment.additional_charge_due", orderId: order.id, title: "Additional garment charge due",
        body: `Order ${order.orderCode} has an additional charge of ${(amount / 100).toFixed(2)} rupees. Top up your wallet to settle it.`,
      });
    }
    await this.store.orders.put(order);
  }

  async payAdditionalCharge(orderId: string): Promise<Order> {
    const order = await this.get(orderId);
    if (order.additionalChargeStatus !== "pending" && order.additionalChargeStatus !== "failed") return order;
    await this.settleAdditionalCharge(order);
    return this.get(orderId);
  }

  private async computeExpectedCompletion(order: Order): Promise<string> {
    const config = await this.systemConfig.get();
    const subscription = order.subscriptionId ? await this.store.subscriptions.get(order.subscriptionId) : null;
    const plan = subscription ? await this.store.plans.get(subscription.planId) : null;
    const hours = plan?.turnaroundHours ?? config.defaultTurnaroundHours;
    return new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  // A failed pickup preserves the order and records why, rather than dropping it
  // out of the queue with no trace.
  async failPickup(orderId: string, reason: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    order.pickupFailureReason = reason;
    order.assignedOperatorUserId = order.assignedOperatorUserId ?? actor.userId;
    const updated = await this.apply(order, "pickup_failed", {}, reason, actor.userId);
    const pickup = order.pickupId ? await this.store.pickups.get(order.pickupId) : null;
    if (pickup) { pickup.status = "failed"; await this.store.pickups.put(pickup); }
    await this.issues.create({
      residentId: order.residentId, orderId: order.id, societyId: order.societyId, areaId: order.areaId,
      category: "pickup_failed", description: reason, priority: "high",
      reportedByUserId: actor.userId, reportedByRole: "operator",
    });
    await this.notifications.notifyResident(order.residentId, {
      type: "pickup.failed", orderId: order.id, title: "Pickup could not be completed", body: `Order ${order.orderCode}: ${reason}.`,
    });
    await this.notifications.notifyRoleInArea(order.areaId, "supervisor", {
      type: "pickup.failed", orderId: order.id, title: "Failed pickup", body: `Order ${order.orderCode}: ${reason}.`,
    });
    return updated;
  }

  // ------------------------------------------------------------- processing

  // Cleaning covers washing, dry cleaning and premium care: one order stage, named
  // after what the garments in the batch were actually sent for.
  async startWash(orderId: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    const label = CLEAN_STAGE_LABELS[this.requirementOf(order).cleanStage];
    const updated = await this.apply(order, "in_wash", {}, `${label} started`, actor.userId);
    await this.notifications.notifyResident(order.residentId, { type: "order.washing", orderId: order.id, title: `${label} started`, body: `Order ${order.orderCode} is in ${label.toLowerCase()}.` });
    return updated;
  }

  // The ironing stage is one order state. Ironing that has not begun yet counts as
  // "ironing pending"; startIroning stamps the timeline so the dashboards can tell
  // pending work apart from work in progress without inventing extra states.
  async completeWash(orderId: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    const requirement = this.requirementOf(order);
    const label = CLEAN_STAGE_LABELS[requirement.cleanStage];
    // Nothing in the batch needs pressing, so it goes straight to quality check
    // rather than sitting in an ironing stage that has no work in it.
    const next: OrderState = requirement.requiresPress ? "ironing" : "qc";
    const note = requirement.requiresPress ? `${label} completed` : `${label} completed, awaiting quality check`;
    return this.apply(order, next, {}, note, actor.userId);
  }

  async startIroning(orderId: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    if (order.state !== "ironing") throw new Error(`Cannot start ironing from ${order.state}`);
    if (!ironingStarted(order)) {
      order.timeline.push({ state: "ironing", at: new Date().toISOString(), note: IRONING_STARTED_NOTE, actorUserId: actor.userId });
      await this.store.orders.put(order);
    }
    await this.notifications.notifyResident(order.residentId, { type: "order.ironing", orderId: order.id, title: "Ironing started", body: `Order ${order.orderCode} is being ironed.` });
    return order;
  }

  async completeIroning(orderId: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    return this.apply(order, "qc", {}, "Ironing completed, awaiting quality check", actor.userId);
  }

  // Kept for the generic advance action the offline queue replays.
  async advanceStage(orderId: string, to: Extract<OrderState, "in_wash" | "ironing" | "qc">, actor: OrderActor): Promise<Order> {
    if (to === "in_wash") return this.startWash(orderId, actor);
    if (to === "ironing") return this.completeWash(orderId, actor);
    const order = await this.get(orderId);
    // A batch that skipped ironing reaches QC from cleaning instead.
    if (order.state === "in_wash") return this.completeWash(orderId, actor);
    return this.completeIroning(orderId, actor);
  }

  // The stages this order still has to go through, and the action that moves it on.
  // The operations portal renders exactly this, so it can never offer Start Wash for
  // an order whose garments are only being ironed.
  nextActions(order: Order): Array<{ to: OrderState; label: string }> {
    const requirement = this.requirementOf(order);
    const clean = CLEAN_STAGE_ACTIONS[requirement.cleanStage];
    return allowedNext(order.state, requirement)
      // Only the processing stages are actions in this sense. Pickup, cancellation
      // and delivery have their own screens and their own endpoints.
      .filter((to) => to === "in_wash" || to === "ironing" || to === "qc")
      .map((to) => {
        if (to === "in_wash") return { to, label: clean.start };
        // Leaving cleaning is the same act whichever stage follows it, so it reads
        // as completing the cleaning rather than as starting whatever comes next.
        if (order.state === "in_wash") return { to, label: clean.complete };
        if (to === "ironing") return { to, label: "Start Ironing" };
        if (order.state === "ironing") return { to, label: "Complete Ironing" };
        // Nothing in the batch needs any processing at all.
        return { to, label: "Send to Quality Check" };
      });
  }

  // Quality check. A pass clears the order for delivery. A fail holds the batch,
  // records the reason, opens an issue for the supervisor, and forces the order to
  // be reprocessed and pass QC again before it can ever become ready for delivery.
  async submitQc(orderId: string, pass: boolean, reason: string | undefined, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    // Count the attempt only once the transition is known to be legal, so a
    // rejected call does not inflate the QC attempt count.
    const target: OrderState = pass ? "ready_for_delivery" : "qc_hold";
    if (!canTransition(order.state, target)) {
      throw new Error(`Illegal order transition from ${order.state} to ${target}`);
    }
    order.qcAttempts = (order.qcAttempts ?? 0) + 1;
    if (pass) {
      order.qcPassed = true;
      order.qcReason = null;
      const ready = await this.apply(order, "ready_for_delivery", { qcPassed: true }, "Quality check passed", actor.userId);
      await this.notifications.notifyResident(order.residentId, { type: "order.ready", orderId: order.id, title: "Ready for delivery", body: `Order ${order.orderCode} passed quality check and is ready.` });
      return ready;
    }
    order.qcPassed = false;
    order.qcReason = reason ?? "Quality check failed";
    const held = await this.apply(order, "qc_hold", {}, order.qcReason, actor.userId);
    await this.issues.create({
      residentId: order.residentId, orderId: order.id, societyId: order.societyId, areaId: order.areaId,
      category: "qc_fail", description: order.qcReason, priority: "high",
      reportedByUserId: actor.userId, reportedByRole: "operator",
    });
    await this.notifications.notifyRoleInArea(order.areaId, "supervisor", {
      type: "qc.failed", orderId: order.id, title: "QC failure", body: `Order ${order.orderCode}: ${order.qcReason}.`,
    });
    await this.notifications.notifyResident(order.residentId, {
      type: "qc.failed", orderId: order.id, title: "Quality check in progress", body: `We are re-checking order ${order.orderCode}: ${order.qcReason}.`,
    });
    return held;
  }

  // Send a held batch back into processing. It must pass QC again afterwards.
  async reprocess(orderId: string, to: Extract<OrderState, "in_wash" | "ironing">, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    order.qcPassed = null;
    // apply() refuses a stage the garments do not need, so a held Iron Only batch
    // cannot be sent back to be washed.
    return this.apply(order, to, {}, `Reprocessing after QC failure (${order.qcReason ?? "no reason recorded"})`, actor.userId);
  }

  // -------------------------------------------------------------- delivery

  async outForDelivery(orderId: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    order.deliveredByUserId = actor.userId;
    const updated = await this.apply(order, "out_for_delivery", {}, "Left the facility for delivery", actor.userId);
    await this.notifications.notifyResident(order.residentId, { type: "order.out_for_delivery", orderId: order.id, title: "On the way", body: `Order ${order.orderCode} is out for delivery.` });
    return updated;
  }

  // Delivery reconciles counts. A mismatch without a reason is blocked by the state
  // machine. Subscription usage is not touched here: it was finalised at pickup.
  async deliver(orderId: string, deliveryCount: number, discrepancyReason: string | undefined, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    order.deliveryCount = deliveryCount;
    if (discrepancyReason) order.discrepancyReason = discrepancyReason;
    order.deliveredByUserId = actor.userId;
    order.deliveredAt = new Date().toISOString();
    const delivered = await this.apply(order, "delivered", {
      pickupCount: order.acceptedCount ?? order.pickupCount ?? undefined, deliveryCount, discrepancyReason,
    }, discrepancyReason ? `Delivered with discrepancy: ${discrepancyReason}` : "Delivered", actor.userId);
    if (discrepancyReason) {
      await this.issues.create({
        residentId: order.residentId, orderId: order.id, societyId: order.societyId, areaId: order.areaId,
        category: "garment_quantity_mismatch", description: discrepancyReason, priority: "high",
        reportedByUserId: actor.userId, reportedByRole: "operator",
      });
    }
    await this.notifications.notifyResident(order.residentId, { type: "order.delivered", orderId: order.id, title: "Delivered", body: `Order ${order.orderCode} delivered.` });
    return delivered;
  }

  // ---------------------------------------------------------------- resident

  async rate(orderId: string, rating: number, comment?: string): Promise<Order> {
    const order = await this.get(orderId);
    order.rating = rating; order.ratingComment = comment ?? null;
    return this.store.orders.put(order);
  }

  async raiseDispute(orderId: string, description: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    const updated = await this.apply(order, "disputed", {}, description, actor.userId);
    await this.issues.create({
      residentId: order.residentId, orderId: order.id, societyId: order.societyId, areaId: order.areaId,
      category: "dispute", description, priority: "high", reportedByUserId: actor.userId, reportedByRole: "resident",
    });
    return updated;
  }

  // ----------------------------------------------------------------- reading

  // Reassigning never touches the order state or its history: the batch stays
  // exactly where it is in processing and simply changes hands.
  async assignOperator(orderId: string, operatorUserId: string | null, actor?: OrderActor, note?: string): Promise<{ order: Order; previousOperatorUserId: string | null }> {
    const order = await this.get(orderId);
    const previousOperatorUserId = order.assignedOperatorUserId;
    order.assignedOperatorUserId = operatorUserId;
    order.timeline.push({
      state: order.state,
      at: new Date().toISOString(),
      note: note ?? (operatorUserId ? "Reassigned to another operator" : "Returned to the unassigned queue"),
      actorUserId: actor?.userId ?? null,
    });
    await this.store.orders.put(order);
    return { order, previousOperatorUserId };
  }

  // Everything an operator still holds. Used when they go on leave so the work can
  // be moved rather than stranded behind one person.
  async openWorkFor(operatorUserId: string): Promise<Order[]> {
    return this.store.orders.find(
      (o) => o.assignedOperatorUserId === operatorUserId && !["delivered", "cancelled", "disputed"].includes(o.state),
    );
  }

  isDelayed(order: Order, graceHours: number): boolean {
    if (!order.expectedCompletionAt) return false;
    if (["delivered", "cancelled", "pickup_failed", "disputed"].includes(order.state)) return false;
    return Date.now() > new Date(order.expectedCompletionAt).getTime() + graceHours * 3600 * 1000;
  }

  delayMinutes(order: Order): number {
    if (!order.expectedCompletionAt) return 0;
    const over = Date.now() - new Date(order.expectedCompletionAt).getTime();
    return over > 0 ? Math.round(over / 60000) : 0;
  }

  // The full order view every portal renders: resolved names, the derived quantity
  // breakdown, the tracking timeline and any issues raised against the order.
  async detail(order: Order) {
    const config = await this.systemConfig.get();
    const resident = await this.store.residents.get(order.residentId);
    const residentUser = resident ? await this.store.users.get(resident.userId) : null;
    const society = await this.store.societies.get(order.societyId);
    const area = society?.areaId ? await this.store.areas.get(society.areaId) : null;
    const operator = order.assignedOperatorUserId ? await this.store.users.get(order.assignedOperatorUserId) : null;
    const subscription = order.subscriptionId ? await this.store.subscriptions.get(order.subscriptionId) : null;
    const plan = subscription ? await this.store.plans.get(subscription.planId) : null;
    const slot = await this.slotFor(order);
    const issues = await this.issues.list({ orderId: order.id });
    const reached = order.timeline.map((t) => t.state);
    return {
      ...order,
      residentName: residentUser?.fullName ?? null,
      residentPhone: residentUser?.phone ?? null,
      unitNumber: resident?.unitNumber ?? null,
      pickupAddress: resident?.pickupAddress ?? resident?.address ?? null,
      societyName: society?.name ?? null,
      areaName: area?.name ?? null,
      operatorName: operator?.fullName ?? null,
      planTier: plan?.tier ?? null,
      hasSubscription: Boolean(subscription && plan && subscription.status === "active"),
      remainingAllowance: subscription && plan && subscription.status === "active" ? remainingAllowance(plan.garmentCap, subscription.garmentsUsed) : 0,
      servicesPaise: order.servicesPaise ?? 0,
      lines: order.lines ?? [],
      turnaroundHours: plan?.turnaroundHours ?? config.defaultTurnaroundHours,
      ironingStarted: ironingStarted(order),
      slot: slot ? { id: slot.id, date: slot.date, window: slot.window, startTime: slot.startTime, endTime: slot.endTime } : null,
      delayed: this.isDelayed(order, config.delayGraceHours),
      delayMinutes: this.delayMinutes(order),
      stages: timelineStages(order.state, reached, lifecycleFor(this.requirementOf(order)), {
        in_wash: CLEAN_STAGE_LABELS[this.requirementOf(order).cleanStage],
      }),
      // What this batch has to go through, and the operator actions that are legal
      // right now. The portal renders these rather than a fixed wash then iron list.
      processing: {
        ...this.requirementOf(order),
        cleanLabel: CLEAN_STAGE_LABELS[this.requirementOf(order).cleanStage],
        lines: (order.lines ?? []).map((line) => ({
          id: line.id, category: line.category, quantity: line.quantity,
          // What was actually received, beside what was asked for, so the two are
          // never conflated into one number.
          acceptedQuantity: line.acceptedQuantity ?? null,
          serviceName: line.serviceName, coveredByPlan: line.coveredByPlan ?? false,
          stages: lineStages(line),
        })),
      },
      // The batches on the floor: one per Garment + Service combination, each with
      // its own sequence and its own progress. Rendered instead of a single fixed
      // wash-then-iron list that applies to no order in particular.
      batches: (order.batches ?? []).map(describeBatch),
      nextActions: this.nextActions(order),
      issues,
    };
  }

  async slotFor(order: Order) {
    if (!order.pickupId) return null;
    const pickup = await this.store.pickups.get(order.pickupId);
    if (!pickup) return null;
    return this.store.slots.get(pickup.slotId);
  }

  // The compact row every list view renders. Resolved in bulk so a long list costs
  // one pass over each collection rather than a lookup per order.
  async summarise(orders: Order[]) {
    const config = await this.systemConfig.get();
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const residents = new Map((await this.store.residents.all()).map((r) => [r.id, r]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    return orders.map((order) => {
      const resident = residents.get(order.residentId);
      const residentUser = resident ? users.get(resident.userId) : null;
      return {
        id: order.id, orderCode: order.orderCode, state: order.state, createdAt: order.createdAt,
        residentId: order.residentId, residentName: residentUser?.fullName ?? null, residentPhone: residentUser?.phone ?? null,
        unitNumber: resident?.unitNumber ?? null,
        societyId: order.societyId, societyName: societies.get(order.societyId)?.name ?? null,
        areaId: order.areaId,
        acceptedCount: order.acceptedCount, subscriptionCoveredCount: order.subscriptionCoveredCount,
        additionalCount: order.additionalCount, additionalChargePaise: order.additionalChargePaise,
        additionalChargeStatus: order.additionalChargeStatus,
        payPerOrder: order.payPerOrder ?? false,
        servicesPaise: order.servicesPaise ?? 0,
        assignedOperatorUserId: order.assignedOperatorUserId,
        operatorName: order.assignedOperatorUserId ? users.get(order.assignedOperatorUserId)?.fullName ?? null : null,
        qcPassed: order.qcPassed, qcReason: order.qcReason,
        pickupFailureReason: order.pickupFailureReason,
        expectedCompletionAt: order.expectedCompletionAt,
        // What the resident was told at booking. Kept beside the operational
        // estimate so a change can be compared with the promise rather than
        // quietly replacing it.
        estimatedDeliveryAt: order.estimatedDeliveryAt ?? null,
        scheduledPickupAt: order.scheduledPickupAt ?? null,
        earlyPickup: order.earlyPickup ?? false,
        pickedUpAt: order.pickedUpAt, deliveredAt: order.deliveredAt,
        ironingStarted: ironingStarted(order),
        processing: orderRequirement(order.lines ?? []),
        nextActions: this.nextActions(order),
        delayed: this.isDelayed(order, config.delayGraceHours),
        delayMinutes: this.delayMinutes(order),
      };
    });
  }

  async tracking(orderId: string) {
    const order = await this.get(orderId);
    const reached = order.timeline.map((t) => t.state);
    return {
      orderCode: order.orderCode, state: order.state, timeline: order.timeline, items: order.items,
      stages: timelineStages(order.state, reached, lifecycleFor(this.requirementOf(order)), {
        in_wash: CLEAN_STAGE_LABELS[this.requirementOf(order).cleanStage],
      }),
      acceptedCount: order.acceptedCount,
      subscriptionCoveredCount: order.subscriptionCoveredCount,
      additionalCount: order.additionalCount,
      additionalChargePaise: order.additionalChargePaise,
      additionalChargeStatus: order.additionalChargeStatus,
      payPerOrder: order.payPerOrder ?? false,
      servicesPaise: order.servicesPaise ?? 0,
      lines: order.lines ?? [],
      // A monotonic marker the resident app polls, so it can tell a genuine change
      // from an identical response without diffing the whole order.
      revision: order.timeline.length,
      updatedAt: order.timeline[order.timeline.length - 1]?.at ?? order.createdAt,
    };
  }
}

export const IRONING_STARTED_NOTE = "Ironing started";

export function ironingStarted(order: Order): boolean {
  return order.timeline.some((entry) => entry.note === IRONING_STARTED_NOTE);
}

export { ACTIVE_STATES, PROCESSING_STATES };
