import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, bearer, loginResident, loginAdmin, loginSupervisor, loginOtherSupervisor, loginOperator, loginOtherOperator } from "./helpers";

// The area boundary is a backend rule, not a UI rule. These tests go straight at
// the API with a valid session for the wrong area and expect it to be refused.
describe("DFT role based access control", () => {
  it("keeps a supervisor inside their own area", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app); // Madhapur

    const societies = await app.inject({ method: "GET", url: "/v1/supervisor/societies", headers: bearer(token) });
    const ids = (societies.json().societies as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain("soc-demo");
    expect(ids).not.toContain("soc-gachibowli");

    // Naming the other area's society directly is refused, not silently allowed.
    const other = await app.inject({ method: "GET", url: "/v1/supervisor/societies/soc-gachibowli", headers: bearer(token) });
    expect(other.statusCode).toBe(403);

    // Creating a society ignores any areaId in the body and uses the session's area.
    const created = await app.inject({
      method: "POST", url: "/v1/supervisor/societies", headers: bearer(token),
      payload: JSON.stringify({ name: "Sri Ram Residency", code: "SRR", areaId: "area-gachibowli" }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().society.areaId).toBe("area-madhapur");
    await container.shutdown();
    await app.close();
  });

  it("hides another area's order from a supervisor even by direct id", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-rbac-1", 5, "soc-gachibowli");
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-gachibowli", slotId: "slot-rbac-1" });

    const madhapur = await loginSupervisor(app);
    const denied = await app.inject({ method: "GET", url: `/v1/supervisor/orders/${booked.order.id}`, headers: bearer(madhapur) });
    expect(denied.statusCode).toBe(403);

    const gachibowli = await loginOtherSupervisor(app);
    const allowed = await app.inject({ method: "GET", url: `/v1/supervisor/orders/${booked.order.id}`, headers: bearer(gachibowli) });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("refuses an operator any order outside their assigned societies", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-rbac-2", 5, "soc-gachibowli");
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-gachibowli", slotId: "slot-rbac-2" });

    const madhapurOperator = await loginOperator(app);
    const denied = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`, headers: bearer(madhapurOperator),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }] }),
    });
    expect(denied.statusCode).toBe(403);

    const rightOperator = await loginOtherOperator(app);
    const allowed = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`, headers: bearer(rightOperator),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }] }),
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("keeps supervisor search inside the permitted scope", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-rbac-3", 5, "soc-gachibowli");
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-gachibowli", slotId: "slot-rbac-3" });
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: `/v1/supervisor/search?q=${booked.order.orderCode}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().orders).toHaveLength(0);
    await app.close();
  });

  it("stops a resident reading another resident's order", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-rbac-4", 5);
    const booked = await container.scheduling.book({ residentId: "res-other", societyId: "soc-demo", slotId: "slot-rbac-4" });
    const token = await loginResident(app);
    const res = await app.inject({ method: "GET", url: `/v1/resident/orders/${booked.order.id}`, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("refuses the supervisor and operator portals to a resident, and admin to a supervisor", async () => {
    const { app } = await makeTestApp();
    const resident = await loginResident(app);
    for (const url of ["/v1/supervisor/dashboard", "/v1/operations/dashboard", "/v1/admin/dashboard"]) {
      const res = await app.inject({ method: "GET", url, headers: bearer(resident) });
      expect(res.statusCode).toBe(403);
    }
    const supervisor = await loginSupervisor(app);
    for (const url of ["/v1/admin/dashboard", "/v1/admin/areas", "/v1/admin/config"]) {
      const res = await app.inject({ method: "GET", url, headers: bearer(supervisor) });
      expect(res.statusCode).toBe(403);
    }
    await app.close();
  });

  it("blocks a supervisor from touching an operator in another area", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({
      method: "PATCH", url: "/v1/supervisor/operators/user-op-2", headers: bearer(token),
      payload: JSON.stringify({ status: "blocked" }),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("ends a session the moment the account is deactivated", async () => {
    const { app } = await makeTestApp();
    const operatorToken = await loginOperator(app);
    expect((await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(operatorToken) })).statusCode).toBe(200);

    const adminToken = await loginAdmin(app);
    const blocked = await app.inject({
      method: "PATCH", url: "/v1/admin/users/user-op/status", headers: bearer(adminToken),
      payload: JSON.stringify({ status: "blocked" }),
    });
    expect(blocked.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(operatorToken) });
    expect(after.statusCode).toBe(401);
    await app.close();
  });
});
