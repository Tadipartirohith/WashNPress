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

const INDIAN_MOBILE = /^[6-9][0-9]{9}$/;
export function isValidIndianMobile(phone: string): boolean {
  return INDIAN_MOBILE.test(phone);
}
