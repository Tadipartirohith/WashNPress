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
//
// "Clearly" means the number survives the round trip back to the same text. An
// identifier that happens to be all digits is not a number: a nineteen digit DLT
// template id is past 2^53 and comes back as 1307161234567890200, a leading zero is
// dropped, and "1e5" stops looking like what was written. None of those fail — the
// value is still a perfectly good number — so the corruption is silent, and the
// first sign of it is a gateway rejecting every message for an unregistered
// template. A port, a pool size and a timeout all round trip, so they are unaffected.
function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value)) && String(Number(value)) === value) return Number(value);
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

// The names app.env may take, as the schema declares them.
//
// NODE_ENV is not validated by anything upstream and routinely carries values that
// mean nothing here — "ci", "local", whatever a build system felt like. Refusing to
// start on those would break builds that have nothing to do with this application,
// so an unrecognised NODE_ENV leaves the configured value alone. WNP_APP__ENV is the
// explicit control for anything outside this list.
const APP_ENVS = new Set(["development", "test", "staging", "production"]);

function applyEnvOverrides(config: Json, env: NodeJS.ProcessEnv): Json {
  const out = { ...config };
  // NODE_ENV decides app.env unless somebody says otherwise.
  //
  // Nothing read NODE_ENV at all before this. The image set NODE_ENV=production and
  // the process still loaded config/default.json's "development", where the OTP
  // endpoint returns the code it has just sent inside its own HTTP response. Every
  // shipped container was therefore a login bypass for anybody who knew a phone
  // number. Applied ahead of the WNP_ overrides below so an explicit WNP_APP__ENV
  // still beats the platform's guess.
  if (env.NODE_ENV && APP_ENVS.has(env.NODE_ENV)) setPath(out, ["app", "env"], env.NODE_ENV);

  // Generic WNP_ prefix, double underscore separates levels, camelCase preserved.
  for (const [rawKey, rawValue] of Object.entries(env)) {
    if (!rawKey.startsWith("WNP_") || rawValue === undefined) continue;
    const path = rawKey.slice(4).split("__").map((p) => lowerFirst(p));
    setPath(out, path, coerce(rawValue));
  }
  for (const [alias, path] of Object.entries(ALIASES)) {
    if (env[alias] !== undefined) setPath(out, path, coerce(env[alias] as string));
  }
  // A database URL implies the driver that can use it.
  //
  // DATABASE_URL used to fill in storage.postgres.url and leave storage.driver at
  // "memory", so a deployment that had been given a database connected to nothing,
  // served every request out of the process heap, and lost every order, payment and
  // account on the next restart — with nothing in the log to say it had happened.
  // Handing over DATABASE_URL is how a platform says "here is your database" and can
  // only mean the postgres driver. An explicit WNP_STORAGE__DRIVER, applied above,
  // still wins, so a deployment can still point at a database and choose not to use it.
  if (env.DATABASE_URL !== undefined && env.WNP_STORAGE__DRIVER === undefined) {
    setPath(out, ["storage", "driver"], "postgres");
  }
  // And a Redis URL implies the cache that can use it, for the same reason.
  //
  // REDIS_URL filled in cache.redis.url and left cache.driver at "memory", so a
  // deployment handed a Redis connected to nothing and kept sessions, OTP codes and
  // rate limit counters in the process heap. That is not a quiet inefficiency: with
  // more than one instance, or across a redeploy, a code issued by one process is a
  // code the next cannot verify, which is the intermittent "Invalid OTP" the OTP
  // service already carries a comment about. Nothing said it had happened, because
  // an in-memory cache is a supported configuration and works perfectly on one box.
  if (env.REDIS_URL !== undefined && env.WNP_CACHE__DRIVER === undefined) {
    setPath(out, ["cache", "driver"], "redis");
  }
  return out;
}

// WNP_STORAGE__POSTGRES__URL -> ["storage","postgres","url"]; each segment lower-cased at the first char.
function lowerFirst(segment: string): string {
  const lower = segment.toLowerCase();
  const map: Record<string, string> = {
    logvel: "logLevel",
    loglevel: "logLevel",
    corsorigins: "corsOrigins",
    ratelimit: "rateLimit",
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
    servicedayoffsetminutes: "serviceDayOffsetMinutes",
    otpsend: "otpSend",
    windowseconds: "windowSeconds",
    otlpendpoint: "otlpEndpoint",
    tracingenabled: "tracingEnabled",
    metricsenabled: "metricsEnabled",
    docsenabled: "docsEnabled",
    publicurl: "publicUrl",
    baseurl: "baseUrl",
    serverkey: "serverKey",
    apikey: "apiKey",
    templateid: "templateId",
    templatename: "templateName",
    phonenumberid: "phoneNumberId",
    fromaddress: "fromAddress",
    fromname: "fromName",
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
