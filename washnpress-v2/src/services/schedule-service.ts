import { randomUUID } from "node:crypto";
import type { RecurringSchedule, Slot } from "../domain/models";
import {
  occurrencesBetween, occurrencesPerMonth, validateRecurrence, describeRecurrence,
  type PickupFrequency,
} from "../domain/recurrence";
import type { DataStore } from "../ports/repositories";
import type { SchedulingService } from "./scheduling-service";
import { serviceDay, today } from "./scheduling-service";

// A resident's standing arrangement to be collected, and the machinery that turns it
// into actual bookings.
//
// The preference is a preference. Which slots exist, and whether they have room, is
// the operation's business, so a schedule asks for a window and takes what is
// actually there — telling the resident when it could not have what they wanted
// rather than silently booking something else or silently booking nothing.

export class ScheduleNotFoundError extends Error {
  constructor() { super("No such schedule."); this.name = "ScheduleNotFoundError"; }
}

// A plan says how many collections it includes. Asking for more than that is
// refused at the point of asking rather than discovered halfway through a month.
export class PickupAllowanceExceededError extends Error {
  constructor(readonly wanted: number, readonly allowed: number) {
    super(`Your plan includes ${allowed} pickups a month; that schedule would need ${wanted}.`);
    this.name = "PickupAllowanceExceededError";
  }
}

export class SubscriptionRequiredError extends Error {
  constructor() {
    super("A preferred pickup window is part of a subscription. Subscribe to choose one.");
    this.name = "SubscriptionRequiredError";
  }
}

export interface ScheduleInput {
  residentId: string;
  societyId: string;
  frequency: PickupFrequency;
  days?: number[];
  window: string;
  startDate?: string;
}

export class ScheduleService {
  constructor(
    private readonly store: DataStore,
    private readonly scheduling: SchedulingService,
    private readonly horizonDays: number,
  ) {}

