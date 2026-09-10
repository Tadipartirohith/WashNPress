import { isIndianMobile } from "./contact";
export interface OtpPolicy {
  ttlSeconds: number;
  maxAttempts: number;
}

export interface OtpCheck {
  ok: boolean;
  reason?: string;
}

export function generateOtp(length: number, rng: () => number = Math.random): string {
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

// The rule lives in `contact` alongside the normalising, so a number typed with a
// country code is now recognised here rather than refused an OTP.
export function isValidIndianMobile(phone: string): boolean {
  return isIndianMobile(phone);
}
