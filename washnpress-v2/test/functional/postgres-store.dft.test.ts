import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import { createPostgresStore, type PgPool } from "../../src/adapters/postgres/store";
import { loadConfig, resetConfigCache } from "../../src/config";
import { buildContainer } from "../../src/container";
import { buildApp } from "../../src/app/build-app";
import { computeSignature } from "../../src/domain/payments/signature";

// Spin up an in-process Postgres that speaks the real wire protocol, so the actual
// SQL in the Postgres adapter runs (schema, atomic UPDATE, ledger, idempotency).
function pgMemPool(): PgPool {
  const db = newDb();
  const pg = db.adapters.createPg();
  return new pg.Pool() as unknown as PgPool;
}

describe("DFT Postgres storage", () => {
  it("applies the schema and round-trips a document collection", async () => {
    const store = await createPostgresStore(pgMemPool());
    await store.societies.put({ id: "s1", name: "Test", code: "TST", areaId: null, address: null, city: "Hyd", state: "TS", status: "active", createdAt: new Date().toISOString() });
    const got = await store.societies.get("s1");
    expect(got?.name).toBe("Test");
    expect((await store.societies.all()).length).toBe(1);
  });

  it("reserves slot capacity atomically and never oversells", async () => {
    const store = await createPostgresStore(pgMemPool());
    await store.slots.put({ id: "slot1", societyId: "s1", date: "2099-01-01", window: "Morning", startTime: "08:00", endTime: "11:00", capacityTotal: 1, capacityRemaining: 1, isActive: true });
    const [a, b] = await Promise.all([store.slots.reserveCapacity("slot1"), store.slots.reserveCapacity("slot1")]);
    const wins = [a, b].filter(Boolean);
    expect(wins).toHaveLength(1);
    expect((await store.slots.get("slot1"))?.capacityRemaining).toBe(0);
  });

  it("posts balanced ledger transactions and derives a balance", async () => {
    const store = await createPostgresStore(pgMemPool());
    await store.ledger.post({ id: "t1", reference: "evt1", createdAt: new Date().toISOString(), entries: [
      { account: "gateway_clearing", direction: "debit", amount: 5000 },
      { account: "resident_wallet:r1", direction: "credit", amount: 5000 },
    ] });
    const txns = await store.ledger.transactionsForAccount("resident_wallet:r1");
    expect(txns).toHaveLength(1);
    expect(txns[0].entries).toHaveLength(2);
  });

  it("is idempotent on processed events", async () => {
    const store = await createPostgresStore(pgMemPool());
    expect(await store.idempotency.seen("e1")).toBe(false);
    await store.idempotency.markSeen("e1");
    await store.idempotency.markSeen("e1");
    expect(await store.idempotency.seen("e1")).toBe(true);
  });

  it("runs the full app end to end on Postgres storage", async () => {
    resetConfigCache();
    const config = loadConfig({ reload: true, env: { WNP_APP__ENV: "test", WNP_STORAGE__DRIVER: "postgres" } });
    const container = await buildContainer(config, { store: await createPostgresStore(pgMemPool()) });
    const app = buildApp(container);
    await app.ready();

    const secret = "change-me-in-config-local-or-env";
    const body = JSON.stringify({ id: "evt_pg_1", payload: { residentId: "res-demo", amountPaise: 120000 } });
    const wh = await app.inject({ method: "POST", url: "/v1/payments/webhook", headers: { "content-type": "application/json", "x-razorpay-signature": computeSignature(body, secret) }, payload: body });
    expect(wh.statusCode).toBe(200);

    const bal = await app.inject({ method: "GET", url: "/v1/wallet/res-demo/balance" });
    expect(bal.json().balancePaise).toBe(120000);
    await app.close();
  });
});
