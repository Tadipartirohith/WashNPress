import type { PostedTransaction } from "../../domain/ledger";
import {
  normaliseAddon, normaliseArea, normaliseOrder, normalisePickup, normalisePlan,
  normaliseResident, normaliseSociety, normaliseTicket, normaliseUnit, normaliseUser,
} from "../../domain/records";
import type {
  Addon, Area, AuditLog, Notification, Order, OutboxEvent, Pickup, Plan, Resident, Session, Slot, Society, Subscription, SupportTicket, SystemConfig, Unit, User, WaterLog, PaymentIntent, RecurringSchedule,
} from "../../domain/models";
import type {
  AuditRepository, Collection, DataStore, IdempotencyStore, LedgerRepository,
  OutboxRepository, SessionRepository, SlotCollection,
} from "../../ports/repositories";
import { schemaSql } from "./schema";

export interface PgClient { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; release(): void; }
export interface PgPool { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; connect(): Promise<PgClient>; }

function parseDoc<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }

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
  async find(predicate: (item: T) => boolean): Promise<T[]> {
    return (await this.all()).filter(predicate);
  }
}

class PgSlotCollection implements SlotCollection {
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
  async all(): Promise<AuditLog[]> {
    const { rows } = await this.pool.query(`SELECT doc FROM audit_logs`);
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
    areas: new PgCollection<Area>(pool, "areas", normaliseArea),
    notifications: new PgCollection<Notification>(pool, "notifications"),
    systemConfig: new PgCollection<SystemConfig>(pool, "system_config"),
    residents: new PgCollection<Resident>(pool, "residents", normaliseResident),
    societies: new PgCollection<Society>(pool, "societies", normaliseSociety),
    units: new PgCollection<Unit>(pool, "units", normaliseUnit),
    plans: new PgCollection<Plan>(pool, "plans", normalisePlan),
    subscriptions: new PgCollection<Subscription>(pool, "subscriptions"),
    paymentIntents: new PgCollection<PaymentIntent>(pool, "payment_intents"),
    slots: new PgSlotCollection(pool),
    pickups: new PgCollection<Pickup>(pool, "pickups", normalisePickup),
    orders: new PgCollection<Order>(pool, "orders", normaliseOrder),
    addons: new PgCollection<Addon>(pool, "addons", normaliseAddon),
    schedules: new PgCollection<RecurringSchedule>(pool, "schedules"),
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
