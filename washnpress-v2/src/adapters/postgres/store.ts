import type { PostedTransaction } from "../../domain/ledger";
import type { Attachment } from "../../domain/attachments";
import {
  normaliseAddon, normaliseOffering, normaliseOrder, normalisePickup, normalisePlan,
  normaliseBlock, normaliseResident, normaliseSociety, normaliseTicket, normaliseUnit, normaliseUser,
} from "../../domain/records";
import type {
  Addon, Block, AuditLog, DeviceToken, Notification, Order, OutboxEvent, Pickup, Plan, Resident, Session, Slot, Society, Subscription, SupportTicket, SystemConfig, Unit, User, WaterLog, PaymentIntent, RecurringSchedule, ServiceOffering, ServiceRequest, RefundRequest, AdditionalServiceSlot,
} from "../../domain/models";
import type {
  AuditRepository, Collection, Criteria, DataStore, IdempotencyStore, LedgerRepository,
  OutboxRepository, SessionRepository, SlotCollection,
} from "../../ports/repositories";
import { schemaSql } from "./schema";

export interface PgClient { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; release(): void; }
export interface PgPool { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; connect(): Promise<PgClient>; }

function parseDoc<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }

// A JSONB path is not something that can be bound, so the field name is interpolated
// into the SQL while the value stays a parameter. That makes the field name the one
// place an injection could enter, and a criteria object can be assembled from a
// request body two layers above here, so the name is checked against the shape a
// field name can have rather than trusted to have come from a typed literal.
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Builds `doc->>'a' = $1 AND doc->>'b' = $2` and the parameters to go with it.
//
// Exported because the engine the tests run against is pg-mem, a JavaScript
// reimplementation that cannot create the expression indexes this clause exists to
// use — so it cannot demonstrate that the clause is worth anything. A test asserting
// the SQL itself is the only thing that can.
//
// `realColumns` names the fields a table keeps outside the document; everything else
// is read out of the JSON. `->>`  yields text, so a value compared against it is sent
// as text, which is how Postgres stored it in the first place.
export function documentWhere(
  criteria: Record<string, unknown>,
  realColumns: Record<string, string> = {},
): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];
  for (const [field, value] of Object.entries(criteria)) {
    if (value === undefined) continue;
    if (!FIELD_NAME.test(field)) throw new Error(`not a queryable field name: ${field}`);
    const column = realColumns[field];
    params.push(column ? value : String(value));
    clauses.push(`${column ?? `doc->>'${field}'`} = $${params.length}`);
  }
  return { clause: clauses.join(" AND "), params };
}

class PgCollection<T extends { id: string }> implements Collection<T> {
  // Same contract as the in-memory collection: a record missing a field is filled in
  // on the way out rather than thrown at the caller. See domain/records.ts.
  constructor(
    protected readonly pool: PgPool,
    protected readonly table: string,
    protected readonly normalise: (item: T) => T = (item) => item,
  ) {}
  async get(id: string): Promise<T | null> {
    const { rows } = await this.pool.query(`SELECT doc FROM ${this.table} WHERE id = $1`, [id]);
    return rows[0] ? this.normalise(parseDoc<T>(rows[0].doc)) : null;
  }
  async put(item: T): Promise<T> {
    await this.pool.query(
      `INSERT INTO ${this.table} (id, doc) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`,
      [item.id, JSON.stringify(item)],
    );
    return item;
  }
  async all(): Promise<T[]> {
    const { rows } = await this.pool.query(`SELECT doc FROM ${this.table}`);
    return rows.map((r) => this.normalise(parseDoc<T>(r.doc)));
  }
  // Full scan, and unavoidably so — an arbitrary predicate can only be applied in
  // Node. See the note on Collection.find; `findBy` is the version Postgres can answer.
  async find(predicate: (item: T) => boolean): Promise<T[]> {
    return (await this.all()).filter(predicate);
  }
  async findBy(criteria: Criteria<T>): Promise<T[]> {
    const { clause, params } = documentWhere(criteria as Record<string, unknown>);
    // No criteria is a request for the whole table, said plainly rather than as a
    // `WHERE TRUE` the planner then has to see through.
    if (!clause) return this.all();
    const { rows } = await this.pool.query(`SELECT doc FROM ${this.table} WHERE ${clause}`, params);
    return rows.map((r) => this.normalise(parseDoc<T>(r.doc)));
  }
  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
  }
}

