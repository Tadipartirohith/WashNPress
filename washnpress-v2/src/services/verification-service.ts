import { randomUUID } from "node:crypto";
import { generateOtp, isOtpUsable, isValidIndianMobile } from "../domain/otp";
import { isEmail } from "../domain/staff-identity";
import type { AppConfig } from "../config";
import type { NotificationService } from "./notification-service";

export class VerificationError extends Error {
  constructor(message: string) { super(message); this.name = "VerificationError"; }
}

interface Pending {
  id: string;
  channel: "phone" | "email";
  value: string;
  otp: string;
  issuedAt: string;
  attempts: number;
  verifiedAt: string | null;
}

// Proving that a phone number and an email address are real, before an account is
// created against them.
//
// A staff account used to be created from whatever was typed. A wrong digit made an
// account nobody could sign into, and nobody found out until the person tried — by
// which point they had been told they were set up and the admin had moved on.
//
// The proof is a short-lived record rather than a flag on the request: the caller
// asks for a code, confirms it, and passes the id of that confirmation when they
// create the account. The account can then only be created against the number and
// address that were actually confirmed.
export class VerificationService {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly config: AppConfig,
    private readonly notifications: NotificationService,
    private readonly rng: () => number = Math.random,
  ) {}

  async send(channel: "phone" | "email", value: string): Promise<{
    verificationId: string; channel: "phone" | "email"; value: string;
    expiresInSeconds: number; otpForTesting?: string;
  }> {
    const trimmed = value.trim();
    if (channel === "phone" && !isValidIndianMobile(trimmed)) {
      throw new VerificationError("That is not a ten digit mobile number");
    }
    if (channel === "email" && !isEmail(trimmed)) {
      throw new VerificationError("That is not an email address");
    }
    // Asking again for the same address replaces the code rather than adding a
    // second one, so Resend means resend and not "now there are two valid codes".
    for (const [id, entry] of this.pending) {
      if (entry.channel === channel && entry.value === trimmed && !entry.verifiedAt) this.pending.delete(id);
    }

    const otp = generateOtp(this.config.auth.otpLength, this.rng);
    const id = randomUUID();
    this.pending.set(id, {
      id, channel, value: trimmed, otp,
      issuedAt: new Date().toISOString(), attempts: 0, verifiedAt: null,
    });
    await this.deliver(channel, trimmed, otp);
    // Never returned in production; returned elsewhere so this is testable without
    // a live SMS or mail provider.
    const expose = this.config.app.env !== "production";
    return {
      verificationId: id, channel, value: trimmed,
      expiresInSeconds: this.config.auth.otpTtlSeconds,
      otpForTesting: expose ? otp : undefined,
    };
  }

  private async deliver(channel: "phone" | "email", value: string, otp: string): Promise<void> {
    const body = `Your Wash N Press verification code is ${otp}.`;
    try {
      await this.notifications.deliverRaw({
        channel: channel === "phone" ? "sms" : "email",
        to: value, title: "Verification code", body,
      });
    } catch {
      // A provider that is not configured must not stop an admin creating staff.
      // The code is still valid and still returned outside production.
    }
  }

  confirm(verificationId: string, otp: string, now: Date = new Date()): { verified: boolean; reason?: string } {
    const entry = this.pending.get(verificationId);
    if (!entry) return { verified: false, reason: "That code has expired. Ask for a new one." };
    if (entry.verifiedAt) return { verified: true };
    const check = isOtpUsable(otp.trim(), entry.issuedAt, entry.attempts, now, entry.otp, {
      ttlSeconds: this.config.auth.otpTtlSeconds,
      maxAttempts: this.config.auth.otpMaxAttempts,
    });
    if (!check.ok) {
      entry.attempts += 1;
      return { verified: false, reason: check.reason };
    }
    entry.verifiedAt = new Date().toISOString();
    return { verified: true };
  }

  // Whether this confirmation actually proves this value. A confirmation is tied to
  // the address it was sent to, so it cannot be obtained for one number and then
  // used to create an account against another.
  proves(verificationId: string | undefined, channel: "phone" | "email", value: string): boolean {
    if (!verificationId) return false;
    const entry = this.pending.get(verificationId);
    if (!entry || !entry.verifiedAt) return false;
    return entry.channel === channel && entry.value === value.trim();
  }

  // Spent once the account exists, so the same confirmation cannot create a second.
  consume(verificationId: string | undefined): void {
    if (verificationId) this.pending.delete(verificationId);
  }

  // What a screen shows beside the field: confirmed, waiting, or nothing yet.
  status(verificationId: string | undefined): "verified" | "pending" | "none" {
    if (!verificationId) return "none";
    const entry = this.pending.get(verificationId);
    if (!entry) return "none";
    return entry.verifiedAt ? "verified" : "pending";
  }
}
