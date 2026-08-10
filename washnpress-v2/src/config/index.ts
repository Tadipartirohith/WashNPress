import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { configSchema, type AppConfig } from "./schema";

type Json = Record<string, unknown>;

function deepMerge(base: Json, override: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key] as Json, value as Json);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Coerce a string env value into a boolean or number when it clearly is one.
function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function setPath(target: Json, path: string[], value: unknown): void {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Json;
  }
  node[path[path.length - 1]] = value;
}

// Explicit convenience aliases, so common values have a short env name too.
const ALIASES: Record<string, string[]> = {
  PORT: ["app", "port"],
  DATABASE_URL: ["storage", "postgres", "url"],
  REDIS_URL: ["cache", "redis", "url"],
  RAZORPAY_WEBHOOK_SECRET: ["payments", "webhookSecret"],
};

function applyEnvOverrides(config: Json, env: NodeJS.ProcessEnv): Json {
  const out = { ...config };
  // Generic WNP_ prefix, double underscore separates levels, camelCase preserved.
  for (const [rawKey, rawValue] of Object.entries(env)) {
    if (!rawKey.startsWith("WNP_") || rawValue === undefined) continue;
    const path = rawKey.slice(4).split("__").map((p) => lowerFirst(p));
    setPath(out, path, coerce(rawValue));
  }
  for (const [alias, path] of Object.entries(ALIASES)) {
    if (env[alias] !== undefined) setPath(out, path, coerce(env[alias] as string));
  }
  return out;
}

// WNP_STORAGE__POSTGRES__URL -> ["storage","postgres","url"]; each segment lower-cased at the first char.
function lowerFirst(segment: string): string {
  const lower = segment.toLowerCase();
  const map: Record<string, string> = {
    logvel: "logLevel",
    loglevel: "logLevel",
    poolmax: "poolMax",
    connectiontimeoutms: "connectionTimeoutMs",
    idletimeoutms: "idleTimeoutMs",
    otplength: "otpLength",
    otpttlseconds: "otpTtlSeconds",
    otpmaxattempts: "otpMaxAttempts",
    resendcooldownseconds: "resendCooldownSeconds",
    lockoutminutes: "lockoutMinutes",
    sessionttlseconds: "sessionTtlSeconds",
    webhooksignatureheader: "webhookSignatureHeader",
    webhooksecret: "webhookSecret",
    keyid: "keyId",
    keysecret: "keySecret",
    reconcilepollseconds: "reconcilePollSeconds",
    slotwindows: "slotWindows",
    defaultslotcapacity: "defaultSlotCapacity",
    bookingcutoffhours: "bookingCutoffHours",
    otpsend: "otpSend",
    windowseconds: "windowSeconds",
    otlpendpoint: "otlpEndpoint",
    tracingenabled: "tracingEnabled",
    metricsenabled: "metricsEnabled",
    baseurl: "baseUrl",
    serverkey: "serverKey",
    apikey: "apiKey",
    otpsendenabled: "otpSendEnabled",
    apienabled: "apiEnabled",
    recurringhorizondays: "recurringHorizonDays",
    recurringgenerationintervalseconds: "recurringGenerationIntervalSeconds",
    reconciliationintervalseconds: "reconciliationIntervalSeconds",
    outboxintervalseconds: "outboxIntervalSeconds",
  };
  return map[lower] ?? lower;
}

let cached: AppConfig | null = null;

export function loadConfig(options: { cwd?: string; env?: NodeJS.ProcessEnv; reload?: boolean } = {}): AppConfig {
  if (cached && !options.reload) return cached;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  const defaults = JSON.parse(readFileSync(join(cwd, "config", "default.json"), "utf8")) as Json;
  const localPath = join(cwd, "config", "local.json");
  const merged = existsSync(localPath)
    ? deepMerge(defaults, JSON.parse(readFileSync(localPath, "utf8")) as Json)
    : defaults;
  const withEnv = applyEnvOverrides(merged, env);

  const parsed = configSchema.safeParse(withEnv);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

export type { AppConfig };
