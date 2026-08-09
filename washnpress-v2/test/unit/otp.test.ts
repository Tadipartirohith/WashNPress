import { describe, it, expect } from "vitest";
import { generateOtp, isOtpUsable, isValidIndianMobile } from "../../src/domain/otp";

const policy = { ttlSeconds: 300, maxAttempts: 5 };

describe("otp", () => {
  it("generates a code of the requested length", () => {
    expect(generateOtp(6, () => 0.5)).toHaveLength(6);
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
