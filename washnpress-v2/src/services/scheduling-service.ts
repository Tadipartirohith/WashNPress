import { randomUUID } from "node:crypto";
import { generateOrderCode } from "../domain/codes";
import type { DataStore } from "../ports/repositories";
import type { Order, Pickup, Slot } from "../domain/models";
import type { NotificationService } from "./notification-service";

export class SlotUnavailableError extends Error {
  constructor() { super("Slot is not available"); this.name = "SlotUnavailableError"; }
}
export class CutoffPassedError extends Error {
  constructor() { super("The change cutoff for this pickup has passed"); this.name = "CutoffPassedError"; }
}

export class SchedulingService {
  constructor(
    private readonly store: DataStore,
    private readonly notifications: NotificationService,
    private readonly cutoffHours: number,
  ) {}

  async listAvailableSlots(societyId: string, date: string): Promise<Slot[]> {
    return this.store.slots.find((s) => s.societyId === societyId && s.date === date && s.isActive && s.capacityRemaining > 0);
  }

  async book(input: {
    residentId: string; societyId: string; slotId: string;
    specialInstructions?: string; recurring?: boolean; recurringDays?: number[]; addonIds?: string[];
  }): Promise<{ pickup: Pickup; order: Order; slot: Slot }> {
    const slot = await this.store.slots.reserveCapacity(input.slotId);
    if (!slot) throw new SlotUnavailableError();

    const scheduledFor = new Date(`${slot.date}T${slot.startTime}:00.000Z`).toISOString();
    const pickup: Pickup = {
      id: randomUUID(), residentId: input.residentId, societyId: input.societyId, slotId: slot.id,
      scheduledFor, status: "scheduled", recurring: input.recurring ?? false,
      recurringDays: input.recurringDays ?? [], specialInstructions: input.specialInstructions ?? null,
    };
    await this.store.pickups.put(pickup);

    const activeSub = (await this.store.subscriptions.find((s) => s.residentId === input.residentId && s.status === "active"))[0] ?? null;
    const order: Order = {
      id: randomUUID(), orderCode: generateOrderCode(), pickupId: pickup.id, residentId: input.residentId,
      societyId: input.societyId, subscriptionId: activeSub?.id ?? null, state: "scheduled", qrBatchCode: null, items: [],
      addonIds: input.addonIds ?? [], pickupCount: null, deliveryCount: null, qcPassed: null, qcReason: null,
      discrepancyReason: null, rating: null, ratingComment: null,
      timeline: [{ state: "scheduled", at: new Date().toISOString() }], createdAt: new Date().toISOString(),
    };
    await this.store.orders.put(order);

    await this.notifications.enqueue("pickup.booked", {
      to: input.residentId, title: "Pickup booked", body: `Your pickup is confirmed. Order ${order.orderCode}.`,
    });
    return { pickup, order, slot };
  }

  private assertBeforeCutoff(scheduledFor: string): void {
    const cutoff = new Date(scheduledFor).getTime() - this.cutoffHours * 3600 * 1000;
    if (Date.now() > cutoff) throw new CutoffPassedError();
  }

  async reschedule(pickupId: string, newSlotId: string): Promise<{ pickup: Pickup; slot: Slot }> {
    const pickup = await this.store.pickups.get(pickupId);
    if (!pickup) throw new Error("Pickup not found");
    this.assertBeforeCutoff(pickup.scheduledFor);
    const slot = await this.store.slots.reserveCapacity(newSlotId);
    if (!slot) throw new SlotUnavailableError();
    await this.store.slots.releaseCapacity(pickup.slotId);
    pickup.slotId = slot.id;
    pickup.scheduledFor = new Date(`${slot.date}T${slot.startTime}:00.000Z`).toISOString();
    pickup.status = "rescheduled";
    await this.store.pickups.put(pickup);
    return { pickup, slot };
  }

  async cancel(pickupId: string): Promise<Pickup> {
    const pickup = await this.store.pickups.get(pickupId);
    if (!pickup) throw new Error("Pickup not found");
    this.assertBeforeCutoff(pickup.scheduledFor);
    await this.store.slots.releaseCapacity(pickup.slotId);
    pickup.status = "cancelled";
    await this.store.pickups.put(pickup);
    const orders = await this.store.orders.find((o) => o.pickupId === pickup.id);
    for (const o of orders) { o.state = "cancelled"; o.timeline.push({ state: "cancelled", at: new Date().toISOString() }); await this.store.orders.put(o); }
    return pickup;
  }
}
