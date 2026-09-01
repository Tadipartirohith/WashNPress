import { z } from "zod";

// A setting that is a string but often looks like a number.
//
// The environment reader turns any value that parses as a number into one, so that
// PORT=8080 arrives as 8080 rather than "8080". That is right for a port and wrong
// for every identifier that happens to be all digits — a DLT template id, a Meta
// phone number id, a numeric SMS sender, a telephone number. Declared as a plain
// string those fail validation and the application refuses to start, which is a
// confusing way to be told that a phone number is a phone number.
const numericString = z.coerce.string();

export const configSchema = z.object({
  app: z.object({
    env: z.enum(["development", "test", "staging", "production"]),
    host: z.string(),
    port: z.number().int().positive(),
    logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
    // Shown in the API documentation and used as its default server URL.
    version: z.string(),
    publicUrl: z.string(),
    // Browser origins allowed to call the API. The web build of the app is a
    // different origin from the API, so without this the browser blocks it.
    // A single "*" allows any origin; credentials are never allowed with "*",
    // so the app authenticates with a bearer token rather than the cookie.
    // Accepts a comma separated list from the environment.
    corsOrigins: z.preprocess(
      (value) => (typeof value === "string" ? value.split(",").map((o) => o.trim()).filter(Boolean) : value),
      z.array(z.string()),
    ),
  }),
  storage: z.object({
    driver: z.enum(["memory", "postgres"]),
    postgres: z.object({
      url: z.string(),
      poolMax: z.number().int().positive(),
      connectionTimeoutMs: z.number().int().nonnegative(),
      idleTimeoutMs: z.number().int().nonnegative(),
    }),
  }),
  cache: z.object({
    driver: z.enum(["memory", "redis"]),
    redis: z.object({ url: z.string() }),
  }),
  auth: z.object({
    otpLength: z.number().int().min(4).max(8),
    otpTtlSeconds: z.number().int().positive(),
    otpMaxAttempts: z.number().int().positive(),
    resendCooldownSeconds: z.number().int().nonnegative(),
    lockoutMinutes: z.number().int().nonnegative(),
    sessionTtlSeconds: z.number().int().positive(),
  }),
  payments: z.object({
    provider: z.string(),
    baseUrl: z.string(),
    currency: z.string().length(3),
    webhookSignatureHeader: z.string(),
    webhookSecret: z.string().min(1),
    keyId: z.string(),
    keySecret: z.string(),
    reconcilePollSeconds: z.number().int().positive(),
    // Which ways of paying are offered, each switched on only once the thing behind
    // it exists. Card, UPI and netbanking are the gateway's to collect and mean
    // nothing without gateway credentials; cash is collected by the operator at the
    // door and is the one method that works with no gateway at all, which is why it
    // is a separate switch rather than an option inside one.
    methods: z.object({
      card: z.boolean().default(false),
      upi: z.boolean().default(false),
      netbanking: z.boolean().default(false),
      cash: z.boolean().default(false),
    }).default({ card: false, upi: false, netbanking: false, cash: false }),
  }),
  scheduling: z.object({
    slotWindows: z.array(z.string()).min(1),
    defaultSlotCapacity: z.number().int().positive(),
    bookingCutoffHours: z.number().int().nonnegative(),
    // Minutes ahead of UTC that the operation's calendar day runs on. India is +330.
    // Without it, "today" ends at midnight UTC and yesterday's slots stay bookable
    // until half past five the following morning.
    serviceDayOffsetMinutes: z.number().int().min(-720).max(840).default(330),
  }),
  rateLimit: z.object({
    otpSendEnabled: z.boolean(),
    apiEnabled: z.boolean(),
    otpSend: z.object({ limit: z.number().int().positive(), windowSeconds: z.number().int().positive() }),
    api: z.object({ limit: z.number().int().positive(), windowSeconds: z.number().int().positive() }),
  }),
  jobs: z.object({
    enabled: z.boolean(),
    outboxIntervalSeconds: z.number().int().positive(),
    reconciliationIntervalSeconds: z.number().int().positive(),
    recurringGenerationIntervalSeconds: z.number().int().positive(),
    recurringHorizonDays: z.number().int().positive(),
  }),
  notifications: z.object({
    // An Indian gateway will not deliver a transactional SMS that is not registered
    // against a DLT template, so the id travels with the message rather than being
    // something the gateway is left to infer.
    sms: z.object({
      enabled: z.boolean(), provider: z.string(), baseUrl: z.string(), apiKey: z.string(), sender: numericString,
      templateId: numericString.default(""),
    }),
    // WhatsApp is not SMS with a different transport. Outside a twenty-four hour
    // window opened by the customer, only an approved template may be sent, and the
    // Cloud API addresses a business phone number id rather than a sender string.
    whatsapp: z.object({
      enabled: z.boolean(), provider: z.string(), baseUrl: z.string(), apiKey: z.string(), sender: numericString,
      phoneNumberId: numericString.default(""),
      templateName: z.string().default(""),
    }),
    push: z.object({ enabled: z.boolean(), provider: z.string(), baseUrl: z.string(), serverKey: z.string() }),
    // Email was already a channel a message could be addressed to — a staff account
    // is created against an address and the address has to be proved — with nothing
    // behind it, so anything sent on it went to the push provider instead.
    email: z.object({
      enabled: z.boolean().default(false),
      provider: z.string().default("mock"),
      baseUrl: z.string().default(""),
      apiKey: z.string().default(""),
      fromAddress: z.string().default(""),
      fromName: z.string().default(""),
    }).default({ enabled: false, provider: "mock", baseUrl: "", apiKey: "", fromAddress: "", fromName: "" }),
  }),
  // How a customer reaches a person. The ticketing is built and is the right route
  // for anything about an order; this is the other half of it, for somebody who
  // cannot get far enough into the app to raise a ticket at all. Every field is
  // optional, and a channel that is blank is simply not offered.
  support: z.object({
    email: z.string().default(""),
    phone: numericString.default(""),
    whatsapp: numericString.default(""),
    hours: z.string().default(""),
  }).default({ email: "", phone: "", whatsapp: "", hours: "" }),
  observability: z.object({
    metricsEnabled: z.boolean(),
    // Serves /docs and /openapi.json. On by default so testers always have it.
    docsEnabled: z.boolean(),
    tracingEnabled: z.boolean(),
    otlpEndpoint: z.string(),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
