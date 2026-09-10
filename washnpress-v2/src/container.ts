import type { AppConfig } from "./config";
import type { DataStore, RateLimitStore, SessionRepository } from "./ports/repositories";
import type { PaymentProvider } from "./domain/payments/provider";
import type { SeedIds } from "./seed";
import { createMemoryStore } from "./adapters/memory/store";
import { seedStore, demoSeedIsAllowed, SEED_IDS } from "./seed";
import { backfillAssignments } from "./services/assignment-backfill";
import { FakePaymentProvider } from "./adapters/payments/fake-provider";
import { RazorpayPaymentProvider } from "./adapters/payments/razorpay-provider";
import { CompositeNotificationProvider } from "./adapters/notifications/composite";
import type { NotificationProvider } from "./adapters/notifications/providers";
import { MemoryRateLimitStore } from "./adapters/cache/memory-rate-limit";
import { RenewalService } from "./services/renewal-service";
import { AccountDeletionService } from "./services/account-deletion-service";
import { OtpService } from "./services/otp-service";
import { createOtpSender } from "./adapters/notifications/sms-otp";
import { MemoryOtpStore, type OtpStore } from "./adapters/cache/otp-store";
import { AuthService } from "./services/auth-service";
import { NotificationService } from "./services/notification-service";
import { DeviceService } from "./services/device-service";
import { WalletService } from "./services/wallet-service";
import { SubscriptionService } from "./services/subscription-service";
import { SchedulingService } from "./services/scheduling-service";
import { OrderService } from "./services/order-service";
import { IssueService } from "./services/issue-service";
import { SystemConfigService } from "./services/system-config-service";
import { AuditService } from "./services/audit-service";
import { AccessService } from "./services/access-service";
import { UserService } from "./services/user-service";
import { SocietyService } from "./services/society-service";
import { AssignmentService } from "./services/assignment-service";
import { DashboardService } from "./services/dashboard-service";
import { StaffingService } from "./services/staffing-service";
import { PaymentService } from "./services/payment-service";
import { RevenueService } from "./services/revenue-service";
import { setServiceDayOffsetMinutes } from "./services/scheduling-service";
import { ReportsService } from "./services/reports-service";
import { SustainabilityService } from "./services/sustainability-service";
import { EarningsService } from "./services/earnings-service";
import { ReconciliationService } from "./services/reconciliation-service";
import { RecurringService } from "./services/recurring-service";
import { ScheduleService } from "./services/schedule-service";
import { ServiceRequestService } from "./services/service-request-service";
import { RefundService } from "./services/refund-service";

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
  devices: DeviceService;
  wallet: WalletService;
  subscriptions: SubscriptionService;
  scheduling: SchedulingService;
  orders: OrderService;
  issues: IssueService;
  systemConfig: SystemConfigService;
  renewal: RenewalService;
  accountDeletion: AccountDeletionService;
  audit: AuditService;
  access: AccessService;
  users: UserService;
  societies: SocietyService;
  assignments: AssignmentService;
  dashboards: DashboardService;
  staffing: StaffingService;
  payments: PaymentService;
  reports: ReportsService;
  revenue: RevenueService;
  sustainability: SustainabilityService;
  earnings: EarningsService;
  reconciliation: ReconciliationService;
  recurring: RecurringService;
  schedules: ScheduleService;
  serviceRequests: ServiceRequestService;
  refunds: RefundService;
  shutdown: () => Promise<void>;
}

function buildPaymentProvider(config: AppConfig): PaymentProvider {
  if (config.payments.provider === "razorpay" && config.payments.keyId && config.payments.keySecret) {
    return new RazorpayPaymentProvider(config.payments.keyId, config.payments.keySecret, config.payments.baseUrl);
  }
  // Given the environment so it can refuse to exist in production, where a provider
  // that agrees every order is paid would credit wallets nobody paid into.
  return new FakePaymentProvider({ env: config.app.env });
}

async function buildStore(config: AppConfig, injected?: DataStore): Promise<{ store: DataStore; seedIds: SeedIds }> {
  if (injected) {
    const already = await injected.societies.get(SEED_IDS.societyId);
    const seedIds = already || !demoSeedIsAllowed(config) ? SEED_IDS : await seedStore(injected, config);
    await backfillAssignments(injected);
    return { store: injected, seedIds };
  }
  if (config.storage.driver === "postgres") {
    const { createPostgresPool, createPostgresStore } = await import("./adapters/postgres/store");
    const pool = await createPostgresPool(config.storage.postgres.url, config.storage.postgres.poolMax, {
      connectionTimeoutMs: config.storage.postgres.connectionTimeoutMs,
      idleTimeoutMs: config.storage.postgres.idleTimeoutMs,
    });
    const store = await createPostgresStore(pool);
    const already = await store.societies.get(SEED_IDS.societyId);
    const seedIds = already || !demoSeedIsAllowed(config) ? SEED_IDS : await seedStore(store, config);
    // Data written before blocks and society-level supervision existed is given its
    // place in the hierarchy here, on every boot, rather than in a migration script
    // somebody has to remember to run.
    await backfillAssignments(store);
    return { store, seedIds };
  }
  const store = createMemoryStore();
  // The demo data creates a live admin on a published phone number. It is right for
  // a clone-and-run developer and is a standing account takeover in production.
  const seedIds = demoSeedIsAllowed(config) ? await seedStore(store, config) : SEED_IDS;
  await backfillAssignments(store);
  return { store, seedIds };
}

