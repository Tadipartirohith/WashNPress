import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor } from "./helpers";
import type { Society, User } from "../../src/domain/models";

// A record that has been in the database for a while may predate a field, or may have
// been written by an import that did not set one. One such record must cost that
// record a default — not cost the whole endpoint a 500 and every user of that screen
// their data.
//
// These are the exact failures a tester reported: the admin user list and society
// creation answering 500 with "Cannot read properties of undefined (reading 'map')"
// and "... (reading 'toLowerCase')".

// Written straight into the store, bypassing the types, because that is precisely
// what a real database containing an older record looks like.
function writeLegacyUser(container: Awaited<ReturnType<typeof makeTestApp>>["container"]) {
  return container.store.users.put({
    id: "user-legacy", phone: "9990001111", fullName: "Legacy Resident",
    email: null, employeeId: null, status: "active", roles: ["resident"],
    lastLoginAt: null, areaId: null, createdAt: "2026-01-01T00:00:00.000Z",
    // societyIds deliberately absent
  } as unknown as User);
}

function writeLegacySociety(container: Awaited<ReturnType<typeof makeTestApp>>["container"]) {
  return container.store.societies.put({
    id: "soc-legacy", name: "Legacy Society", areaId: "area-madhapur",
    address: null, city: "Hyderabad", state: "Telangana",
    status: "active", createdAt: "2026-01-01T00:00:00.000Z",
    // code deliberately absent
  } as unknown as Society);
}

describe("DFT a record missing a field does not take an endpoint down", () => {
  it("lists users when one of them has no societyIds", async () => {
    const { app, container } = await makeTestApp();
    await writeLegacyUser(container);
    const token = await loginAdmin(app);

    const all = await app.inject({ method: "GET", url: "/v1/admin/users", headers: bearer(token) });
    expect(all.statusCode).toBe(200);
    expect(all.json().users.some((u: { id: string }) => u.id === "user-legacy")).toBe(true);

    const residents = await app.inject({ method: "GET", url: "/v1/admin/users?role=resident", headers: bearer(token) });
    expect(residents.statusCode).toBe(200);
    // The record is repaired on the way out rather than dropped.
    const legacy = residents.json().users.find((u: { id: string }) => u.id === "user-legacy");
    expect(legacy.societyIds).toEqual([]);
    expect(legacy.societyNames).toEqual([]);
  });

  it("creates a society when an existing one has no code", async () => {
    const { app, container } = await makeTestApp();
    await writeLegacySociety(container);
    const token = await loginAdmin(app);

    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: JSON.stringify({ name: "RainBow Vistas", code: "RBV", areaId: "area-madhapur", address: "IDPL" }),
    });
    expect(response.statusCode).toBe(201);
  });

  it("lists societies for a supervisor when one of them is incomplete", async () => {
    const { app, container } = await makeTestApp();
    await writeLegacySociety(container);
    const token = await loginSupervisor(app);
    const response = await app.inject({ method: "GET", url: "/v1/supervisor/societies", headers: bearer(token) });
    expect(response.statusCode).toBe(200);
  });

  it("still refuses a genuine duplicate, so the repair has not weakened the check", async () => {
    const { app, container } = await makeTestApp();
    await writeLegacySociety(container);
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: JSON.stringify({ name: "Anything", code: "MHB", areaId: "area-madhapur", address: "Road 1" }),
    });
    expect(response.statusCode).toBe(409);
  });

  it("carries no 500 into any admin or supervisor screen", async () => {
    const { app, container } = await makeTestApp();
    await writeLegacyUser(container);
    await writeLegacySociety(container);

    const admin = await loginAdmin(app);
    for (const path of [
      "/v1/admin/dashboard", "/v1/admin/users", "/v1/admin/societies", "/v1/admin/areas",
      "/v1/admin/supervisors", "/v1/admin/operators", "/v1/admin/orders", "/v1/admin/slots",
      "/v1/admin/revenue", "/v1/admin/reports", "/v1/admin/issues",
    ]) {
      const res = await app.inject({ method: "GET", url: path, headers: bearer(admin) });
      expect(res.statusCode, path).toBeLessThan(500);
    }

    const supervisor = await loginSupervisor(app);
    for (const path of [
      "/v1/supervisor/dashboard", "/v1/supervisor/societies", "/v1/supervisor/operators",
      "/v1/supervisor/slots", "/v1/supervisor/orders", "/v1/supervisor/pickups",
      "/v1/supervisor/workload", "/v1/supervisor/issues", "/v1/supervisor/reports",
    ]) {
      const res = await app.inject({ method: "GET", url: path, headers: bearer(supervisor) });
      expect(res.statusCode, path).toBeLessThan(500);
    }
  });
});
