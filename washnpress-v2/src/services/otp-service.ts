import { generateOtp, isOtpUsable, isValidIndianMobile } from "../domain/otp";
import type { AppConfig } from "../config";
import type { RateLimitStore } from "../ports/repositories";

// A small in-memory OTP store stands in for Redis in this scaffold. The interface
// is deliberately narrow so a Redis-backed version is a drop-in replacement.
interface OtpRecord {
  otp: string;
  issuedAt: string;
  attempts: number;
}

export class OtpService {
  private readonly store = new Map<string, OtpRecord>();

  constructor(
    private readonly config: AppConfig,
    private readonly rateLimit: RateLimitStore,
    private readonly rng: () => number = Math.random,
  ) {}

  async send(phone: string): Promise<{ sent: boolean; otpForTesting?: string }> {
    if (!isValidIndianMobile(phone)) throw new Error("Invalid Indian mobile number");
    if (this.config.rateLimit.otpSendEnabled) {
      const limit = await this.rateLimit.hit(`otp:${phone}`, this.config.rateLimit.otpSend.limit, this.config.rateLimit.otpSend.windowSeconds * 1000);
      if (!limit.allowed) throw new Error(`Too many OTP requests, retry in ${limit.resetSeconds} seconds`);
    }

    const otp = generateOtp(this.config.auth.otpLength, this.rng);
    this.store.set(phone, { otp, issuedAt: new Date().toISOString(), attempts: 0 });
    // In production this is handed to the SMS provider; the code is never returned
    // to the caller. In non-production it is returned so tests can assert on it.
    const expose = this.config.app.env !== "production";
    return { sent: true, otpForTesting: expose ? otp : undefined };
  }

  verify(phone: string, input: string, now: Date = new Date()): { verified: boolean; reason?: string } {
    const record = this.store.get(phone);
    if (!record) return { verified: false, reason: "OTP expired or not found" };
    const check = isOtpUsable(input, record.issuedAt, record.attempts, now, record.otp, {
      ttlSeconds: this.config.auth.otpTtlSeconds,
      maxAttempts: this.config.auth.otpMaxAttempts,
    });
    if (!check.ok) {
      record.attempts += 1;
      return { verified: false, reason: check.reason };
    }
    this.store.delete(phone);
    return { verified: true };
  }
}
