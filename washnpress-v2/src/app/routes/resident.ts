import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, requireSession, withScope } from "../guards";
import { ACTIVE_STATES, STATE_LABELS } from "../../domain/order-state-machine";
import { SLOT_WINDOWS } from "../../services/scheduling-service";
import { PICKUP_FREQUENCIES, FREQUENCY_LABELS, DAYS_REQUIRED, InvalidRecurrenceError } from "../../domain/recurrence";
import { ScheduleNotFoundError, PickupAllowanceExceededError, SubscriptionRequiredError } from "../../services/schedule-service";

const profileSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  pickupAddress: z.string().optional(),
  preferredWindows: z.array(z.string()).optional(),
});

// The resident portal. A resident only ever sees their own data: every list is
// filtered by the resident id on the session, and a direct lookup of somebody
// else's order fails the same way a missing order does.
const scheduleSchema = z.object({
  frequency: z.enum(["one_time", "daily", "alternate_days", "twice_weekly", "weekly", "custom"]),
  days: z.array(z.number().int().min(0).max(6)).optional(),
  window: z.enum(["Morning", "Afternoon", "Evening"]),
  startDate: z.string().optional(),
});
const schedulePatchSchema = z.object({
  frequency: z.enum(["one_time", "daily", "alternate_days", "twice_weekly", "weekly", "custom"]).optional(),
  days: z.array(z.number().int().min(0).max(6)).optional(),
  window: z.enum(["Morning", "Afternoon", "Evening"]).optional(),
  status: z.enum(["active", "paused"]).optional(),
});
const preferencesSchema = z.object({
  preferredWindows: z.array(z.enum(["Morning", "Afternoon", "Evening"])),
});

export function registerResidentRoutes(app: FastifyInstance, container: Container): void {
  const resident = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "resident");