class PgSlotCollection implements SlotCollection {
  // Capacity and the active flag are real columns, because reserving a slot is one
  // conditional write against them and nothing else — the write leaves the document
  // alone, so the JSON's copies of both go stale the moment a slot is booked. `row()`
  // already reads the columns rather than the document; a query has to do the same, or
  // a search for a slot with capacity left answers from the state it was created in.
  private static readonly REAL_COLUMNS: Record<string, string> = {
    capacityRemaining: "capacity_remaining",
    isActive: "is_active",
  };
  constructor(private readonly pool: PgPool) {}
  private row(r: Record<string, unknown>): Slot {
    return { ...parseDoc<Slot>(r.doc), capacityRemaining: Number(r.capacity_remaining), isActive: Boolean(r.is_active) };
  }
  async get(id: string): Promise<Slot | null> {
    const { rows } = await this.pool.query(`SELECT doc, capacity_remaining, is_active FROM slots WHERE id = $1`, [id]);
    return rows[0] ? this.row(rows[0]) : null;
  }
  async put(item: Slot): Promise<Slot> {
    await this.pool.query(
      `INSERT INTO slots (id, doc, capacity_remaining, is_active) VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, capacity_remaining = EXCLUDED.capacity_remaining, is_active = EXCLUDED.is_active`,
      [item.id, JSON.stringify(item), item.capacityRemaining, item.isActive],
    );
    return item;
  }
  async all(): Promise<Slot[]> {
    const { rows } = await this.pool.query(`SELECT doc, capacity_remaining, is_active FROM slots`);
    return rows.map((r) => this.row(r));
  }
  async find(predicate: (item: Slot) => boolean): Promise<Slot[]> { return (await this.all()).filter(predicate); }
  async findBy(criteria: Criteria<Slot>): Promise<Slot[]> {
    const { clause, params } = documentWhere(criteria as Record<string, unknown>, PgSlotCollection.REAL_COLUMNS);
    if (!clause) return this.all();
    const { rows } = await this.pool.query(
      `SELECT doc, capacity_remaining, is_active FROM slots WHERE ${clause}`,
      params,
    );
    return rows.map((r) => this.row(r));
  }
  // Present for the interface. A slot is deactivated rather than deleted — a booking
  // made against it still has to be able to say what it was booked into.
  async remove(id: string): Promise<void> {
    await this.pool.query("DELETE FROM slots WHERE id = $1", [id]);
  }
  // Atomic: the conditional UPDATE on the real column is the single source of truth
  // for capacity, so two concurrent callers cannot both take the last unit.
  async reserveCapacity(id: string): Promise<Slot | null> {
    const { rows } = await this.pool.query(
      `UPDATE slots SET capacity_remaining = capacity_remaining - 1
       WHERE id = $1 AND is_active = TRUE AND capacity_remaining > 0
       RETURNING doc, capacity_remaining, is_active`,
      [id],
    );
    return rows[0] ? this.row(rows[0]) : null;
  }
  async releaseCapacity(id: string): Promise<Slot | null> {
    const { rows } = await this.pool.query(
      `UPDATE slots SET capacity_remaining = capacity_remaining + 1
       WHERE id = $1 RETURNING doc, capacity_remaining, is_active`,
      [id],
    );
    return rows[0] ? this.row(rows[0]) : null;
  }
}

