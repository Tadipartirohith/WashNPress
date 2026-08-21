import { randomUUID } from "node:crypto";
import { generateOrderCode } from "../domain/codes";
import type { DataStore } from "../ports/repositories";
import type { Addon, Order, Pickup, Plan, Slot } from "../domain/models";
import { buildLines, linesQuantity, linesTotalPaise, type PricedLineInput } from "../domain/pricing";
import type { SystemConfigService } from "./system-config-service";
import type { NotificationService } from "./notification-service";

export class SlotUnavailableError extends Error {
  constructor() { super("Slot is not available"); this.name = "SlotUnavailableError"; }
}
export class CutoffPassedError extends Error {
  constructor() { super("The change cutoff for this pickup has passed"); this.name = "CutoffPassedError"; }
}
export class SlotInUseError extends Error {
  constructor() { super("This slot already has bookings"); this.name = "SlotInUseError"; }
}
export class SlotInPastError extends Error {
  constructor() { super("That pickup slot is in the past"); this.name = "SlotInPastError"; }
}

// The service day a slot belongs to, in the local calendar the slots are written in.
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// A slot is bookable while its own day has not finished. Time of day is left to the
// change cutoff, which already refuses a booking made too close to the pickup.
export function isPastSlot(slot: { date: string }, now: Date = new Date()): boolean {
  return slot.date < today(now);
}

export interface SlotView extends Slot {
  bookedCount: number;
  full: boolean;
  societyName?: string | null;
  areaId?: string | null;
}

export class SchedulingService {
  constructor(
    private readonly store: DataStore,
    private readonly notifications: NotificationService,
    private readonly cutoffHours: number,
    private readonly systemConfig: SystemConfigService,
  ) {}

  // ------------------------------------------------------------ slot reading

  private view(slot: Slot): SlotView {
    const bookedCount = slot.capacityTotal - slot.capacityRemaining;
    return { ...slot, bookedCount, full: slot.capacityRemaining <= 0 };
  }

  // Residents only ever see slots for their own society that still have capacity.
  async listAvailableSlots(societyId: string, date: string): Promise<SlotView[]> {
    // A day that has already gone cannot be booked, so it is not offered.
    if (date < today()) return [];
    const slots = await this.store.slots.find((s) => s.societyId === societyId && s.date === date && s.isActive && s.capacityRemaining > 0);
    slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return slots.map((s) => this.view(s));
  }

  // Staff see every slot including the full and inactive ones, because a full slot
  // is exactly the thing a supervisor needs to notice. Days that have already gone
  // are left out unless they are asked for, so the schedule shows work that can
  // still be done rather than a backlog of dead slots.
  async listSlots(filter: { societyIds?: Set<string>; societyId?: string; from?: string; to?: string; includePast?: boolean }): Promise<SlotView[]> {
    let slots = await this.store.slots.all();
    if (filter.societyId) slots = slots.filter((s) => s.societyId === filter.societyId);
    if (filter.societyIds) slots = slots.filter((s) => filter.societyIds!.has(s.societyId));
    const from = filter.from ?? (filter.includePast ? undefined : today());
    if (from) slots = slots.filter((s) => s.date >= from);
    if (filter.to) slots = slots.filter((s) => s.date <= filter.to!);
    slots.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    return slots.map((s) => ({
      ...this.view(s),
      societyName: societies.get(s.societyId)?.name ?? null,
      areaId: societies.get(s.societyId)?.areaId ?? null,
    }));
  }

  // ------------------------------------------------------------ slot writing

  async createSlot(input: { societyId: string; date: string; window: string; startTime: string; endTime: string; capacityTotal: number }): Promise<Slot> {
    if (isPastSlot(input)) throw new SlotInPastError();
    return this.store.slots.put({
      id: randomUUID(), ...input,
      capacityRemaining: input.capacityTotal, isActive: true,
    });
  }

  // Editing capacity preserves what is already booked, so a supervisor can raise or
  // lower the ceiling without ever losing or double counting an existing booking.
  async updateSlot(slotId: string, patch: { capacityTotal?: number; startTime?: string; endTime?: string; window?: string; isActive?: boolean }): Promise<{ previous: Slot; current: Slot } | null> {
    const previous = await this.store.slots.get(slotId);
    if (!previous) return null;
    const booked = previous.capacityTotal - previous.capacityRemaining;
    const capacityTotal = patch.capacityTotal ?? previous.capacityTotal;
    if (capacityTotal < booked) throw new SlotInUseError();
    const current: Slot = {
      ...previous,
      window: patch.window ?? previous.window,
      startTime: patch.startTime ?? previous.startTime,
      endTime: patch.endTime ?? previous.endTime,
      capacityTotal,
      capacityRemaining: capacityTotal - booked,
      isActive: patch.isActive ?? previous.isActive,
    };
    await this.store.slots.put(current);
    return { previous, current };
  }

