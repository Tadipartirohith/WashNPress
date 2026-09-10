import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import { createPostgresStore, documentWhere, type PgPool } from "../../src/adapters/postgres/store";
import { createMemoryStore } from "../../src/adapters/memory/store";
import type { AuditLog, Society } from "../../src/domain/models";

// Every scoped lookup in this platform used to be `find(predicate)`, which on Postgres
// is `SELECT doc FROM <table>` with no WHERE — the whole table over the wire, parsed in
// Node, then filtered in JavaScript. The thirty expression indexes in schema.ts were
// unreachable the entire time, because nothing emitted a clause that could use one.
//
// `findBy` is the clause. The awkward part of proving it is that the engine these
// tests run against is pg-mem, a JavaScript reimplementation which cannot create an
// expression index at all — createPostgresStore swallows those failures for exactly
// that reason. So pg-mem can show that the results are right and can never show that
// the query is worth anything. Only an assertion on the SQL itself can do that, which
// is why the first half of this file reads text.

function pgMemPool(): PgPool {
  const db = newDb();
  const pg = db.adapters.createPg();
  return new pg.Pool() as unknown as PgPool;
}

// Records what the store asks the database for, so the query can be read back.
function recordingPool(): { pool: PgPool; queries: Array<{ text: string; params?: unknown[] }> } {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      queries.push({ text, params });
      return { rows: [] };
    },
    async connect() { throw new Error("the recording pool has no transactions"); },
  };
  return { pool, queries };
}

const address = { house: "1", street: "Main Road", locality: "Madhapur", city: "Hyderabad", state: "Telangana", pincode: "500081" };
function society(id: string, fields: Partial<Society> = {}): Society {
  return { id, name: id, address, status: "active", supervisorUserId: null, createdAt: "2026-01-01T00:00:00.000Z", ...fields };
}

function auditEntry(id: string, at: string): AuditLog {
  return {
    id, actor: "u1", actorName: null, role: "admin", action: "update",
    entity: `society:${id}`, resource: "society", resourceId: id,
    previousValue: null, newValue: null, at,
  };
}

describe("the criteria clause", () => {
  it("names each field in the WHERE and binds each value", () => {
    const { clause, params } = documentWhere({ societyId: "soc-1", state: "delivered" });
    expect(clause).toBe("doc->>'societyId' = $1 AND doc->>'state' = $2");
    expect(params).toEqual(["soc-1", "delivered"]);
  });

  it("compares as text, because that is what `->>` yields", () => {
    const { clause, params } = documentWhere({ flatCount: 40, active: true });
    expect(clause).toBe("doc->>'flatCount' = $1 AND doc->>'active' = $2");
    expect(params).toEqual(["40", "true"]);
  });

  it("reads a real column where the document's copy would be stale", () => {
    // Reserving capacity updates the column and not the document, so a query that
    // read `doc->>'capacityRemaining'` would answer from the state the slot was
    // created in and hand out a slot that has been full for hours.
    const { clause, params } = documentWhere(
      { societyId: "soc-1", capacityRemaining: 0 },
      { capacityRemaining: "capacity_remaining" },
    );
    expect(clause).toBe("doc->>'societyId' = $1 AND capacity_remaining = $2");
    expect(params).toEqual(["soc-1", 0]);
  });

  it("refuses a field name that is not a field name", () => {
    // The field is interpolated because a JSONB path cannot be bound, so this check
    // is the whole defence. A criteria object can be assembled from a request body.
    expect(() => documentWhere({ "id' OR '1'='1": "x" })).toThrow(/not a queryable field name/);
  });

  it("asks for no clause at all when there are no criteria", () => {
    expect(documentWhere({}).clause).toBe("");
    expect(documentWhere({ societyId: undefined }).clause).toBe("");
  });
});

describe("what the Postgres collection actually sends", () => {
  it("puts the criteria in a WHERE instead of reading the table", async () => {
    const { pool, queries } = recordingPool();
    const store = await createPostgresStore(pool);
    queries.length = 0;

    await store.orders.findBy({ societyId: "soc-1", state: "delivered" });

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toBe("SELECT doc FROM orders WHERE doc->>'societyId' = $1 AND doc->>'state' = $2");
    expect(queries[0].params).toEqual(["soc-1", "delivered"]);
  });

  it("still reads the whole table for a predicate, which is the cost being avoided", async () => {
    const { pool, queries } = recordingPool();
    const store = await createPostgresStore(pool);
    queries.length = 0;

    await store.orders.find((o) => o.societyId === "soc-1");

    // Pinned deliberately: if this ever grows a WHERE the two methods have merged and
    // the note in ports/repositories.ts about find being a full scan is a lie.
    expect(queries[0].text).toBe("SELECT doc FROM orders");
  });

  it("queries slot capacity against the column the reservation updates", async () => {
    const { pool, queries } = recordingPool();
    const store = await createPostgresStore(pool);
    queries.length = 0;

    await store.slots.findBy({ societyId: "soc-1", isActive: true });

    expect(queries[0].text).toBe("SELECT doc, capacity_remaining, is_active FROM slots WHERE doc->>'societyId' = $1 AND is_active = $2");
    expect(queries[0].params).toEqual(["soc-1", true]);
  });

  it("bounds a recent-activity read in the database", async () => {
    const { pool, queries } = recordingPool();
    const store = await createPostgresStore(pool);
    queries.length = 0;

    await store.audit.recent(12);

    expect(queries[0].text).toBe("SELECT doc FROM audit_logs ORDER BY doc->>'at' DESC LIMIT 12");
  });

  it("will not accept a limit that is not a number", async () => {
    const { pool, queries } = recordingPool();
    const store = await createPostgresStore(pool);
    queries.length = 0;

    await store.audit.recent("12; DROP TABLE audit_logs" as unknown as number);

    expect(queries[0].text).toBe("SELECT doc FROM audit_logs ORDER BY doc->>'at' DESC LIMIT 0");
  });
});

