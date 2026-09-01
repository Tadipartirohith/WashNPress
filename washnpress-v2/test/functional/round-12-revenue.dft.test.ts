import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";
import { resolveRange, DATE_RANGE_PRESETS, CHARGE_DUE_DAYS } from "../../src/services/revenue-service";

// Two things the Revenue page could not answer.
//
// Everything unpaid was one figure, so "still to collect" put a charge raised
// this morning beside one that has been ignored for a fortnight — and an admin
// chasing money could not tell which was which. And there was no breakdown by
// service at all, which for a laundry is the breakdown that says where the money
// comes from.

describe("date ranges an admin can ask for", () => {
  const now = new Date("2026-08-19T09:00:00Z"); // a Wednesday

  it("offers the whole set the round asks for", () => {
    for (const preset of ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_quarter", "this_year", "custom"]) {
      expect(DATE_RANGE_PRESETS).toContain(preset);
    }
  });

  it("ends last week where this week begins", () => {
    const thisWeek = resolveRange("this_week", undefined, undefined, now);
    const lastWeek = resolveRange("last_week", undefined, undefined, now);
    expect(lastWeek.to! < thisWeek.from!).toBe(true);
    // Seven days, Monday to Sunday.
    const days = (Date.parse(lastWeek.to!) - Date.parse(lastWeek.from!)) / 86400_000;
    expect(days).toBe(6);
  });

  it("starts the quarter and the year where they actually start", () => {
    expect(resolveRange("this_quarter", undefined, undefined, now).from).toBe("2026-07-01");
    expect(resolveRange("this_year", undefined, undefined, now).from).toBe("2026-01-01");
  });

  it("still takes a custom range and says so", () => {
    const range = resolveRange(undefined, "2026-01-01", "2026-01-31", now);
    expect(range.preset).toBe("custom");
    expect(range.from).toBe("2026-01-01");
  });
});

describe("the revenue report", () => {
  async function report(query = "") {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: `/v1/admin/revenue${query}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    return { body: res.json(), container, app, token };
  }

  it("separates what is late from what is merely unpaid", async () => {
    const { body } = await report();
    expect(typeof body.summary.pendingPaise).toBe("number");
    expect(typeof body.summary.overduePaise).toBe("number");
    // Overdue is a subset of pending: it can equal it, never exceed it.
    expect(body.summary.overduePaise).toBeLessThanOrEqual(body.summary.pendingPaise);
    expect(Array.isArray(body.overdueCharges)).toBe(true);
    for (const row of body.overdueCharges as Array<{ dueDate: string }>) {
      expect(row.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("counts a charge as overdue only once its due date has passed", async () => {
    const { app, token, container } = await report();
    const orders = await container.store.orders.all();
    const target = orders.find((o) => (o.additionalChargePaise ?? 0) > 0);
    if (!target) return;

    // Raised today: not late yet.
    target.additionalChargeStatus = "pending";
    target.createdAt = new Date().toISOString();
    await container.store.orders.put(target);
    let res = await app.inject({ method: "GET", url: "/v1/admin/revenue", headers: bearer(token) });
    const fresh = (res.json().overdueCharges as Array<{ id: string }>).some((r) => r.id === target.id);
    expect(fresh).toBe(false);

    // Raised well before the due window: late.
    target.createdAt = new Date(Date.now() - (CHARGE_DUE_DAYS + 3) * 86400_000).toISOString();
    await container.store.orders.put(target);
    res = await app.inject({ method: "GET", url: "/v1/admin/revenue", headers: bearer(token) });
    const late = (res.json().overdueCharges as Array<{ id: string }>).some((r) => r.id === target.id);
    expect(late).toBe(true);
  });

  it("breaks revenue down by service, with each one's share", async () => {
    const { body } = await report();
    expect(Array.isArray(body.byService)).toBe(true);
    const rows = body.byService as Array<{ name: string; orders: number; revenuePaise: number; sharePercent: number }>;
    for (const row of rows) {
      expect(row.name).toBeTruthy();
      expect(row.revenuePaise).toBeGreaterThanOrEqual(0);
      expect(row.sharePercent).toBeGreaterThanOrEqual(0);
      expect(row.sharePercent).toBeLessThanOrEqual(100);
    }
    if (rows.length) {
      // Biggest earner first, and the shares account for the whole.
      expect(rows[0].revenuePaise).toBeGreaterThanOrEqual(rows[rows.length - 1].revenuePaise);
      const total = rows.reduce((sum, r) => sum + r.sharePercent, 0);
      expect(Math.abs(total - 100)).toBeLessThan(1);
    }
  });

  it("keeps the breakdowns it already had", async () => {
    const { body } = await report();
    for (const key of ["bySociety", "byBlock", "bySupervisor", "byOperator", "byPlan"]) {
      expect(Array.isArray(body[key])).toBe(true);
    }
  });

  it("offers every preset to the client that renders them", async () => {
    const { body } = await report();
    const values = (body.presets as Array<{ value: string; label: string }>).map((p) => p.value);
    expect(values).toContain("last_week");
    expect(values).toContain("this_quarter");
    expect(values).toContain("this_year");
    for (const preset of body.presets as Array<{ label: string }>) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
    }
  });
});
