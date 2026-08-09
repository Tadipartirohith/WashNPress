import { z } from "zod";

export const configSchema = z.object({
  app: z.object({
    env: z.enum(["development", "test", "staging", "production"]),
    host: z.string(),
    port: z.number().int().positive(),
    logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
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
    currency: z.string().length(3),
    webhookSignatureHeader: z.string(),
    webhookSecret: z.string().min(1),
    keyId: z.string(),
    keySecret: z.string(),
    reconcilePollSeconds: z.number().int().positive(),
  }),
  scheduling: z.object({
    slotWindows: z.array(z.string()).min(1),
    defaultSlotCapacity: z.number().int().positive(),
    bookingCutoffHours: z.number().int().nonnegative(),
  }),
  rateLimit: z.object({
    otpSend: z.object({ limit: z.number().int().positive(), windowSeconds: z.number().int().positive() }),
    api: z.object({ limit: z.number().int().positive(), windowSeconds: z.number().int().positive() }),
  }),
  notifications: z.object({
    sms: z.object({ enabled: z.boolean(), provider: z.string() }),
    whatsapp: z.object({ enabled: z.boolean(), provider: z.string() }),
    push: z.object({ enabled: z.boolean(), provider: z.string() }),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
