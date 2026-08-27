import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, loginOperator, loginAdmin } from "./helpers";
import { serviceDay, today, withinServiceDays } from "../../src/services/scheduling-service";

// The reporting and analytics defects from the sixth round: an end date that was
// silently excluded, a queue that claimed one ordering and used another, analytics
// that ignored the filters beside them, and an earnings figure that was invented.

const putOrder = (container: Awaited<ReturnType<typeof makeTestApp>>["container"], over: Record<string, unknown> = {}) =>
  container.store.orders.put({
    id: `ord-${Math.round(Math.random() * 1e9)}`, orderCode: "ORD-7001", pickupId: null,
    residentId: "res-demo", societyId: "soc-demo", subscriptionId: null,
    state: "delivered", qrBatchCode: null, items: [], addonIds: [], lines: [], servicesPaise: 0,
    estimatedCount: 3, pickupCount: 3, acceptedCount: 3, subscriptionCoveredCount: 3,
    additionalCount: 0, additionalRatePaise: null, additionalChargePaise: null, payPerOrder: false,
    additionalChargeStatus: "none", deliveryCount: null, qcPassed: null, qcReason: null, qcAttempts: 0,
    pickupFailureReason: null, discrepancyReason: null, assignedOperatorUserId: null, deliveredByUserId: null,
    expectedCompletionAt: null, pickedUpAt: null, deliveredAt: new Date().toISOString(),
    rating: null, ratingComment: null, timeline: [], createdAt: new Date().toISOString(),
    ...over,
  } as never);

describe("DFT a date range includes the day it ends on", () => {
  it("counts a record created during the last day of the range", () => {
    // The whole point: a timestamp at ten in the morning on the end date used to sort
    // after the bare date and drop out of the range entirely.
    expect(withinServiceDays("2026-08-24T10:00:00.000Z", "2026-08-20", "2026-08-24")).toBe(true);
    // The last moment of the 24th in IST is 18:29 UTC; after that it is the 25th.
    expect(withinServiceDays("2026-08-24T18:29:00.000Z", "2026-08-24", "2026-08-24")).toBe(true);
    expect(withinServiceDays("2026-08-24T18:31:00.000Z", "2026-08-24", "2026-08-24")).toBe(false);
    expect(withinServiceDays("2026-08-25T06:00:00.000Z", "2026-08-20", "2026-08-24")).toBe(false);
    // 23:00 UTC on the 19th is already the 20th in IST, so it is inside the range.
    expect(withinServiceDays("2026-08-19T23:00:00.000Z", "2026-08-20", "2026-08-24")).toBe(true);
    expect(withinServiceDays("2026-08-19T17:00:00.000Z", "2026-08-20", "2026-08-24")).toBe(false);
  });

  it("uses the service day, so the small hours belong to the right day", () => {
    // 20:00 UTC is already the next day in IST, and the range is the operation's.
    expect(serviceDay("2026-08-24T20:00:00.000Z")).toBe("2026-08-25");
    expect(withinServiceDays("2026-08-24T20:00:00.000Z", "2026-08-25", "2026-08-25")).toBe(true);
  });

  it("returns an order created today when today is the end of the range", async () => {
    const { app, container } = await makeTestApp();
    await putOrder(container, { createdAt: new Date().toISOString() });
    const day = today();
    const report = await app.inject({
      method: "GET", url: `/v1/admin/reports?from=${day}&to=${day}`, headers: bearer(await loginAdmin(app)),
    });
    expect(report.statusCode).toBe(200);
    const totalOrders = (report.json().byBlock as { orders: number }[]).reduce((sum, row) => sum + row.orders, 0);
    expect(totalOrders).toBeGreaterThan(0);
  });

  it("returns an issue raised today when today is the end of the range", async () => {
    const { app } = await makeTestApp();
    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ category: "delivery_issue", description: "Raised right now" }),
    });
    const ticketId = raised.json().ticket.id as string;
    const day = today();
    const listed = await app.inject({
      method: "GET", url: `/v1/admin/issues?from=${day}&to=${day}`, headers: bearer(await loginAdmin(app)),
    });
    expect((listed.json().issues as { id: string }[]).map((i) => i.id)).toContain(ticketId);
  });
});

describe("DFT the issue queue is ordered oldest first within a priority", () => {
  it("puts the issue that has been waiting longest at the top of its band", async () => {
    const { app, container } = await makeTestApp();
    const base = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = `tkt-order-${i}`;
      ids.push(id);
      await container.store.tickets.put({
        id, residentId: "res-demo", orderId: null, societyId: "soc-demo",
        category: "delivery_issue", description: `Waiting ${i}`, status: "open", priority: "normal",
        reportedByUserId: "user-res", reportedByRole: "resident", assignedToUserId: null,
        resolution: null, resolvedAt: null, closedAt: null, escalatedToAdmin: false,
        responsibleRole: "operator", escalatedToSupervisor: false, messages: [],
        // Oldest first in the array: i = 0 is the one waiting longest.
        createdAt: new Date(base - (3 - i) * 3600_000).toISOString(),
      } as never);
    }

    const listed = await app.inject({ method: "GET", url: "/v1/admin/issues", headers: bearer(await loginAdmin(app)) });
    const order = (listed.json().issues as { id: string }[]).map((i) => i.id).filter((id) => ids.includes(id));
    expect(order).toEqual(ids);
  });

  it("still puts an emergency above an older ordinary issue", async () => {
    const { app, container } = await makeTestApp();
    const common = {
      residentId: "res-demo", orderId: null, societyId: "soc-demo",
      category: "delivery_issue", status: "open", reportedByUserId: "user-res",
      reportedByRole: "resident", assignedToUserId: null, resolution: null, resolvedAt: null,
      closedAt: null, escalatedToAdmin: false, responsibleRole: "operator",
      escalatedToSupervisor: false, messages: [],
    };
    await container.store.tickets.put({
      ...common, id: "tkt-old", description: "Old but ordinary", priority: "normal",
      createdAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
    } as never);
    await container.store.tickets.put({
      ...common, id: "tkt-urgent", description: "Just raised, urgent", priority: "emergency",
      createdAt: new Date().toISOString(),
    } as never);

    const listed = await app.inject({ method: "GET", url: "/v1/admin/issues", headers: bearer(await loginAdmin(app)) });
    const ids = (listed.json().issues as { id: string }[]).map((i) => i.id);
    expect(ids.indexOf("tkt-urgent")).toBeLessThan(ids.indexOf("tkt-old"));
  });
});

