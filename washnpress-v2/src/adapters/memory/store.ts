import type { PostedTransaction } from "../../domain/ledger";
import {
  normaliseAddon, normaliseOffering, normaliseOrder, normalisePickup, normalisePlan,
  normaliseBlock, normaliseResident, normaliseSociety, normaliseTicket, normaliseUnit, normaliseUser,
} from "../../domain/records";
import type {
  Addon, Block, AuditLog, Notification, Order, OutboxEvent, Pickup, Plan, Resident, Session, Slot, Society, Subscription, SupportTicket, SystemConfig, Unit, User, WaterLog, PaymentIntent, RecurringSchedule, ServiceOffering, ServiceRequest,
} from "../../domain/models";
import type {
  AuditRepository, Collection, DataStore, IdempotencyStore, LedgerRepository,
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
  async post(txn: PostedTransaction): Promise<void> { this.txns.push(txn); }
  async transactionsForAccount(account: string): Promise<PostedTransaction[]> {
    return this.txns.filter((t) => t.entries.some((e) => e.account === account));
  }
  async all(): Promise<PostedTransaction[]> { return [...this.txns]; }
}

class MemoryIdempotency implements IdempotencyStore {
  private readonly keys = new Set<string>();
  async seen(key: string): Promise<boolean> { return this.keys.has(key); }
  async markSeen(key: string): Promise<void> { this.keys.add(key); }
}

class MemorySessions implements SessionRepository {
  private readonly byToken = new Map<string, Session>();
  async create(session: Session): Promise<Session> { this.byToken.set(session.token, session); return session; }
  async findByToken(token: string): Promise<Session | null> { return this.byToken.get(token) ?? null; }
  async delete(token: string): Promise<void> { this.byToken.delete(token); }
}

class MemoryOutbox implements OutboxRepository {
  private readonly events = new Map<string, OutboxEvent>();
  async add(event: OutboxEvent): Promise<OutboxEvent> { this.events.set(event.id, event); return event; }
  async listPending(): Promise<OutboxEvent[]> { return [...this.events.values()].filter((e) => e.status === "pending"); }
  async mark(id: string, status: OutboxEvent["status"]): Promise<void> {
    const e = this.events.get(id); if (e) this.events.set(id, { ...e, status, attempts: e.attempts + 1 });
  }
}

class MemoryAudit implements AuditRepository {
  private readonly entries: AuditLog[] = [];
  async add(entry: AuditLog): Promise<AuditLog> { this.entries.push(entry); return entry; }
  async all(): Promise<AuditLog[]> { return [...this.entries]; }
}

export function createMemoryStore(): DataStore {
  return {
    users: new MemoryCollection<User>(normaliseUser),
    notifications: new MemoryCollection<Notification>(),
    systemConfig: new MemoryCollection<SystemConfig>(),
    residents: new MemoryCollection<Resident>(normaliseResident),
    societies: new MemoryCollection<Society>(normaliseSociety),
    blocks: new MemoryCollection<Block>(normaliseBlock),
    units: new MemoryCollection<Unit>(normaliseUnit),
    plans: new MemoryCollection<Plan>(normalisePlan),
    subscriptions: new MemoryCollection<Subscription>(),
    paymentIntents: new MemoryCollection<PaymentIntent>(),
    slots: new MemorySlotCollection(),
    pickups: new MemoryCollection<Pickup>(normalisePickup),
    orders: new MemoryCollection<Order>(normaliseOrder),
    addons: new MemoryCollection<Addon>(normaliseAddon),
    schedules: new MemoryCollection<RecurringSchedule>(),
    offerings: new MemoryCollection<ServiceOffering>(normaliseOffering),
    serviceRequests: new MemoryCollection<ServiceRequest>(),
    tickets: new MemoryCollection<SupportTicket>(normaliseTicket),
    waterLogs: new MemoryCollection<WaterLog>(),
    sessions: new MemorySessions(),
    outbox: new MemoryOutbox(),
    audit: new MemoryAudit(),
    ledger: new MemoryLedger(),
    idempotency: new MemoryIdempotency(),
  };
}
