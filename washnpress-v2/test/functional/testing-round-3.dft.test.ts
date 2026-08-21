import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, giveSubscription, bearer, loginResident, loginOperator, loginSupervisor, loginAdmin,
} from "./helpers";

// The issues raised during the second round of testing, each one covered by the
// behaviour it asked for.

const YESTERDAY = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

describe("DFT a malformed request body is the client's mistake, not the server's", () => {
  it("answers 400 rather than 500 when the body is not valid JSON", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: '{name:"Missing quotes"}',
    });
    expect(response.statusCode).toBe(400);
    // The shape has to be the error shape the app already knows how to render, or
    // the client crashes reading a field that is not there.
    expect(response.json()).toHaveProperty("error");
  });

  it("still accepts a well formed body on the same endpoint", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: JSON.stringify({ name: "Green Meadows", code: "GRM", areaId: "area-madhapur", address: "Plot 14, Madhapur" }),
    });
    expect(response.statusCode).toBe(201);
  });

  it("treats an empty body as an empty object rather than failing", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({ method: "POST", url: "/v1/admin/societies", headers: bearer(token), payload: "" });
    // No body means no fields, which is a validation failure and not a parse failure.
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
  });
});

describe("DFT a pickup slot that has already passed", () => {
  async function seedPastSlot(container: Parameters<typeof seedSlot>[0], id: string) {
    return container.store.slots.put({
      id, societyId: "soc-demo", date: YESTERDAY, window: "Morning",
      startTime: "08:00", endTime: "11:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
  }

  it("is not offered to the resident", async () => {
    const { app, container } = await makeTestApp();
    await seedPastSlot(container, "slot-past-1");
    const token = await loginResident(app);
    const response = await app.inject({ method: "GET", url: `/v1/slots?date=${YESTERDAY}`, headers: bearer(token) });
    expect(response.json().slots).toEqual([]);
  });

  it("cannot be booked even when its id is known", async () => {
    const { app, container } = await makeTestApp();
    await seedPastSlot(container, "slot-past-2");
    const token = await loginResident(app);
    const response = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-past-2" }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("slot_in_past");
  });

  it("gives its capacity back when a booking is refused", async () => {
    const { app, container } = await makeTestApp();
    await seedPastSlot(container, "slot-past-3");
    const token = await loginResident(app);
    await app.inject({ method: "POST", url: "/v1/pickups", headers: bearer(token), payload: JSON.stringify({ slotId: "slot-past-3" }) });
    const slot = await container.store.slots.get("slot-past-3");
    // A refused booking must not quietly consume a place in the slot.
    expect(slot?.capacityRemaining).toBe(5);
  });

  it("is left out of the supervisor's schedule unless it is asked for", async () => {
    const { app, container } = await makeTestApp();
    await seedPastSlot(container, "slot-past-4");
    const token = await loginSupervisor(app);
    const current = await app.inject({ method: "GET", url: "/v1/supervisor/slots", headers: bearer(token) });
    expect(current.json().slots.some((s: { id: string }) => s.id === "slot-past-4")).toBe(false);

    const withPast = await app.inject({ method: "GET", url: "/v1/supervisor/slots?includePast=true", headers: bearer(token) });
    expect(withPast.json().slots.some((s: { id: string }) => s.id === "slot-past-4")).toBe(true);
  });

  it("cannot be created by a supervisor in the first place", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const response = await app.inject({
      method: "POST", url: "/v1/supervisor/slots", headers: bearer(token),
      payload: JSON.stringify({ societyId: "soc-demo", date: YESTERDAY, window: "Morning", startTime: "08:00", endTime: "11:00", capacityTotal: 10 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("slot_in_past");
  });
});

describe("DFT a pickup that was missed yesterday", () => {
  it("stays in the operator's queue instead of disappearing behind a date filter", async () => {
    const { app, container } = await makeTestApp();
    // A booking made for a slot that has since passed and was never collected.
    await seedSlot(container, "slot-overdue", 5);
    const residentToken = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
      payload: JSON.stringify({ slotId: "slot-overdue" }),
    });
    const pickupId = booked.json().pickup.id;
    const pickup = await container.store.pickups.get(pickupId);
    pickup!.scheduledFor = `${YESTERDAY}T08:00:00.000Z`;
    await container.store.pickups.put(pickup!);

    const operatorToken = await loginOperator(app);
    const queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    const rows = queue.json().pickups as Array<{ pickupId: string; overdue: boolean; scheduledDate: string }>;
    const found = rows.find((r) => r.pickupId === pickupId);

    expect(found).toBeDefined();
    expect(found!.overdue).toBe(true);
    expect(queue.json().overdueCount).toBeGreaterThan(0);
    // The oldest waits longest, so it sorts to the top.
    expect(rows[0].scheduledDate <= TODAY).toBe(true);
  });

  it("is still reachable by asking for its own date", async () => {
    const { app } = await makeTestApp();
    const token = await loginOperator(app);
    const response = await app.inject({ method: "GET", url: `/v1/operations/pickups?date=${YESTERDAY}`, headers: bearer(token) });
    expect(response.statusCode).toBe(200);
  });
});

describe("DFT each garment is processed according to the service it was sent for", () => {
  async function bookWith(app: Awaited<ReturnType<typeof makeTestApp>>["app"], container: Awaited<ReturnType<typeof makeTestApp>>["container"], slotId: string, serviceId: string) {
    await seedSlot(container, slotId, 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId, lines: [{ category: "Shirts", quantity: 3, serviceId }] }),
    });
    const orderId = booked.json().order.id as string;
    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }),
    });
    return { orderId, operatorToken };
  }

  it("does not offer washing on an Iron Only order", async () => {
    const { app, container } = await makeTestApp();
    const { orderId, operatorToken } = await bookWith(app, container, "slot-iron-only", "iron_only");

    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    const order = detail.json().order;
    expect(order.processing.requiresClean).toBe(false);
    expect(order.processing.requiresPress).toBe(true);
    expect(order.nextActions.map((a: { to: string }) => a.to)).toEqual(["ironing"]);

    // And the backend refuses it even if a client asks anyway.
    const washed = await app.inject({ method: "POST", url: `/v1/operations/orders/${orderId}/wash/start`, headers: bearer(operatorToken) });
    expect(washed.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("sends a Wash Only order straight from washing to quality check", async () => {
    const { app, container } = await makeTestApp();
    const { orderId, operatorToken } = await bookWith(app, container, "slot-wash-only", "wash_only");

    await app.inject({ method: "POST", url: `/v1/operations/orders/${orderId}/wash/start`, headers: bearer(operatorToken) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${orderId}/wash/complete`, headers: bearer(operatorToken) });

    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    // No ironing stage to sit in, so it is waiting for QC already.
    expect(detail.json().order.state).toBe("qc");
    expect(detail.json().order.stages.map((s: { state: string }) => s.state)).not.toContain("ironing");
  });

  it("makes an order that needs both go through both", async () => {
    const { app, container } = await makeTestApp();
    const { orderId, operatorToken } = await bookWith(app, container, "slot-both", "wash_iron");

    await app.inject({ method: "POST", url: `/v1/operations/orders/${orderId}/wash/start`, headers: bearer(operatorToken) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${orderId}/wash/complete`, headers: bearer(operatorToken) });
    const midway = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    expect(midway.json().order.state).toBe("ironing");

    await app.inject({ method: "POST", url: `/v1/operations/orders/${orderId}/ironing/complete`, headers: bearer(operatorToken) });
    const done = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    expect(done.json().order.state).toBe("qc");
  });

  it("names the cleaning stage after the service, so dry cleaning does not read as washing", async () => {
    const { app, container } = await makeTestApp();
    const { orderId, operatorToken } = await bookWith(app, container, "slot-dryclean", "dryclean_iron");

    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    const order = detail.json().order;
    expect(order.processing.cleanLabel).toBe("Dry Cleaning");
    expect(order.nextActions[0].label).toBe("Start Dry Clean");
  });

  it("tells the operator what each individual line needs", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-mixed", 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-mixed", lines: [
        { category: "Shirts", quantity: 4, serviceId: "dryclean_iron" },
        { category: "Shirts", quantity: 6, serviceId: "iron_only" },
      ] }),
    });
    const orderId = booked.json().order.id;
    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 10 }] }),
    });

    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    const lines = detail.json().order.processing.lines as Array<{ serviceName: string; stages: Array<{ label: string }> }>;
    expect(lines).toHaveLength(2);
    expect(lines[0].stages.map((s) => s.label)).toEqual(["Dry Cleaning", "Ironing"]);
    expect(lines[1].stages.map((s) => s.label)).toEqual(["Ironing"]);
  });
});