  // Cancelling a slot cancels the pickups inside it and tells the affected
  // residents, rather than silently stranding a booking against a dead slot.
  async cancelSlot(slotId: string): Promise<{ slot: Slot; cancelledPickups: number } | null> {
    const slot = await this.store.slots.get(slotId);
    if (!slot) return null;
    const pickups = await this.store.pickups.find((p) => p.slotId === slotId && (p.status === "scheduled" || p.status === "rescheduled"));
    for (const pickup of pickups) {
      pickup.status = "cancelled";
      await this.store.pickups.put(pickup);
      for (const order of await this.store.orders.find((o) => o.pickupId === pickup.id && o.state === "scheduled")) {
        order.state = "cancelled";
        order.timeline.push({ state: "cancelled", at: new Date().toISOString(), note: "Pickup slot cancelled", actorUserId: null });
        await this.store.orders.put(order);
      }
      await this.notifications.notifyResident(pickup.residentId, {
        type: "slot.cancelled", title: "Pickup slot cancelled",
        body: `Your pickup on ${slot.date} at ${slot.startTime} was cancelled. Please book another slot.`,
      });
    }
    slot.isActive = false;
    slot.capacityRemaining = slot.capacityTotal;
    await this.store.slots.put(slot);
    return { slot, cancelledPickups: pickups.length };
  }

  // --------------------------------------------------------------- booking

  // Quotes an order before it is booked. The same code prices the booking itself, so
  // the figure the resident confirms is the figure that is stored.
  async quoteLines(lines: PricedLineInput[], residentId?: string) {
    const config = await this.systemConfig.get();
    const addons = new Map((await this.store.addons.all()).map((a: Addon) => [a.id, a]));
    const plan = residentId ? await this.planFor(residentId) : null;
    const built = buildLines(lines, config.garmentServices, addons, () => randomUUID(), plan);
    return {
      lines: built,
      estimatedCount: linesQuantity(built),
      servicesPaise: linesTotalPaise(built),
      planId: plan?.id ?? null,
      planTier: plan?.tier ?? null,
    };
  }

