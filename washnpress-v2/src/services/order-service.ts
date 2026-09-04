import { Account } from "../domain/accounts";
import { computeGst } from "../domain/tax";
import { AllowanceLedger, applyLedger } from "../domain/plan-usage";
import type { QcFailureReason } from "../domain/qc";
import {
  assertDiscrepancy, buildDiscrepancy, residentMessage,
  type DiscrepancyReason, type QuantityDiscrepancy,
} from "../domain/discrepancy";
import { generateQrBatchCode } from "../domain/codes";
import { remainingAllowance, totalQuantity } from "../domain/garments";
import {
  applyCoverage,
  repriceLine,
  coveredEligibleQuantity, garmentsChargePaise, linesTotalPaise, priceOrder,
  reconcileLines, additionalChargeFromLines,
  type OrderCharge, type LineReconciliation,
} from "../domain/pricing";
import {
  batchesForLines, completeStep, recordQc, describeBatch, orderStageFromBatches,
  intermediateStageFromBatches,
} from "../domain/batches";
import { canTransition, transition, timelineStages, ACTIVE_STATES, PROCESSING_STATES, STATE_LABELS, type OrderState } from "../domain/order-state-machine";
import {
  allowedNext, isAllowedNext, lifecycleFor, lineStages, orderRequirement,
  CLEAN_STAGE_ACTIONS, CLEAN_STAGE_LABELS, type ProcessingRequirement,
} from "../domain/processing";
import type { BatchStep, GarmentItem, Order, OrderLine, Session, Subscription } from "../domain/models";
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