class PgLedger implements LedgerRepository {
  constructor(private readonly pool: PgPool) {}
  async post(txn: PostedTransaction): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO ledger_txn (id, reference, created_at) VALUES ($1, $2, $3)`, [txn.id, txn.reference, txn.createdAt]);
      let idx = 0;
      for (const e of txn.entries) {
        await client.query(`INSERT INTO ledger_entry (txn_id, idx, account, direction, amount) VALUES ($1, $2, $3, $4, $5)`, [txn.id, idx++, e.account, e.direction, e.amount]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  private async build(txnRows: Array<Record<string, unknown>>): Promise<PostedTransaction[]> {
    const out: PostedTransaction[] = [];
    for (const t of txnRows) {
      const { rows: entries } = await this.pool.query(`SELECT account, direction, amount FROM ledger_entry WHERE txn_id = $1 ORDER BY idx`, [t.id]);
      out.push({
        id: t.id as string, reference: t.reference as string, createdAt: String(t.created_at),
        entries: entries.map((e) => ({ account: e.account as string, direction: e.direction as "debit" | "credit", amount: Number(e.amount) })),
      });
    }
    return out;
  }
  async transactionsForAccount(account: string): Promise<PostedTransaction[]> {
    const { rows } = await this.pool.query(
      `SELECT id, reference, created_at FROM ledger_txn WHERE id IN (SELECT txn_id FROM ledger_entry WHERE account = $1) ORDER BY created_at`,
      [account],
    );
    return this.build(rows);
  }
  async all(): Promise<PostedTransaction[]> {
    const { rows } = await this.pool.query(`SELECT id, reference, created_at FROM ledger_txn ORDER BY created_at`);
    return this.build(rows);
  }
}

class PgIdempotency implements IdempotencyStore {
  constructor(private readonly pool: PgPool) {}
  async seen(key: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM processed_events WHERE event_id = $1`, [key]);
    return rows.length > 0;
  }
  async markSeen(key: string): Promise<void> {
    await this.pool.query(`INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
  }
}

class PgSessions implements SessionRepository {
  constructor(private readonly pool: PgPool) {}
  async create(session: Session): Promise<Session> {
    await this.pool.query(`INSERT INTO sessions (token, doc) VALUES ($1, $2::jsonb) ON CONFLICT (token) DO UPDATE SET doc = EXCLUDED.doc`, [session.token, JSON.stringify(session)]);
    return session;
  }
  async findByToken(token: string): Promise<Session | null> {
    const { rows } = await this.pool.query(`SELECT doc FROM sessions WHERE token = $1`, [token]);
    return rows[0] ? parseDoc<Session>(rows[0].doc) : null;
  }
  async delete(token: string): Promise<void> { await this.pool.query(`DELETE FROM sessions WHERE token = $1`, [token]); }
}

class PgOutbox implements OutboxRepository {
  constructor(private readonly pool: PgPool) {}
  async add(event: OutboxEvent): Promise<OutboxEvent> {
    await this.pool.query(`INSERT INTO outbox_events (id, doc, status) VALUES ($1, $2::jsonb, $3)`, [event.id, JSON.stringify(event), event.status]);
    return event;
  }
  async listPending(): Promise<OutboxEvent[]> {
    const { rows } = await this.pool.query(`SELECT doc FROM outbox_events WHERE status = 'pending'`);
    return rows.map((r) => parseDoc<OutboxEvent>(r.doc));
  }
  async mark(id: string, status: OutboxEvent["status"]): Promise<void> {
    const { rows } = await this.pool.query(`SELECT doc FROM outbox_events WHERE id = $1`, [id]);
    if (!rows[0]) return;
    const event = parseDoc<OutboxEvent>(rows[0].doc);
    const updated = { ...event, status, attempts: event.attempts + 1 };
    await this.pool.query(`UPDATE outbox_events SET doc = $2::jsonb, status = $3 WHERE id = $1`, [id, JSON.stringify(updated), status]);
  }
}

class PgAudit implements AuditRepository {
  constructor(private readonly pool: PgPool) {}
  async add(entry: AuditLog): Promise<AuditLog> {
    await this.pool.query(`INSERT INTO audit_logs (id, doc) VALUES ($1, $2::jsonb)`, [entry.id, JSON.stringify(entry)]);
    return entry;
  }
  // Ordered, where it used to be whatever order the heap happened to hand back. The
  // in-memory adapter returns these oldest first because it appends to an array, and
  // two stores that disagree about order are two stores the same test cannot cover.
  async all(): Promise<AuditLog[]> {
    const { rows } = await this.pool.query(`SELECT doc FROM audit_logs ORDER BY doc->>'at'`);
    return rows.map((r) => parseDoc<AuditLog>(r.doc));
  }
  // The bound belongs here rather than in the caller. audit_logs only grows, and a
  // caller that slices twelve rows off the end has already paid to read and parse
  // every row ever written by the time it gets to slice anything.
  //
  // The limit is inlined rather than bound because it is a number this method has
  // just coerced to one, and `LIMIT $1` is not accepted everywhere `LIMIT 12` is.
  async recent(limit: number): Promise<AuditLog[]> {
    const bound = Math.max(0, Math.floor(Number(limit) || 0));
    const { rows } = await this.pool.query(`SELECT doc FROM audit_logs ORDER BY doc->>'at' DESC LIMIT ${bound}`);
    return rows.map((r) => parseDoc<AuditLog>(r.doc));
  }
}

export async function createPostgresStore(pool: PgPool): Promise<DataStore> {
  // Apply the schema. Split on semicolons so it works across drivers.
  for (const stmt of schemaSql().split(";").map((s) => s.trim()).filter(Boolean)) {
    try {
      await pool.query(stmt);
    } catch (error) {
      // A table that will not create is fatal; an index that will not create is not.
      // Some drivers used in testing do not implement expression indexes, and the
      // application is correct without them — only slower.
      if (!stmt.toUpperCase().startsWith("CREATE INDEX")) throw error;
    }
  }
  return {
    users: new PgCollection<User>(pool, "users", normaliseUser),
    notifications: new PgCollection<Notification>(pool, "notifications"),
    deviceTokens: new PgCollection<DeviceToken>(pool, "device_tokens"),
    attachments: new PgCollection<Attachment>(pool, "attachments"),
    systemConfig: new PgCollection<SystemConfig>(pool, "system_config"),
    residents: new PgCollection<Resident>(pool, "residents", normaliseResident),
    societies: new PgCollection<Society>(pool, "societies", normaliseSociety),
    blocks: new PgCollection<Block>(pool, "blocks", normaliseBlock),
    units: new PgCollection<Unit>(pool, "units", normaliseUnit),
    plans: new PgCollection<Plan>(pool, "plans", normalisePlan),
    subscriptions: new PgCollection<Subscription>(pool, "subscriptions"),
    paymentIntents: new PgCollection<PaymentIntent>(pool, "payment_intents"),
    refundRequests: new PgCollection<RefundRequest>(pool, "refund_requests"),
    slots: new PgSlotCollection(pool),
    additionalServiceSlots: new PgCollection<AdditionalServiceSlot>(pool, "additional_service_slots"),
    pickups: new PgCollection<Pickup>(pool, "pickups", normalisePickup),
    orders: new PgCollection<Order>(pool, "orders", normaliseOrder),
    addons: new PgCollection<Addon>(pool, "addons", normaliseAddon),
    schedules: new PgCollection<RecurringSchedule>(pool, "schedules"),
    offerings: new PgCollection<ServiceOffering>(pool, "offerings", normaliseOffering),
    serviceRequests: new PgCollection<ServiceRequest>(pool, "service_requests"),
    tickets: new PgCollection<SupportTicket>(pool, "tickets", normaliseTicket),
    waterLogs: new PgCollection<WaterLog>(pool, "water_logs"),
    sessions: new PgSessions(pool),
    outbox: new PgOutbox(pool),
    audit: new PgAudit(pool),
    ledger: new PgLedger(pool),
    idempotency: new PgIdempotency(pool),
  };
}

export interface PoolTimeouts {
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export async function createPostgresPool(url: string, poolMax: number, timeouts: PoolTimeouts = {}): Promise<PgPool> {
  const pg = (await import("pg")) as unknown as { Pool: new (cfg: unknown) => PgPool };
  // The configured timeouts were read into config and then never passed to the pool,
  // so the driver's own defaults applied and a connection attempt could wait far
  // longer than the configuration said it should.
  return new pg.Pool({
    connectionString: url,
    max: poolMax,
    ...(timeouts.connectionTimeoutMs !== undefined ? { connectionTimeoutMillis: timeouts.connectionTimeoutMs } : {}),
    ...(timeouts.idleTimeoutMs !== undefined ? { idleTimeoutMillis: timeouts.idleTimeoutMs } : {}),
  });
}
