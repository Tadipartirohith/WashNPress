import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginResident, seedSlot } from "./helpers";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";
import { buildTransaction } from "../../src/domain/ledger";

// The admin issues from the Zoho round: ST1-I129 and I130 (orders and subscriptions
// browsable past the first page, with search and filters over everything), I131
// (reopening a resolved or closed issue with a reason), I132 (the transaction ledger)
// and I133 (GST and notification settings that are saved, audited and obeyed).

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];
type Ctr = Awaited<ReturnType<typeof makeTestApp>>["container"];

function orderRecord(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `ord-st1-${i}`, orderCode: `ORD-${7000 + i}`, pickupId: null,
    residentId: "res-demo", societyId: "soc-demo", blockId: "block-demo-a", subscriptionId: null,
    state: "delivered", qrBatchCode: null, items: [], addonIds: [], lines: [], servicesPaise: 0,
    estimatedCount: 1, pickupCount: 1, acceptedCount: 1, subscriptionCoveredCount: 1,
    additionalCount: 0, additionalRatePaise: null, additionalChargePaise: null, payPerOrder: false,
    additionalChargeStatus: "none", deliveryCount: null, qcPassed: null, qcReason: null, qcAttempts: 0,
    pickupFailureReason: null, discrepancyReason: null, assignedOperatorUserId: null, deliveredByUserId: null,
    expectedCompletionAt: null, pickedUpAt: null, deliveredAt: null, rating: null, ratingComment: null,
    timeline: [], createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    ...over,
  };
}

async function walk(app: App, token: string, url: (offset: number) => string, key: string) {
  const ids: string[] = [];
  let total = -1;
  for (let offset = 0; offset < 1000; ) {
    const body = (await app.inject({ method: "GET", url: url(offset), headers: bearer(token) })).json();
    if (total < 0) total = body.page.total;
    expect(body.page.total).toBe(total);
    ids.push(...(body[key] as { id: string }[]).map((r) => r.id));
    if (!body.page.hasMore) break;
    offset += body.page.limit;
  }
  return { ids, total };
}

describe("ST1-I129 the admin order list pages through every order", () => {
  it("reaches every order past the first page, with no repeats", async () => {
    const { app, container } = await makeTestApp();
    for (let i = 0; i < 60; i += 1) await container.store.orders.put(orderRecord(i) as never);
    const token = await loginAdmin(app);
    const { ids, total } = await walk(app, token, (o) => `/v1/admin/orders?limit=25&offset=${o}`, "orders");
    expect(total).toBeGreaterThanOrEqual(60);
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
    for (let i = 0; i < 60; i += 1) expect(ids).toContain(`ord-st1-${i}`);
  });

  it("searches across every order, and keeps the search while paging", async () => {
    const { app, container } = await makeTestApp();
    // The oldest are the ones a first page would never have held.
    for (let i = 0; i < 60; i += 1) {
      await container.store.orders.put(orderRecord(i, i >= 50 ? { orderCode: `OLD-${i}` } : {}) as never);
    }
    const token = await loginAdmin(app);
    const { ids, total } = await walk(app, token, (o) => `/v1/admin/orders?orderCode=old-&limit=4&offset=${o}`, "orders");
    expect(total).toBe(10);
    expect(new Set(ids)).toEqual(new Set(Array.from({ length: 10 }, (_, k) => `ord-st1-${50 + k}`)));
  });
});

describe("ST1-I130 the admin subscription list pages, searches and filters server-side", () => {
  async function seed(container: Ctr) {
    for (let i = 0; i < 30; i += 1) {
      const start = new Date(Date.now() - i * 86400_000).toISOString();
      await container.store.subscriptions.put({
        id: `sub-st1-${i}`, residentId: i % 3 === 0 ? "res-demo" : `res-ghost-${i}`, planId: "plan-basic",
        status: i % 2 === 0 ? "active" : "paused", cycle: "monthly", cycleStart: start,
        cycleEnd: new Date(Date.parse(start) + 30 * 86400_000).toISOString(),
        garmentsUsed: 0, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
      } as never);
    }
  }

  it("reaches every subscription past the first page", async () => {
    const { app, container } = await makeTestApp();
    await seed(container);
    const token = await loginAdmin(app);
    const { ids, total } = await walk(app, token, (o) => `/v1/admin/subscriptions?limit=7&offset=${o}`, "subscriptions");
    expect(total).toBeGreaterThanOrEqual(30);
    expect(new Set(ids).size).toBe(total);
    for (let i = 0; i < 30; i += 1) expect(ids).toContain(`sub-st1-${i}`);
  });

  it("applies the search and the status filter to the whole set on every page", async () => {
    const { app, container } = await makeTestApp();
    await seed(container);
    const token = await loginAdmin(app);
    const rows: { id: string; status: string; residentName: string | null }[] = [];
    let total = 0;
    for (let offset = 0; ; offset += 2) {
      const body = (await app.inject({
        method: "GET", url: `/v1/admin/subscriptions?q=anusha&status=paused&limit=2&offset=${offset}`, headers: bearer(token),
      })).json();
      total = body.page.total;
      rows.push(...body.subscriptions);
      if (!body.page.hasMore) break;
    }
    // Residents res-demo at i = 3, 9, 15, 21, 27 are the paused ones.
    const ours = rows.filter((r) => r.id.startsWith("sub-st1-")).map((r) => r.id).sort();
    expect(ours).toEqual(["sub-st1-15", "sub-st1-21", "sub-st1-27", "sub-st1-3", "sub-st1-9"]);
    expect(rows).toHaveLength(total);
    expect(rows.every((r) => r.status === "paused" && /anusha/i.test(r.residentName ?? ""))).toBe(true);
  });
});

