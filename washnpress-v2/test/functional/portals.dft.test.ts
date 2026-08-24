import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, giveSubscription, bearer, loginAdmin, loginSupervisor, loginOperator, loginResident, openSlotNow,
} from "./helpers";
import { serviceDay } from "../../src/services/scheduling-service";

describe("DFT admin portal", () => {
  it("summarises the whole platform on one dashboard", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/dashboard", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Five areas are seeded: two with a supervisor and three still waiting for one,
    // so admin coverage and "create staff before a supervisor exists" both have
    // something real to work with.
    expect(body.areas.total).toBe(5);
    expect(body.supervisors.total).toBe(2);
    expect(body.societies.total).toBe(3);
    expect(body.orders).toHaveProperty("delayed");
    expect(body.revenue).toHaveProperty("totalRevenuePaise");
  });

  it("creates an area, creates a supervisor and assigns them, writing the audit trail", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);

    const area = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      // A name and code the seed does not already use, since the seed now carries
      // the five areas the requirements name.
      payload: JSON.stringify({ name: "Miyapur", code: "MYP", region: "Hyderabad" }),
    });
    expect(area.statusCode).toBe(201);
    const areaId = area.json().area.id as string;

    const supervisor = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({ fullName: "Kiran Rao", phone: "9876500099", employeeId: "WNP-SUP-09", areaId }),
    });
    expect(supervisor.statusCode).toBe(201);
    expect(supervisor.json().supervisor.areaId).toBe(areaId);

    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit", headers: bearer(token) });
    const actions = (audit.json().entries as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain("area.created");
    expect(actions).toContain("supervisor.created");
    expect(actions).toContain("area.supervisor_assigned");
  });

  it("moves a supervisor to another area and releases the previous one", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/areas/area-gachibowli/supervisor", headers: bearer(token),
      payload: JSON.stringify({ supervisorUserId: "user-sup" }),
    });
    expect(res.statusCode).toBe(200);
    const areas = await app.inject({ method: "GET", url: "/v1/admin/areas", headers: bearer(token) });
    const list = areas.json().areas as Array<{ id: string; supervisorUserId: string | null }>;
    expect(list.find((a) => a.id === "area-gachibowli")?.supervisorUserId).toBe("user-sup");
    expect(list.find((a) => a.id === "area-madhapur")?.supervisorUserId).toBeNull();
  });

  it("keeps the additional garment rate as global admin-only configuration", async () => {
    const { app } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const patched = await app.inject({
      method: "PATCH", url: "/v1/admin/config", headers: bearer(adminToken),
      payload: JSON.stringify({ additionalGarmentRatePaise: 3500 }),
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().config.additionalGarmentRatePaise).toBe(3500);

    const supervisorToken = await loginSupervisor(app);
    const refused = await app.inject({
      method: "PATCH", url: "/v1/admin/config", headers: bearer(supervisorToken),
      payload: JSON.stringify({ additionalGarmentRatePaise: 1 }),
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe("DFT supervisor portal", () => {
  it("reports only the assigned area on the dashboard", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.area.name).toBe("Madhapur");
    // Two Madhapur societies are seeded; the Gachibowli one must not be counted.
    expect(body.societies.total).toBe(2);
  });

  it("manages slots for its own societies and refuses another area's slot", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    const created = await app.inject({
      method: "POST", url: "/v1/supervisor/slots", headers: bearer(token),
      payload: JSON.stringify({ societyId: "soc-demo", date: "2099-03-03", window: "Morning", startTime: "09:00", endTime: "10:00", capacityTotal: 10 }),
    });
    expect(created.statusCode).toBe(201);
    const slotId = created.json().slot.id as string;

    const updated = await app.inject({
      method: "PATCH", url: `/v1/supervisor/slots/${slotId}`, headers: bearer(token),
      payload: JSON.stringify({ capacityTotal: 12 }),
    });
    expect(updated.json().slot.capacityRemaining).toBe(12);

    // Capacity cannot be lowered below what is already booked.
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId });
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId });
    const shrunk = await app.inject({
      method: "PATCH", url: `/v1/supervisor/slots/${slotId}`, headers: bearer(token),
      payload: JSON.stringify({ capacityTotal: 1 }),
    });
    expect(shrunk.statusCode).toBe(409);

    await seedSlot(container, "slot-other-area", 5, "soc-gachibowli");
    const refused = await app.inject({
      method: "PATCH", url: "/v1/supervisor/slots/slot-other-area", headers: bearer(token),
      payload: JSON.stringify({ capacityTotal: 1 }),
    });
    expect(refused.statusCode).toBe(403);
  });

  it("creates an operator inside its own area and shows their workload", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const created = await app.inject({
      method: "POST", url: "/v1/supervisor/operators", headers: bearer(token),
      payload: JSON.stringify({ fullName: "Operator 03", phone: "9876500055", societyIds: ["soc-demo"] }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().operator.areaId).toBe("area-madhapur");

    const refused = await app.inject({
      method: "POST", url: "/v1/supervisor/operators", headers: bearer(token),
      payload: JSON.stringify({ fullName: "Operator 04", phone: "9876500056", societyIds: ["soc-gachibowli"] }),
    });
    expect(refused.statusCode).toBe(403);

    const workload = await app.inject({ method: "GET", url: "/v1/supervisor/workload", headers: bearer(token) });
    expect(workload.statusCode).toBe(200);
    expect(workload.json().workload.length).toBeGreaterThan(0);
  });

  it("works a QC failure through review to resolution", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-sup-qc", 5);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-sup-qc" });
    const operatorToken = await loginOperator(app);
    const id = booked.order.id;
    await openSlotNow(container, "slot-sup-qc");
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/picked-up`, headers: bearer(operatorToken), payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/start`, headers: bearer(operatorToken) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/complete`, headers: bearer(operatorToken) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/ironing/complete`, headers: bearer(operatorToken) });
    const failed = await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/qc`, headers: bearer(operatorToken), payload: JSON.stringify({ pass: false, reason: "Stain remaining" }) });
    expect(failed.json().order.state).toBe("qc_hold");

    const supervisorToken = await loginSupervisor(app);
    const issues = await app.inject({ method: "GET", url: "/v1/supervisor/issues?status=open", headers: bearer(supervisorToken) });
    const issue = (issues.json().issues as Array<{ id: string; category: string }>).find((i) => i.category === "qc_fail");
    expect(issue).toBeDefined();

    const resolved = await app.inject({
      method: "PATCH", url: `/v1/supervisor/issues/${issue!.id}/status`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "resolved", resolution: "Rewashed and re-checked" }),
    });
    expect(resolved.json().issue.status).toBe("resolved");
    expect(resolved.json().issue.resolution).toBe("Rewashed and re-checked");

    const qc = await app.inject({ method: "GET", url: "/v1/supervisor/qc", headers: bearer(supervisorToken) });
    expect((qc.json().qc as Array<{ qcStatus: string }>).some((o) => o.qcStatus === "failed")).toBe(true);
  });
});

describe("DFT operations portal", () => {
  it("computes the quantity split for the operator instead of accepting it", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-ops-1", 5);
    // Basic plan: 40 garments, 35 already used, so 5 remain.
    const sub = await giveSubscription(container, "res-demo", "plan-basic", 35);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-ops-1" });
    const token = await loginOperator(app);

    const items = [
      { category: "Shirts", quantity: 8 }, { category: "Trousers", quantity: 5 },
      { category: "Bedsheets", quantity: 4 }, { category: "Other", quantity: 3 },
    ];
    const preview = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.order.id}/garments/preview`,
      headers: bearer(token), payload: JSON.stringify({ items }),
    });
    expect(preview.json().summary).toMatchObject({ acceptedCount: 20, subscriptionCoveredCount: 5, additionalCount: 15 });

    await openSlotNow(container, "slot-ops-1");
    const pickedUp = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`,
      headers: bearer(token), payload: JSON.stringify({ items }),
    });
    const order = pickedUp.json().order;
    expect(order.state).toBe("picked_up");
    expect(order.acceptedCount).toBe(20);
    expect(order.subscriptionCoveredCount).toBe(5);
    expect(order.additionalCount).toBe(15);
    expect(order.additionalChargePaise).toBe(15 * order.additionalRatePaise);

    // The subscription is finalised from the accepted quantity, not the estimate.
    const after = await container.store.subscriptions.get(sub.id);
    expect(after!.garmentsUsed).toBe(40);
  });

  it("refuses a pickup with no garment quantity", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-ops-2", 5);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-ops-2" });
    const token = await loginOperator(app);
    await openSlotNow(container, "slot-ops-2");
    const res = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`,
      headers: bearer(token), payload: JSON.stringify({ items: [] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("quantity_required");
  });

  it("requires a reason on a QC failure", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-ops-3", 5);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-ops-3" });
    const token = await loginOperator(app);
    const id = booked.order.id;
    await openSlotNow(container, "slot-ops-3");
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/picked-up`, headers: bearer(token), payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 1 }] }) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/start`, headers: bearer(token) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/complete`, headers: bearer(token) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/ironing/complete`, headers: bearer(token) });
    const res = await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/qc`, headers: bearer(token), payload: JSON.stringify({ pass: false }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("qc_reason_required");
  });

  it("moves a picked up order out of the pickup queue but keeps it reachable", async () => {
    const { app, container } = await makeTestApp();
    // The operation's own calendar day, which is what the service books against.
    const today = serviceDay(new Date());
    await container.store.slots.put({ id: "slot-ops-4", societyId: "soc-demo", date: today, window: "Morning", startTime: "08:00", endTime: "11:00", capacityTotal: 5, capacityRemaining: 5, isActive: true });
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-ops-4" });
    const token = await loginOperator(app);

    const before = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(token) });
    expect((before.json().pickups as Array<{ orderId: string }>).some((p) => p.orderId === booked.order.id)).toBe(true);

    await openSlotNow(container, "slot-ops-4");
    await app.inject({ method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`, headers: bearer(token), payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }] }) });

    const after = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(token) });
    expect((after.json().pickups as Array<{ orderId: string }>).some((p) => p.orderId === booked.order.id)).toBe(false);

    const active = await app.inject({ method: "GET", url: "/v1/operations/active", headers: bearer(token) });
    expect((active.json().pickedUp as Array<{ id: string }>).some((o) => o.id === booked.order.id)).toBe(true);

    const search = await app.inject({ method: "GET", url: `/v1/operations/search?q=${booked.order.orderCode}`, headers: bearer(token) });
    expect((search.json().orders as Array<{ id: string }>).some((o) => o.id === booked.order.id)).toBe(true);
  });
});

