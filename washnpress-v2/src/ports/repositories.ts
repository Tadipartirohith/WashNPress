import type { PostedTransaction } from "../domain/ledger";
import type {
  Addon, AuditLog, Order, OutboxEvent, Pickup, Plan, Resident, Session, Slot,
  Society, Subscription, SupportTicket, Unit, User, WaterLog, PaymentIntent,
} from "../domain/models";

export interface Collection<T> {
  get(id: string): Promise<T | null>;
  put(item: T): Promise<T>;
  all(): Promise<T[]>;
  find(predicate: (item: T) => boolean): Promise<T[]>;
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
  residents: Collection<Resident>;
  societies: Collection<Society>;
  units: Collection<Unit>;
  plans: Collection<Plan>;
  subscriptions: Collection<Subscription>;
  paymentIntents: Collection<PaymentIntent>;
  slots: SlotCollection;
  pickups: Collection<Pickup>;
  orders: Collection<Order>;
  addons: Collection<Addon>;
  tickets: Collection<SupportTicket>;
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
