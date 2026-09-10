import { randomInt } from "node:crypto";
import { isIndianMobile } from "./contact";
export interface OtpPolicy {
  ttlSeconds: number;
  maxAttempts: number;
}

export interface OtpCheck {
  ok: boolean;
  reason?: string;
}

// V8's Math.random is xorshift128+. It is seeded per process and its internal state
// is recoverable from a short run of outputs, so an attacker who can ask for codes
// on a number they control can predict the code sent to a number they do not. Every
// other secret in this codebase comes from node:crypto and the login code is the one
// that matters most, so it does too.
//
// The parameter stays so a test can pin the code it is asserting on; only the
// default changed.
function cryptoUnitInterval(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}

export function generateOtp(length: number, rng: () => number = cryptoUnitInterval): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return String(Math.floor(min + rng() * (max - min)));
}

export function isOtpUsable(
  input: string,
  issuedAt: string,
  attempts: number,
  now: Date,
  stored: string,
  policy: OtpPolicy,
): OtpCheck {
  const ageSeconds = (now.getTime() - new Date(issuedAt).getTime()) / 1000;
  if (ageSeconds > policy.ttlSeconds) return { ok: false, reason: "OTP expired" };
  if (attempts >= policy.maxAttempts) return { ok: false, reason: "Too many attempts" };
  if (input !== stored) return { ok: false, reason: "Incorrect OTP" };
  return { ok: true };
}

// How long a caller still has to wait before a resend is honoured. Zero means now.
//
// Without this, `resendCooldownSeconds` was configuration nothing read: a script
// could ask for a fresh code as fast as it could open connections, and each fresh
// code is another SMS billed to us and another chance for the recipient to be
// pestered into reading one out to somebody on the phone.
export function resendWaitSeconds(issuedAt: string, now: Date, cooldownSeconds: number): number {
  if (cooldownSeconds <= 0) return 0;
  const elapsed = (now.getTime() - new Date(issuedAt).getTime()) / 1000;
  const remaining = cooldownSeconds - elapsed;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

// How long a number is barred from logging in after burning through its attempts.
export function lockoutWaitSeconds(lockedUntil: string | null, now: Date): number {
  if (!lockedUntil) return 0;
  const remaining = (new Date(lockedUntil).getTime() - now.getTime()) / 1000;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

// When the attempt cap is reached, the number is barred until this moment.
//
// The cap on its own is worth nothing while a new code can be asked for, because a
// new code used to arrive with the counter set back to zero: six guesses, resend,
// six more, forever. The counter now survives the resend, and reaching the cap
// starts a `lockoutMinutes` bar that survives it too. A deployment that sets
// `lockoutMinutes` to zero keeps only the cap, which is the old behaviour minus the
// reset.
export function lockoutUntil(attempts: number, maxAttempts: number, now: Date, lockoutMinutes: number): string | null {
  if (lockoutMinutes <= 0 || attempts < maxAttempts) return null;
  return new Date(now.getTime() + lockoutMinutes * 60_000).toISOString();
}

// The rule lives in `contact` alongside the normalising, so a number typed with a
// country code is now recognised here rather than refused an OTP.
export function isValidIndianMobile(phone: string): boolean {
  return isIndianMobile(phone);
}