describe("DFT resident portal", () => {
  it("reports onboarding status and completes it once", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app, "9876511111"); // new number, no resident record

    const status = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(token) });
    expect(status.json().completed).toBe(false);
    expect(status.json().requiredFields).toContain("unitNumber");
    expect(status.json().societies.length).toBeGreaterThan(0);

    const done = await app.inject({
      method: "POST", url: "/v1/auth/onboarding", headers: bearer(token),
      payload: JSON.stringify({ fullName: "New Resident", societyId: "soc-demo", unitNumber: "B-101", pickupAddress: "B-101, My Home Bhooja" }),
    });
    expect(done.statusCode).toBe(201);
    const newToken = done.json().token as string;

    const after = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(newToken) });
    expect(after.json().completed).toBe(true);
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(newToken) });
    expect(me.json().needsOnboarding).toBe(false);
    expect(me.json().portal).toBe("resident");
  });

  it("separates current, upcoming and previous orders and keeps delivered ones", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-res-1", 5);
    await seedSlot(container, "slot-res-2", 5);
    const active = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-res-1" });
    const upcoming = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-res-2" });

    const operatorToken = await loginOperator(app);
    const id = active.order.id;
    // Only the active order's slot has come round; the other stays upcoming, which
    // is the distinction this test is about.
    await openSlotNow(container, "slot-res-1");
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/picked-up`, headers: bearer(operatorToken), payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }] }) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/start`, headers: bearer(operatorToken) });

    const token = await loginResident(app);
    const orders = await app.inject({ method: "GET", url: "/v1/resident/orders", headers: bearer(token) });
    const body = orders.json();
    expect((body.current as Array<{ id: string }>).some((o) => o.id === id)).toBe(true);
    expect((body.upcoming as Array<{ id: string }>).some((o) => o.id === upcoming.order.id)).toBe(true);

    const dashboard = await app.inject({ method: "GET", url: "/v1/resident/dashboard", headers: bearer(token) });
    expect(dashboard.json().currentOrder.id).toBe(id);
    expect(dashboard.json().upcomingPickup).not.toBeNull();
    expect(dashboard.json().notifications.length).toBeGreaterThan(0);

    const tracking = await app.inject({ method: "GET", url: `/v1/orders/${id}/tracking`, headers: bearer(token) });
    const stages = tracking.json().stages as Array<{ state: string; status: string }>;
    expect(stages.find((s) => s.state === "in_wash")?.status).toBe("current");
    expect(stages.find((s) => s.state === "picked_up")?.status).toBe("completed");
    expect(stages.find((s) => s.state === "delivered")?.status).toBe("pending");
  });

  it("shows subscription usage derived from the accepted quantity", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-standard", 55);
    const token = await loginResident(app);
    const res = await app.inject({ method: "GET", url: "/v1/subscription/usage", headers: bearer(token) });
    expect(res.json().usage).toMatchObject({ planTier: "Standard", allowance: 80, used: 55, remaining: 25 });
  });
});
