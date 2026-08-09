import { generateQrBatchCode } from "../domain/codes";
import { transition, type OrderState } from "../domain/order-state-machine";
import type { GarmentItem, Order } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { NotificationService } from "./notification-service";
import type { SupportService } from "./support-service";
import type { SubscriptionService } from "./subscription-service";

export class OrderService {
  constructor(
    private readonly store: DataStore,
    private readonly notifications: NotificationService,
    private readonly support: SupportService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  private async apply(order: Order, to: OrderState, ctx: Record<string, unknown> = {}, note?: string): Promise<Order> {
    const next = transition(order.state, to, ctx);
    order.state = next;
    order.timeline.push({ state: next, at: new Date().toISOString(), note });
    return this.store.orders.put(order);
  }

  private async get(orderId: string): Promise<Order> {
    const order = await this.store.orders.get(orderId);
    if (!order) throw new Error("Order not found");
    return order;
  }

  async markPickedUp(orderId: string, items: GarmentItem[]): Promise<Order> {
    const order = await this.get(orderId);
    order.items = items;
    order.pickupCount = items.reduce((sum, i) => sum + i.quantity, 0);
    order.qrBatchCode = generateQrBatchCode();
    const updated = await this.apply(order, "picked_up", {}, `QR ${order.qrBatchCode}`);
    const pickup = order.pickupId ? await this.store.pickups.get(order.pickupId) : null;
    if (pickup) { pickup.status = "completed"; await this.store.pickups.put(pickup); }
    await this.notifications.enqueue("pickup.completed", {
      to: order.residentId, title: "Garments collected", body: `${order.pickupCount} garments collected for order ${order.orderCode}.`,
    });
    return updated;
  }

  async advanceStage(orderId: string, to: Extract<OrderState, "in_wash" | "ironing" | "qc">): Promise<Order> {
    return this.apply(await this.get(orderId), to);
  }

  // Quality check. A pass clears the order for delivery. A fail holds the batch,
  // records the reason, and automatically opens a support ticket and a notification.
  async submitQc(orderId: string, pass: boolean, reason?: string): Promise<Order> {
    const order = await this.get(orderId);
    if (pass) {
      order.qcPassed = true;
      return this.apply(order, "ready_for_delivery", { qcPassed: true });
    }
    order.qcPassed = false;
    order.qcReason = reason ?? "Quality check failed";
    const held = await this.apply(order, "qc_hold", {}, order.qcReason);
    await this.support.create({ residentId: order.residentId, orderId: order.id, category: "qc_fail", description: order.qcReason, priority: "high" });
    await this.notifications.enqueue("qc.failed", {
      to: order.residentId, title: "Quality check in progress", body: `We are re-checking order ${order.orderCode}: ${order.qcReason}.`,
    });
    return held;
  }

  async outForDelivery(orderId: string): Promise<Order> {
    const order = await this.apply(await this.get(orderId), "out_for_delivery");
    await this.notifications.enqueue("order.out_for_delivery", { to: order.residentId, title: "On the way", body: `Order ${order.orderCode} is out for delivery.` });
    return order;
  }

  // Delivery reconciles counts. A mismatch without a reason is blocked by the state
  // machine. On success we deduct the delivered garments from the subscription cap.
  async deliver(orderId: string, deliveryCount: number, discrepancyReason?: string): Promise<Order> {
    const order = await this.get(orderId);
    order.deliveryCount = deliveryCount;
    if (discrepancyReason) order.discrepancyReason = discrepancyReason;
    const delivered = await this.apply(order, "delivered", {
      pickupCount: order.pickupCount ?? undefined, deliveryCount, discrepancyReason,
    });
    if (discrepancyReason) {
      await this.support.create({ residentId: order.residentId, orderId: order.id, category: "delivery_discrepancy", description: discrepancyReason, priority: "high" });
    }
    if (order.subscriptionId) await this.subscriptions.deductGarments(order.subscriptionId, deliveryCount);
    await this.notifications.enqueue("order.delivered", { to: order.residentId, title: "Delivered", body: `Order ${order.orderCode} delivered.` });
    return delivered;
  }

  async rate(orderId: string, rating: number, comment?: string): Promise<Order> {
    const order = await this.get(orderId);
    order.rating = rating; order.ratingComment = comment ?? null;
    return this.store.orders.put(order);
  }

  async raiseDispute(orderId: string, description: string): Promise<Order> {
    const order = await this.get(orderId);
    const updated = await this.apply(order, "disputed", {}, description);
    await this.support.create({ residentId: order.residentId, orderId: order.id, category: "dispute", description, priority: "high" });
    return updated;
  }

  async tracking(orderId: string) {
    const order = await this.get(orderId);
    return { orderCode: order.orderCode, state: order.state, timeline: order.timeline, items: order.items };
  }
}
