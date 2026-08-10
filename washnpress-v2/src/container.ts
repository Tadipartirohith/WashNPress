import type { AppConfig } from "./config";
import type { DataStore, RateLimitStore, SessionRepository } from "./ports/repositories";
import type { PaymentProvider } from "./domain/payments/provider";
import type { SeedIds } from "./seed";
import { createMemoryStore } from "./adapters/memory/store";
import { seedStore, SEED_IDS } from "./seed";
import { FakePaymentProvider } from "./adapters/payments/fake-provider";
import { RazorpayPaymentProvider } from "./adapters/payments/razorpay-provider";
import { CompositeNotificationProvider } from "./adapters/notifications/composite";
import type { NotificationProvider } from "./adapters/notifications/providers";
import { MemoryRateLimitStore } from "./adapters/cache/memory-rate-limit";
import { OtpService } from "./services/otp-service";
import { AuthService } from "./services/auth-service";
import { NotificationService } from "./services/notification-service";
import { WalletService } from "./services/wallet-service";
import { SubscriptionService } from "./services/subscription-service";
import { SchedulingService } from "./services/scheduling-service";
import { OrderService } from "./services/order-service";
import { SupportService } from "./services/support-service";
import { PaymentService } from "./services/payment-service";
import { ReportsService } from "./services/reports-service";
import { SustainabilityService } from "./services/sustainability-service";
import { EarningsService } from "./services/earnings-service";
import { ReconciliationService } from "./services/reconciliation-service";
import { RecurringService } from "./services/recurring-service";

export interface Container {
  config: AppConfig;
  store: DataStore;
  seedIds: SeedIds;
  notificationProvider: NotificationProvider;
  rateLimit: RateLimitStore;
  paymentProvider: PaymentProvider;
  otp: OtpService;
  auth: AuthService;
  notifications: NotificationService;
  wallet: WalletService;
  subscriptions: SubscriptionService;
  scheduling: SchedulingService;
  orders: OrderService;
  support: SupportService;
  payments: PaymentService;
  reports: ReportsService;
  sustainability: SustainabilityService;
  earnings: EarningsService;
  reconciliation: ReconciliationService;
  recurring: RecurringService;
  shutdown: () => Promise<void>;
}

function buildPaymentProvider(config: AppConfig): PaymentProvider {
  if (config.payments.provider === "razorpay" && config.payments.keyId && config.payments.keySecret) {
    return new RazorpayPaymentProvider(config.payments.keyId, config.payments.keySecret, config.payments.baseUrl);
  }
  return new FakePaymentProvider();
}

async function buildStore(config: AppConfig, injected?: DataStore): Promise<{ store: DataStore; seedIds: SeedIds }> {
  if (injected) {
    const already = await injected.societies.get(SEED_IDS.societyId);
    return { store: injected, seedIds: already ? SEED_IDS : await seedStore(injected, config) };
  }
  if (config.storage.driver === "postgres") {
    const { createPostgresPool, createPostgresStore } = await import("./adapters/postgres/store");
    const pool = await createPostgresPool(config.storage.postgres.url, config.storage.postgres.poolMax);
    const store = await createPostgresStore(pool);
    const already = await store.societies.get(SEED_IDS.societyId);
    return { store, seedIds: already ? SEED_IDS : await seedStore(store, config) };
  }
  const store = createMemoryStore();
  return { store, seedIds: await seedStore(store, config) };
}

export async function buildContainer(config: AppConfig, options: { store?: DataStore } = {}): Promise<Container> {
  const { store, seedIds } = await buildStore(config, options.store);

  // Cache backed pieces: rate limiter and sessions. Redis is used when configured,
  // otherwise an in process implementation keeps everything runnable and testable.
  let rateLimit: RateLimitStore = new MemoryRateLimitStore();
  let sessions: SessionRepository = store.sessions;
  let closeRedis: (() => Promise<void>) | null = null;
  if (config.cache.driver === "redis") {
    const { createRedisClient, RedisRateLimitStore, RedisSessionRepository } = await import("./adapters/cache/redis");
    const redis = createRedisClient(config.cache.redis.url);
    rateLimit = new RedisRateLimitStore(redis);
    sessions = new RedisSessionRepository(redis, config.auth.sessionTtlSeconds);
    closeRedis = async () => { await redis.quit(); };
  }

  const notificationProvider = new CompositeNotificationProvider(config);
  const paymentProvider = buildPaymentProvider(config);

  const otp = new OtpService(config, rateLimit);
  const auth = new AuthService(store, otp, config, sessions);
  const notifications = new NotificationService(store, config, notificationProvider);
  const wallet = new WalletService(store, paymentProvider, config.payments.currency);
  const subscriptions = new SubscriptionService(store, wallet);
  const scheduling = new SchedulingService(store, notifications, config.scheduling.bookingCutoffHours);
  const support = new SupportService(store);
  const orders = new OrderService(store, notifications, support, subscriptions);
  const payments = new PaymentService(store, config.payments.webhookSecret);
  const reports = new ReportsService(store);
  const sustainability = new SustainabilityService(store);
  const earnings = new EarningsService(store);
  const reconciliation = new ReconciliationService(store, paymentProvider);
  const recurring = new RecurringService(store, scheduling, config.jobs.recurringHorizonDays);

  const shutdown = async () => { if (closeRedis) await closeRedis(); };

  return {
    config, store, seedIds, notificationProvider, rateLimit, paymentProvider,
    otp, auth, notifications, wallet, subscriptions, scheduling, orders, support,
    payments, reports, sustainability, earnings, reconciliation, recurring, shutdown,
  };
}
