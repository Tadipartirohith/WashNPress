import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, loginOperator } from "./helpers";

// Staff sign-in, sign-out and which portal a role opens.
//
// ST1-I140: a code that is not exactly six digits is refused before it is checked.
// ST1-I139: signing out ends the session on the server, not only in the browser.
// ST1-I150: admin no longer stands in for a supervisor or an operator, so each
// portal's API opens to its own role and to nobody else's.

const json = { "content-type": "application/json" };

const SUPERVISOR_READS = ["/v1/supervisor/dashboard", "/v1/supervisor/profile", "/v1/supervisor/workload"];
const OPERATIONS_READS = ["/v1/operations/dashboard", "/v1/operations/profile", "/v1/operations/queue", "/v1/operations/services"];
const ADMIN_READS = ["/v1/admin/dashboard", "/v1/admin/societies"];

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];
const get = (app: App, url: string, token: string) => app.inject({ method: "GET", url, headers: bearer(token) });

describe("DFT the staff OTP must be exactly six digits (ST1-I140)", () => {
  it("refuses short, long and non-numeric codes without using up an attempt", async () => {
    const { app } = await makeTestApp();
    const phone = "9876500002";
    const sent = await app.inject({ method: "POST", url: "/v1/auth/otp/send", headers: json, payload: JSON.stringify({ phone }) });
    const otp = sent.json().otpForTesting as string;
    expect(otp).toMatch(/^\d{6}$/);

    const verify = (code: string) => app.inject({
      method: "POST", url: "/v1/auth/otp/verify", headers: json, payload: JSON.stringify({ phone, otp: code }),
    });
    for (const code of [otp.slice(0, 4), otp.slice(0, 5), `${otp}7`, "12a456", "12 456", ""]) {
      const res = await verify(code);
      expect(res.statusCode, code).toBe(400);
      expect(res.json().message, code).toBe("Enter the 6-digit code.");
    }

    // The refusals never reached the OTP check, so the real code still signs in.
    const ok = await verify(otp);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    await app.close();
  });
});

describe("DFT signing out ends the session on the server (ST1-I139)", () => {
  it("refuses the old token on protected routes afterwards", async () => {
    const { app } = await makeTestApp();
    const token = await loginOperator(app);
    expect((await get(app, "/v1/operations/dashboard", token)).statusCode).toBe(200);

    const out = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(token), payload: JSON.stringify({}) });
    expect(out.statusCode).toBe(200);
    expect(out.json().loggedOut).toBe(true);

    for (const url of ["/v1/operations/dashboard", "/v1/auth/me"]) {
      expect((await get(app, url, token)).statusCode, url).toBe(401);
    }
    // Signing out again with the dead token is refused rather than pretended, which
    // is why the web portals clear their own state whatever this answers.
    const again = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(token), payload: JSON.stringify({}) });
    expect(again.statusCode).toBe(401);
    await app.close();
  });
});

describe("DFT each portal's API opens to its own role only (ST1-I150)", () => {
  it("keeps an admin out of the supervisor and operations APIs, reads and writes alike", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);

    for (const url of [...SUPERVISOR_READS, ...OPERATIONS_READS]) {
      const res = await get(app, url, admin);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error, url).toBe("forbidden");
    }
    const writes = [
      { method: "POST" as const, url: "/v1/supervisor/slots" },
      { method: "POST" as const, url: "/v1/operations/issues" },
      { method: "POST" as const, url: "/v1/operations/services/any-request/assign" },
    ];
    for (const { method, url } of writes) {
      const res = await app.inject({ method, url, headers: bearer(admin), payload: JSON.stringify({}) });
      expect(res.statusCode, url).toBe(403);
    }

    // Still the admin's own portal, and /me still sends the web guard there.
    for (const url of ADMIN_READS) expect((await get(app, url, admin)).statusCode, url).toBe(200);
    const me = await get(app, "/v1/auth/me", admin);
    expect(me.json().portal).toBe("admin");
    await app.close();
  });

  it("lets a supervisor into the supervisor API and nowhere else", async () => {
    const { app } = await makeTestApp();
    const supervisor = await loginSupervisor(app);
    for (const url of SUPERVISOR_READS) expect((await get(app, url, supervisor)).statusCode, url).toBe(200);
    for (const url of [...OPERATIONS_READS, ...ADMIN_READS]) expect((await get(app, url, supervisor)).statusCode, url).toBe(403);
    await app.close();
  });

  it("lets an operator into the operations API and nowhere else", async () => {
    const { app } = await makeTestApp();
    const operator = await loginOperator(app);
    for (const url of OPERATIONS_READS) expect((await get(app, url, operator)).statusCode, url).toBe(200);
    for (const url of [...SUPERVISOR_READS, ...ADMIN_READS]) expect((await get(app, url, operator)).statusCode, url).toBe(403);
    await app.close();
  });
});