describe("DFT the garment service catalogue", () => {
  it("lets an admin add a service without resending the whole catalogue", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const before = await app.inject({ method: "GET", url: "/v1/admin/config", headers: bearer(token) });
    const countBefore = before.json().config.garmentServices.length;

    const created = await app.inject({
      method: "POST", url: "/v1/admin/config/services", headers: bearer(token),
      payload: JSON.stringify({
        name: "Starch and Press", unitPricePaise: 4000,
        pricesPaise: { Sarees: 9000 }, requiresClean: false, requiresPress: true,
      }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().service.id).toBe("starch_and_press");
    // Nothing was dropped by omission.
    expect(created.json().config.garmentServices).toHaveLength(countBefore + 1);
  });

  it("makes a newly added service immediately bookable at its per garment price", async () => {
    const { app, container } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/config/services", headers: bearer(adminToken),
      payload: JSON.stringify({ name: "Starch and Press", unitPricePaise: 4000, pricesPaise: { Sarees: 9000 }, requiresClean: false, requiresPress: true }),
    });

    await seedSlot(container, "slot-new-service", 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-new-service", lines: [{ category: "Sarees", quantity: 2, serviceId: "starch_and_press" }] }),
    });
    expect(booked.json().order.servicesPaise).toBe(2 * 9000);
  });

  it("refuses a duplicate rather than overwriting a service in use", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/config/services", headers: bearer(token),
      payload: JSON.stringify({ id: "dryclean_iron", name: "Dry Clean and Iron" }),
    });
    expect(response.statusCode).toBe(409);
  });

  it("edits a service in place", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "PATCH", url: "/v1/admin/config/services/iron_only", headers: bearer(token),
      payload: JSON.stringify({ pricesPaise: { Shirts: 2200 } }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().service.pricesPaise.Shirts).toBe(2200);
  });

  it("retires a service rather than deleting it, and will not retire the base one", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const retired = await app.inject({ method: "DELETE", url: "/v1/admin/config/services/premium_care", headers: bearer(token) });
    expect(retired.statusCode).toBe(200);
    const service = retired.json().config.garmentServices.find((s: { id: string }) => s.id === "premium_care");
    // Still present, because orders already in flight reference it.
    expect(service.isActive).toBe(false);

    const base = await app.inject({ method: "DELETE", url: "/v1/admin/config/services/wash_iron", headers: bearer(token) });
    expect(base.statusCode).toBe(409);
  });

  it("records every catalogue change in the audit log", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/config/services", headers: bearer(token),
      payload: JSON.stringify({ name: "Starch and Press" }),
    });
    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit?resource=garment_service", headers: bearer(token) });
    expect(audit.json().entries.length).toBeGreaterThan(0);
  });
});

