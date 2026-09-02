import type { PostedTransaction } from "../domain/ledger";
import type { Attachment } from "../domain/attachments";
import type {
  Addon, Block, AuditLog, DeviceToken, Notification, Order, OutboxEvent, Pickup, Plan, Resident, Session, Slot, Society, Subscription, SupportTicket, SystemConfig, Unit, User, WaterLog, PaymentIntent, RecurringSchedule, ServiceOffering, ServiceRequest,
} from "../domain/models";

export interface Collection<T> {
  get(id: string): Promise<T | null>;
  put(item: T): Promise<T>;
  all(): Promise<T[]>;
  find(predicate: (item: T) => boolean): Promise<T[]>;
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
  all(): Promise<AuditLog[]>;
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
  slots: SlotCollection;
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
