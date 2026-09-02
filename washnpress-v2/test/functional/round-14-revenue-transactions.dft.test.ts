import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginResident } from "./helpers";

// The revenue report could always say what a period came to, and break that total
// down by society, block, supervisor, operator, plan and service. What it could not
// do is show the movements the total is made of — so a figure that looked wrong
// could be sliced six ways and never opened.

describe("the movements a revenue total is made of", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let admin: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    admin = await loginAdmin(app);
    await loginResident(app);
  });

  const list = (query = "") => app.inject({
    method: "GET", url: `/v1/admin/revenue/transactions${query}`, headers: bearer(admin),
  });

  // The fixture carries no orders at all, so the money has to be put there. Written
  // straight to the store rather than booked through the API: this is a test about
  // how movements are projected, not about how an order comes to exist.
  const ORDER_ID = "ord-revenue-1";

  async function anOrder(over: Record<string, unknown> = {}) {
    const order = {
      id: ORDER_ID,
      orderCode: "ORD-770011",
      residentId: "res-demo",
      societyId: "soc-demo",
      blockId: "block-demo-a",
      state: "delivered",
      createdAt: new Date().toISOString(),
      servicesPaise: 24900,
      additionalChargePaise: 0,
      additionalChargeStatus: "none",
      assignedOperatorUserId: "user-op",
      ...over,
    };
    await container.store.orders.put(order as never);
    return order;
  }

  // A charge beyond the plan, which is the money on an order that carries a status
  // of its own.
  async function anOrderCharged(paise: number, status: string) {
    return anOrder({ additionalChargePaise: paise, additionalChargeStatus: status });
  }

  it("is admin only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/revenue/transactions" })).statusCode).toBe(401);
  });

  it("answers with the vocabulary the screen needs, not just rows", async () => {
    const body = (await list()).json();
    expect(body.types.map((t: { key: string }) => t.key)).toContain("order_payment");
    expect(body.types.map((t: { key: string }) => t.key)).toContain("refund");
    expect(body.statuses.map((t: { key: string }) => t.key)).toContain("pending");
  });

  it("does not count what a plan already paid for", async () => {
    // `servicesPaise` is the value of the work, not a payment: for a subscriber the
    // plan has already covered it, which is why the report counts only the part
    // beyond the plan as order revenue. A row here would show the same money twice,
    // once as the subscription and again as an order payment.
    await anOrder({ servicesPaise: 24900, additionalChargePaise: 0 });
    const rows = (await list()).json().transactions as { id: string }[];
    expect(rows.some((r) => r.id.endsWith(":services"))).toBe(false);
  });

  it("shows the charge beyond the plan as money taken", async () => {
    await anOrderCharged(15000, "paid");
    const rows = (await list()).json().transactions as { type: string; amountPaise: number }[];
    expect(rows.some((r) => r.type === "order_payment" && r.amountPaise === 15000)).toBe(true);
  });

  it("agrees with the total the report puts above it", async () => {
    // The whole point of the list: a figure that looks wrong should be openable, and
    // opening it has to show the money the figure was counting.
    await anOrderCharged(15000, "paid");
    const rows = (await list("?preset=last_30_days")).json();
    const report = await app.inject({
      method: "GET", url: "/v1/admin/revenue?preset=last_30_days", headers: bearer(admin),
    });
    expect(rows.tally.settledPaise).toBe(report.json().summary.totalRevenuePaise);
  });

  it("shows a charge beyond the plan as its own movement, with its own status", async () => {
    // An order can be delivered with the additional charge still owing, so the two
    // are not one row.
    await anOrderCharged(15000, "pending");
    const rows = (await list()).json().transactions as { id: string; status: string; amountPaise: number }[];
    const additional = rows.find((r) => r.id.endsWith(":additional"))!;
    expect(additional.status).toBe("pending");
    expect(additional.amountPaise).toBe(15000);
  });

  it("counts money that went back out as a refund rather than as a payment", async () => {
    // Otherwise it lands in the same column as money that came in.
    await anOrderCharged(15000, "refunded");
    const rows = (await list()).json().transactions as { id: string; type: string }[];
    expect(rows.find((r) => r.id.endsWith(":additional"))!.type).toBe("refund");
  });

  it("narrows by type", async () => {
    await anOrderCharged(15000, "refunded");
    const rows = (await list("?type=refund")).json().transactions as { type: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.type === "refund")).toBe(true);
  });

  it("narrows by status", async () => {
    await anOrderCharged(15000, "pending");
    const rows = (await list("?status=pending")).json().transactions as { status: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("finds one by the order it belongs to", async () => {
    const order = await anOrderCharged(15000, "paid");
    const rows = (await list(`?q=${order.orderCode}`)).json().transactions as { orderCode: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orderCode === order.orderCode)).toBe(true);
  });

  it("finds one by the customer's name", async () => {
    await anOrderCharged(15000, "paid");
    const rows = (await list("?q=anusha")).json().transactions as { customerName: string }[];
    expect(rows.length).toBeGreaterThan(0);
  });

  it("finds nothing for somebody who does not exist, rather than everything", async () => {
    expect((await list("?q=nobody-of-that-name")).json().transactions).toEqual([]);
  });

  it("pages, because a busy month is not a page", async () => {
    await anOrderCharged(15000, "paid");
    const first = await list("?limit=1&offset=0");
    expect(first.json().transactions).toHaveLength(1);
    expect(first.json().page.limit).toBe(1);
  });

  it("counts the tally over everything that matched, not over the page", async () => {
    await anOrderCharged(15000, "paid");
    // Otherwise the figures would change as somebody paged through their own money.
    const all = (await list()).json();
    const paged = (await list("?limit=1&offset=0")).json();
    expect(paged.tally.count).toBe(all.tally.count);
    expect(paged.tally.settledPaise).toBe(all.tally.settledPaise);
  });

  it("separates what was taken, what went back and what is owed", async () => {
    await anOrderCharged(15000, "pending");
    const tally = (await list()).json().tally;
    expect(tally.pendingPaise).toBeGreaterThanOrEqual(15000);
    expect(tally).toHaveProperty("settledPaise");
    expect(tally).toHaveProperty("refundedPaise");
  });

  it("reads newest first", async () => {
    await anOrderCharged(15000, "paid");
    const rows = (await list()).json().transactions as { at: string }[];
    const dates = rows.map((r) => r.at);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it("says nothing about how the money arrived, rather than guessing", async () => {
    // The method arrived with the payment configuration, so an older movement
    // genuinely does not know. Reporting "card" because card is switched on would be
    // inventing a fact about somebody else's money.
    await anOrderCharged(15000, "paid");
    const rows = (await list()).json().transactions as { paymentMethod: string | null }[];
    expect(rows.every((r) => r.paymentMethod === null)).toBe(true);
  });

  it("takes the same narrowing as the report it explains", async () => {
    await anOrderCharged(15000, "paid");
    const mine = await list("?societyId=soc-demo");
    const elsewhere = await list("?societyId=soc-whitefield");
    expect(mine.statusCode).toBe(200);
    expect(elsewhere.statusCode).toBe(200);
    const ids = (mine.json().transactions as { societyId: string | null }[])
      .filter((r) => r.societyId !== null);
    expect(ids.every((r) => r.societyId === "soc-demo")).toBe(true);
  });
});