describe("DFT what a plan covers", () => {
  it("charges nothing for a covered service and full price for one outside the plan", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-coverage", 5);
    // Basic covers wash and iron, and does not cover dry cleaning.
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-coverage", lines: [
        { category: "Shirts", quantity: 4, serviceId: "wash_iron" },
        { category: "Sarees", quantity: 2, serviceId: "dryclean_iron" },
      ] }),
    });
    const lines = booked.json().order.lines as Array<{ serviceId: string; coveredByPlan: boolean; linePricePaise: number }>;
    const covered = lines.find((l) => l.serviceId === "wash_iron")!;
    const extra = lines.find((l) => l.serviceId === "dryclean_iron")!;
    expect(covered.coveredByPlan).toBe(true);
    expect(covered.linePricePaise).toBe(0);
    expect(extra.coveredByPlan).toBe(false);
    expect(extra.linePricePaise).toBeGreaterThan(0);
  });

  it("lets an admin change which services a plan covers", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const plans = await app.inject({ method: "GET", url: "/v1/admin/plans", headers: bearer(token) });
    const planId = plans.json().plans[0].id;
    const response = await app.inject({
      method: "PATCH", url: `/v1/admin/plans/${planId}`, headers: bearer(token),
      payload: JSON.stringify({ coveredServiceIds: ["wash_iron", "dryclean_iron"] }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.coveredServiceIds).toEqual(["wash_iron", "dryclean_iron"]);
  });
});

describe("DFT a scheduled plan change", () => {
  it("is shown in full rather than as a bare flag", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const plans = await app.inject({ method: "GET", url: "/v1/resident/subscription", headers: bearer(token) });
    const current = plans.json().current;
    const target = (plans.json().availablePlans as Array<{ id: string; isCurrent: boolean }>).find((p) => !p.isCurrent)!;

    await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: target.id }),
    });

    const usage = await app.inject({ method: "GET", url: "/v1/subscription/usage", headers: bearer(token) });
    const pending = usage.json().usage.pendingPlan;
    expect(pending).toBeTruthy();
    expect(pending.planId).toBe(target.id);
    expect(pending.tier).toBeTruthy();
    expect(pending.monthlyPaise).toBeGreaterThan(0);
    // When it starts, and whether it costs more or less than what they are on.
    expect(pending.effectiveFrom).toBe(current.renewalDate);
    expect(["upgrade", "downgrade", "sidegrade"]).toContain(pending.direction);
  });

  it("can be called off, leaving the resident on the plan they are already on", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const plans = await app.inject({ method: "GET", url: "/v1/resident/subscription", headers: bearer(token) });
    const target = (plans.json().availablePlans as Array<{ id: string; isCurrent: boolean }>).find((p) => !p.isCurrent)!;
    await app.inject({ method: "POST", url: "/v1/subscription/change", headers: bearer(token), payload: JSON.stringify({ planId: target.id }) });

    const cancelled = await app.inject({ method: "DELETE", url: "/v1/subscription/change", headers: bearer(token) });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().subscription.pendingPlan).toBeNull();
    expect(cancelled.json().subscription.pendingPlanId).toBeNull();
  });
});