export async function buildContainer(config: AppConfig, options: { store?: DataStore } = {}): Promise<Container> {
  const { store, seedIds } = await buildStore(config, options.store);

  // Cache backed pieces: rate limiter and sessions. Redis is used when configured,
  // otherwise an in process implementation keeps everything runnable and testable.
  let rateLimit: RateLimitStore = new MemoryRateLimitStore();
  let sessions: SessionRepository = store.sessions;
  // In memory unless Redis is configured. A one-time code held in one process is a
  // code the next process cannot verify — which is the intermittent login failure
  // this platform was already seeing.
  let otpStore: OtpStore = new MemoryOtpStore();
  let closeRedis: (() => Promise<void>) | null = null;
  if (config.cache.driver === "redis") {
    const { createRedisClient, RedisRateLimitStore, RedisSessionRepository } = await import("./adapters/cache/redis");
    const redis = createRedisClient(config.cache.redis.url);
    rateLimit = new RedisRateLimitStore(redis);
    sessions = new RedisSessionRepository(redis, config.auth.sessionTtlSeconds);
    const { RedisOtpStore } = await import("./adapters/cache/otp-store");
    otpStore = new RedisOtpStore(redis);
    closeRedis = async () => { await redis.quit(); };
  }

  const notificationProvider = new CompositeNotificationProvider(config);
  const paymentProvider = buildPaymentProvider(config);

  const otp = new OtpService(config, rateLimit, createOtpSender(config), otpStore);
  const auth = new AuthService(store, otp, config, sessions);
  const devices = new DeviceService(store);
  const notifications = new NotificationService(store, config, notificationProvider, devices);
  const wallet = new WalletService(store, paymentProvider, config.payments.currency);
  const systemConfig = new SystemConfigService(store);
  const subscriptions = new SubscriptionService(store, wallet, systemConfig);
  // The billing job. Without it a monthly subscription is charged once, ever: nothing
  // else in this system ever moves a cycle boundary forward.
  const renewal = new RenewalService(store, wallet, systemConfig);
  const accountDeletion = new AccountDeletionService(store);
  // One value for what "today" means, agreed before anything reads a date.
  setServiceDayOffsetMinutes(config.scheduling.serviceDayOffsetMinutes);
  const scheduling = new SchedulingService(store, notifications, config.scheduling.bookingCutoffHours, systemConfig, wallet);
  const issues = new IssueService(store);
  const access = new AccessService(store);
  const auditLog = new AuditService(store);
  const users = new UserService(store);
  const societies = new SocietyService(store);
  const assignments = new AssignmentService(store, auditLog);
  const orders = new OrderService(store, notifications, issues, subscriptions, systemConfig, wallet);
  const dashboards = new DashboardService(store, access, orders, systemConfig);
  const staffing = new StaffingService(store, orders, notifications, auditLog);
  const payments = new PaymentService(store, config.payments.webhookSecret);
  const reports = new ReportsService(store, access, orders, systemConfig);
  const revenue = new RevenueService(store);
  const sustainability = new SustainabilityService(store);
  const earnings = new EarningsService(store);
  const reconciliation = new ReconciliationService(store, paymentProvider);
  const recurring = new RecurringService(store, scheduling, config.jobs.recurringHorizonDays);
  const schedules = new ScheduleService(store, scheduling, config.jobs.recurringHorizonDays);
  const serviceRequests = new ServiceRequestService(store, notifications);
  const refunds = new RefundService(store, wallet, notifications);

  const shutdown = async () => { if (closeRedis) await closeRedis(); };

  return {
    config, store, seedIds, notificationProvider, rateLimit, paymentProvider,
    otp, auth, notifications, devices, wallet, subscriptions, scheduling, orders, issues,
    systemConfig, audit: auditLog, access, users, societies, assignments, dashboards, staffing,
    payments, reports, revenue, sustainability, earnings, reconciliation, recurring, renewal, accountDeletion, schedules, serviceRequests, refunds, shutdown,
  };
}
