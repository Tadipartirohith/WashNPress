import { createHmac, timingSafeEqual } from "node:crypto";

// Razorpay webhook signature is an HMAC SHA256 of the raw request body using the
// webhook secret. Verification must use the raw bytes and a constant time compare.
export function computeSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = computeSignature(rawBody, secret);
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