describe("DFT one active subscription per resident", () => {
  it("refuses a second subscription rather than creating a duplicate", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const response = await app.inject({
      method: "POST", url: "/v1/subscription/subscribe", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-standard", cycle: "monthly" }),
    });
    // Two active rows for one resident would make every later read depend on
    // which one it happened to find first.
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("already_subscribed");
    const active = await container.store.subscriptions.find((sub) => sub.residentId === "res-demo" && sub.status === "active");
    expect(active).toHaveLength(1);
  });

  it("settles on the most recently started one if a database already holds several", async () => {
    const { app, container } = await makeTestApp();
    const older = await giveSubscription(container, "res-demo", "plan-basic");
    older.cycleStart = new Date(Date.now() - 60 * 86400_000).toISOString();
    await container.store.subscriptions.put(older);
    await container.store.subscriptions.put({ ...older, id: "sub-newer", planId: "plan-standard", cycleStart: new Date().toISOString() });

    const token = await loginResident(app);
    const usage = await app.inject({ method: "GET", url: "/v1/subscription/usage", headers: bearer(token) });
    expect(usage.json().usage.planId).toBe("plan-standard");
  });
});

describe("DFT a plan written before service coverage existed", () => {
  it("still covers the ordinary wash and iron rather than charging for it", async () => {
    const { app, container } = await makeTestApp();
    // A stored plan from an earlier version has no coveredServiceIds at all.
    const plan = await container.store.plans.get("plan-basic");
    delete (plan as { coveredServiceIds?: string[] }).coveredServiceIds;
    await container.store.plans.put(plan!);
    await giveSubscription(container, "res-demo", "plan-basic");

    await seedSlot(container, "slot-legacy-plan", 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-legacy-plan", lines: [{ category: "Shirts", quantity: 3, serviceId: "wash_iron" }] }),
    });
    expect(booked.json().order.lines[0].coveredByPlan).toBe(true);
    expect(booked.json().order.servicesPaise).toBe(0);
  });
});

describe("DFT finding an operator", () => {
  it("filters by availability and by name, and counts each state", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const all = await app.inject({ method: "GET", url: "/v1/supervisor/operators", headers: bearer(token) });
    expect(all.json().counts.all).toBeGreaterThan(0);
    expect(all.json().counts).toHaveProperty("on_leave");

    const operator = all.json().operators[0];
    const byName = await app.inject({
      method: "GET", url: `/v1/supervisor/operators?q=${encodeURIComponent(operator.fullName.split(" ")[0])}`,
      headers: bearer(token),
    });
    expect(byName.json().operators.length).toBeGreaterThan(0);

    const onLeave = await app.inject({ method: "GET", url: "/v1/supervisor/operators?status=on_leave", headers: bearer(token) });
    expect(onLeave.json().operators.every((o: { status: string }) => o.status === "on_leave")).toBe(true);
  });

  it("keeps the counts stable while the list is narrowed", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const all = await app.inject({ method: "GET", url: "/v1/supervisor/operators", headers: bearer(token) });
    const narrowed = await app.inject({ method: "GET", url: "/v1/supervisor/operators?status=on_leave", headers: bearer(token) });
    expect(narrowed.json().counts).toEqual(all.json().counts);
  });
});

describe("DFT searching societies", () => {
  it("matches a substring in any case, with and without an area filter", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    for (const q of ["apar", "APAR", "Apar"]) {
      const response = await app.inject({ method: "GET", url: `/v1/admin/societies?q=${q}`, headers: bearer(token) });
      expect(response.json().societies.length).toBeGreaterThan(0);
    }
    const scoped = await app.inject({ method: "GET", url: "/v1/admin/societies?q=apar&areaId=area-madhapur", headers: bearer(token) });
    expect(scoped.json().societies.length).toBeGreaterThan(0);
  });
});
