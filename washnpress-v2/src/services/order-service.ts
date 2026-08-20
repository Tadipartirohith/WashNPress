import { Account } from "../domain/accounts";
import { generateQrBatchCode } from "../domain/codes";
import { splitGarments, remainingAllowance, totalQuantity, type GarmentSplit } from "../domain/garments";
import { canTransition, transition, timelineStages, ACTIVE_STATES, PROCESSING_STATES, type OrderState } from "../domain/order-state-machine";
import type { GarmentItem, Order, Session } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { NotificationService } from "./notification-service";
import type { IssueService } from "./issue-service";
import type { SubscriptionService } from "./subscription-service";
import type { SystemConfigService } from "./system-config-service";
import type { WalletService } from "./wallet-service";
import { InsufficientBalanceError } from "./wallet-service";

export class OrderNotFoundError extends Error {
  constructor() { super("Order not found"); this.name = "OrderNotFoundError"; }
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

  private async apply(order: Order, to: OrderState, ctx: Record<string, unknown> = {}, note?: string, actorUserId?: string): Promise<Order> {
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
  // quantity, the additional quantity and the charge are all derived here.
  async previewSplit(orderId: string, items: GarmentItem[]): Promise<GarmentSplit & { planTier: string | null; remainingAllowance: number }> {
    const order = await this.get(orderId);
    const accepted = totalQuantity(items);
    const rate = await this.systemConfig.additionalGarmentRatePaise();
    const subscription = order.subscriptionId ? await this.store.subscriptions.get(order.subscriptionId) : null;
    const plan = subscription ? await this.store.plans.get(subscription.planId) : null;
    const remaining = subscription && plan && subscription.status === "active"
      ? remainingAllowance(plan.garmentCap, subscription.garmentsUsed)
      : 0;
    return {
      ...splitGarments({ acceptedCount: accepted, remainingAllowance: remaining, additionalRatePaise: rate }),
      planTier: plan?.tier ?? null,
      remainingAllowance: remaining,
    };
  }

  // ------------------------------------------------------------------- pickup

  // Rule 4. Subscription usage is finalised from the accepted quantity at pickup,
  // never from the booking estimate the resident entered.
  async markPickedUp(orderId: string, items: GarmentItem[], actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    const accepted = totalQuantity(items);
    if (!items.length || accepted <= 0) throw new QuantityRequiredError();

    const split = await this.previewSplit(orderId, items);
    order.items = items;
    order.pickupCount = accepted;
    order.acceptedCount = accepted;
    order.subscriptionCoveredCount = split.subscriptionCoveredCount;
    order.additionalCount = split.additionalCount;
    order.additionalRatePaise = split.additionalRatePaise;
    order.additionalChargePaise = split.additionalChargePaise;
    order.additionalChargeStatus = split.additionalChargePaise > 0 ? "pending" : "none";
    order.qrBatchCode = order.qrBatchCode ?? generateQrBatchCode();
    order.assignedOperatorUserId = order.assignedOperatorUserId ?? actor.userId;
    order.pickedUpAt = new Date().toISOString();
    order.expectedCompletionAt = await this.computeExpectedCompletion(order);

    const updated = await this.apply(order, "picked_up", {}, `Accepted ${accepted} garments (QR ${order.qrBatchCode})`, actor.userId);

    if (order.subscriptionId && split.subscriptionCoveredCount > 0) {
      await this.subscriptions.deductGarments(order.subscriptionId, split.subscriptionCoveredCount);
    }
    if (split.additionalChargePaise > 0) await this.settleAdditionalCharge(updated);

    const pickup = order.pickupId ? await this.store.pickups.get(order.pickupId) : null;
    if (pickup) { pickup.status = "completed"; await this.store.pickups.put(pickup); }

    await this.notifications.notifyResident(order.residentId, {
      type: "order.picked_up", orderId: order.id, title: "Garments collected",
      body: `${accepted} garments collected for order ${order.orderCode}. ${split.subscriptionCoveredCount} covered by your plan, ${split.additionalCount} additional.`,
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

  async startWash(orderId: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    const updated = await this.apply(order, "in_wash", {}, "Washing started", actor.userId);
    await this.notifications.notifyResident(order.residentId, { type: "order.washing", orderId: order.id, title: "Washing started", body: `Order ${order.orderCode} is being washed.` });
    return updated;
  }

  // The ironing stage is one order state. Ironing that has not begun yet counts as
  // "ironing pending"; startIroning stamps the timeline so the dashboards can tell
  // pending work apart from work in progress without inventing extra states.
  async completeWash(orderId: string, actor: OrderActor): Promise<Order> {
    const order = await this.get(orderId);
    return this.apply(order, "ironing", {}, "Washing completed", actor.userId);
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
    return this.completeIroning(orderId, actor);
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

  async assignOperator(orderId: string, operatorUserId: string): Promise<Order> {
    const order = await this.get(orderId);
    order.assignedOperatorUserId = operatorUserId;
    return this.store.orders.put(order);
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
      remainingAllowance: subscription && plan ? remainingAllowance(plan.garmentCap, subscription.garmentsUsed) : 0,
      turnaroundHours: plan?.turnaroundHours ?? config.defaultTurnaroundHours,
      ironingStarted: ironingStarted(order),
      slot: slot ? { id: slot.id, date: slot.date, window: slot.window, startTime: slot.startTime, endTime: slot.endTime } : null,
      delayed: this.isDelayed(order, config.delayGraceHours),
      delayMinutes: this.delayMinutes(order),
      stages: timelineStages(order.state, reached),
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
        assignedOperatorUserId: order.assignedOperatorUserId,
        operatorName: order.assignedOperatorUserId ? users.get(order.assignedOperatorUserId)?.fullName ?? null : null,
        qcPassed: order.qcPassed, qcReason: order.qcReason,
        pickupFailureReason: order.pickupFailureReason,
        expectedCompletionAt: order.expectedCompletionAt,
        pickedUpAt: order.pickedUpAt, deliveredAt: order.deliveredAt,
        ironingStarted: ironingStarted(order),
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
      stages: timelineStages(order.state, reached),
      acceptedCount: order.acceptedCount,
      subscriptionCoveredCount: order.subscriptionCoveredCount,
      additionalCount: order.additionalCount,
      additionalChargePaise: order.additionalChargePaise,
      additionalChargeStatus: order.additionalChargeStatus,
    };
  }
}

export const IRONING_STARTED_NOTE = "Ironing started";

export function ironingStarted(order: Order): boolean {
  return order.timeline.some((entry) => entry.note === IRONING_STARTED_NOTE);
}

export { ACTIVE_STATES, PROCESSING_STATES };
