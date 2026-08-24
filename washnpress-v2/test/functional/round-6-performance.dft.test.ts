import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestApp, bearer, loginAdmin, loginResident } from "./helpers";
import { schemaSql, DOC_TABLES } from "../../src/adapters/postgres/schema";
import { paginate, pageParams, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "../../src/app/paging";

// The performance and data-layer defects from the sixth round: three schemas that
// disagreed, tables with no indexes, lists with no ceiling, and a decoration pass
// that read the whole users table once per row.

describe("DFT there is one database schema", () => {
  it("generates db/init.sql from the schema the application applies", () => {
    const onDisk = readFileSync(join(__dirname, "..", "..", "db", "init.sql"), "utf-8");
    // The container mounts init.sql on a fresh volume; the application applies
    // schemaSql() at startup. They used to be maintained by hand and had drifted:
    // init.sql was missing payment_intents, areas, notifications and system_config.
    expect(onDisk).toContain("GENERATED FILE");
    expect(onDisk.trimEnd().endsWith(schemaSql())).toBe(true);
  });

  it("creates every table the store actually uses", () => {
    const sql = schemaSql();
    for (const table of DOC_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} `);
    }
    // The four that were missing from the hand-written copy.
    for (const table of ["payment_intents", "areas", "notifications", "system_config"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} `);
    }
  });

  it("indexes the fields that every scoped query filters on", () => {
    const sql = schemaSql();
    // Without these, an operator asking for their society's orders reads every
    // order on the platform.
    for (const [table, field] of [
      ["orders", "societyId"], ["orders", "state"], ["orders", "residentId"],
      ["tickets", "societyId"], ["tickets", "status"],
      ["pickups", "slotId"], ["residents", "societyId"], ["subscriptions", "residentId"],
    ] as const) {
      expect(sql).toContain(`ON ${table} ((doc->>'${field}'))`);
    }
    expect(sql).toContain("ON ledger_entry (txn_id)");
  });

  it("no longer ships a third, unapplied schema", () => {
    let present = true;
    try {
      readFileSync(join(__dirname, "..", "..", "db", "migrations", "001_full_schema.sql"), "utf-8");
    } catch {
      present = false;
    }
    expect(present).toBe(false);
  });
});

