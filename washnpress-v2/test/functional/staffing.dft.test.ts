import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, bearer, loginAdmin, loginSupervisor, loginOperator, openSlotNow, approveStaff , staffBody } from "./helpers";

// Employee availability must not be a single point of failure. Taking somebody off
// duty keeps the account and the data, and moves the work rather than stranding it.
describe("DFT staff leave and handover", () => {
  it("keeps an operator's open orders workable after they go on leave", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-leave-1", 5);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-leave-1" });
    const operatorToken = await loginOperator(app);
    const id = booked.order.id;
    await openSlotNow(container, "slot-leave-1");
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/picked-up`, headers: bearer(operatorToken), payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }) });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/start`, headers: bearer(operatorToken) });

    const supervisorToken = await loginSupervisor(app);
    const preview = await app.inject({ method: "GET", url: "/v1/supervisor/operators/user-op/handover", headers: bearer(supervisorToken) });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().openCount).toBeGreaterThan(0);

    const leave = await app.inject({
      method: "POST", url: "/v1/supervisor/operators/user-op/availability", headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "on_leave", reason: "Annual leave" }),
    });
    expect(leave.statusCode).toBe(200);
    expect(leave.json().operator.status).toBe("on_leave");
    expect(leave.json().returnedToQueue).toBeGreaterThan(0);

    // The order is untouched: same state, same history, no operator holding it.
    const order = await container.store.orders.get(id);
    expect(order).not.toBeNull();
    expect(order!.state).toBe("in_wash");
    expect(order!.assignedOperatorUserId).toBeNull();

    // And it is visible in the shared queue for a colleague to take on.
    const colleague = await container.users.createStaff({
      role: "operator", fullName: "Operator 09", phone: "9876500077",
      societyIds: ["soc-demo"], blockIds: ["block-demo-a", "block-demo-b"],
    });
    // A new operator has to be vouched for before they can work.
    await approveStaff(app, colleague.id);
    const colleagueToken = await loginOperator(app, colleague.phone);
    const queue = await app.inject({ method: "GET", url: "/v1/operations/queue", headers: bearer(colleagueToken) });
    expect((queue.json().orders as Array<{ id: string }>).some((o) => o.id === id)).toBe(true);

    const claimed = await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/claim`, headers: bearer(colleagueToken) });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().order.assignedOperatorUserId).toBe(colleague.id);
    // Processing continues from where it was, not from the beginning.
    expect(claimed.json().order.state).toBe("in_wash");
  });

  it("hands work directly to a named replacement when one is given", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-leave-2", 5);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-leave-2" });
    const operatorToken = await loginOperator(app);
    await openSlotNow(container, "slot-leave-2");
    await app.inject({ method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`, headers: bearer(operatorToken), payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }] }) });

    const replacement = await container.users.createStaff({
      role: "operator", fullName: "Operator 10", phone: "9876500078",
      societyIds: ["soc-demo"], blockIds: ["block-demo-a", "block-demo-b"],
    });
    const supervisorToken = await loginSupervisor(app);
    const leave = await app.inject({
      method: "POST", url: "/v1/supervisor/operators/user-op/availability", headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "on_leave", reassignToUserId: replacement.id, reason: "Sick" }),
    });
    expect(leave.statusCode).toBe(200);
    expect(leave.json().returnedToQueue).toBe(0);

    const order = await container.store.orders.get(booked.order.id);
    expect(order!.assignedOperatorUserId).toBe(replacement.id);

    // The move is on the record, with who held it before and who holds it now.
    const adminToken = await loginAdmin(app);
    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit?resource=order", headers: bearer(adminToken) });
    const entry = (audit.json().entries as Array<{ action: string; previousValue: unknown; newValue: unknown }>)
      .find((e) => e.action === "order.operator_reassigned");
    expect(entry).toBeDefined();
    expect(entry!.previousValue).toMatchObject({ assignedOperatorUserId: "user-op" });
    expect(entry!.newValue).toMatchObject({ assignedOperatorUserId: replacement.id });
  });

  it("refuses to hand work to somebody who is not available", async () => {
    const { app, container } = await makeTestApp();
    const away = await container.users.createStaff({
      role: "operator", fullName: "Operator 11", phone: "9876500079",
      societyIds: ["soc-demo"], blockIds: ["block-demo-a", "block-demo-b"],
    });
    await container.users.setStatus(away.id, "blocked");
    const supervisorToken = await loginSupervisor(app);
    const res = await app.inject({
      method: "POST", url: "/v1/supervisor/operators/user-op/availability", headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "on_leave", reassignToUserId: away.id }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("handover_failed");
  });

  it("keeps a society and its data intact when its supervisor is deactivated, and lets admin cover it", async () => {
    const { app, container } = await makeTestApp();
    const adminToken = await loginAdmin(app);

    const before = await app.inject({ method: "GET", url: "/v1/admin/societies/soc-demo", headers: bearer(adminToken) });
    const residentsBefore = before.json().residents.length;

    const off = await app.inject({
      method: "POST", url: "/v1/admin/users/user-sup/availability", headers: bearer(adminToken),
      payload: JSON.stringify({ status: "on_leave", reason: "Left the organisation" }),
    });
    expect(off.statusCode).toBe(200);

    // Nothing about the society was deleted, and it still records who runs it.
    const after = await app.inject({ method: "GET", url: "/v1/admin/societies/soc-demo", headers: bearer(adminToken) });
    expect(after.json().residents.length).toBe(residentsBefore);
    expect(after.json().society.supervisorUserId).toBe("user-sup");
    expect((await container.store.residents.find((r) => r.societyId === "soc-demo")).length).toBeGreaterThan(0);

    // The admin is flagged as covering the society.
    const coverage = await app.inject({ method: "GET", url: "/v1/admin/coverage", headers: bearer(adminToken) });
    const row = (coverage.json().needingCover as Array<{ societyId: string; supervisorStatus: string }>)
      .find((c) => c.societyId === "soc-demo");
    expect(row).toBeDefined();
    expect(row!.supervisorStatus).toBe("on_leave");

    // And can do the supervisor's job in the meantime: slots, societies, operators.
    const slot = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(adminToken),
      payload: JSON.stringify({ societyId: "soc-demo", date: "2099-05-05", window: "Morning", startTime: "09:00", endTime: "10:00", capacityTotal: 8 }),
    });
    expect(slot.statusCode).toBe(201);
    const slotId = slot.json().slot.id as string;
    const edited = await app.inject({ method: "PATCH", url: `/v1/admin/slots/${slotId}`, headers: bearer(adminToken), payload: JSON.stringify({ capacityTotal: 12 }) });
    expect(edited.json().slot.capacityRemaining).toBe(12);
    const cancelled = await app.inject({ method: "POST", url: `/v1/admin/slots/${slotId}/cancel`, headers: bearer(adminToken) });
    expect(cancelled.statusCode).toBe(200);

    const operator = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(adminToken),
      payload: staffBody({ firstName: "Cover", lastName: "Operator", phone: "9876500088", societyId: "soc-demo", blockIds: ["block-demo-c"] }),
    });
    expect(operator.statusCode).toBe(201);

    // A replacement supervisor picks the society straight back up. The person on
    // leave is released first, because one society holds one supervisor.
    await app.inject({
      method: "PUT", url: "/v1/admin/societies/soc-demo/supervisor", headers: bearer(adminToken),
      payload: JSON.stringify({ supervisorUserId: null }),
    });
    const replacement = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(adminToken),
      payload: staffBody({ firstName: "New", lastName: "Supervisor", phone: "9876500089", societyId: "soc-demo" }),
    });
    expect(replacement.statusCode).toBe(201);
    // The admin vouches for their new supervisor before the portal opens to them.
    await approveStaff(app, replacement.json().supervisor.id, adminToken);
    const newToken = await loginSupervisor(app, "9876500089");
    const dashboard = await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(newToken) });
    expect(dashboard.json().society.name).toBe("My Home Bhooja");
    expect(dashboard.json().societies.total).toBe(1);
  });

  it("does not ask an admin created supervisor to onboard", async () => {
    const { app } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(adminToken),
      payload: staffBody({ firstName: "Direct", lastName: "Login", phone: "9876500090", societyId: "soc-aparna" }),
    });
    expect(created.statusCode).toBe(201);

    // The supervisor signs in with the registered number and lands on their portal.
    const send = await app.inject({ method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone: "9876500090" }) });
    const otp = send.json().otpForTesting as string;
    const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone: "9876500090", otp }) });
    expect(verify.json().needsOnboarding).toBe(false);
    expect(verify.json().portal).toBe("supervisor");

    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(verify.json().token) });
    expect(me.json().needsOnboarding).toBe(false);
    // The society they were given, carried on the session rather than looked up.
    expect(me.json().societyIds).toEqual(["soc-aparna"]);
  });
});
