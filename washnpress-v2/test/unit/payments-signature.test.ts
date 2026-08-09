import { describe, it, expect } from "vitest";
import { computeSignature, verifyWebhookSignature } from "../../src/domain/payments/signature";

const secret = "whsec_test";
const body = JSON.stringify({ id: "evt_1", payload: { residentId: "r1", amountPaise: 5000 } });

describe("payment webhook signature", () => {
  it("verifies a correct signature", () => {
    const sig = computeSignature(body, secret);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = computeSignature(body, secret);
    const tampered = body.replace("5000", "999999");
    expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
  });
  it("rejects a missing signature", () => {
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });
});
