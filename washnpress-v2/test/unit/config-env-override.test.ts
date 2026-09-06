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