describe("ST1-I131 an admin reopens a resolved or closed issue with a reason", () => {
  async function raised(app: App) {
    const response = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ category: "delivery_issue", description: "Reopen me" }),
    });
    return response.json().ticket.id as string;
  }
  const reopen = (app: App, token: string, id: string, reason: unknown) => app.inject({
    method: "POST", url: `/v1/admin/issues/${id}/reopen`, headers: bearer(token), payload: JSON.stringify({ reason }),
  });

  it("refuses an empty or whitespace reason in words", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const id = await raised(app);
    await app.inject({ method: "POST", url: `/v1/admin/issues/${id}/close`, headers: bearer(token), payload: "{}" });
    for (const reason of ["", "   ", undefined]) {
      const response = await reopen(app, token, id, reason);
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toBe("Reopen reason is required.");
    }
    const still = await app.inject({ method: "GET", url: `/v1/admin/issues/${id}`, headers: bearer(token) });
    expect(still.json().issue.status).toBe("closed");
  });

  it("will not reopen an issue that was never resolved or closed", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const id = await raised(app);
    expect((await reopen(app, token, id, "Why not")).statusCode).toBe(409);
  });

  it("reopens a resolved issue, puts the reason on its timeline with who and when, and audits it", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const id = await raised(app);
    const ticket = await container.store.tickets.get(id);
    await container.store.tickets.put({ ...ticket!, status: "resolved", resolution: "Done", resolvedAt: new Date().toISOString() });

    const response = await reopen(app, token, id, "  Resident says the shirt is still missing  ");
    expect(response.statusCode).toBe(200);
    const issue = response.json().issue;
    expect(issue.status).toBe("open");
    expect(issue.reopenReason).toBe("Resident says the shirt is still missing");
    expect(issue.reopenedByUserId).toBeTruthy();
    expect(issue.reopenedByName).toBeTruthy();
    expect(Date.parse(issue.reopenedAt)).not.toBeNaN();
    const line = (issue.messages as { body: string; authorRole: string; authorName: string | null; at: string }[])
      .find((m) => m.authorRole === "system" && m.body.includes("Resident says the shirt is still missing"));
    expect(line?.authorName).toBeTruthy();
    expect(line?.at).toBe(issue.reopenedAt);

    const audit = await app.inject({ method: "GET", url: `/v1/admin/audit?resource=issue&resourceId=${id}`, headers: bearer(token) });
    const entry = (audit.json().entries as { action: string; previousValue: { status: string }; newValue: { reason: string } }[])
      .find((e) => e.action === "issue.reopened");
    expect(entry?.previousValue.status).toBe("resolved");
    expect(entry?.newValue.reason).toBe("Resident says the shirt is still missing");
  });
});

describe("ST1-I132 the transaction ledger", () => {
  async function settledCharge(container: Ctr) {
    await container.store.ledger.post(buildTransaction({
      id: "fund-st1", reference: "fund-st1",
      entries: [
        { account: Account.GatewayClearing, direction: "debit", amount: 100000 },
        { account: walletAccount("res-demo"), direction: "credit", amount: 100000 },
      ],
      at: new Date(),
    }));
    await container.store.orders.put(orderRecord(1, { additionalChargePaise: 15000, additionalChargeStatus: "pending" }) as never);
    await container.orders.payAdditionalCharge("ord-st1-1");
    await container.store.orders.put(orderRecord(2, { additionalChargePaise: 9000, additionalChargeStatus: "pending" }) as never);
  }

  it("names the settlement posting only for money that moved, and where the resident lives", async () => {
    const { app, container } = await makeTestApp();
    await settledCharge(container);
    const token = await loginAdmin(app);
    const body = (await app.inject({ method: "GET", url: "/v1/admin/revenue/transactions", headers: bearer(token) })).json();
    const rows = body.transactions as { id: string; status: string; referenceId: string | null; unitNumber: string | null; residentId: string | null }[];
    const paid = rows.find((r) => r.id === "ord-st1-1:additional")!;
    const owing = rows.find((r) => r.id === "ord-st1-2:additional")!;
    expect(paid.status).toBe("successful");
    const posting = (await container.store.ledger.all()).find((p) => p.id === paid.referenceId);
    expect(posting?.reference).toBe("addl-garments-ord-st1-1");
    expect(paid.residentId).toBe("res-demo");
    expect(paid.unitNumber).toBeTruthy();
    expect(owing.status).toBe("pending");
    expect(owing.referenceId).toBeNull();
    expect(body.methods).toEqual([{ key: "wallet", label: "Wallet" }]);
  });

  it("filters by method and finds a row by its settlement reference, paging over the match", async () => {
    const { app, container } = await makeTestApp();
    await settledCharge(container);
    const token = await loginAdmin(app);
    const byMethod = (await app.inject({ method: "GET", url: "/v1/admin/revenue/transactions?method=wallet", headers: bearer(token) })).json();
    const methodIds = (byMethod.transactions as { id: string; paymentMethod: string }[]);
    expect(methodIds.every((r) => r.paymentMethod === "wallet")).toBe(true);
    expect(methodIds.map((r) => r.id)).not.toContain("ord-st1-2:additional");

    const paid = methodIds.find((r) => r.id === "ord-st1-1:additional") as unknown as { referenceId: string };
    const found = (await app.inject({ method: "GET", url: `/v1/admin/revenue/transactions?q=${paid.referenceId}`, headers: bearer(token) })).json();
    expect((found.transactions as { id: string }[]).map((r) => r.id)).toEqual(["ord-st1-1:additional"]);

    const { ids, total } = await walk(app, token, (o) => `/v1/admin/revenue/transactions?limit=1&offset=${o}`, "transactions");
    expect(new Set(ids).size).toBe(total);
    expect(ids).toEqual(expect.arrayContaining(["ord-st1-1:additional", "ord-st1-2:additional"]));
  });
});