  private async allowanceFor(residentId: string): Promise<number | null> {
    const subscription = (await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active"))[0] ?? null;
    if (!subscription) return null;
    const plan = await this.store.plans.get(subscription.planId);
    // A plan that predates pickup allowances does not restrict them, rather than
    // restricting them to nothing.
    return plan?.pickupsPerCycle ?? null;
  }

  async create(input: ScheduleInput): Promise<RecurringSchedule> {
    const days = input.days ?? [];
    validateRecurrence(input.frequency, days);

    // "3–4 pickups per month" is plan configuration, not a number in the client, so
    // an admin can change what Basic includes without an application change.
    const allowed = await this.allowanceFor(input.residentId);
    const wanted = occurrencesPerMonth(input.frequency, days);
    if (allowed !== null && wanted > allowed) throw new PickupAllowanceExceededError(wanted, allowed);

    const schedule: RecurringSchedule = {
      id: randomUUID(),
      residentId: input.residentId,
      societyId: input.societyId,
      frequency: input.frequency,
      days: [...new Set(days)].sort(),
      window: input.window,
      startDate: input.startDate ?? today(),
      status: "active",
      generatedThrough: null,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
    };
    return this.store.schedules.put(schedule);
  }

  async listFor(residentId: string): Promise<RecurringSchedule[]> {
    const schedules = await this.store.schedules.find((s) => s.residentId === residentId && s.status !== "cancelled");
    return schedules.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(id: string, residentId: string, patch: Partial<Pick<RecurringSchedule, "frequency" | "days" | "window" | "status">>): Promise<RecurringSchedule> {
    const schedule = await this.store.schedules.get(id);
    if (!schedule || schedule.residentId !== residentId || schedule.status === "cancelled") throw new ScheduleNotFoundError();

    const frequency = patch.frequency ?? schedule.frequency;
    const days = patch.days ?? schedule.days;
    validateRecurrence(frequency, days);

    const allowed = await this.allowanceFor(residentId);
    const wanted = occurrencesPerMonth(frequency, days);
    if (allowed !== null && wanted > allowed) throw new PickupAllowanceExceededError(wanted, allowed);

    schedule.frequency = frequency;
    schedule.days = [...new Set(days)].sort();
    if (patch.window) schedule.window = patch.window;
    if (patch.status) schedule.status = patch.status;
    return this.store.schedules.put(schedule);
  }

  // Stopping a schedule stops future bookings. Anything already booked stays booked,
  // because those are collections the resident has been told about.
  async cancel(id: string, residentId: string): Promise<RecurringSchedule> {
    const schedule = await this.store.schedules.get(id);
    if (!schedule || schedule.residentId !== residentId) throw new ScheduleNotFoundError();
    schedule.status = "cancelled";
    schedule.cancelledAt = new Date().toISOString();
    return this.store.schedules.put(schedule);
  }

  async describe(schedule: RecurringSchedule) {
    const upcoming = await this.store.pickups.find(
      (p) => p.residentId === schedule.residentId && (p.status === "scheduled" || p.status === "rescheduled"),
    );
    return {
      ...schedule,
      description: describeRecurrence(schedule.frequency, schedule.days),
      perMonth: occurrencesPerMonth(schedule.frequency, schedule.days),
      allowance: await this.allowanceFor(schedule.residentId),
      upcomingCount: upcoming.length,
    };
  }

  // Turn the active schedules into bookings, up to the horizon. Run by the same job
  // that used to generate the old weekly recurrences.
  async generateUpcoming(now: Date = new Date()): Promise<{ created: number; skipped: { date: string; reason: string }[] }> {
    const from = serviceDay(now);
    const horizon = new Date(now.getTime() + this.horizonDays * 86_400_000);
    const to = serviceDay(horizon);

    let created = 0;
    const skipped: { date: string; reason: string }[] = [];

    for (const schedule of await this.store.schedules.find((s) => s.status === "active")) {
      const wanted = occurrencesBetween(schedule, from, to);
      for (const date of wanted) {
        // Never twice for the same day, whatever made the first one.
        const already = await this.store.pickups.find(
          (p) => p.residentId === schedule.residentId
            && serviceDay(p.scheduledFor) === date
            && p.status !== "cancelled",
        );
        if (already.length) continue;

        const slot = await this.pickSlot(schedule, date);
        if (!slot) {
          // Said rather than swallowed: a resident who asked for Mondays and got
          // nothing should be able to find out why.
          skipped.push({ date, reason: "no_slot_available" });
          continue;
        }
        try {
          await this.scheduling.book({ residentId: schedule.residentId, societyId: schedule.societyId, slotId: slot.id });
          created += 1;
        } catch {
          skipped.push({ date, reason: "booking_refused" });
        }
      }
      schedule.generatedThrough = to;
      await this.store.schedules.put(schedule);
    }
    return { created, skipped };
  }

  // The preferred window first, then whatever else is open that day. A preference is
  // not a reservation, and the requirements are explicit that it has to be checked
  // against what is actually available.
  private async pickSlot(schedule: RecurringSchedule, date: string): Promise<Slot | null> {
    const open = await this.store.slots.find(
      (s) => s.societyId === schedule.societyId && s.date === date && s.isActive && s.capacityRemaining > 0,
    );
    if (!open.length) return null;
    return open.find((s) => s.window === schedule.window) ?? open[0];
  }

  // What a resident may choose, and what their plan allows. Offering a preference to
  // somebody with no subscription would be offering something that does not exist.
  async preferences(residentId: string) {
    const subscription = (await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active"))[0] ?? null;
    if (!subscription) throw new SubscriptionRequiredError();
    const plan = await this.store.plans.get(subscription.planId);
    return {
      preferredWindows: subscription.preferredWindows ?? [],
      pickupsPerCycle: plan?.pickupsPerCycle ?? null,
      pickupsUsed: subscription.pickupsUsed ?? 0,
      planTier: plan?.tier ?? null,
    };
  }

  async setPreferences(residentId: string, windows: string[]) {
    const subscription = (await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active"))[0] ?? null;
    if (!subscription) throw new SubscriptionRequiredError();
    subscription.preferredWindows = [...new Set(windows)];
    await this.store.subscriptions.put(subscription);
    return this.preferences(residentId);
  }
}
