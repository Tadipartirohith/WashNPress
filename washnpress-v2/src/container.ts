import type { AppConfig } from "./config";
import type { DataStore } from "./ports/repositories";
import type { PaymentProvider } from "./domain/payments/provider";
import type { SeedIds } from "./seed";
import { createMemoryStore } from "./adapters/memory/store";
import { seedStore, SEED_IDS } from "./seed";
import { FakePaymentProvider } from "./adapters/payments/fake-provider";
import { RazorpayPaymentProvider } from "./adapters/payments/razorpay-provider";
import { LoggingNotificationProvider, type NotificationProvider } from "./adapters/notifications/providers";
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

export interface Container {
  config: AppConfig;
  store: DataStore;
  seedIds: SeedIds;
  notificationProvider: NotificationProvider;
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
}

function buildPaymentProvider(config: AppConfig): PaymentProvider {
  if (config.payments.provider === "razorpay" && config.payments.keyId && config.payments.keySecret) {
    return new RazorpayPaymentProvider(config.payments.keyId, config.payments.keySecret);
  }
  return new FakePaymentProvider();
}

// The store is chosen from configuration. For Postgres, seed only when the database
// is empty so restarts do not duplicate data. Tests may inject a store directly.
async function buildStore(config: AppConfig, injected?: DataStore): Promise<{ store: DataStore; seedIds: SeedIds }> {
  if (injected) {
    const already = await injected.societies.get(SEED_IDS.societyId);
    const seedIds = already ? SEED_IDS : await seedStore(injected, config);
    return { store: injected, seedIds };
  }
  if (config.storage.driver === "postgres") {
    const { createPostgresPool, createPostgresStore } = await import("./adapters/postgres/store");
    const pool = await createPostgresPool(config.storage.postgres.url, config.storage.postgres.poolMax);
    const store = await createPostgresStore(pool);
    const already = await store.societies.get(SEED_IDS.societyId);
    const seedIds = already ? SEED_IDS : await seedStore(store, config);
    return { store, seedIds };
  }
  const store = createMemoryStore();
  const seedIds = await seedStore(store, config);
  return { store, seedIds };
}

export async function buildContainer(config: AppConfig, options: { store?: DataStore } = {}): Promise<Container> {
  const { store, seedIds } = await buildStore(config, options.store);

  const notificationProvider = new LoggingNotificationProvider();
  const paymentProvider = buildPaymentProvider(config);

  const otp = new OtpService(config);
  const auth = new AuthService(store, otp, config);
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

  return {
    config, store, seedIds, notificationProvider,
    otp, auth, notifications, wallet, subscriptions, scheduling, orders,
    support, payments, reports, sustainability, earnings,
  };
}