  // The plan a resident is actually on right now, which decides which of the
  // services they choose are covered rather than charged.
  private async planFor(residentId: string): Promise<Plan | null> {
    const sub = (await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active"))[0];
    if (!sub) return null;
    return (await this.store.plans.get(sub.planId)) ?? null;
  }

  async book(input: {
    residentId: string; societyId: string; slotId: string; estimatedCount?: number;
    specialInstructions?: string; recurring?: boolean; recurringDays?: number[]; addonIds?: string[];
    lines?: PricedLineInput[];
  }): Promise<{ pickup: Pickup; order: Order; slot: Slot }> {
    // Price the requested services before taking capacity, so an unknown service
    // fails without consuming a slot.
    const quote = input.lines?.length
      ? await this.quoteLines(input.lines, input.residentId)
      : { lines: [], estimatedCount: 0, servicesPaise: 0 };
    // Capacity is taken atomically. Even when the slot looked free while the page
    // was open, a booking that loses the race fails here rather than overselling.
    const slot = await this.store.slots.reserveCapacity(input.slotId);
    if (!slot) throw new SlotUnavailableError();
    if (slot.societyId !== input.societyId || isPastSlot(slot)) {
      // Give the capacity straight back: losing the society check or booking a day
      // that has already gone must not quietly consume a place in the slot.
      await this.store.slots.releaseCapacity(slot.id);
      if (isPastSlot(slot)) throw new SlotInPastError();
      throw new SlotUnavailableError();
    }

    const society = await this.store.societies.get(input.societyId);
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
      societyId: input.societyId, areaId: society?.areaId ?? null, subscriptionId: activeSub?.id ?? null,
      state: "scheduled", qrBatchCode: null, items: [], addonIds: input.addonIds ?? [],
      estimatedCount: input.estimatedCount ?? (quote.estimatedCount || null),
      lines: quote.lines,
      servicesPaise: quote.servicesPaise,
      pickupCount: null, acceptedCount: null, subscriptionCoveredCount: null, additionalCount: null,
      additionalRatePaise: null, additionalChargePaise: null, payPerOrder: false, additionalChargeStatus: "none",
      deliveryCount: null, qcPassed: null, qcReason: null, qcAttempts: 0,
      pickupFailureReason: null, discrepancyReason: null,
      assignedOperatorUserId: null, deliveredByUserId: null,
      expectedCompletionAt: null, pickedUpAt: null, deliveredAt: null,
      rating: null, ratingComment: null,
      timeline: [{ state: "scheduled", at: new Date().toISOString(), note: "Booking confirmed", actorUserId: null }],
      createdAt: new Date().toISOString(),
    };
    await this.store.orders.put(order);

    await this.notifications.notifyResident(input.residentId, {
      type: "pickup.booked", orderId: order.id, title: "Pickup booked",
      body: `Your pickup on ${slot.date} at ${slot.startTime} is confirmed. Order ${order.orderCode}.`,
    });
    await this.notifications.notifyRoleInArea(society?.areaId ?? null, "supervisor", {
      type: "pickup.booked", orderId: order.id, title: "New pickup booking",
      body: `${society?.name ?? "A society"} has a new booking for ${slot.date} at ${slot.startTime}.`,
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
    const target = await this.store.slots.get(newSlotId);
    if (target && isPastSlot(target)) throw new SlotInPastError();
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
    for (const o of orders) {
      if (o.state !== "scheduled") continue;
      o.state = "cancelled";
      o.timeline.push({ state: "cancelled", at: new Date().toISOString(), note: "Cancelled by resident", actorUserId: null });
      await this.store.orders.put(o);
    }
    return pickup;
  }

  // Today's pickup activity, the view both operations and supervisors work from.
  // The operator's queue. Asking for a specific date gives exactly that date; asking
  // for nothing gives everything still waiting to be collected up to and including
  // today, because a pickup that was missed yesterday is precisely the work that
  // must not disappear from the screen.
  async pickupQueue(filter: { societyIds: Set<string>; date?: string }) {
    const upTo = today();
    const pickups = await this.store.pickups.find((p) => {
      if (!filter.societyIds.has(p.societyId)) return false;
      const day = p.scheduledFor.slice(0, 10);
      if (filter.date) return day === filter.date;
      const pending = p.status === "scheduled" || p.status === "rescheduled";
      return day <= upTo && pending;
    });
    const orders = await this.store.orders.all();
    const residents = new Map((await this.store.residents.all()).map((r) => [r.id, r]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const slots = new Map((await this.store.slots.all()).map((s) => [s.id, s]));
    return pickups.map((pickup) => {
      const order = orders.find((o) => o.pickupId === pickup.id) ?? null;
      const resident = residents.get(pickup.residentId);
      const residentUser = resident ? users.get(resident.userId) : null;
      const slot = slots.get(pickup.slotId);
      const operator = order?.assignedOperatorUserId ? users.get(order.assignedOperatorUserId) : null;
      const day = pickup.scheduledFor.slice(0, 10);
      return {
        // A pickup whose day has passed and which is still waiting is overdue, and
        // is sorted and badged as such rather than silently dropped from the queue.
        overdue: day < upTo && (pickup.status === "scheduled" || pickup.status === "rescheduled"),
        scheduledDate: day,
        pickupId: pickup.id,
        orderId: order?.id ?? null,
        orderCode: order?.orderCode ?? null,
        residentName: residentUser?.fullName ?? null,
        residentPhone: residentUser?.phone ?? null,
        societyId: pickup.societyId,
        societyName: societies.get(pickup.societyId)?.name ?? null,
        unitNumber: resident?.unitNumber ?? null,
        pickupAddress: resident?.pickupAddress ?? resident?.address ?? null,
        pickupDate: pickup.scheduledFor.slice(0, 10),
        slot: slot ? `${slot.startTime} - ${slot.endTime}` : null,
        slotWindow: slot?.window ?? null,
        estimatedCount: order?.estimatedCount ?? null,
        specialInstructions: pickup.specialInstructions,
        assignedOperatorUserId: order?.assignedOperatorUserId ?? null,
        operatorName: operator?.fullName ?? null,
        status: order?.state ?? pickup.status,
        pickupFailureReason: order?.pickupFailureReason ?? null,
      };
    });
  }
}