describe("findBy answers what the equivalent find answers", () => {
  const rows = [
    society("a", { status: "active", supervisorUserId: "sup-1" }),
    society("b", { status: "active", supervisorUserId: "sup-2" }),
    society("c", { status: "inactive", supervisorUserId: "sup-1" }),
    society("d", { status: "active", supervisorUserId: null }),
  ];

  it("agrees with the predicate on Postgres, one field and several", async () => {
    const store = await createPostgresStore(pgMemPool());
    for (const s of rows) await store.societies.put(s);

    const byPredicate = await store.societies.find((s) => s.supervisorUserId === "sup-1");
    const byCriteria = await store.societies.findBy({ supervisorUserId: "sup-1" });
    expect(byCriteria.map((s) => s.id).sort()).toEqual(byPredicate.map((s) => s.id).sort());
    expect(byCriteria.map((s) => s.id).sort()).toEqual(["a", "c"]);

    const both = await store.societies.findBy({ supervisorUserId: "sup-1", status: "active" });
    expect(both.map((s) => s.id)).toEqual(["a"]);
  });

  it("agrees with the predicate in memory, and with Postgres", async () => {
    const memory = createMemoryStore();
    const postgres = await createPostgresStore(pgMemPool());
    for (const s of rows) { await memory.societies.put(s); await postgres.societies.put(s); }

    const inMemory = (await memory.societies.findBy({ status: "active" })).map((s) => s.id).sort();
    const inPostgres = (await postgres.societies.findBy({ status: "active" })).map((s) => s.id).sort();
    expect(inMemory).toEqual(["a", "b", "d"]);
    expect(inPostgres).toEqual(inMemory);
  });

  it("returns nothing rather than everything when nothing matches", async () => {
    const store = await createPostgresStore(pgMemPool());
    for (const s of rows) await store.societies.put(s);
    expect(await store.societies.findBy({ supervisorUserId: "nobody" })).toEqual([]);
  });
});

describe("findBy matches what was written, not what normalise reads back", () => {
  // The one place the two methods genuinely disagree, pinned here so it is a
  // documented property rather than something a caller discovers in production
  // after migrating a `find` to a `findBy`. A society stored before status existed
  // reads back as "active" — `find` sees the default, the database never does.
  const legacy = { id: "old", name: "Old Society", address, createdAt: "2026-01-01T00:00:00.000Z" } as unknown as Society;

  it("does not find a defaulted field, in memory or on Postgres", async () => {
    const memory = createMemoryStore();
    const postgres = await createPostgresStore(pgMemPool());
    await memory.societies.put(legacy);
    await postgres.societies.put(legacy);

    expect((await memory.societies.find((s) => s.status === "active")).map((s) => s.id)).toEqual(["old"]);
    expect(await memory.societies.findBy({ status: "active" })).toEqual([]);
    expect(await postgres.societies.findBy({ status: "active" })).toEqual([]);
  });

  it("still normalises what it does return", async () => {
    const store = createMemoryStore();
    await store.societies.put(legacy);
    const [found] = await store.societies.findBy({ name: "Old Society" });
    expect(found.status).toBe("active");
  });
});

describe("the audit log", () => {
  const entries = [auditEntry("e1", "2026-01-01T00:00:00.000Z"), auditEntry("e2", "2026-01-03T00:00:00.000Z"), auditEntry("e3", "2026-01-02T00:00:00.000Z")];

  it("hands back the newest first, and only as many as were asked for", async () => {
    const memory = createMemoryStore();
    const postgres = await createPostgresStore(pgMemPool());
    for (const e of entries) { await memory.audit.add(e); await postgres.audit.add(e); }

    expect((await memory.audit.recent(2)).map((e) => e.id)).toEqual(["e2", "e3"]);
    expect((await postgres.audit.recent(2)).map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("reads oldest first when asked for everything, in both stores", async () => {
    const memory = createMemoryStore();
    const postgres = await createPostgresStore(pgMemPool());
    for (const e of entries) { await memory.audit.add(e); await postgres.audit.add(e); }

    expect((await postgres.audit.all()).map((e) => e.id)).toEqual(["e1", "e3", "e2"]);
    // The in-memory store returns insertion order, which for a log that is only ever
    // appended to is the same order. Both callers sort for themselves regardless.
    expect((await memory.audit.all()).map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
});
