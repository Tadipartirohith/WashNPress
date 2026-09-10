import type { PostedTransaction } from "../domain/ledger";
import type { Attachment } from "../domain/attachments";
import type {
  Addon, Block, AuditLog, DeviceToken, Notification, Order, OutboxEvent, Pickup, Plan, Resident, Session, Slot, Society, Subscription, SupportTicket, SystemConfig, Unit, User, WaterLog, PaymentIntent, RecurringSchedule, ServiceOffering, ServiceRequest, RefundRequest, AdditionalServiceSlot,
} from "../domain/models";

// A field whose stored value is a plain scalar, which is the only kind a store can
// compare without unpacking the document: `doc->>'field' = $1` on Postgres, `===` in
// memory. Arrays, nested objects and unknowns are deliberately not offered, because
// there is no honest indexed query for them and a criteria object that quietly did
// nothing would be worse than one that will not compile.
type ScalarField<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean ? K : never;
}[keyof T];

// Equality on one or more fields, AND-ed together. No ranges, no OR, no negation:
// widening this is a schema decision, because every clause added here has to be an
// index in schema.ts to be worth anything.
export type Criteria<T> = { [K in ScalarField<T>]?: NonNullable<T[K]> };

export interface Collection<T> {
  get(id: string): Promise<T | null>;
  put(item: T): Promise<T>;
  all(): Promise<T[]>;
  // FULL SCAN. On Postgres this is `SELECT doc FROM <table>` with no WHERE: every row
  // in the table crosses the wire and is JSON-parsed in Node before the predicate sees
  // it, so its cost grows with the size of the platform rather than with the size of
  // the answer, and none of the expression indexes in schema.ts can be used.
  //
  // It stays because a predicate expresses things this port cannot — a range, an OR,
  // a set membership — and because most of the codebase is written against it. For a
  // plain equality on a field, prefer `findBy`, which the database can answer.
  find(predicate: (item: T) => boolean): Promise<T[]>;
  // The same answer as `find` with an equality predicate, but computed by the store.
  //
  // One caveat, and it is the reason this is not a silent drop-in for every `find`:
  // this matches what was WRITTEN, whereas `find` matches what `normalise` reads back
  // (domain/records.ts). For nearly every field those are the same value. For a field
  // a normaliser supplies or rewrites they are not — a ticket stored under the old
  // "assigned" status reads back as "in_progress", so `find` matches it on the new
  // name and `findBy` matches it on the old one. Both adapters agree with each other
  // here, so an in-memory test tells the truth about Postgres.
  findBy(criteria: Criteria<T>): Promise<T[]>;
  // Actually gone.
  //
  // Almost nothing in this platform is deleted — staff are stood down, orders are
  // cancelled, societies are deactivated, because a record is history and history is
  // not editable. A photograph somebody attached by mistake is the exception: there
  // is no history in it to keep, and leaving the bytes behind after the person asked
  // for them to go is the wrong answer to a privacy question.
  remove(id: string): Promise<void>;
}

export interface SlotCollection extends Collection<Slot> {
  // Atomic reserve and release of one unit of capacity. Safe under concurrency.
  reserveCapacity(id: string): Promise<Slot | null>;
  releaseCapacity(id: string): Promise<Slot | null>;
}

export interface LedgerRepository {
  post(txn: PostedTransaction): Promise<void>;
  transactionsForAccount(account: string): Promise<PostedTransaction[]>;
  all(): Promise<PostedTransaction[]>;
}

export interface IdempotencyStore {
  seen(key: string): Promise<boolean>;
  markSeen(key: string): Promise<void>;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  findByToken(token: string): Promise<Session | null>;
  delete(token: string): Promise<void>;
}

export interface OutboxRepository {
  add(event: OutboxEvent): Promise<OutboxEvent>;
  listPending(): Promise<OutboxEvent[]>;
  mark(id: string, status: OutboxEvent["status"]): Promise<void>;
}

export interface AuditRepository {
  add(entry: AuditLog): Promise<AuditLog>;
  // Every entry ever written, oldest first. Unbounded on purpose: the audit log is the
  // answer to "what has been done to this record", and that answer cannot be truncated
  // without knowing which record is being asked about.
  //
  // It is also the one table here that is only ever appended to, so a caller that
  // wants a tail rather than a history should ask for one.
  all(): Promise<AuditLog[]>;
  // The newest `limit` entries, bounded by the database rather than by the caller.
  // What an activity feed actually needs, and what it should ask for instead of
  // pulling every change ever made to the platform across the wire to show twelve.
  recent(limit: number): Promise<AuditLog[]>;
}

export interface DataStore {
  users: Collection<User>;
  notifications: Collection<Notification>;
  // The handsets a push notification can actually be delivered to.
  deviceTokens: Collection<DeviceToken>;
  systemConfig: Collection<SystemConfig>;
  residents: Collection<Resident>;
  societies: Collection<Society>;
  // The towers, wings and phases inside a society; the unit work is divided by.
  blocks: Collection<Block>;
  units: Collection<Unit>;
  plans: Collection<Plan>;
  subscriptions: Collection<Subscription>;
  paymentIntents: Collection<PaymentIntent>;
  // Requests to return money on an order, and the decision made on each.
  refundRequests: Collection<RefundRequest>;
  slots: SlotCollection;
  additionalServiceSlots: Collection<AdditionalServiceSlot>;
  pickups: Collection<Pickup>;
  orders: Collection<Order>;
  addons: Collection<Addon>;
  // Standing collection arrangements, kept as records rather than as a flag.
  schedules: Collection<RecurringSchedule>;
  // Services that are not laundry, and the bookings made against them.
  offerings: Collection<ServiceOffering>;
  serviceRequests: Collection<ServiceRequest>;
  tickets: Collection<SupportTicket>;
  // Photographs attached to a ticket. Held here rather than on a disk so the memory
  // and Postgres adapters behave identically and the tests need no storage.
  attachments: Collection<Attachment>;
  waterLogs: Collection<WaterLog>;
  sessions: SessionRepository;
  outbox: OutboxRepository;
  audit: AuditRepository;
  ledger: LedgerRepository;
  idempotency: IdempotencyStore;
}

export interface RateHit { allowed: boolean; remaining: number; resetSeconds: number; }
export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number): Promise<RateHit>;
}
