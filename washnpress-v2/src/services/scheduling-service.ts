import { randomUUID } from "node:crypto";
import { AllowanceLedger, allowances, assessOrder, firstRefusal } from "../domain/plan-usage";
import { allowedWeekdays, describeRecurrence } from "../domain/recurrence";
import { AdditionalUsageNeedsApprovalError } from "../domain/measurement";
import { generateOrderCode } from "../domain/codes";
import type { DataStore } from "../ports/repositories";
import type { Addon, CleanStage, Order, OrderLine, Pickup, Plan, Slot, Subscription } from "../domain/models";
import {
  servicePricePaise,
  unitOf,
  lineUnits,
  applyCoverage, buildLines, linesQuantity, linesTotalPaise, audienceFor, type PricedLineInput } from "../domain/pricing";
import { orderRequirement } from "../domain/processing";
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

// How far ahead of UTC the operation's calendar day runs. Set from configuration at
// startup so the whole service agrees on one value, with India as the default.
let serviceDayOffsetMinutes = 330;

export function setServiceDayOffsetMinutes(minutes: number): void {
  serviceDayOffsetMinutes = Number.isFinite(minutes) ? minutes : 330;
}

// The service day a slot belongs to, in the operation's own calendar rather than in
// UTC. A laundry in Hyderabad finishes its day at midnight local time; computing this
// in UTC would leave yesterday's slots bookable until half past five the next morning.
export function today(now: Date = new Date()): string {
  return serviceDay(now);
}

