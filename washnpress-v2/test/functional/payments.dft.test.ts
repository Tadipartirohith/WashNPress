import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";
import { computeSignature } from "../../src/domain/payments/signature";

// The webhook settles a top-up the platform started. It does not take instructions
// about who to credit or how much from the body: those tests used to post a resident
// id and an amount of their choosing and be believed, and the webhook secret has a
// committed default, so the whole thing was a wallet-minting endpoint for anyone who
// had read the repository. The body now only says *which* top-up settled.

describe("DFT payments webhook", () => {
  const secret = "change-me-in-config-local-or-env";
  const header = "x-razorpay-signature";

  function body(providerOrderId: string, residentId: string, amountPaise: number, id = `evt-${providerOrderId}`) {
    return JSON.stringify({ id, event: "payment.captured", payload: { providerOrderId, residentId, amountPaise } });
  }

  async function post(app: Awaited<ReturnType<typeof makeTestApp>>["app"], payload: string, signature?: string) {
    return app.inject({
      method: "POST", url: "/v1/payments/webhook",
      headers: { "content-type": "application/json", [header]: signature ?? computeSignature(payload, secret) },
      payload,
    });
  }

  it("rejects a bad signature", async () => {
    const { app } = await makeTestApp();
    const res = await post(app, body("order_x", "r1", 5000), "deadbeef");
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("credits the wallet on a valid webhook against a top-up that exists", async () => {
    const { app, container } = await makeTestApp();
    const order = await container.wallet.startTopUp("r1", 5000);
    const res = await post(app, body(order.providerOrderId, "r1", 5000));
    expect(res.statusCode).toBe(200);
    const balance = await app.inject({ method: "GET", url: "/v1/wallet/r1/balance", headers: bearer(await loginAdmin(app)) });
    expect(balance.json().balancePaise).toBe(5000);
    await app.close();
  });

  it("refuses a webhook for a top-up this platform never created", async () => {
    const { app } = await makeTestApp();
    const res = await post(app, body("order_invented", "r1", 500000));
    expect(res.statusCode).toBe(400);
    const balance = await app.inject({ method: "GET", url: "/v1/wallet/r1/balance", headers: bearer(await loginAdmin(app)) });
    expect(balance.json().balancePaise).toBe(0);
    await app.close();
  });

  it("refuses an amount that disagrees with the top-up it claims to settle", async () => {
    const { app, container } = await makeTestApp();
    const order = await container.wallet.startTopUp("r1", 5000);
    const res = await post(app, body(order.providerOrderId, "r1", 500000));
    expect(res.statusCode).toBe(400);
    const balance = await app.inject({ method: "GET", url: "/v1/wallet/r1/balance", headers: bearer(await loginAdmin(app)) });
    expect(balance.json().balancePaise).toBe(0);
    await app.close();
  });

  it("refuses to credit a resident other than the one who started the top-up", async () => {
    const { app, container } = await makeTestApp();
    const order = await container.wallet.startTopUp("r1", 5000);
    const res = await post(app, body(order.providerOrderId, "attacker", 5000));
    expect(res.statusCode).toBe(400);
    const balance = await app.inject({ method: "GET", url: "/v1/wallet/attacker/balance", headers: bearer(await loginAdmin(app)) });
    expect(balance.json().balancePaise).toBe(0);
    await app.close();
  });

  it("ignores a replay, including one wearing a fresh event id", async () => {
    const { app, container } = await makeTestApp();
    const order = await container.wallet.startTopUp("r1", 3000);
    await post(app, body(order.providerOrderId, "r1", 3000, "evt-first"));
    // The event id is the caller's to choose, which is exactly why it is no longer
    // what replay protection turns on. The top-up has settled; it settles once.
    const second = await post(app, body(order.providerOrderId, "r1", 3000, "evt-second"));
    expect(second.json().status).toBe("duplicate_ignored");
    const balance = await app.inject({ method: "GET", url: "/v1/wallet/r1/balance", headers: bearer(await loginAdmin(app)) });
    expect(balance.json().balancePaise).toBe(3000);
    await app.close();
  });
});
