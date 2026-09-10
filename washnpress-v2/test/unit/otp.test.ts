import { describe, it, expect } from "vitest";
import {
  generateOtp, isOtpUsable, isValidIndianMobile,
  lockoutUntil, lockoutWaitSeconds, resendWaitSeconds,
} from "../../src/domain/otp";

const policy = { ttlSeconds: 300, maxAttempts: 5 };

describe("otp", () => {
  it("generates a code of the requested length", () => {
    expect(generateOtp(6, () => 0.5)).toHaveLength(6);
  });
  it("uses the rng it is given rather than one of its own", () => {
    // The default is now a CSPRNG, so the only way a test can name the code it is
    // asserting on is by injecting the source — which is why the parameter stayed.
    expect(generateOtp(6, () => 0)).toBe("100000");
    expect(generateOtp(6, () => 0.5)).toBe("550000");
  });
  it("defaults to a source that is not Math.random", () => {
    // Not a randomness test, which a unit test cannot be. It asserts the default is
    // wired to something at all and produces codes of the right shape, so a future
    // edit that drops the default back to Math.random has to do so deliberately.
    const codes = new Set(Array.from({ length: 50 }, () => generateOtp(6)));
    for (const code of codes) expect(code).toMatch(/^[1-9]\d{5}$/);
    expect(codes.size).toBeGreaterThan(40);
  });
  it("accepts a correct, fresh code", () => {
    const issuedAt = new Date().toISOString();
    expect(isOtpUsable("123456", issuedAt, 0, new Date(), "123456", policy).ok).toBe(true);
  });
  it("rejects an expired code", () => {
    const issuedAt = new Date(Date.now() - 400 * 1000).toISOString();
    const check = isOtpUsable("123456", issuedAt, 0, new Date(), "123456", policy);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/expired/);
  });
  it("rejects after too many attempts", () => {
    const issuedAt = new Date().toISOString();
    expect(isOtpUsable("000000", issuedAt, 5, new Date(), "123456", policy).reason).toMatch(/Too many/);
  });
  it("validates Indian mobile numbers", () => {
    expect(isValidIndianMobile("9876543210")).toBe(true);
    expect(isValidIndianMobile("1234567890")).toBe(false);
  });
});

describe("resend cooldown", () => {
  const issuedAt = new Date("2026-01-01T10:00:00.000Z").toISOString();
  it("holds a resend back for the configured window", () => {
    expect(resendWaitSeconds(issuedAt, new Date("2026-01-01T10:00:10.000Z"), 30)).toBe(20);
  });
  it("lets one through once the window has passed", () => {
    expect(resendWaitSeconds(issuedAt, new Date("2026-01-01T10:00:30.000Z"), 30)).toBe(0);
  });
  it("is off when the setting is zero", () => {
    expect(resendWaitSeconds(issuedAt, new Date("2026-01-01T10:00:00.000Z"), 0)).toBe(0);
  });
});

describe("lockout", () => {
  const now = new Date("2026-01-01T10:00:00.000Z");
  it("starts only once the attempt cap is reached", () => {
    expect(lockoutUntil(4, 5, now, 15)).toBeNull();
    expect(lockoutUntil(5, 5, now, 15)).toBe("2026-01-01T10:15:00.000Z");
  });
  it("is off when the setting is zero, leaving only the attempt cap", () => {
    expect(lockoutUntil(5, 5, now, 0)).toBeNull();
  });
  it("reports the time left and then stops", () => {
    const until = "2026-01-01T10:15:00.000Z";
    expect(lockoutWaitSeconds(until, now)).toBe(900);
    expect(lockoutWaitSeconds(until, new Date("2026-01-01T10:15:00.000Z"))).toBe(0);
    expect(lockoutWaitSeconds(null, now)).toBe(0);
  });
});
