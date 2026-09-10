import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// What the Reports tabs have to show.
//
// Each tab was two or four numbers: subscriptions was four status counts, revenue was
// two ledger totals, operations was a total and a state histogram. None of that
// answers what an admin opens Reports to ask — which plans people are on, what was
// actually kept after refunds, how much is running late.
//
// Everything here is read off records that exist. Sustainability still reports zero
// rather than an invented figure when nothing was logged, which is the same rule.

describe("DFT the subscriptions report", () => {
  it("counts every status a subscription can be in", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/reports/subscriptions", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const key of ["total", "active", "paused", "cancelled", "expired", "changing"]) {
      expect(typeof body[key]).toBe("number");
    }
  });

  it("says which plans people are actually on", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const [resident] = await container.store.residents.all();
    const [plan] = await container.store.plans.all();
    await container.store.subscriptions.put({
      id: "sub-report", residentId: resident.id, planId: plan.id, status: "active",
      cycle: "monthly", cycleStart: "2026-09-01", cycleEnd: "2026-09-30",
      garmentsUsed: 0, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
    });
    const res = await app.inject({ method: "GET", url: "/v1/admin/reports/subscriptions", headers: bearer(token) });
    const row = res.json().byPlan.find((p: { planId: string }) => p.planId === plan.id);
    expect(row).toBeTruthy();
    expect(row.planName).toBeTruthy();
    expect(row.subscribers).toBeGreaterThan(0);
  });

  it("leaves out plans nobody is on and nobody has paid for", async () => {
    // A distribution padded with zeroes is a list of the catalogue, not a report.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/reports/subscriptions", headers: bearer(token) });
    for (const row of res.json().byPlan) {
      expect(row.subscribers > 0 || row.revenuePaise > 0).toBe(true);
    }
  });

  it("counts a subscription with a change booked", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const [resident] = await container.store.residents.all();
    const plans = await container.store.plans.all();
    await container.store.subscriptions.put({
      id: "sub-changing", residentId: resident.id, planId: plans[0].id, status: "active",
      cycle: "monthly", cycleStart: "2026-09-01", cycleEnd: "2026-09-30",
      garmentsUsed: 0, autoRenew: true, pendingPlanId: plans[1].id, pauseUntil: null, cancelReason: null,
    });
    const res = await app.inject({ method: "GET", url: "/v1/admin/reports/subscriptions", headers: bearer(token) });
    expect(res.json().changing).toBeGreaterThan(0);
  });
});

describe("DFT the revenue report", () => {
  it("separates what was earned, what went back and what is owed to the tax authority", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/reports/revenue", headers: bearer(token) });
    const body = res.json();
    for (const key of ["subscriptionRevenuePaise", "addonRevenuePaise", "refundedPaise", "taxCollectedPaise", "grossPaise", "netPaise"]) {
      expect(typeof body[key]).toBe("number");
    }
  });

  it("keeps net as gross less what was refunded", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const body = (await app.inject({ method: "GET", url: "/v1/admin/reports/revenue", headers: bearer(token) })).json();
    expect(body.netPaise).toBe(body.grossPaise - body.refundedPaise);
  });

  it("does not fold GST into revenue", async () => {
    // Tax collected is held on behalf of the tax authority. Counting it as earnings
    // is how a platform reports money it does not have.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const body = (await app.inject({ method: "GET", url: "/v1/admin/reports/revenue", headers: bearer(token) })).json();
    const parts = body.subscriptionRevenuePaise + body.addonRevenuePaise
      + body.cancellationFeePaise + body.reschedulingFeePaise;
    expect(body.grossPaise).toBe(parts);
  });
});

describe("DFT the operations report", () => {
  it("gives the counts and the rates that go with them", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const body = (await app.inject({ method: "GET", url: "/v1/admin/reports/operations", headers: bearer(token) })).json();
    for (const key of ["totalOrders", "completed", "cancelled", "delayed", "inProgress"]) {
      expect(typeof body[key]).toBe("number");
    }
    expect(body.completed + body.cancelled + body.inProgress).toBe(body.totalOrders);
  });

  it("says nothing rather than 0% when there were no orders at all", async () => {
    // "0% completed" reads as a failure. An empty period is not one.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const body = (await app.inject({
      method: "GET",
      url: "/v1/admin/reports/operations?from=1999-01-01&to=1999-01-31",
      headers: bearer(token),
    })).json();
    expect(body.totalOrders).toBe(0);
    expect(body.completionRate).toBeNull();
    expect(body.delayRate).toBeNull();
    expect(body.cancellationRate).toBeNull();
  });

  it("buckets orders by the day they were raised", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const body = (await app.inject({ method: "GET", url: "/v1/admin/reports/operations", headers: bearer(token) })).json();
    expect(Array.isArray(body.trend)).toBe(true);
    const total = body.trend.reduce((sum: number, d: { total: number }) => sum + d.total, 0);
    // Every order with a date is on the chart, and none is on it twice.
    expect(total).toBeLessThanOrEqual(body.totalOrders);
    const days = body.trend.map((d: { day: string }) => d.day);
    expect(new Set(days).size).toBe(days.length);
    expect([...days].sort()).toEqual(days);
  });

  it("draws only the days there is something to draw", async () => {
    // Inventing empty days would make a quiet week look like an outage.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const body = (await app.inject({
      method: "GET",
      url: "/v1/admin/reports/operations?from=1999-01-01&to=1999-01-31",
      headers: bearer(token),
    })).json();
    expect(body.trend).toEqual([]);
  });
});