describe("ST1-I133 GST and notification configuration", () => {
  const patch = (app: App, token: string, body: unknown) => app.inject({
    method: "PATCH", url: "/v1/admin/config", headers: bearer(token), payload: JSON.stringify(body),
  });

  it("validates the GST rate", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const tooPrecise = await patch(app, token, { gstRatePercent: 18.555 });
    expect(tooPrecise.statusCode).toBe(400);
    expect(tooPrecise.json().message).toBe("GST rate can have at most 2 decimal places.");
    expect((await patch(app, token, { gstRatePercent: 0.25 })).statusCode).toBe(200);
    expect((await patch(app, token, { notificationFlags: { nonsense: false } })).statusCode).toBe(400);
  });

  it("persists GST, audits the change, and charges the saved rate", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    expect((await patch(app, token, { gstEnabled: true, gstRatePercent: 12 })).statusCode).toBe(200);

    const config = (await app.inject({ method: "GET", url: "/v1/admin/config", headers: bearer(token) })).json();
    expect(config.config.gstEnabled).toBe(true);
    expect(config.config.gstRatePercent).toBe(12);

    const audit = (await app.inject({ method: "GET", url: "/v1/admin/audit?resource=system_config", headers: bearer(token) })).json();
    expect((audit.entries as { newValue: { gstRatePercent: number } }[]).some((e) => e.newValue.gstRatePercent === 12)).toBe(true);

    await container.store.ledger.post(buildTransaction({
      id: "fund-gst-st1", reference: "fund-gst-st1",
      entries: [
        { account: Account.GatewayClearing, direction: "debit", amount: 100000 },
        { account: walletAccount("res-demo"), direction: "credit", amount: 100000 },
      ],
      at: new Date(),
    }));
    const before = await container.wallet.balancePaise("res-demo");
    await container.subscriptions.subscribe("res-demo", "plan-basic", "monthly");
    // 49,900 plus 12% (5,988).
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - 55888);
  });

  it("merges notification flags, lists the categories, and audits the change", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await patch(app, token, { notificationFlags: { pickups: false } });
    await patch(app, token, { notificationFlags: { orders: false } });
    const body = (await app.inject({ method: "GET", url: "/v1/admin/config", headers: bearer(token) })).json();
    expect(body.config.notificationFlags).toMatchObject({ pickups: false, orders: false, payments: true, issues: true });
    expect((body.notificationCategories as { key: string }[]).map((c) => c.key)).toContain("pickups");
    const audit = (await app.inject({ method: "GET", url: "/v1/admin/audit?resource=system_config", headers: bearer(token) })).json();
    expect(audit.page.total).toBeGreaterThanOrEqual(2);
  });

  async function bookAndCount(container: Ctr, slotId: string) {
    await seedSlot(container, slotId, 3);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId });
    const feed = await container.store.notifications.find((n) => n.type === "pickup.booked");
    const outbox = (await container.store.outbox.listPending()).filter((e) => e.type === "pickup.booked");
    return feed.length + outbox.length;
  }

  it("sends a booking notification while its flag is on", async () => {
    const { container } = await makeTestApp();
    expect(await bookAndCount(container, "slot-st1-on")).toBeGreaterThan(0);
  });

  it("suppresses it once the admin switches that kind off", async () => {
    const { app, container } = await makeTestApp();
    expect((await patch(app, await loginAdmin(app), { notificationFlags: { pickups: false } })).statusCode).toBe(200);
    expect(await bookAndCount(container, "slot-st1-off")).toBe(0);
  });

  it("suppresses everything when the master switch is off", async () => {
    const { app, container } = await makeTestApp();
    expect((await patch(app, await loginAdmin(app), { notificationsEnabled: false })).statusCode).toBe(200);
    expect(await bookAndCount(container, "slot-st1-master")).toBe(0);
  });
});