// Onboarding belongs to residents alone. A supervisor, operator or admin account is
  // created by an admin who already knows everything onboarding would ask for, so the
  // flow is refused for them rather than quietly returning an empty form a client
  // might decide to render.
  function residentsOnly(session: { roles: string[] }): boolean {
    return session.roles.includes("resident");
  }

  // ------------------------------------------------------------ onboarding

  app.get("/v1/resident/onboarding", async (req, reply) => {
    const session = await requireSession(req, reply, container);
    if (!session) return;
    if (!residentsOnly(session)) {
      return reply.code(403).send({
        error: "onboarding_not_applicable",
        message: "Only residents go through onboarding. Staff accounts are created by an admin.",
      });
    }
    const status = await container.auth.onboardingStatus(session.userId);
    const societies = (await container.store.societies.all()).filter((s) => s.status !== "inactive");
    // The blocks of each society, so somebody signing up chooses their tower from
    // the towers that exist rather than typing whatever they call it. Which block a
    // resident lives in decides who collects from them, so a free text answer that
    // does not match any block leaves them covered by nobody.
    const blocks = (await container.store.blocks.all()).filter((b) => b.status === "active");
    return reply.send({
      completed: status.completed,
      requiredFields: status.requiredFields,
      resident: status.resident,
      societies: societies.map((s) => ({
        id: s.id, name: s.name, code: s.code, address: s.address, city: s.city,
        blocks: blocks
          .filter((b) => b.societyId === s.id)
          .map((b) => ({ id: b.id, name: b.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    });
  });

  // ------------------------------------------------------------- dashboard

  // Everything the dashboard needs in one call, so the resident does not have to
  // walk several pages to learn the state of their account.
  app.get("/v1/resident/dashboard", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const residentId = session.residentId;
    if (!residentId) return reply.code(409).send({ error: "onboarding_incomplete" });

    const user = await container.store.users.get(session.userId);
    const orders = await container.store.orders.find((o) => o.residentId === residentId);
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const summaries = await container.orders.summarise(orders);
    const active = summaries.filter((o) => ACTIVE_STATES.includes(o.state));
    const currentOrder = active.find((o) => o.state !== "scheduled") ?? null;
    const upcoming = active.filter((o) => o.state === "scheduled");

    const nextPickup = await nextPickupFor(container, residentId);
    const usage = await container.subscriptions.usage(residentId);
    const balancePaise = await container.wallet.balancePaise(residentId);
    const notifications = await container.notifications.listForUser(session.userId, { limit: 5 });
    const pendingCharges = summaries
      .filter((o) => o.additionalChargeStatus === "pending" || o.additionalChargeStatus === "failed")
      .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0);

    return reply.send({
      residentName: user?.fullName ?? null,
      currentOrder,
      upcomingOrders: upcoming,
      recentOrders: summaries.slice(0, 5),
      upcomingPickup: nextPickup,
      subscription: usage,
      walletBalancePaise: balancePaise,
      pendingAdditionalChargesPaise: pendingCharges,
      notifications,
      unreadNotifications: (await container.notifications.listForUser(session.userId, { unreadOnly: true })).length,
    });
  });

  // ---------------------------------------------------------------- orders

  // Current, upcoming and previous, so a delivered order never disappears.
  app.get<{ Querystring: { status?: string; from?: string; to?: string; orderCode?: string } }>("/v1/resident/orders", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    if (!session.residentId) return reply.code(409).send({ error: "onboarding_incomplete" });
    let orders = await container.store.orders.find((o) => o.residentId === session.residentId);
    if (req.query.from) orders = orders.filter((o) => o.createdAt >= req.query.from!);
    if (req.query.to) orders = orders.filter((o) => o.createdAt <= req.query.to!);
    if (req.query.orderCode) orders = orders.filter((o) => o.orderCode.toLowerCase().includes(req.query.orderCode!.toLowerCase()));
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const summaries = await container.orders.summarise(orders);
    const current = summaries.filter((o) => ACTIVE_STATES.includes(o.state) && o.state !== "scheduled");
    const upcoming = summaries.filter((o) => o.state === "scheduled");
    const previous = summaries.filter((o) => !ACTIVE_STATES.includes(o.state));
    if (req.query.status === "active") return reply.send({ orders: current, stateLabels: STATE_LABELS });
    if (req.query.status === "upcoming") return reply.send({ orders: upcoming, stateLabels: STATE_LABELS });
    if (req.query.status === "completed") return reply.send({ orders: previous.filter((o) => o.state === "delivered"), stateLabels: STATE_LABELS });
    if (req.query.status === "cancelled") return reply.send({ orders: previous.filter((o) => o.state === "cancelled"), stateLabels: STATE_LABELS });
    return reply.send({ current, upcoming, previous, stateLabels: STATE_LABELS });
  });

  app.get<{ Params: { id: string } }>("/v1/resident/orders/:id", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      return reply.send({ order: await container.orders.detail(order) });
    });
  });

  app.post<{ Params: { id: string } }>("/v1/resident/orders/:id/pay-additional", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      const updated = await container.orders.payAdditionalCharge(order.id);
      if (updated.additionalChargeStatus === "pending") {
        return reply.code(402).send({ error: "insufficient_balance", action: "top_up_wallet", amountPaise: updated.additionalChargePaise });
      }
      return reply.send({ order: await container.orders.detail(updated) });
    });
  });

  // --------------------------------------------------------- subscription

  app.get("/v1/resident/subscription", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    if (!session.residentId) return reply.code(409).send({ error: "onboarding_incomplete" });
    const usage = await container.subscriptions.usage(session.residentId);
    const plans = await container.subscriptions.listPlans();
    return reply.send({
      current: usage,
      availablePlans: plans.map((p) => ({ ...p, isCurrent: usage?.planId === p.id })),
    });
  });

  // --------------------------------------------------------- notifications

  app.get<{ Querystring: { unread?: string } }>("/v1/resident/notifications", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    const notifications = await container.notifications.listForUser(session.userId, { unreadOnly: req.query.unread === "true" });
    return reply.send({ notifications });
  });

  app.post<{ Params: { id: string } }>("/v1/resident/notifications/:id/read", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    const notification = await container.notifications.markRead(session.userId, req.params.id);
    if (!notification) return reply.code(404).send({ error: "not_found" });
    return reply.send({ notification });
  });

  app.post("/v1/resident/notifications/read-all", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    return reply.send({ marked: await container.notifications.markAllRead(session.userId) });
  });

  // --------------------------------------------------------------- profile

  app.get("/v1/resident/profile", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const user = await container.store.users.get(session.userId);
    const residentRecord = session.residentId ? await container.store.residents.get(session.residentId) : null;
    const society = residentRecord ? await container.store.societies.get(residentRecord.societyId) : null;
    return reply.send({
      profile: {
        fullName: user?.fullName ?? null, phone: user?.phone ?? null, email: user?.email ?? null,
        societyId: residentRecord?.societyId ?? null, societyName: society?.name ?? null,
        unitNumber: residentRecord?.unitNumber ?? null, towerBlock: residentRecord?.towerBlock ?? null,
        address: residentRecord?.address ?? null, pickupAddress: residentRecord?.pickupAddress ?? null,
        preferredWindows: residentRecord?.preferredWindows ?? [],
        accountStatus: user?.status ?? null,
        onboardingCompleted: residentRecord?.onboardingCompleted ?? false,
      },
    });
  });

  app.patch("/v1/resident/profile", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    // Society and unit are deliberately not accepted: moving a resident between
    // societies is an admin or supervisor action, not a self service one.
    await container.auth.updateResidentProfile(session.userId, parsed.data);
    const user = await container.store.users.get(session.userId);
    const residentRecord = session.residentId ? await container.store.residents.get(session.residentId) : null;
    return reply.send({ profile: { fullName: user?.fullName ?? null, email: user?.email ?? null, address: residentRecord?.address ?? null, pickupAddress: residentRecord?.pickupAddress ?? null, preferredWindows: residentRecord?.preferredWindows ?? [] } });
  });

  // -------------------------------------------------- standing arrangements

  // A recurrence is a thing a resident can look at, change and stop. It used to be
  // a boolean on whichever booking happened to start it, which could not express
  // "Tuesdays and Fridays" and could not be viewed at all.
  app.get("/v1/resident/schedules", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const schedules = await container.schedules.listFor(session.residentId!);
    return reply.send({
      schedules: await Promise.all(schedules.map((s) => container.schedules.describe(s))),
      frequencies: PICKUP_FREQUENCIES.map((key) => ({ key, label: FREQUENCY_LABELS[key], daysRequired: DAYS_REQUIRED[key] })),
      windows: Object.keys(SLOT_WINDOWS),
    });
  });

  app.post("/v1/resident/schedules", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const schedule = await container.schedules.create({
        residentId: session.residentId!, societyId: session.societyId!,
        frequency: parsed.data.frequency, days: parsed.data.days,
        window: parsed.data.window, startDate: parsed.data.startDate,
      });
      await container.audit.record({ session, action: "schedule.created", resource: "schedule", resourceId: schedule.id, newValue: schedule });
      return reply.code(201).send({ schedule: await container.schedules.describe(schedule) });
    } catch (error) {
      if (error instanceof InvalidRecurrenceError) return reply.code(400).send({ error: "invalid_recurrence", message: error.message });
      if (error instanceof PickupAllowanceExceededError) {
        return reply.code(422).send({ error: "pickup_allowance_exceeded", message: error.message, wanted: error.wanted, allowed: error.allowed });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/resident/schedules/:id", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const parsed = schedulePatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const schedule = await container.schedules.update(req.params.id, session.residentId!, parsed.data);
      await container.audit.record({ session, action: "schedule.updated", resource: "schedule", resourceId: schedule.id, newValue: schedule });
      return reply.send({ schedule: await container.schedules.describe(schedule) });
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) return reply.code(404).send({ error: "not_found" });
      if (error instanceof InvalidRecurrenceError) return reply.code(400).send({ error: "invalid_recurrence", message: error.message });
      if (error instanceof PickupAllowanceExceededError) {
        return reply.code(422).send({ error: "pickup_allowance_exceeded", message: error.message, wanted: error.wanted, allowed: error.allowed });
      }
      throw error;
    }
  });

  // Stopping a schedule stops future bookings. What is already booked stays booked,
  // because those are collections the resident has been told about.
  app.delete<{ Params: { id: string } }>("/v1/resident/schedules/:id", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    try {
      const schedule = await container.schedules.cancel(req.params.id, session.residentId!);
      await container.audit.record({ session, action: "schedule.cancelled", resource: "schedule", resourceId: schedule.id, newValue: { status: "cancelled" } });
      return reply.send({ schedule });
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) return reply.code(404).send({ error: "not_found" });
      throw error;
    }
  });

  // ------------------------------------------------------- preferred windows

  app.get("/v1/resident/preferences", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    try {
      return reply.send({ preferences: await container.schedules.preferences(session.residentId!) });
    } catch (error) {
      if (error instanceof SubscriptionRequiredError) return reply.code(409).send({ error: "subscription_required", message: error.message });
      throw error;
    }
  });

  app.put("/v1/resident/preferences", async (req, reply) => {
    const session = await resident(req, reply); if (!session) return;
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      return reply.send({ preferences: await container.schedules.setPreferences(session.residentId!, parsed.data.preferredWindows) });
    } catch (error) {
      if (error instanceof SubscriptionRequiredError) return reply.code(409).send({ error: "subscription_required", message: error.message });
      throw error;
    }
  });

}

async function nextPickupFor(container: Container, residentId: string) {
  const pickups = await container.store.pickups.find((p) => p.residentId === residentId && (p.status === "scheduled" || p.status === "rescheduled"));
  const upcoming = pickups
    .filter((p) => new Date(p.scheduledFor).getTime() >= Date.now() - 12 * 3600 * 1000)
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
  if (!upcoming) return null;
  const slot = await container.store.slots.get(upcoming.slotId);
  const society = await container.store.societies.get(upcoming.societyId);
  const order = (await container.store.orders.find((o) => o.pickupId === upcoming.id))[0] ?? null;
  return {
    pickupId: upcoming.id,
    orderId: order?.id ?? null,
    orderCode: order?.orderCode ?? null,
    societyName: society?.name ?? null,
    date: upcoming.scheduledFor.slice(0, 10),
    startTime: slot?.startTime ?? null,
    endTime: slot?.endTime ?? null,
    window: slot?.window ?? null,
    status: order?.state ?? upcoming.status,
  };
}
