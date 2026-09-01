import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// The seams the outside world will be connected through, before any of it is
// connected.
//
// Every integration falls back to a provider that records the message and returns
// successfully, which is what lets the platform run and be tested with no gateway
// in front of it. It is also why "the SMS went out" and "the SMS was appended to an
// array in memory" look identical from everywhere else in the system — so the
// question these endpoints answer is which of the two is happening, and what is
// still missing before the first becomes true.
//
// The default configuration has all of it switched off. That is the state under
// test here, because it is the state the platform ships in.

describe("what a resident may pay with", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];

  beforeEach(async () => { ({ app } = await makeTestApp()); });

  it("offers nothing while nothing has been configured", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payments/methods" });
    expect(res.statusCode).toBe(200);
    expect(res.json().methods).toEqual([]);
  });

  it("says which currency the amounts are in", async () => {
    // The application should not be deciding that a paise figure is rupees.
    expect((await app.inject({ method: "GET", url: "/v1/payments/methods" })).json().currency).toBe("INR");
  });

  it("does not need a session, because the price list is not private", async () => {
    // Somebody deciding whether to sign up has no token yet.
    expect((await app.inject({ method: "GET", url: "/v1/payments/methods" })).statusCode).toBe(200);
  });
});

describe("how a customer reaches a person", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];

  beforeEach(async () => { ({ app } = await makeTestApp()); });

  it("publishes nothing that has not been configured", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/support/contact" })).json();
    expect(body.channels).toEqual([]);
    expect(body.hours).toBeNull();
  });

  it("is reachable without signing in", async () => {
    // Raising a ticket needs an account, a society and usually an order. Somebody
    // who cannot sign in has none of those and is the person most in need of it.
    expect((await app.inject({ method: "GET", url: "/v1/support/contact" })).statusCode).toBe(200);
  });
});

describe("which outside services are connected", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let admin: string;

  beforeEach(async () => {
    ({ app } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  const read = () => app.inject({ method: "GET", url: "/v1/admin/integrations", headers: bearer(admin) });

  it("is admin only, because it describes the platform rather than an order", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/integrations" })).statusCode).toBe(401);
  });

  it("reports every channel rather than only the broken ones", async () => {
    const names = (await read()).json().notifications.map((c: { name: string }) => c.name);
    expect(names).toEqual(["sms", "whatsapp", "email", "push"]);
  });

  it("calls nothing live while nothing is configured", async () => {
    const live = (await read()).json().notifications.filter((c: { live: boolean }) => c.live);
    expect(live).toEqual([]);
  });

  it("names what each channel is still missing", async () => {
    const sms = (await read()).json().notifications.find((c: { name: string }) => c.name === "sms");
    expect(sms.missing).toContain("baseUrl");
    expect(sms.missing).toContain("apiKey");
  });

  it("never returns a credential, only whether it is set", async () => {
    // An admin session is not a reason to hand back the gateway's secret key.
    const raw = (await read()).payload;
    expect(raw).not.toMatch(/apiKey"\s*:\s*"[^"]+"/);
    expect(raw).not.toMatch(/keySecret/);
    expect(raw).not.toMatch(/serverKey"\s*:\s*"[^"]+"/);
  });

  it("does not invent a server key for a provider that does not use one", async () => {
    // Expo authorises by the device token itself and the mock sends nothing at all.
    // Firebase is the only one that needs a key, so demanding it of the others
    // reports a perfectly good push configuration as incomplete.
    const push = (await read()).json().notifications.find((c: { name: string }) => c.name === "push");
    expect(push.provider).toBe("mock");
    expect(push.missing).not.toContain("serverKey");
  });

  it("reports the payment methods with the reason each is unavailable", async () => {
    const payments = (await read()).json().payments;
    expect(payments.gatewayConfigured).toBe(false);
    expect(payments.methods.map((m: { method: string }) => m.method))
      .toEqual(["card", "upi", "netbanking", "cash"]);
    // Nothing is switched on by default, so nothing is offered and nothing is
    // blamed on the missing gateway.
    expect(payments.methods.every((m: { offered: boolean }) => !m.offered)).toBe(true);
    expect(payments.methods.every((m: { blockedBy: string | null }) => m.blockedBy === null)).toBe(true);
  });

  it("reports support as channels published rather than as credentials held", async () => {
    const support = (await read()).json().support;
    expect(support).toEqual({ phone: false, whatsapp: false, email: false, hours: false });
  });
});
