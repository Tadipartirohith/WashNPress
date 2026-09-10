import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginSupervisor, loginAdmin } from "./helpers";

// A supervisor runs one society. Plans are priced, sold and retired by the business,
// so a supervisor reads them and does not write them.
//
// The routes were there — POST and PATCH /v1/supervisor/plans, sharing the admin's
// schema and wizard — so hiding the buttons would have left the capability sitting
// behind a token anyone signed in as a supervisor already holds. They are gone.

describe("DFT a supervisor cannot create or change a plan", () => {
  it("has no route to create one", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({
      method: "POST", url: "/v1/supervisor/plans", headers: bearer(token),
      payload: { tier: "invented", name: "Invented", monthlyPaise: 100000, garmentCap: 10, turnaroundHours: 48 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("has no route to edit one", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    const [plan] = await container.store.plans.all();
    const res = await app.inject({
      method: "PATCH", url: `/v1/supervisor/plans/${plan.id}`, headers: bearer(token),
      payload: { monthlyPaise: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("leaves the admin's own plan management alone", async () => {
    // The point is who may write a plan, not that plans stopped being writable.
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const [plan] = await container.store.plans.all();
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/plans/${plan.id}`, headers: bearer(token),
      payload: { turnaroundHours: 36 },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("DFT what a supervisor sees instead", () => {
  it("lists the residents who hold a subscription", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/subscriptions", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().subscriptions)).toBe(true);
  });

  it("carries what the table has to show, resolved rather than as ids", async () => {
    // The row is read by somebody, not joined by them: a planId and a residentId
    // would make the supervisor look up both.
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    const [resident] = await container.store.residents.all();
    const [plan] = await container.store.plans.all();
    await container.store.subscriptions.put({
      id: "sub-table", residentId: resident.id, planId: plan.id, status: "active",
      cycle: "monthly", cycleStart: "2026-09-01", cycleEnd: "2026-09-30",
      garmentsUsed: 4, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
    });

    const res = await app.inject({ method: "GET", url: "/v1/supervisor/subscriptions", headers: bearer(token) });
    const row = res.json().subscriptions.find((s: { id: string }) => s.id === "sub-table");
    expect(row).toBeTruthy();
    expect(row.planName ?? row.planTier).toBeTruthy();
    expect(row.societyName).toBeTruthy();
    expect(row.startDate).toBe("2026-09-01");
    expect(row.endDate).toBe("2026-09-30");
    expect(row.status).toBe("active");
    expect(row.unitNumber).toBeTruthy();
  });

  it("shows no row for a resident who never subscribed", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/subscriptions", headers: bearer(token) });
    const residentIds = new Set(res.json().subscriptions.map((s: { residentId: string }) => s.residentId));
    const subscribed = new Set((await container.store.subscriptions.all()).map((s) => s.residentId));
    for (const id of residentIds) expect(subscribed.has(id as string)).toBe(true);
  });

  it("shows nothing from a society this supervisor does not run", async () => {
    // Read-only is not the same as unscoped.
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/subscriptions", headers: bearer(token) });
    const residents = new Map((await container.store.residents.all()).map((r) => [r.id, r]));
    const mine = new Set((await container.store.societies.find((s) => s.supervisorUserId !== null))
      .filter((s) => s.supervisorUserId === "user-sup").map((s) => s.id));
    for (const row of res.json().subscriptions) {
      const resident = residents.get(row.residentId);
      expect(mine.has(resident!.societyId)).toBe(true);
    }
  });

  it("refuses a resident asking for the supervisor's table", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/subscriptions" });
    expect(res.statusCode).toBe(401);
  });
});