describe("DFT a list has a ceiling", () => {
  it("defaults to a page rather than the whole table", () => {
    expect(pageParams({}).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(pageParams({}).offset).toBe(0);
  });

  it("refuses to hand over the table however large a page is asked for", () => {
    expect(pageParams({ limit: "100000" }).limit).toBe(MAX_PAGE_SIZE);
    expect(pageParams({ limit: "-5" }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(pageParams({ limit: "not a number" }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(pageParams({ offset: "-2" }).offset).toBe(0);
  });

  it("describes the whole match, not just the page", () => {
    const items = Array.from({ length: 130 }, (_, i) => i);
    const first = paginate(items, { limit: "20" });
    expect(first.items).toHaveLength(20);
    expect(first.total).toBe(130);
    expect(first.hasMore).toBe(true);

    const last = paginate(items, { limit: "20", offset: "120" });
    expect(last.items).toHaveLength(10);
    expect(last.total).toBe(130);
    expect(last.hasMore).toBe(false);
  });

  it("pages the admin order list and reports the total", async () => {
    const { app, container } = await makeTestApp();
    for (let i = 0; i < 25; i += 1) {
      await container.store.orders.put({
        id: `ord-page-${i}`, orderCode: `ORD-${9000 + i}`, pickupId: null,
        residentId: "res-demo", societyId: "soc-demo", areaId: "area-madhapur", subscriptionId: null,
        state: "delivered", qrBatchCode: null, items: [], addonIds: [], lines: [], servicesPaise: 0,
        estimatedCount: 1, pickupCount: 1, acceptedCount: 1, subscriptionCoveredCount: 1,
        additionalCount: 0, additionalRatePaise: null, additionalChargePaise: null, payPerOrder: false,
        additionalChargeStatus: "none", deliveryCount: null, qcPassed: null, qcReason: null, qcAttempts: 0,
        pickupFailureReason: null, discrepancyReason: null, assignedOperatorUserId: null, deliveredByUserId: null,
        expectedCompletionAt: null, pickedUpAt: null, deliveredAt: null, rating: null, ratingComment: null,
        timeline: [], createdAt: new Date(Date.now() - i * 60_000).toISOString(),
      } as never);
    }
    const token = await loginAdmin(app);

    const firstPage = await app.inject({ method: "GET", url: "/v1/admin/orders?limit=10", headers: bearer(token) });
    expect(firstPage.statusCode).toBe(200);
    expect((firstPage.json().orders as unknown[]).length).toBe(10);
    expect(firstPage.json().page.total).toBe(25);
    expect(firstPage.json().page.hasMore).toBe(true);

    const lastPage = await app.inject({ method: "GET", url: "/v1/admin/orders?limit=10&offset=20", headers: bearer(token) });
    expect((lastPage.json().orders as unknown[]).length).toBe(5);
    expect(lastPage.json().page.hasMore).toBe(false);
  });

  it("pages the audit log and searches it", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    // Something to audit.
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: "POST", url: "/v1/admin/areas", headers: bearer(token),
        payload: JSON.stringify({ name: `Paged Area ${i}`, code: `PA${i}` }),
      });
    }
    const listed = await app.inject({ method: "GET", url: "/v1/admin/audit?limit=2", headers: bearer(token) });
    expect(listed.statusCode).toBe(200);
    expect((listed.json().entries as unknown[]).length).toBeLessThanOrEqual(2);
    expect(listed.json().page.total).toBeGreaterThanOrEqual(3);

    const searched = await app.inject({ method: "GET", url: "/v1/admin/audit?q=area", headers: bearer(token) });
    expect((searched.json().entries as unknown[]).length).toBeGreaterThan(0);
  });

  it("pages the issue list, and only decorates the page", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    for (let i = 0; i < 12; i += 1) {
      await app.inject({
        method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
        payload: JSON.stringify({ category: "delivery_issue", description: `Issue ${i}` }),
      });
    }
    const listed = await app.inject({
      method: "GET", url: "/v1/admin/issues?limit=5", headers: bearer(await loginAdmin(app)),
    });
    expect((listed.json().issues as unknown[]).length).toBe(5);
    expect(listed.json().page.total).toBe(12);
    // The page is still decorated, just not the whole table.
    expect(listed.json().issues[0]).toHaveProperty("residentName");
  });
});

describe("DFT decorating a list of issues does not read the tables once per row", () => {
  it("reads each supporting table once however many issues there are", async () => {
    const { app, container } = await makeTestApp();
    const residentToken = await loginResident(app);
    for (let i = 0; i < 10; i += 1) {
      await app.inject({
        method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
        payload: JSON.stringify({ category: "delivery_issue", description: `Counted ${i}` }),
      });
    }

    // Count how often the users table is read while the list is decorated. It used
    // to be once per issue, because detail() loaded every user to resolve one name.
    const users = container.store.users;
    const realAll = users.all.bind(users);
    let reads = 0;
    (users as unknown as { all: () => Promise<unknown> }).all = async () => {
      reads += 1;
      return realAll();
    };
    try {
      const tickets = await container.issues.list({});
      expect(tickets.length).toBeGreaterThanOrEqual(10);
      await container.issues.details(tickets);
    } finally {
      (users as unknown as { all: typeof realAll }).all = realAll;
    }
    expect(reads).toBe(1);
  });
});

describe("DFT the pool uses the timeouts it was configured with", () => {
  it("passes them through rather than falling back to the driver's defaults", async () => {
    const store = await import("../../src/adapters/postgres/store");
    const source = readFileSync(join(__dirname, "..", "..", "src", "adapters", "postgres", "store.ts"), "utf-8");
    expect(typeof store.createPostgresPool).toBe("function");
    // The configured values were read into config and then never handed to pg.Pool.
    expect(source).toContain("connectionTimeoutMillis");
    expect(source).toContain("idleTimeoutMillis");
  });
});
