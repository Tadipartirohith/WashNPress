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

class MemoryCollection<T extends { id: string }> implements Collection<T> {
  protected readonly items = new Map<string, T>();
  // Records are normalised on the way out, so a row missing a field costs that row a
  // default rather than costing the caller an exception. See domain/records.ts.
  constructor(protected readonly normalise: (item: T) => T = (item) => item) {}
  async get(id: string): Promise<T | null> { const item = this.items.get(id); return item ? this.normalise(item) : null; }
  async put(item: T): Promise<T> { this.items.set(item.id, item); return item; }
  async all(): Promise<T[]> { return [...this.items.values()].map(this.normalise); }
  async find(predicate: (item: T) => boolean): Promise<T[]> { return (await this.all()).filter(predicate); }
  // Matched against the stored record, before `normalise` fills anything in, because
  // that is what the Postgres adapter's WHERE compares against — it reads the JSON as
  // it was written and never sees the defaults. Filtering the normalised records here
  // would be the friendlier answer and the wrong one: it would make the suite green on
  // legacy rows that Postgres does not return. See Collection.findBy.
  async findBy(criteria: Criteria<T>): Promise<T[]> {
    const tests = Object.entries(criteria as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return [...this.items.values()]
      .filter((item) => tests.every(([field, value]) => (item as Record<string, unknown>)[field] === value))
      .map((item) => this.normalise(item));
  }
  async remove(id: string): Promise<void> { this.items.delete(id); }
}

class MemorySlotCollection extends MemoryCollection<Slot> implements SlotCollection {
  // No await between the read and the write, so within one process this is atomic
  // and two concurrent callers cannot both take the last unit of capacity.
  async reserveCapacity(id: string): Promise<Slot | null> {
    const slot = this.items.get(id);
    if (!slot || !slot.isActive || slot.capacityRemaining <= 0) return null;
    const updated = { ...slot, capacityRemaining: slot.capacityRemaining - 1 };
    this.items.set(id, updated);
    return updated;
  }
  async releaseCapacity(id: string): Promise<Slot | null> {
    const slot = this.items.get(id);
    if (!slot) return null;
    const updated = { ...slot, capacityRemaining: Math.min(slot.capacityTotal, slot.capacityRemaining + 1) };
    this.items.set(id, updated);
    return updated;
  }
}

class MemoryLedger implements LedgerRepository {
  private readonly txns: PostedTransaction[] = [];
  // The idempotency store's keys, shared as the Postgres ledger shares its table, so a
  // key taken through one is taken for the other.
  constructor(private readonly keys: MemoryIdempotency) {}
  async post(txn: PostedTransaction): Promise<void> { this.txns.push(txn); }
  async postOnce(key: string, txn: PostedTransaction): Promise<boolean> {
    if (!this.keys.take(key)) return false;
    this.txns.push(txn);
    return true;
  }
  async transactionsForAccount(account: string): Promise<PostedTransaction[]> {
    return this.txns.filter((t) => t.entries.some((e) => e.account === account));
  }
  async all(): Promise<PostedTransaction[]> { return [...this.txns]; }
}

class MemoryIdempotency implements IdempotencyStore {
  private readonly keys = new Set<string>();
  // Synchronous, so nothing can run between the test and the take.
  take(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
  async claim(key: string): Promise<boolean> { return this.take(key); }
}

class MemorySessions implements SessionRepository {
  private readonly byToken = new Map<string, Session>();
  async create(session: Session): Promise<Session> { this.byToken.set(session.token, session); return session; }
  async findByToken(token: string): Promise<Session | null> { return this.byToken.get(token) ?? null; }
  async delete(token: string): Promise<void> { this.byToken.delete(token); }
}

class MemoryOutbox implements OutboxRepository {
  private readonly events = new Map<string, OutboxEvent>();
  // When each event was last handed out, kept beside the event as Postgres keeps it in
  // its own column, so a claim is a lease on a pending event rather than a new status.
  private readonly claimedAt = new Map<string, number>();
  async add(event: OutboxEvent): Promise<OutboxEvent> { this.events.set(event.id, event); return event; }
  async listPending(): Promise<OutboxEvent[]> { return [...this.events.values()].filter((e) => e.status === "pending"); }
  async claimPending(limit: number, leaseSeconds: number, now: Date = new Date()): Promise<OutboxEvent[]> {
    const cutoff = now.getTime() - leaseSeconds * 1000;
    const batch = [...this.events.values()]
      .filter((e) => e.status === "pending" && (this.claimedAt.get(e.id) ?? -Infinity) < cutoff)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
    for (const e of batch) this.claimedAt.set(e.id, now.getTime());
    return batch;
  }
  async mark(id: string, status: OutboxEvent["status"]): Promise<void> {
    const e = this.events.get(id); if (e) this.events.set(id, { ...e, status, attempts: e.attempts + 1 });
  }
}

class MemoryAudit implements AuditRepository {
  private readonly entries: AuditLog[] = [];
  async add(entry: AuditLog): Promise<AuditLog> { this.entries.push(entry); return entry; }
  async all(): Promise<AuditLog[]> { return [...this.entries]; }
  async recent(limit: number): Promise<AuditLog[]> {
    return [...this.entries].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, Math.max(0, Math.floor(limit)));
  }
}

export function createMemoryStore(): DataStore {
  const idempotency = new MemoryIdempotency();
  return {
    users: new MemoryCollection<User>(normaliseUser),
    notifications: new MemoryCollection<Notification>(),
    deviceTokens: new MemoryCollection<DeviceToken>(),
    systemConfig: new MemoryCollection<SystemConfig>(),
    residents: new MemoryCollection<Resident>(normaliseResident),
    societies: new MemoryCollection<Society>(normaliseSociety),
    blocks: new MemoryCollection<Block>(normaliseBlock),
    units: new MemoryCollection<Unit>(normaliseUnit),
    plans: new MemoryCollection<Plan>(normalisePlan),
    subscriptions: new MemoryCollection<Subscription>(),
    paymentIntents: new MemoryCollection<PaymentIntent>(),
    refundRequests: new MemoryCollection<RefundRequest>(),
    slots: new MemorySlotCollection(),
    additionalServiceSlots: new MemoryCollection<AdditionalServiceSlot>(),
    pickups: new MemoryCollection<Pickup>(normalisePickup),
    orders: new MemoryCollection<Order>(normaliseOrder),
    addons: new MemoryCollection<Addon>(normaliseAddon),
    schedules: new MemoryCollection<RecurringSchedule>(),
    offerings: new MemoryCollection<ServiceOffering>(normaliseOffering),
    serviceRequests: new MemoryCollection<ServiceRequest>(),
    tickets: new MemoryCollection<SupportTicket>(normaliseTicket),
    attachments: new MemoryCollection<Attachment>(),
    waterLogs: new MemoryCollection<WaterLog>(),
    sessions: new MemorySessions(),
    outbox: new MemoryOutbox(),
    audit: new MemoryAudit(),
    ledger: new MemoryLedger(idempotency),
    idempotency,
  };
}