describe("DFT the analytics describe the same issues as the list beside them", () => {
  it("applies the list's filters to the analytics too", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    for (const [category, priority] of [
      ["delivery_issue", "normal"], ["payment_issue", "emergency"], ["missing_garment", "high"],
    ] as const) {
      await app.inject({
        method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
        payload: JSON.stringify({ category, description: `${category} raised`, priority }),
      });
    }
    const adminToken = await loginAdmin(app);

    const all = await app.inject({ method: "GET", url: "/v1/admin/issues/analytics", headers: bearer(adminToken) });
    expect(all.json().filtered).toBe(false);
    expect(all.json().analytics.total).toBe(3);

    const urgentList = await app.inject({ method: "GET", url: "/v1/admin/issues?emergency=true", headers: bearer(adminToken) });
    const urgentAnalytics = await app.inject({ method: "GET", url: "/v1/admin/issues/analytics?emergency=true", headers: bearer(adminToken) });
    expect(urgentAnalytics.json().filtered).toBe(true);
    // The cards used to say 3 while the list under them showed 1.
    expect(urgentAnalytics.json().analytics.total).toBe((urgentList.json().issues as unknown[]).length);
    expect(urgentAnalytics.json().analytics.total).toBe(1);
  });

  it("filters by category as well", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    for (const category of ["delivery_issue", "delivery_issue", "payment_issue"] as const) {
      await app.inject({
        method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
        payload: JSON.stringify({ category, description: "One of several" }),
      });
    }
    const adminToken = await loginAdmin(app);
    const analytics = await app.inject({
      method: "GET", url: "/v1/admin/issues/analytics?type=delivery_issue", headers: bearer(adminToken),
    });
    expect(analytics.json().analytics.total).toBe(2);
  });
});

describe("DFT earnings come from what was actually collected", () => {
  it("is zero when nothing has been charged, rather than a nominal figure per order", async () => {
    const { app, container } = await makeTestApp();
    // Delivered, but nothing collected against it.
    await putOrder(container, { additionalChargeStatus: "none", additionalChargePaise: null });

    const earnings = await app.inject({
      method: "GET", url: "/v1/operations/units/unit-demo/earnings", headers: bearer(await loginOperator(app)),
    });
    expect(earnings.statusCode).toBe(200);
    expect(earnings.json().earnings.revenuePaise).toBe(0);
    expect(earnings.json().earnings.sharePaise).toBe(0);
  });

  it("pays a share of collected revenue and reports what is still pending", async () => {
    const { app, container } = await makeTestApp();
    const unit = await container.store.units.get("unit-demo");
    expect(unit).toBeTruthy();
    await putOrder(container, { additionalChargeStatus: "paid", additionalChargePaise: 50_000 });
    await putOrder(container, { additionalChargeStatus: "pending", additionalChargePaise: 30_000 });

    const earnings = await app.inject({
      method: "GET", url: "/v1/operations/units/unit-demo/earnings", headers: bearer(await loginOperator(app)),
    });
    const body = earnings.json().earnings;
    expect(body.revenuePaise).toBe(50_000);
    expect(body.pendingRevenuePaise).toBe(30_000);
    expect(body.sharePaise).toBe(Math.round(50_000 * (unit!.revenueSharePercent / 100)));
    expect(body.projectedPayoutPaise).toBe(unit!.baseDrawPaise + body.sharePaise);
  });

  it("can be asked for a period", async () => {
    const { app, container } = await makeTestApp();
    await putOrder(container, {
      additionalChargeStatus: "paid", additionalChargePaise: 40_000,
      deliveredAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
    });
    const day = today();
    const thisMonth = await app.inject({
      method: "GET", url: `/v1/operations/units/unit-demo/earnings?from=${day}&to=${day}`,
      headers: bearer(await loginOperator(app)),
    });
    expect(thisMonth.json().earnings.revenuePaise).toBe(0);
  });
});

describe("DFT a plan's contracted value is not reported as revenue", () => {
  it("names the list price and the collected money separately", async () => {
    const { app } = await makeTestApp();
    const report = await app.inject({
      method: "GET", url: "/v1/admin/reports", headers: bearer(await loginAdmin(app)),
    });
    expect(report.statusCode).toBe(200);
    const plans = report.json().subscriptions.byPlan as Record<string, unknown>[];
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan).toHaveProperty("contractedMonthlyPaise");
      expect(plan).toHaveProperty("collectedPaise");
      // The ambiguous name is gone: it used to hold the list price while sitting
      // beside figures that came from the ledger.
      expect(plan).not.toHaveProperty("revenuePaise");
    }
  });
});
