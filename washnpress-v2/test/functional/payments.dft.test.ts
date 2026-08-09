import { describe, it, expect } from "vitest";
import { makeTestApp } from "./helpers";
import { computeSignature } from "../../src/domain/payments/signature";

describe("DFT payments webhook", () => {
  const secret = "change-me-in-config-local-or-env";
  const header = "x-razorpay-signature";
  const body = (id: string, amountPaise: number) => JSON.stringify({ id, event: "payment.captured", payload: { residentId: "r1", amountPaise } });

  it("rejects a bad signature", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "POST", url: "/v1/payments/webhook", headers: { "content-type": "application/json", [header]: "deadbeef" }, payload: body("evt_bad", 5000) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("credits the wallet on a valid webhook", async () => {
    const { app } = await makeTestApp();
    const b = body("evt_1", 5000);
    await app.inject({ method: "POST", url: "/v1/payments/webhook", headers: { "content-type": "application/json", [header]: computeSignature(b, secret) }, payload: b });
    const balance = await app.inject({ method: "GET", url: "/v1/wallet/r1/balance" });
    expect(balance.json().balancePaise).toBe(5000);
    await app.close();
  });

  it("ignores a replayed event", async () => {
    const { app } = await makeTestApp();
    const b = body("evt_2", 3000);
    const headers = { "content-type": "application/json", [header]: computeSignature(b, secret) };
    await app.inject({ method: "POST", url: "/v1/payments/webhook", headers, payload: b });
    const second = await app.inject({ method: "POST", url: "/v1/payments/webhook", headers, payload: b });
    expect(second.json().status).toBe("duplicate_ignored");
    const balance = await app.inject({ method: "GET", url: "/v1/wallet/r1/balance" });
    expect(balance.json().balancePaise).toBe(3000);
    await app.close();
  });
});