// Which service day an instant falls in. Everything that turns a timestamp into a
// date has to go through here, or two parts of the system end up disagreeing about
// what day it is for the five and a half hours after midnight.
export function serviceDay(at: string | Date): string {
  const instant = typeof at === "string" ? new Date(at) : at;
  return new Date(instant.getTime() + serviceDayOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

// A pickup may be collected once its slot has started, and not before. A resident
// who booked the Evening window is not standing at the door at nine in the morning,
// and an order picked up, processed and delivered before its own scheduled date is a
// record of something that did not happen. minutesUntilStart already measures this
// in the operation's own day, so the rule is expressed in terms of it.
export function minutesUntilPickup(slot: { date: string; startTime: string }, now: Date = new Date()): number {
  return minutesUntilStart(slot, now);
}

export function pickupWindowOpen(slot: { date: string; startTime: string }, now: Date = new Date()): boolean {
  return minutesUntilStart(slot, now) <= 0;
}

// When it may be collected, said in a way a person can read.
export function pickupAvailableFrom(slot: { date: string; startTime: string }): string {
  return `${slot.date} ${slot.startTime}`;
}

// Refused rather than silently allowed, and the message says when it may be done.
export class PickupNotDueError extends Error {
  constructor(readonly availableFrom: string) {
    super(`This pickup cannot be started yet. It can be collected from ${availableFrom}.`);
    this.name = "PickupNotDueError";
  }
}

// When the garments should come back, from what this order actually asks for rather
// than one number for every order. A dry cleaned batch takes longer than an ironed
// one, and an order of forty garments takes longer than an order of four; a resident
// deciding whether to book deserves to be told which they are getting.
export function estimateDeliveryAt(input: {
  from: string;
  quantity: number;
  requiresClean: boolean;
  cleanStage: CleanStage;
  requiresPress: boolean;
  baseTurnaroundHours: number;
}): string {
  let hours = input.baseTurnaroundHours;
  // The specialised cleans take longer, and are the reason a single turnaround
  // figure was wrong for most orders.
  if (input.requiresClean && input.cleanStage === "dry_clean") hours += 24;
  if (input.requiresClean && input.cleanStage === "premium") hours += 36;
  if (input.requiresPress) hours += 4;
  // Volume, in whole extra days per twenty garments beyond the first twenty.
  hours += Math.max(0, Math.ceil((input.quantity - 20) / 20)) * 24;
  return new Date(new Date(input.from).getTime() + hours * 3_600_000).toISOString();
}

// Whether an instant falls inside a range of service days. The bounds are days and
// the value is a timestamp, so comparing them as strings quietly dropped the whole
// of the last day: "2026-08-24T10:00:00.000Z" sorts after "2026-08-24". Everything
// that filters records by a from/to pair goes through here, which also makes the
// range mean the operation's day rather than UTC's.
export function withinServiceDays(at: string | null | undefined, from?: string, to?: string): boolean {
  if (!at) return !from && !to;
  const day = serviceDay(at);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
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
}

// What a slot is, at a glance. "closed" is a slot whose day has gone: it is history
// and cannot be booked or edited, which is different from one an operator cancelled.
export type SlotStatus = "open" | "full" | "cancelled" | "closed";
export type BookingStatus = "available" | "partially_booked" | "fully_booked";

export const SHIFTS = ["Morning", "Afternoon", "Evening"] as const;
export type Shift = (typeof SHIFTS)[number];

// Pickup slots run to fixed windows. Nobody types a start and end time: choosing the
// window sets them, which is what stops a 03:17 slot existing at all and what keeps
// every society's day comparable.
export const SLOT_WINDOWS: Record<Shift, { startTime: string; endTime: string }> = {
  Morning: { startTime: "09:00", endTime: "12:00" },
  Afternoon: { startTime: "13:00", endTime: "16:00" },
  Evening: { startTime: "17:00", endTime: "20:00" },
};

// How long before a slot starts it may still be created, and how long before it
// starts a resident may still book into it.
export const SLOT_CREATION_LEAD_MINUTES = 120;
export const BOOKING_CUTOFF_MINUTES = 30;

export class UnknownSlotWindowError extends Error {
  constructor(window: string) {
    super(`${window} is not a pickup window. Choose Morning, Afternoon or Evening.`);
    this.name = "UnknownSlotWindowError";
  }
}
export class SlotTooSoonError extends Error {
  constructor() {
    super("A slot must be created at least 2 hours before it starts");
    this.name = "SlotTooSoonError";
  }
}
// The plan itself refuses this booking: the wrong day for the service, more than a
// ceiling allows, or beyond an allowance the plan says may not be exceeded. Distinct
// from a slot problem, because the resident has to change what they asked for rather
// than when they asked for it.
export class PlanDoesNotAllowError extends Error {
  constructor(message: string) { super(message); this.name = "PlanDoesNotAllowError"; }
}

// This slot is held for residents on a plan.
export class SubscribersOnlySlotError extends Error {
  constructor() {
    super("That slot is reserved for residents on a subscription plan.");
    this.name = "SubscribersOnlySlotError";
  }
}

export class BookingClosedError extends Error {
  constructor(message: string) { super(message); this.name = "BookingClosedError"; }
}

export function isSlotWindow(window: string): window is Shift {
  return Object.prototype.hasOwnProperty.call(SLOT_WINDOWS, window);
}

// Minutes from the start of the service day, so a date and a HH:MM can be compared
// without constructing a timezone-bearing Date for every slot.
function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// How many minutes from now until that slot starts. Negative once it has started.
export function minutesUntilStart(slot: { date: string; startTime: string }, now: Date = new Date()): number {
  const local = new Date(now.getTime() + serviceDayOffsetMinutes * 60_000);
  const nowDay = local.toISOString().slice(0, 10);
  const nowMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  // Whole days between, plus the difference within the day.
  const days = Math.round((Date.parse(slot.date + "T00:00:00Z") - Date.parse(nowDay + "T00:00:00Z")) / 86_400_000);
  return days * 1440 + minutesOfDay(slot.startTime) - nowMinutes;
}

export function minutesUntilEnd(slot: { date: string; endTime: string }, now: Date = new Date()): number {
  return minutesUntilStart({ date: slot.date, startTime: slot.endTime }, now);
}

// A slot is over once its end time has passed, which is not the same as its day
// having ended: a morning slot is finished by lunchtime.
export function hasEnded(slot: { date: string; endTime: string }, now: Date = new Date()): boolean {
  return minutesUntilEnd(slot, now) <= 0;
}

// Booking closes half an hour before the slot starts, so an operator is never sent to
// collect from a booking made while they were already on their way.
export function isBookingOpen(slot: { date: string; startTime: string }, now: Date = new Date()): boolean {
  return minutesUntilStart(slot, now) >= BOOKING_CUTOFF_MINUTES;
}

// A slot belongs to the shift its start time falls in, so filtering by "Morning"
// works whatever the supervisor happened to name the window.
export function shiftOf(startTime: string): Shift {
  const hour = Number(startTime.slice(0, 2));
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

export function slotStatusOf(slot: Slot, now: Date = new Date()): SlotStatus {
  if (!slot.isActive) return "cancelled";
  if (isPastSlot(slot, now)) return "closed";
  return slot.capacityRemaining <= 0 ? "full" : "open";
}

export function bookingStatusOf(slot: Slot): BookingStatus {
  const booked = slot.capacityTotal - slot.capacityRemaining;
  if (booked <= 0) return "available";
  return slot.capacityRemaining <= 0 ? "fully_booked" : "partially_booked";
}

// Nought to a hundred, rounded to a tenth, so the bands in the filter line up with
// what is displayed rather than disagreeing at the boundary.
export function utilisationOf(slot: Slot): number {
  if (slot.capacityTotal <= 0) return 0;
  const booked = slot.capacityTotal - slot.capacityRemaining;
  return Math.round((booked / slot.capacityTotal) * 1000) / 10;
}

export interface SlotMonitorFilter {
  societyId?: string;
  societyIds?: Set<string>;
  supervisorUserId?: string;
  operatorUserId?: string;
  from?: string;
  to?: string;
  date?: string;
  shift?: string;
  status?: SlotStatus | "all";
  bookingStatus?: BookingStatus | "all";
  // A band such as "0-25" or "100", matching the ranges the admin screen offers.
  utilisation?: string;
  includePast?: boolean;
}

function inUtilisationBand(percent: number, band?: string): boolean {
  if (!band || band === "all") return true;
  if (band === "100") return percent >= 100;
  const [lo, hi] = band.split("-").map(Number);
  if (Number.isNaN(lo) || Number.isNaN(hi)) return true;
  return percent >= lo && percent <= hi;
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
  async listAvailableSlots(societyId: string, date: string, residentId?: string): Promise<SlotView[]> {
    // A day that has already gone cannot be booked, so it is not offered.
    if (date < today()) return [];
    const slots = await this.store.slots.find((s) => s.societyId === societyId && s.date === date && s.isActive && s.capacityRemaining > 0);
    // And nor can a slot that has already finished, or one so close to starting that
    // booking has closed. A morning slot is not bookable at two in the afternoon
    // merely because it is still the same day.
    let bookable = slots.filter((s) => !hasEnded(s) && isBookingOpen(s));
    // Capacity held back for subscribers is not offered to anybody else. Shown and
    // then refused would be worse than not shown at all.
    if (bookable.some((s) => s.subscribersOnly)) {
      const subscriber = residentId ? await this.hasActivePlan(residentId) : false;
      if (!subscriber) bookable = bookable.filter((s) => !s.subscribersOnly);
    }
    bookable.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return bookable.map((s) => this.view(s));
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
    }));
  }

  // Slot monitoring: every slot with who is responsible for it and how much of it
  // has actually been taken up, so an admin can see where capacity is short and
  // where it is going to waste. Filters compose, and a filter left out means "all".
  async monitorSlots(filter: SlotMonitorFilter) {
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    const operators = (await this.store.users.all()).filter((u) => u.roles.includes("operator"));

    let slots = await this.store.slots.all();
    const from = filter.date ?? filter.from ?? (filter.includePast ? undefined : today());
    const to = filter.date ?? filter.to;
    if (from) slots = slots.filter((s) => s.date >= from);
    if (to) slots = slots.filter((s) => s.date <= to);
    if (filter.societyIds) slots = slots.filter((s) => filter.societyIds!.has(s.societyId));
    if (filter.societyId) slots = slots.filter((s) => s.societyId === filter.societyId);
    if (filter.shift && filter.shift !== "all") slots = slots.filter((s) => shiftOf(s.startTime) === filter.shift);

    const rows = slots.map((slot) => {
      const society = societies.get(slot.societyId) ?? null;
      // Who runs this society. It used to be read off the area, which answered a
      // different question — who runs the corridor this society happens to sit in.
      const supervisorUserId = society?.supervisorUserId ?? null;
      const supervisor = supervisorUserId ? users.get(supervisorUserId) ?? null : null;
      // The operators who cover this society; the first is shown, the count tells
      // the admin whether anybody is covering it at all.
      const covering = operators.filter((u) => u.societyIds.includes(slot.societyId) && u.status === "active");
      const booked = slot.capacityTotal - slot.capacityRemaining;
      return {
        ...slot,
        societyName: society?.name ?? null,
        supervisorUserId,
        supervisorName: supervisor?.fullName ?? null,
        operatorUserId: covering[0]?.id ?? null,
        operatorName: covering[0]?.fullName ?? null,
        operatorCount: covering.length,
        shift: shiftOf(slot.startTime),
        bookedCount: booked,
        availableCount: Math.max(0, slot.capacityRemaining),
        utilisationPercent: utilisationOf(slot),
        status: slotStatusOf(slot),
        bookingStatus: bookingStatusOf(slot),
        full: slot.capacityRemaining <= 0,
        readOnly: isPastSlot(slot),
      };
    }).filter((row) => {
      if (filter.supervisorUserId && row.supervisorUserId !== filter.supervisorUserId) return false;
      if (filter.operatorUserId && !operators.some((u) => u.id === filter.operatorUserId && u.societyIds.includes(row.societyId))) return false;
      if (filter.status && filter.status !== "all" && row.status !== filter.status) return false;
      if (filter.bookingStatus && filter.bookingStatus !== "all" && row.bookingStatus !== filter.bookingStatus) return false;
      if (!inUtilisationBand(row.utilisationPercent, filter.utilisation)) return false;
      return true;
    });

    rows.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));

    const capacity = rows.reduce((sum, r) => sum + r.capacityTotal, 0);
    const booked = rows.reduce((sum, r) => sum + r.bookedCount, 0);
    return {
      slots: rows,
      summary: {
        totalSlots: rows.length,
        openSlots: rows.filter((r) => r.status === "open").length,
        fullSlots: rows.filter((r) => r.status === "full").length,
        closedSlots: rows.filter((r) => r.status === "closed").length,
        cancelledSlots: rows.filter((r) => r.status === "cancelled").length,
        totalCapacity: capacity,
        totalBookings: booked,
        totalAvailable: Math.max(0, capacity - booked),
        utilisationPercent: capacity > 0 ? Math.round((booked / capacity) * 1000) / 10 : 0,
      },
    };
  }

  // ------------------------------------------------------------ slot writing

  // The window decides the times. Any startTime or endTime a caller sends is ignored,
  // so the rule cannot be bypassed by posting to the API directly.
  async createSlot(input: { societyId: string; date: string; window: string; startTime?: string; endTime?: string; capacityTotal: number; subscribersOnly?: boolean }): Promise<Slot> {
    if (!isSlotWindow(input.window)) throw new UnknownSlotWindowError(input.window);
    const { startTime, endTime } = SLOT_WINDOWS[input.window];
    if (isPastSlot(input)) throw new SlotInPastError();
    // Two hours' notice, so there is time to roster somebody against it. Exactly two
    // hours is allowed; less is not.
    if (minutesUntilStart({ date: input.date, startTime }) < SLOT_CREATION_LEAD_MINUTES) {
      throw new SlotTooSoonError();
    }
    return this.store.slots.put({
      id: randomUUID(),
      societyId: input.societyId,
      date: input.date,
      window: input.window,
      startTime,
      endTime,
      capacityTotal: input.capacityTotal,
      capacityRemaining: input.capacityTotal,
      isActive: true,
      subscribersOnly: input.subscribersOnly ?? false,
    });
  }

  // Editing capacity preserves what is already booked, so a supervisor can raise or
  // lower the ceiling without ever losing or double counting an existing booking.
  async updateSlot(slotId: string, patch: { capacityTotal?: number; window?: string; isActive?: boolean; subscribersOnly?: boolean }): Promise<{ previous: Slot; current: Slot } | null> {
    const previous = await this.store.slots.get(slotId);
    if (!previous) return null;
    // A day that has gone is a record of what happened, not something to edit.
    if (isPastSlot(previous)) throw new SlotInPastError();
    const booked = previous.capacityTotal - previous.capacityRemaining;
    const capacityTotal = patch.capacityTotal ?? previous.capacityTotal;
    if (capacityTotal < booked) throw new SlotInUseError();
    // The times belong to the window, not to whoever is editing. Moving a slot to a
    // different window moves its hours with it; there is no way to set an arbitrary
    // start or end, so every Morning slot in the system means the same three hours.
    const window = patch.window ?? previous.window;
    if (!isSlotWindow(window)) throw new UnknownSlotWindowError(window);
    const { startTime, endTime } = SLOT_WINDOWS[window];
    const current: Slot = {
      ...previous,
      window,
      startTime,
      endTime,
      capacityTotal,
      capacityRemaining: capacityTotal - booked,
      isActive: patch.isActive ?? previous.isActive,
      subscribersOnly: patch.subscribersOnly ?? previous.subscribersOnly ?? false,
    };
    await this.store.slots.put(current);
    return { previous, current };
  }

  // Cancelling a slot cancels the pickups inside it and tells the affected
  // residents, rather than silently stranding a booking against a dead slot.
  async cancelSlot(slotId: string): Promise<{ slot: Slot; cancelledPickups: number } | null> {
    const slot = await this.store.slots.get(slotId);
    if (!slot) return null;
    if (isPastSlot(slot)) throw new SlotInPastError();
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
  async quoteLines(lines: PricedLineInput[], residentId?: string, forDate?: string | null) {
    const config = await this.systemConfig.get();
    const addons = new Map((await this.store.addons.all()).map((a: Addon) => [a.id, a]));
    const { plan, subscription } = residentId
      ? await this.planFor(residentId)
      : { plan: null, subscription: null };
    // Which price list applies is decided here, from the subscription, and never
    // taken from the request. A price the client chooses is a price the client can
    // change.
    const audience = audienceFor(Boolean(plan));
    const priced = buildLines(lines, config.garmentServices, addons, () => randomUUID(), plan, audience);
    // What the plan actually covers, service by service, at the moment of quoting.
    // The preview and the booking run the same pass, so the figure the resident is
    // shown is the figure that gets stored.
    const ledger = new AllowanceLedger(plan, subscription);
    const built = applyCoverage(priced, ledger);
    // Whether the plan lets this order go ahead at all: on this day, within any
    // ceiling it sets, and — where it goes beyond the allowance — whether that is
    // permitted, charged, or something an admin has to say yes to. Answered here so
    // the preview can show the consequence, and enforced in `book`.
    const eligibility = assessOrder(
      plan, subscription,
      built.map((line) => ({
        serviceId: line.serviceId, serviceName: line.serviceName,
        unit: line.unit ?? "piece", quantity: lineUnits(line),
      })),
      forDate ?? null,
    );
    const requirement = orderRequirement(built);
    const estimatedDeliveryAt = estimateDeliveryAt({
      from: new Date().toISOString(),
      quantity: linesQuantity(built),
      ...requirement,
      baseTurnaroundHours: plan?.turnaroundHours ?? config.defaultTurnaroundHours,
    });
    return {
      lines: built,
      // Which price list was applied, so the client can say so rather than guess.
      audience,
      // Told before the order is confirmed, not discovered after it.
      estimatedDeliveryAt,
      estimatedCount: linesQuantity(built),
      servicesPaise: linesTotalPaise(built),
      planId: plan?.id ?? null,
      planTier: plan?.tier ?? null,
      // Line by line, whether the plan permits it and why not where it does not.
      eligibility,
      blockedBy: firstRefusal(eligibility),
      // What each covered service has left, in its own unit, so the resident is told
      // "18 of 40 kg remaining" rather than a single number that means nothing.
      allowances: allowances(plan, subscription),
    };
  }

  // Whether this resident is on a plan at all, which is what a subscriber-only slot
  // and the unified booking screen both turn on.
  async hasActivePlan(residentId: string): Promise<boolean> {
    return (await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active")).length > 0;
  }

  // The plan a resident is actually on right now, which decides which of the
  // services they choose are covered rather than charged.
  private async planFor(residentId: string): Promise<{ plan: Plan | null; subscription: Subscription | null }> {
    const sub = (await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active"))[0];
    if (!sub) return { plan: null, subscription: null };
    return { plan: (await this.store.plans.get(sub.planId)) ?? null, subscription: sub };
  }

  // Everything one Booking screen needs, whether or not the resident is on a plan.
  //
  // Book and Regular used to be two separate resident features, and the client had to
  // know which rules applied to which. There is one booking module now: the backend
  // says who the resident is and what therefore applies to them, and the screen
  // renders that rather than deciding it.
  async bookingOptions(residentId: string) {
    const config = await this.systemConfig.get();
    const { plan, subscription } = await this.planFor(residentId);
    const subscriber = Boolean(plan && subscription);

    const rules = new Map((plan?.services ?? []).map((r) => [r.serviceId, r]));
    const balances = new Map(allowances(plan, subscription).map((a) => [a.serviceId, a]));

    // Every service in the catalogue, said in the terms that apply to this resident:
    // what it is measured in, what it costs them, and — for a subscriber — what their
    // plan has left of it and which days it may be collected on.
    const services = config.garmentServices.filter((service) => service.isActive).map((service) => {
      const rule = rules.get(service.id);
      const balance = balances.get(service.id);
      const unit = unitOf(service);
      return {
        id: service.id,
        name: service.name,
        unit,
        minimumBillable: service.minimumBillable ?? null,
        // What a resident with no plan pays, and what a subscriber pays beyond their
        // allowance. Never the same number by accident.
        pricePaise: servicePricePaise(service, "", subscriber ? "subscriber" : "standard"),
        includedInPlan: Boolean(rule),
        allowance: balance ?? null,
        additionalUsage: rule?.additionalUsage ?? null,
        additionalRatePaise: rule?.additionalRatePaise ?? null,
        // Which days this service may be collected on under the plan. Everything is
        // allowed where no plan governs it.
        allowedDays: rule ? allowedWeekdays(rule.frequency, rule.frequencyDays) : [0, 1, 2, 3, 4, 5, 6],
        frequency: rule?.frequency ?? null,
        frequencyLabel: rule ? describeRecurrence(rule.frequency, rule.frequencyDays) : null,
      };
    });

    const resident = await this.store.residents.get(residentId);
    return {
      // Which of the two booking experiences applies, decided here rather than by
      // the client reading a plan and guessing.
      audience: subscriber ? "subscriber" as const : "standard" as const,
      subscriber,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name ?? plan.tier,
            tier: plan.tier,
            description: plan.description ?? null,
            turnaroundHours: plan.turnaroundHours,
            renewalDate: subscription?.cycleEnd ?? null,
          }
        : null,
      services,
      // The windows this resident prefers, and the windows that exist. A preference
      // is not a booking, so both are sent and availability still decides.
      preferredWindows: subscription?.preferredWindows ?? resident?.preferredWindows ?? [],
      windows: Object.keys(SLOT_WINDOWS),
      turnaroundHours: plan?.turnaroundHours ?? config.defaultTurnaroundHours,
      // What a resident with no plan is told before they choose anything.
      garmentPricesPaise: config.garmentPricesPaise ?? {},
      nonSubscriberGarmentRatePaise: config.nonSubscriberGarmentRatePaise,
    };
  }

  async book(input: {
    residentId: string; societyId: string; slotId: string; estimatedCount?: number;
    specialInstructions?: string; recurring?: boolean; recurringDays?: number[]; addonIds?: string[];
    lines?: PricedLineInput[];
  }): Promise<{ pickup: Pickup; order: Order; slot: Slot }> {
    // Price the requested services before taking capacity, so an unknown service
    // fails without consuming a slot.
    const bookedSlot = await this.store.slots.get(input.slotId);
    const quote = input.lines?.length
      ? await this.quoteLines(input.lines, input.residentId, bookedSlot?.date ?? null)
      // An order booked without choosing services gets the ordinary turnaround.
      : {
          lines: [] as OrderLine[], estimatedCount: 0, servicesPaise: 0,
          estimatedDeliveryAt: estimateDeliveryAt({
            from: new Date().toISOString(),
            quantity: input.estimatedCount ?? 0,
            requiresClean: true, cleanStage: "wash" as CleanStage, requiresPress: true,
            baseTurnaroundHours: (await this.systemConfig.get()).defaultTurnaroundHours,
          }),
        };
    // What the plan will not allow is refused before capacity is touched, so a
    // booking the plan forbids never consumes a place in the slot.
    const refused = "blockedBy" in quote ? quote.blockedBy : null;
    if (refused) {
      throw refused.needsApproval
        ? new AdditionalUsageNeedsApprovalError(refused.serviceName)
        : new PlanDoesNotAllowError(refused.reason ?? `Your plan does not allow that much ${refused.serviceName}.`);
    }

    // Capacity is taken atomically. Even when the slot looked free while the page
    // was open, a booking that loses the race fails here rather than overselling.
    const slot = await this.store.slots.reserveCapacity(input.slotId);
    if (!slot) throw new SlotUnavailableError();
    // A slot kept for subscribers is refused to anybody else, here as well as in the
    // listing: a client that never showed it can still be asked to book it.
    if (slot.subscribersOnly && !(await this.hasActivePlan(input.residentId))) {
      await this.store.slots.releaseCapacity(slot.id);
      throw new SubscribersOnlySlotError();
    }
    if (slot.societyId !== input.societyId || isPastSlot(slot) || hasEnded(slot) || !isBookingOpen(slot)) {
      // Give the capacity straight back: a refused booking must never quietly consume
      // a place in the slot.
      await this.store.slots.releaseCapacity(slot.id);
      if (isPastSlot(slot)) throw new SlotInPastError();
      if (hasEnded(slot)) throw new BookingClosedError("That pickup window has already finished.");
      if (!isBookingOpen(slot)) {
        throw new BookingClosedError(`Booking for this slot closed ${BOOKING_CUTOFF_MINUTES} minutes before it starts.`);
      }
      throw new SlotUnavailableError();
    }

    const society = await this.store.societies.get(input.societyId);
    // Which tower this collection is from. Copied onto the order rather than looked
    // up through the resident later, so the order stays where it was collected from
    // even if the resident moves, and so the operator who covers that block is the
    // one who sees it.
    const bookingResident = await this.store.residents.get(input.residentId);
    const blockId = bookingResident?.blockId ?? null;
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
      societyId: input.societyId, blockId,
      subscriptionId: activeSub?.id ?? null,
      state: "scheduled", qrBatchCode: null, items: [], addonIds: input.addonIds ?? [],
      estimatedCount: input.estimatedCount ?? (quote.estimatedCount || null),
      lines: quote.lines,
      // No batches until the operator confirms what actually turned up.
      batches: [],
      servicesPaise: quote.servicesPaise,
      pickupCount: null, acceptedCount: null, subscriptionCoveredCount: null, additionalCount: null,
      additionalRatePaise: null, additionalChargePaise: null, payPerOrder: false, additionalChargeStatus: "none",
      deliveryCount: null, qcPassed: null, qcReason: null, qcAttempts: 0,
      pickupFailureReason: null, discrepancyReason: null,
      assignedOperatorUserId: null, deliveredByUserId: null,
      expectedCompletionAt: null, pickedUpAt: null, deliveredAt: null,
      estimatedDeliveryAt: quote.estimatedDeliveryAt,
      rating: null, ratingComment: null,
      timeline: [{ state: "scheduled", at: new Date().toISOString(), note: "Booking confirmed", actorUserId: null }],
      createdAt: new Date().toISOString(),
    };
    await this.store.orders.put(order);

    await this.notifications.notifyResident(input.residentId, {
      type: "pickup.booked", orderId: order.id, title: "Pickup booked",
      body: `Your pickup on ${slot.date} at ${slot.startTime} is confirmed. Order ${order.orderCode}.`,
    });
    await this.notifications.notifyRoleInSociety(society?.id ?? null, "supervisor", {
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

    // Everything that can refuse the move is checked before any capacity is taken,
    // so a rejected reschedule cannot leave a seat held in a slot nobody moved to.
    const target = await this.store.slots.get(newSlotId);
    if (!target) throw new SlotUnavailableError();
    // A pickup belongs to a society. Moving it into another society's slot was
    // possible if the slot id was known and it had room, which put a resident on a
    // round nobody was rostered to make for them.
    if (target.societyId !== pickup.societyId) throw new SlotUnavailableError();
    if (target.isActive === false) throw new SlotUnavailableError();
    if (isPastSlot(target)) throw new SlotInPastError();
    if (hasEnded(target)) throw new BookingClosedError("That pickup window has already finished.");
    if (!isBookingOpen(target)) {
      throw new BookingClosedError(`Booking for this slot closed ${BOOKING_CUTOFF_MINUTES} minutes before it starts.`);
    }

    const slot = await this.store.slots.reserveCapacity(newSlotId);
    if (!slot) throw new SlotUnavailableError();
    try {
      await this.store.slots.releaseCapacity(pickup.slotId);
      pickup.slotId = slot.id;
      pickup.scheduledFor = new Date(`${slot.date}T${slot.startTime}:00.000Z`).toISOString();
      pickup.status = "rescheduled";
      await this.store.pickups.put(pickup);
      return { pickup, slot };
    } catch (error) {
      // Give the seat back rather than stranding it against a move that never landed.
      await this.store.slots.releaseCapacity(slot.id);
      throw error;
    }
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
      const pending = p.status === "scheduled" || p.status === "rescheduled";
      // A date narrows the queue to that day. With no date, every pending pickup is
      // listed — including the ones still to come. They used to be hidden until
      // their own day arrived, so an operator could not see tomorrow's workload at
      // all; they are shown now, and marked as not yet due rather than filtered out.
      if (filter.date) return serviceDay(p.scheduledFor) === filter.date && pending;
      return pending;
    });
    const orders = await this.store.orders.all();
    const residents = new Map((await this.store.residents.all()).map((r) => [r.id, r]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const slots = new Map((await this.store.slots.all()).map((s) => [s.id, s]));
    const rows = pickups.map((pickup) => {
      const order = orders.find((o) => o.pickupId === pickup.id) ?? null;
      const resident = residents.get(pickup.residentId);
      const residentUser = resident ? users.get(resident.userId) : null;
      const slot = slots.get(pickup.slotId);
      const operator = order?.assignedOperatorUserId ? users.get(order.assignedOperatorUserId) : null;
      const day = serviceDay(pickup.scheduledFor);
      const pending = pickup.status === "scheduled" || pickup.status === "rescheduled";
      const open = slot ? pickupWindowOpen(slot) : day <= upTo;
      // A pickup whose window has finished and which is still waiting is not
      // "Scheduled" any more — it is due. Leaving it labelled Scheduled and in its
      // original position is how an overdue collection sits quietly in the middle of
      // a list while the operator works through the ones above it.
      const windowPassed = slot ? hasEnded(slot) : day < upTo;
      const due = pending && (windowPassed || day < upTo);

      return {
        // A pickup whose day has passed and which is still waiting is overdue, and
        // is sorted and badged as such rather than silently dropped from the queue.
        overdue: day < upTo && pending,
        // Past its window and still waiting. Shown as Due and sorted to the top.
        due,
        pickupStatus: due ? "due" : pending ? "scheduled" : pickup.status,
        pickupStatusLabel: due ? "Due" : pending ? "Scheduled" : pickup.status,
        // Whether it may be collected now. A future pickup is visible so the
        // operator can plan, but cannot be started until its window opens.
        dueNow: open,
        availableFrom: slot ? pickupAvailableFrom(slot) : pickup.scheduledFor,
        minutesUntilDue: slot ? Math.max(0, minutesUntilPickup(slot)) : 0,
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

    // Due first, oldest first within that, then everything else by when it is due.
    // A pickup that becomes overdue moves to the top on its own, rather than waiting
    // for somebody to notice it and reorder the list by hand.
    rows.sort((a, b) => {
      if (a.due !== b.due) return a.due ? -1 : 1;
      return a.availableFrom < b.availableFrom ? -1 : a.availableFrom > b.availableFrom ? 1 : 0;
    });
    return rows;
  }
}