// What the operator confirms for one Garment + Service combination: how many
// garments, and — where the service is weighed or timed rather than counted — how
// much of it there actually was.
export interface LineQuantity {
  lineId: string;
  acceptedQuantity: number;
  acceptedMeasuredQuantity?: number | null;
}

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

  // Which subscription this order draws on.
  //
  // The link is stamped when the order is booked, but the plan a resident is on when
  // their garments are actually collected is the plan that should pay for them. A
  // resident who booked a collection and then took out a plan was charged the pay
  // per garment rate for garments taken days into that plan, and the plan's usage
  // never moved — the order was still pointing at the nothing that existed when it
  // was made. The reverse holds too: a plan cancelled between booking and collection
  // is not a plan that can pay.
  private async subscriptionForOrder(order: Order): Promise<Subscription | null> {
    const stamped = order.subscriptionId ? await this.store.subscriptions.get(order.subscriptionId) : null;
    if (stamped && stamped.status === "active") return stamped;
    const live = await this.store.subscriptions.find(
      (sub) => sub.residentId === order.residentId && sub.status === "active");
    return live[0] ?? null;
  }

  // Rules 1 to 3. The operator supplies only the accepted quantity; the covered
  // quantity, the additional quantity and the charge are all derived here. A
  // resident without an active plan pays the ordinary per garment price instead.
  async previewSplit(orderId: string, items: GarmentItem[]): Promise<OrderCharge & { planTier: string | null; remainingAllowance: number; additionalRatePaise: number; additionalChargePaise: number; subscriptionCoveredCount: number; additionalCount: number; acceptedCount: number }> {
    const order = await this.get(orderId);
    const config = await this.systemConfig.get();
    const accepted = totalQuantity(items);
    const subscription = await this.subscriptionForOrder(order);
    const plan = subscription ? await this.store.plans.get(subscription.planId) : null;
    const hasSubscription = Boolean(subscription && plan && subscription.status === "active");
    const remaining = hasSubscription ? remainingAllowance(plan!.garmentCap, subscription!.garmentsUsed) : 0;

    // A plan that names its services governs the whole charge: each line is split
    // against that service's own allowance and the remainder billed at that
    // service's own overage rate. There is no separate per garment charge on top of
    // it — that belonged to the single shared cap this replaced, and adding both
    // would bill the same washing twice.
    // Only where there are lines to govern. An order booked as a bare garment count
    // names no service, so there is no service allowance to draw it from and the
    // plan's overall cap still applies to it.
    const ledger = hasSubscription && (order.lines?.length ?? 0) > 0
      ? new AllowanceLedger(plan, subscription)
      : null;
    if (ledger?.active) {
      // A line that already carries a split was settled when the pickup was
      // confirmed, and the subscription has already been charged for it. Covering it
      // again against the balance that charge produced would bill all of it twice.
      const settled = (order.lines ?? []).every((l) => l.coveredQuantity != null);
      const covered = settled ? order.lines ?? [] : applyCoverage(order.lines ?? [], ledger);
      const servicesPaise = linesTotalPaise(covered);
      // Counted in garments for the screens that still speak in garments.
      const coveredCount = covered.reduce(
        (sum, l) => sum + ((l.coveredQuantity ?? 0) > 0 ? (l.acceptedQuantity ?? l.quantity) : 0), 0);
      return {
        acceptedCount: accepted,
        subscriptionCoveredCount: Math.min(accepted, coveredCount),
        additionalCount: Math.max(0, accepted - Math.min(accepted, coveredCount)),
        ratePaise: config.additionalGarmentRatePaise,
        garmentChargePaise: 0,
        servicesPaise,
        totalPaise: servicesPaise,
        payPerOrder: false,
        additionalRatePaise: config.additionalGarmentRatePaise,
        additionalChargePaise: servicesPaise,
        planTier: plan?.tier ?? null,
        remainingAllowance: remaining,
      };
    }

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
    const byLine = new Map(accepted.map((a) => [a.lineId, a]));
    const acceptedOf = (line: OrderLine) => {
      const entry = byLine.get(line.id);
      return entry ? Math.max(0, Math.trunc(entry.acceptedQuantity)) : line.acceptedQuantity ?? line.quantity;
    };
    const measuredOf = (line: OrderLine) => byLine.get(line.id)?.acceptedMeasuredQuantity ?? null;

    const lines = reconcileLines(order.lines ?? [], acceptedOf, config.garmentPricesPaise, config.nonSubscriberGarmentRatePaise, measuredOf);
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
  async qcBatch(
    orderId: string,
    batchId: string,
    passed: boolean,
    actor: OrderActor,
    // A failure has to say why. The reason decides where the work goes back to,
    // whether a supervisor is involved and whether the resident hears about it.
    failure?: { reason: QcFailureReason; remarks: string; evidenceUrl?: string | null },
  ): Promise<Order> {
    const order = await this.get(orderId);
    const batch = (order.batches ?? []).find((b) => b.id === batchId);
    if (!batch) throw new BatchNotFoundError();
    const { outcome } = recordQc(batch, passed, actor.userId, failure);
    order.batches = [...order.batches];

    const note = passed
      ? `QC passed for ${batch.quantity} x ${batch.category} (${batch.serviceName})`
      : `QC failed for ${batch.quantity} x ${batch.category} (${batch.serviceName}): ${batch.qcReason}. ${outcome?.correctiveLabel ?? ""}`.trim();

    const saved = await this.syncOrderToBatches(order, actor, note);

    if (outcome) {
      // A supervisor is told when the failure is serious, or when this batch has now
      // failed more than once — repeated failures are a different problem from a
      // first one and are not fixed by retrying again.
      if (outcome.needsSupervisor) {
        await this.notifications.notifyRoleInSociety(saved.societyId ?? null, "supervisor", {
          type: "qc.failed",
          orderId: saved.id,
          title: outcome.attempt > 1
            ? `QC failed ${outcome.attempt} times — ${saved.orderCode}`
            : `QC failure needs review — ${saved.orderCode}`,
          body: `${outcome.reasonLabel}: ${outcome.remarks}. ${outcome.correctiveLabel}.`,
        });
      }
      // The resident hears about it when it touches their garments, their delivery
      // date or the outcome of their order — not for a shirt that needs another pass
      // of the iron.
      if (outcome.notifyResident && saved.residentId) {
        await this.notifications.notifyResident(saved.residentId, {
          type: "qc.failed",
          orderId: saved.id,
          title: `We found a problem with your order ${saved.orderCode}`,
          body: `${outcome.reasonLabel}. ${outcome.remarks} We are looking into it and will keep you posted.`,
        });
      }
    }

    return saved;
  }

  // The order's own state follows from its batches rather than being set beside
  // them, so an order can never claim to be ready for delivery while a batch is
  // still in a machine.
  private async syncOrderToBatches(order: Order, actor: OrderActor, note: string): Promise<Order> {
    const stage = orderStageFromBatches(order.batches ?? []);
    // A batch held for a person is on hold just as surely as one that failed and is
    // being redone — more so, since nothing is happening to it at all.
    const stopped = stage.anyFailed || stage.anyHeld;
    // The order advances only when *every* batch has finished its whole sequence. One
    // batch finishing is not an order finishing, and nobody should have to press a
    // button to say so once the last one does.
    const target: OrderState | null = stopped
      ? "qc_hold"
      : stage.allComplete
        ? "ready_for_delivery"
        : null;

    if (target && target !== order.state) {
      order.qcPassed = stopped ? false : stage.allComplete ? true : order.qcPassed;
      if (stopped) {
        order.qcReason = (order.batches ?? []).find((b) => b.status === "qc_failed" || b.status === "held")?.qcReason ?? null;
        order.qcAttempts += 1;
      } else if (stage.allComplete) {
        order.qcReason = null;
      }
      // Forced, because the order state is a summary of the batches rather than a
      // separate machine that has to be walked one legal step at a time.
      //
      // When the last batch finishes, the order says so in its own words: an operator
      // should not have to go back and press something to move an order whose work is
      // demonstrably done.
      const stageNote = target === "ready_for_delivery"
        ? `${note} — all ${stage.completed} batches completed, so the order is ready for delivery.`
        : note;
      order.timeline.push({ state: target, at: new Date().toISOString(), note: stageNote, actorUserId: actor.userId });
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

    // Not stopped and not finished: the order is somewhere in washing, ironing or the
    // checks. Its state follows the least-advanced batch so every portal — the
    // operator's Active list most of all — shows it at the stage it is genuinely at,
    // instead of leaving it at Picked Up until the whole order fails or finishes. The
    // state is a summary of the batches, so this is set forcibly rather than walked
    // through the state machine one legal step at a time.
    const midway = intermediateStageFromBatches(order.batches ?? []);
    if (midway && midway !== order.state) {
      order.timeline.push({ state: midway, at: new Date().toISOString(), note, actorUserId: actor.userId });
      order.state = midway;
      return this.store.orders.put(order);
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
    options: {
      early?: boolean;
      earlyReason?: string;
      // Why the count differs from what the resident declared. Required whenever it
      // does; the operator must not be able to confirm a mismatched pickup silently.
      discrepancy?: { reason?: string; remarks?: string };
    } = {},
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
      const byLine = new Map(acceptedLines.map((a) => [a.lineId, a]));
      // Repriced from what was actually weighed or counted, so a bag guessed at 3 kg
      // that turns out to be 3.4 kg is billed for 3.4 kg.
      order.lines = order.lines.map((line) => {
        const entry = byLine.get(line.id);
        return repriceLine(line, entry?.acceptedQuantity ?? 0, entry?.acceptedMeasuredQuantity ?? null);
      });
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
      order.lines = order.lines.map((line) =>
        // No measurement was given, so a weighed line keeps the quantity it was
        // booked with rather than being guessed at from a garment count.
        repriceLine(line, given.get(line.category) ?? 0, null));
      items = linesToAcceptedItems(order.lines);
    }

    const accepted = totalQuantity(items);
    if (!items.length || accepted <= 0) throw new QuantityRequiredError();

    // What the resident declared when they booked, against what was actually counted.
    // A difference is not an error to be quietly resolved in the operator's favour:
    // it is a discrepancy, and it has to be explained, communicated and kept.
    //
    // A *declaration* is the per-service lines a resident chose: "five shirts for
    // washing" is a statement about what is in the bag. A bare estimated count is
    // not — the booking screen says in as many words that the operator confirms the
    // final quantity — so an order booked without lines is not held to it.
    const declared = (order.lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
    const requested = order.requestedCount ?? (hasLines ? declared : 0);
    if (requested > 0) order.requestedCount = requested;

    let discrepancy: QuantityDiscrepancy | null = null;
    if (requested > 0 && accepted !== requested) {
      // The operator must not be able to confirm a mismatched pickup without saying
      // why. Without that the resident is left with two missing shirts and nobody to
      // ask about them.
      assertDiscrepancy(options.discrepancy ?? {});
      discrepancy = buildDiscrepancy({
        requested,
        received: accepted,
        reason: options.discrepancy!.reason as DiscrepancyReason,
        remarks: options.discrepancy!.remarks!,
        actorUserId: actor.userId,
      });
      order.quantityDiscrepancy = discrepancy;
      order.discrepancyReason = `${discrepancy.reasonLabel}: ${discrepancy.remarks}`;
    }

    // The lines are priced against the plan with the quantities that actually
    // arrived, and that same split is what gets stored on the order.
    const orderSubscription = await this.subscriptionForOrder(order);
    // Recorded on the order, so it says which plan actually paid for it rather than
    // which plan happened to exist when it was booked.
    if (orderSubscription && orderSubscription.id !== order.subscriptionId) {
      order.subscriptionId = orderSubscription.id;
      await this.store.orders.put(order);
    }
    const orderPlan = orderSubscription ? await this.store.plans.get(orderSubscription.planId) : null;
    const pickupLedger = orderSubscription && orderPlan && orderSubscription.status === "active"
      && (order.lines?.length ?? 0) > 0
      ? new AllowanceLedger(orderPlan, orderSubscription)
      : null;
    if (pickupLedger?.active) {
      order.lines = applyCoverage(order.lines ?? [], pickupLedger);
      // What this order actually used, recorded service by service, so washing never
      // spends the allowance meant for ironing.
      applyLedger(orderSubscription!, pickupLedger);
      await this.store.subscriptions.put(orderSubscription!);
    }

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
    if (!order.assignedOperatorUserId) {
      order.assignedOperatorUserId = actor.userId;
      order.assignmentHistory = [
        ...(order.assignmentHistory ?? []),
        {
          at: new Date().toISOString(), fromUserId: null, toUserId: actor.userId,
          byUserId: actor.userId, note: "Took the order by collecting it",
        },
      ];
    }
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
      await this.subscriptions.deductGarments(
        order.subscriptionId, split.subscriptionCoveredCount,
        { id: order.id, orderCode: order.orderCode },
      );
    }
    if (split.totalPaise > 0) await this.settleAdditionalCharge(updated);

    if (pickup) { pickup.status = "completed"; await this.store.pickups.put(pickup); }

    await this.notifications.notifyResident(order.residentId, {
      type: "order.picked_up", orderId: order.id, title: "Garments collected",
      body: split.payPerOrder
        ? `${accepted} garments collected for order ${order.orderCode}. Charged at the pay per garment rate.`
        : `${accepted} garments collected for order ${order.orderCode}. ${split.subscriptionCoveredCount} covered by your plan, ${split.additionalCount} additional.`,
    });
    await this.notifications.notifyRoleInSociety(order.societyId, "supervisor", {
      type: "order.picked_up", orderId: order.id, title: "Pickup completed",
      body: `Order ${order.orderCode} picked up with ${accepted} garments.`,
    });

    // Whenever the count differs from what the resident declared, they hear about it
    // — with both numbers, and with something they can act on.
    if (discrepancy) {
      await this.notifications.notifyResident(order.residentId, {
        type: "pickup.discrepancy",
        orderId: order.id,
        title: discrepancy.direction === "short" ? "Pickup quantity discrepancy" : "Extra garments collected",
        body: residentMessage(discrepancy),
      });
      await this.notifications.notifyRoleInSociety(order.societyId, "supervisor", {
        type: "pickup.discrepancy",
        orderId: order.id,
        title: `Quantity discrepancy on ${order.orderCode}`,
        body: `Declared ${discrepancy.requested}, collected ${discrepancy.received}. ${discrepancy.reasonLabel}: ${discrepancy.remarks}`,
      });
    }

    return updated;
  }

  // The resident's answer to a discrepancy: they accept it, or they say it is wrong.
  // Either way it stays on the record — acknowledging one does not erase it, and
  // disputing one does not change the count that was verified.
  async answerDiscrepancy(
    orderId: string,
    answer: "acknowledged" | "disputed",
    actor: OrderActor,
    note?: string,
  ): Promise<Order | null> {
    const order = await this.get(orderId);
    if (!order.quantityDiscrepancy) return null;
    order.quantityDiscrepancy = {
      ...order.quantityDiscrepancy,
      acknowledgement: answer,
      acknowledgedAt: new Date().toISOString(),
      disputeNote: answer === "disputed" ? (note?.trim() || null) : null,
    };
    order.timeline.push({
      state: order.state,
      at: new Date().toISOString(),
      note: answer === "acknowledged"
        ? "Resident acknowledged the quantity discrepancy."
        : `Resident disputed the quantity discrepancy${note?.trim() ? `: ${note.trim()}` : "."}`,
      actorUserId: actor.userId,
    });
    const saved = await this.store.orders.put(order);

    // A dispute is somebody's problem now, so it goes to the supervisor rather than
    // sitting on the order waiting to be noticed.
    if (answer === "disputed") {
      await this.notifications.notifyRoleInSociety(saved.societyId, "supervisor", {
        type: "pickup.discrepancy_disputed",
        orderId: saved.id,
        title: `Discrepancy disputed on ${saved.orderCode}`,
        body: note?.trim() || "The resident does not accept the recorded quantity.",
      });
    }
    return saved;
  }

  // The charge is taken from the wallet when it can cover it. If it cannot, the
  // charge stays pending and the resident is told, rather than blocking the pickup.
  // Settling what the order owes, and keeping what happened.
  //
  // A charge that fails posts nothing to the ledger, so the only record of the
  // attempt used to be a status field that the next attempt overwrote. A resident
  // who topped up and paid on the third try had no way to see the first two, and
  // neither did anybody looking into it for them.
  private async settleAdditionalCharge(order: Order, kind: "charge" | "retry" = "charge"): Promise<void> {
    const amount = order.additionalChargePaise ?? 0;
    if (amount <= 0) return;
    // GST on the charge, where the deployment has it switched on. The resident pays
    // the charge plus the tax; the tax is recorded on the order and posted to
    // TaxPayable so revenue stays the pre-tax figure it always was.
    const config = await this.systemConfig.get();
    const gst = computeGst(amount, config);
    order.taxPaise = gst.taxPaise;
    const reference = `addl-garments-${order.id}`;
    let note: string | null = null;
    try {
      await this.wallet.chargeWithTax(order.residentId, amount, gst.taxPaise, Account.AddonRevenue, reference);
      order.additionalChargeStatus = "paid";
    } catch (error) {
      const short = error instanceof InsufficientBalanceError;
      order.additionalChargeStatus = short ? "pending" : "failed";
      note = short ? "Not enough in the wallet" : (error as Error).message;
      const duePaise = amount + gst.taxPaise;
      await this.notifications.notifyResident(order.residentId, {
        type: "payment.additional_charge_due", orderId: order.id, title: "Additional garment charge due",
        body: `Order ${order.orderCode} has an additional charge of ${(duePaise / 100).toFixed(2)} rupees. Top up your wallet to settle it.`,
      });
    }
    order.paymentEvents = [
      ...(order.paymentEvents ?? []),
      {
        at: new Date().toISOString(), kind, amountPaise: amount + gst.taxPaise,
        status: order.additionalChargeStatus === "paid" ? "paid"
          : order.additionalChargeStatus === "failed" ? "failed" : "pending",
        note, reference: order.additionalChargeStatus === "paid" ? reference : null,
      },
    ];
    await this.store.orders.put(order);
  }

  async payAdditionalCharge(orderId: string): Promise<Order> {
    const order = await this.get(orderId);
    if (order.additionalChargeStatus !== "pending" && order.additionalChargeStatus !== "failed") return order;
    await this.settleAdditionalCharge(order, "retry");
    return this.get(orderId);
  }

  private async computeExpectedCompletion(order: Order): Promise<string> {
    const config = await this.systemConfig.get();
    const subscription = await this.subscriptionForOrder(order);
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
      residentId: order.residentId, orderId: order.id, societyId: order.societyId,
      category: "pickup_failed", description: reason, priority: "high",
      reportedByUserId: actor.userId, reportedByRole: "operator",
    });
    await this.notifications.notifyResident(order.residentId, {
      type: "pickup.failed", orderId: order.id, title: "Pickup could not be completed", body: `Order ${order.orderCode}: ${reason}.`,
    });
    await this.notifications.notifyRoleInSociety(order.societyId, "supervisor", {
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
      residentId: order.residentId, orderId: order.id, societyId: order.societyId,
      category: "qc_fail", description: order.qcReason, priority: "high",
      reportedByUserId: actor.userId, reportedByRole: "operator",
    });
    await this.notifications.notifyRoleInSociety(order.societyId, "supervisor", {
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
        residentId: order.residentId, orderId: order.id, societyId: order.societyId,
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
      residentId: order.residentId, orderId: order.id, societyId: order.societyId,
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
    // Who held it before, and who holds it now. The order carries one operator, and
    // a single field cannot answer "who had this yesterday" — which is the question
    // asked whenever something went wrong on a day nobody remembers.
    order.assignmentHistory = [
      ...(order.assignmentHistory ?? []),
      {
        at: new Date().toISOString(),
        fromUserId: previousOperatorUserId,
        toUserId: operatorUserId,
        byUserId: actor?.userId ?? null,
        note: note ?? null,
      },
    ];
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
    const block = order.blockId ? await this.store.blocks.get(order.blockId) : null;
    const operator = order.assignedOperatorUserId ? await this.store.users.get(order.assignedOperatorUserId) : null;
    const subscription = await this.subscriptionForOrder(order);
    const plan = subscription ? await this.store.plans.get(subscription.planId) : null;
    const slot = await this.slotFor(order);
    const issues = await this.issues.list({ orderId: order.id });
    const reached = order.timeline.map((t) => t.state);
    // The GST recorded on the order, split into its statutory halves for the
    // invoice. The tax was fixed when the charge settled and is read off the order,
    // not recomputed from today's rate — a rate change must not rewrite an old bill.
    const taxPaise = order.taxPaise ?? 0;
    const cgstPaise = Math.floor(taxPaise / 2);
    const sgstPaise = taxPaise - cgstPaise;
    return {
      ...order,
      residentName: residentUser?.fullName ?? null,
      residentPhone: residentUser?.phone ?? null,
      unitNumber: resident?.unitNumber ?? null,
      pickupAddress: resident?.pickupAddress ?? resident?.address ?? null,
      societyName: society?.name ?? null,
      // Which tower it was collected from. This used to be the area the society sat
      // in, which was one level too coarse to tell anybody where to go.
      blockName: block?.name ?? resident?.towerBlock ?? null,
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
          // What this line is measured in, and how much of it there is in that unit.
          // A weighed line is settled by weight, so the operator has to be told the
          // estimate and asked for the actual rather than only counting garments.
          unit: line.unit ?? "piece",
          measuredQuantity: line.measuredQuantity ?? null,
          acceptedMeasuredQuantity: line.acceptedMeasuredQuantity ?? null,
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
      // ------------------------------------------------------------- the history
      //
      // These panels used to be a column of dashes. Every one of these facts was
      // either recorded and not read, or derivable and not derived, so an admin
      // looking into a disputed order saw blanks where the answer was.

      // What was asked for, what turned up, and the difference between them. Both
      // numbers are kept: one is what the resident expected, the other is what the
      // operator verified, and collapsing them into one loses the question.
      quantityHistory: {
        residentEstimate: order.requestedCount ?? order.estimatedCount ?? null,
        operatorReceived: order.acceptedCount,
        difference: order.acceptedCount != null && (order.requestedCount ?? order.estimatedCount) != null
          ? order.acceptedCount - (order.requestedCount ?? order.estimatedCount)!
          : null,
        recordedAt: order.pickedUpAt,
        recordedByUserId: order.assignedOperatorUserId,
        recordedByName: operator?.fullName ?? null,
        discrepancy: order.quantityDiscrepancy ?? null,
        deliveredCount: order.deliveryCount,
      },
      // What this order came to, itemised, so a total is never the only figure on
      // the page.
      charges: {
        subscriptionCoveredCount: order.subscriptionCoveredCount,
        additionalCount: order.additionalCount,
        additionalRatePaise: order.additionalRatePaise,
        additionalChargePaise: order.additionalChargePaise ?? 0,
        servicesPaise: order.servicesPaise ?? 0,
        // The GST taken on the charge, split into its two halves so an invoice can
        // print CGST and SGST as separate lines. Zero on an untaxed order, and the
        // total then equals the charge, exactly as before GST existed.
        taxPaise,
        cgstPaise,
        sgstPaise,
        // What the resident actually pays: the charge and the tax on it.
        totalPaise: (order.additionalChargePaise ?? 0) + taxPaise,
        payPerOrder: order.payPerOrder ?? false,
        status: order.additionalChargeStatus,
      },
      // Every attempt to settle it, in order, with the ledger reference for the one
      // that worked.
      paymentHistory: await this.paymentHistory(order),
      // Who has held it, by name.
      assignmentHistory: await this.assignmentHistory(order),
      // Where it has been. The timeline is the record; this names the actors.
      statusHistory: await this.statusHistory(order),
    };
  }

  // The money, from the order's own record of what it attempted and from the ledger
  // entry that actually moved it.
  private async paymentHistory(order: Order) {
    const events = order.paymentEvents ?? [];
    if (events.length === 0 && (order.additionalChargePaise ?? 0) > 0) {
      // An order charged before attempts were recorded still has a status, and that
      // status is a fact worth showing rather than an empty panel.
      return [{
        at: order.pickedUpAt ?? order.createdAt,
        kind: "charge" as const,
        amountPaise: order.additionalChargePaise ?? 0,
        status: order.additionalChargeStatus === "paid" ? "paid" as const
          : order.additionalChargeStatus === "failed" ? "failed" as const : "pending" as const,
        note: "Recorded before payment attempts were kept",
        reference: null,
      }];
    }
    return events;
  }

  private async assignmentHistory(order: Order) {
    const entries = order.assignmentHistory ?? [];
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.fromUserId) ids.add(entry.fromUserId);
      if (entry.toUserId) ids.add(entry.toUserId);
      if (entry.byUserId) ids.add(entry.byUserId);
    }
    const names = new Map<string, string | null>();
    for (const id of ids) names.set(id, (await this.store.users.get(id))?.fullName ?? null);
    return entries.map((entry) => ({
      ...entry,
      fromName: entry.fromUserId ? names.get(entry.fromUserId) ?? null : null,
      toName: entry.toUserId ? names.get(entry.toUserId) ?? null : null,
      byName: entry.byUserId ? names.get(entry.byUserId) ?? null : null,
    }));
  }

  private async statusHistory(order: Order) {
    const raw = order.timeline ?? [];
    const ids = new Set(raw.map((t) => t.actorUserId).filter((id): id is string => Boolean(id)));
    const names = new Map<string, string | null>();
    for (const id of ids) names.set(id, (await this.store.users.get(id))?.fullName ?? null);
    // One row per stage the order reached, not one per batch step. A multi-batch order
    // records a timeline entry every time any batch finishes a step, so the raw record
    // reads as the same status repeated — "washing, washing, washing" — one line per
    // garment rather than one per stage. The reader wants the stages the order moved
    // through and when each was first reached, so consecutive entries in the same state
    // fold into the moment that state was entered. A stage re-entered after a hold is a
    // genuine new row, so only *consecutive* repeats are folded, never the whole run.
    const grouped: Array<(typeof raw)[number] & { actorName: string | null; label: string }> = [];
    for (const entry of raw) {
      const last = grouped[grouped.length - 1];
      if (last && last.state === entry.state) continue;
      grouped.push({
        ...entry,
        actorName: entry.actorUserId ? names.get(entry.actorUserId) ?? null : null,
        label: STATE_LABELS[entry.state as OrderState] ?? entry.state,
      });
    }
    return grouped;
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
    const blocks = new Map((await this.store.blocks.all()).map((b) => [b.id, b]));
    return orders.map((order) => {
      const resident = residents.get(order.residentId);
      const residentUser = resident ? users.get(resident.userId) : null;
      return {
        id: order.id, orderCode: order.orderCode, state: order.state, createdAt: order.createdAt,
        residentId: order.residentId, residentName: residentUser?.fullName ?? null, residentPhone: residentUser?.phone ?? null,
        unitNumber: resident?.unitNumber ?? null,
        societyId: order.societyId, societyName: societies.get(order.societyId)?.name ?? null,
        blockId: order.blockId ?? null,
        blockName: order.blockId ? blocks.get(order.blockId)?.name ?? null : resident?.towerBlock ?? null,
        acceptedCount: order.acceptedCount, subscriptionCoveredCount: order.subscriptionCoveredCount,
        additionalCount: order.additionalCount, additionalChargePaise: order.additionalChargePaise,
        additionalChargeStatus: order.additionalChargeStatus,
        payPerOrder: order.payPerOrder ?? false,
        servicesPaise: order.servicesPaise ?? 0,
        assignedOperatorUserId: order.assignedOperatorUserId,
        operatorName: order.assignedOperatorUserId ? users.get(order.assignedOperatorUserId)?.fullName ?? null : null,
        qcPassed: order.qcPassed, qcReason: order.qcReason,
        // Whether this order is worked as batches, and how far they have got. An
        // order that has batches is a batch-wise order for good: reopening it must
        // show the same processing view it showed the moment it was collected, and a
        // screen cannot know that without being told.
        batchCount: (order.batches ?? []).length,
        batchesCompleted: (order.batches ?? []).filter((b) => b.status === "completed").length,
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
