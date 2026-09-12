import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config";

// WNP_<SECTION>__<KEY> env vars are meant to override any nested config value.
// A section whose camelCase name isn't all-lowercase (rateLimit, corsOrigins, ...)
// needs an explicit entry in the loader's segment map, or the override silently
// lands on a same-named-but-wrong key instead of the real one and the intended
// setting never changes. rateLimit had no such entry: WNP_RATELIMIT__* was a no-op.
describe("WNP_ environment config overrides", () => {
  it("overrides a nested value under a camelCase section (rateLimit)", () => {
    const cfg = loadConfig({
      reload: true,
      env: { ...process.env, WNP_RATELIMIT__OTPSEND__LIMIT: "1000", WNP_RATELIMIT__OTPSENDENABLED: "false" },
    });
    expect(cfg.rateLimit.otpSend.limit).toBe(1000);
    expect(cfg.rateLimit.otpSendEnabled).toBe(false);
  });

  it("still overrides a nested value under an already-lowercase section (storage)", () => {
    const cfg = loadConfig({ reload: true, env: { ...process.env, WNP_STORAGE__DRIVER: "memory" } });
    expect(cfg.storage.driver).toBe("memory");
  });
});

// The image had set NODE_ENV=production since it was written, and nothing read it,
// so a shipped container ran on config/default.json's "development" — where the OTP
// endpoint hands back the code it has just sent. That is not a leak of a debugging
// aid, it is a login bypass for anybody who knows a phone number.
describe("app.env derived from NODE_ENV", () => {
  it("takes production from NODE_ENV alone", () => {
    expect(loadConfig({ reload: true, env: { NODE_ENV: "production" } }).app.env).toBe("production");
  });

  it("lets an explicit WNP_APP__ENV beat the platform's guess", () => {
    // The CI smoke test needs the OTP in the response out of an image built with
    // NODE_ENV=production, so this override has to keep working.
    const cfg = loadConfig({ reload: true, env: { NODE_ENV: "production", WNP_APP__ENV: "staging" } });
    expect(cfg.app.env).toBe("staging");
  });

  it("ignores a NODE_ENV that means nothing here rather than refusing to start", () => {
    // Build systems set NODE_ENV to whatever they like. Crashing on "ci" would make
    // the application unbuildable on somebody else's machine for no benefit.
    expect(loadConfig({ reload: true, env: { NODE_ENV: "ci" } }).app.env).toBe("development");
  });
});

// DATABASE_URL used to set the connection string and leave storage.driver at
// "memory", so a deployment handed a database served everything out of the process
// heap and lost it all on the next restart, silently.
describe("DATABASE_URL implies the postgres driver", () => {
  it("selects postgres when only the URL is given", () => {
    const cfg = loadConfig({ reload: true, env: { DATABASE_URL: "postgresql://u:p@db:5432/wnp" } });
    expect(cfg.storage.driver).toBe("postgres");
    expect(cfg.storage.postgres.url).toBe("postgresql://u:p@db:5432/wnp");
  });

  it("still lets a deployment point at a database and choose not to use it", () => {
    const cfg = loadConfig({
      reload: true,
      env: { DATABASE_URL: "postgresql://u:p@db:5432/wnp", WNP_STORAGE__DRIVER: "memory" },
    });
    expect(cfg.storage.driver).toBe("memory");
  });
});

// REDIS_URL had the same asymmetry: it set the URL and left cache.driver at "memory",
// so sessions, OTP codes and rate limit counters stayed in the process heap on a
// deployment that had been given a Redis. One instance hides it completely; a second
// instance, or a redeploy, turns it into a code that cannot be verified.
describe("REDIS_URL implies the redis cache driver", () => {
  it("selects redis when only the URL is given", () => {
    const cfg = loadConfig({ reload: true, env: { REDIS_URL: "redis://cache:6379" } });
    expect(cfg.cache.driver).toBe("redis");
    expect(cfg.cache.redis.url).toBe("redis://cache:6379");
  });

  it("still lets a deployment point at a cache and choose not to use it", () => {
    const cfg = loadConfig({
      reload: true,
      env: { REDIS_URL: "redis://cache:6379", WNP_CACHE__DRIVER: "memory" },
    });
    expect(cfg.cache.driver).toBe("memory");
  });
});
