import { describe, it, expect } from "vitest";
import {
  makeTestApp, bearer,
  loginResident, loginOperator, loginOtherOperator, loginSupervisor, loginOtherSupervisor, loginAdmin,
} from "./helpers";

// The security and scope defects reported in the sixth round of testing. Each of
// these was reachable on the running system before this branch.

describe("DFT a wallet balance is not readable by whoever asks", () => {
  it("refuses an anonymous balance lookup", async () => {
    const { app } = await makeTestApp();
    const anonymous = await app.inject({ method: "GET", url: "/v1/wallet/res-demo/balance" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("refuses one resident reading another resident's balance", async () => {
    const { app } = await makeTestApp();
    const other = await loginResident(app, "9876543211");
    const peek = await app.inject({ method: "GET", url: "/v1/wallet/res-demo/balance", headers: bearer(other) });
    expect(peek.statusCode).toBe(403);
  });

  it("lets a resident read their own, and an admin read anybody's", async () => {
    const { app } = await makeTestApp();
    const own = await app.inject({
      method: "GET", url: "/v1/wallet/res-demo/balance", headers: bearer(await loginResident(app)),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toHaveProperty("balancePaise");

    const asAdmin = await app.inject({
      method: "GET", url: "/v1/wallet/res-demo/balance", headers: bearer(await loginAdmin(app)),
    });
    expect(asAdmin.statusCode).toBe(200);
  });
});

describe("DFT authorisation follows the account, not the session", () => {
  it("drops an operator's society access as soon as the assignment is taken away", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginOperator(app);

    const before = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    expect(before.statusCode).toBe(200);
    expect((before.json().societies as unknown[]).length).toBeGreaterThan(0);

    // The same change an admin makes when moving somebody off a society. The session
    // token is untouched and unexpired; it used to keep the old access for its whole
    // lifetime, which could be a week.
    const operator = await container.store.users.get("user-op");
    operator!.societyIds = [];
    await container.store.users.put(operator!);

    const after = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    expect(after.statusCode).toBe(200);
    expect(after.json().societies).toEqual([]);
  });

  it("stops honouring a role that has been removed", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    expect((await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(token) })).statusCode).toBe(200);

    const supervisor = await container.store.users.get("user-sup");
    supervisor!.roles = ["operator"];
    await container.store.users.put(supervisor!);

    const after = await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(token) });
    expect(after.statusCode).toBe(403);
  });
});

describe("DFT an operator with no societies can reach nothing", () => {
  it("gives no society access rather than the whole area", async () => {
    const { app, container } = await makeTestApp();
    const operator = await container.store.users.get("user-op");
    operator!.societyIds = [];
    await container.store.users.put(operator!);

    const token = await loginOperator(app);
    const orders = await app.inject({ method: "GET", url: "/v1/operations/bookings", headers: bearer(token) });
    expect(orders.statusCode).toBe(200);
    expect(orders.json().orders).toEqual([]);

    const dashboard = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    expect(dashboard.json().societies).toEqual([]);
  });

  it("still allows area-wide cover when an admin has granted it deliberately", async () => {
    const { app, container } = await makeTestApp();
    const operator = await container.store.users.get("user-op");
    operator!.societyIds = [];
    operator!.areaWideAccess = true;
    await container.store.users.put(operator!);

    const token = await loginOperator(app);
    const dashboard = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(200);
    expect((dashboard.json().societies as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("DFT an issue with no society still belongs to an area", () => {
  it("keeps it away from a supervisor in another area, by id as well as by list", async () => {
    const { app } = await makeTestApp();
    // An operator's own issue has no society when it is not about an order.
    const raised = await app.inject({
      method: "POST", url: "/v1/operations/issues", headers: bearer(await loginOperator(app)),
      payload: JSON.stringify({ type: "general_query", description: "Trolley wheel is broken" }),
    });
    expect(raised.statusCode).toBe(201);
    const ticketId = raised.json().issue.id as string;

    const outsider = await loginOtherSupervisor(app);
    const list = await app.inject({ method: "GET", url: "/v1/supervisor/issues", headers: bearer(outsider) });
    expect((list.json().issues as { id: string }[]).map((i) => i.id)).not.toContain(ticketId);

    // Knowing the id used to be enough, because a ticket with no society skipped the
    // area check entirely.
    const direct = await app.inject({ method: "GET", url: `/v1/supervisor/issues/${ticketId}`, headers: bearer(outsider) });
    expect(direct.statusCode).toBe(403);

    const reply = await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticketId}/reply`, headers: bearer(outsider),
      payload: JSON.stringify({ body: "Not mine to answer" }),
    });
    expect(reply.statusCode).toBe(403);
  });

  it("still reaches the supervisor whose area it is", async () => {
    const { app } = await makeTestApp();
    const raised = await app.inject({
      method: "POST", url: "/v1/operations/issues", headers: bearer(await loginOperator(app)),
      payload: JSON.stringify({ type: "general_query", description: "Need a second trolley" }),
    });
    const ticketId = raised.json().issue.id as string;
    const owner = await loginSupervisor(app);
    expect((await app.inject({ method: "GET", url: `/v1/supervisor/issues/${ticketId}`, headers: bearer(owner) })).statusCode).toBe(200);
  });
});

describe("DFT a pickup cannot be moved into another society's slot", () => {
  it("refuses a slot that belongs somewhere else", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);

    const soon = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
    await container.store.slots.put({
      id: "slot-ours", societyId: "soc-demo", date: soon, window: "Morning",
      startTime: "09:00", endTime: "12:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    // A slot in a different society, with room in it.
    await container.store.slots.put({
      id: "slot-theirs", societyId: "soc-gachibowli", date: soon, window: "Morning",
      startTime: "09:00", endTime: "12:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });

    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-ours", estimatedCount: 3 }),
    });
    expect(booked.statusCode).toBe(201);
    const pickupId = booked.json().pickup.id as string;

    const moved = await app.inject({
      method: "POST", url: "/v1/pickups/reschedule", headers: bearer(token),
      payload: JSON.stringify({ pickupId, slotId: "slot-theirs" }),
    });
    expect(moved.statusCode).toBeGreaterThanOrEqual(400);

    // And the refusal must not have quietly taken a seat in the other society's slot.
    const theirs = await container.store.slots.get("slot-theirs");
    expect(theirs!.capacityRemaining).toBe(5);
    // The original booking is still where it was.
    const pickup = await container.store.pickups.get(pickupId);
    expect(pickup!.slotId).toBe("slot-ours");
  });

  it("allows a move within the same society", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const soon = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
    for (const [id, window, startTime, endTime] of [
      ["slot-a", "Morning", "09:00", "12:00"],
      ["slot-b", "Evening", "17:00", "20:00"],
    ] as const) {
      await container.store.slots.put({
        id, societyId: "soc-demo", date: soon, window, startTime, endTime,
        capacityTotal: 5, capacityRemaining: 5, isActive: true,
      });
    }
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-a", estimatedCount: 2 }),
    });
    const pickupId = booked.json().pickup.id as string;
    const moved = await app.inject({
      method: "POST", url: "/v1/pickups/reschedule", headers: bearer(token),
      payload: JSON.stringify({ pickupId, slotId: "slot-b" }),
    });
    expect(moved.statusCode).toBe(200);
    // The seat moved with it rather than being held in both.
    expect((await container.store.slots.get("slot-a"))!.capacityRemaining).toBe(5);
    expect((await container.store.slots.get("slot-b"))!.capacityRemaining).toBe(4);
  });
});

describe("DFT the public surface says only what it has to", () => {
  it("keeps addresses and areas out of the anonymous society list", async () => {
    const { app } = await makeTestApp();
    const listed = await app.inject({ method: "GET", url: "/v1/societies" });
    expect(listed.statusCode).toBe(200);
    const societies = listed.json().societies as Record<string, unknown>[];
    expect(societies.length).toBeGreaterThan(0);
    for (const society of societies) {
      expect(Object.keys(society).sort()).toEqual(["city", "code", "id", "name", "status"]);
    }
  });

  it("actually filters nearby, and says when it has not", async () => {
    const { app } = await makeTestApp();
    const unfiltered = await app.inject({ method: "GET", url: "/v1/societies/nearby" });
    expect(unfiltered.json().filtered).toBe(false);

    const byCity = await app.inject({ method: "GET", url: "/v1/societies/nearby?city=Hyderabad" });
    expect(byCity.json().filtered).toBe(true);
    for (const s of byCity.json().societies as { city: string }[]) {
      expect(s.city.toLowerCase()).toBe("hyderabad");
    }

    const nowhere = await app.inject({ method: "GET", url: "/v1/societies/nearby?city=Reykjavik" });
    expect(nowhere.json().societies).toEqual([]);
  });

  it("does not describe the deployment to an anonymous caller", async () => {
    const { app } = await makeTestApp();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ status: "ok" });

    const diagnostics = await app.inject({ method: "GET", url: "/v1/admin/diagnostics" });
    expect(diagnostics.statusCode).toBe(401);

    const asAdmin = await app.inject({
      method: "GET", url: "/v1/admin/diagnostics", headers: bearer(await loginAdmin(app)),
    });
    expect(asAdmin.json()).toHaveProperty("env");
  });
});

describe("DFT the session cookie is cleared when you log out", () => {
  it("sends an expired cookie back", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const out = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(token) });
    expect(out.statusCode).toBe(200);
    const cookie = String(out.headers["set-cookie"] ?? "");
    expect(cookie).toContain("wnp_session=");
    expect(cookie).toContain("Max-Age=0");
    // And the token itself is dead, which was already true and stays true.
    const after = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) });
    expect(after.statusCode).toBe(401);
  });

  it("marks the cookie HttpOnly and SameSite when it is issued", async () => {
    const { app } = await makeTestApp();
    await app.inject({
      method: "POST", url: "/v1/auth/otp/send",
      headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone: "9876543210" }),
    });
    const send = await app.inject({
      method: "POST", url: "/v1/auth/otp/send",
      headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone: "9876543210" }),
    });
    const verify = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876543210", otp: send.json().otpForTesting }),
    });
    const cookie = String(verify.headers["set-cookie"] ?? "");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite");
  });
});

describe("DFT an issue category has to be a real one", () => {
  it("refuses a made up category", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    for (const category of ["string", "hello", "hiiii", ""]) {
      const raised = await app.inject({
        method: "POST", url: "/v1/support/tickets", headers: bearer(token),
        payload: JSON.stringify({ category, description: "Junk category" }),
      });
      expect(raised.statusCode).toBe(400);
    }
  });

  it("accepts the documented ones", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(token),
      payload: JSON.stringify({ category: "delivery_issue", description: "Where is my order" }),
    });
    expect(raised.statusCode).toBe(201);
  });
});

describe("DFT every error answers in the same shape", () => {
  it("answers a missing route as JSON rather than framework HTML", async () => {
    const { app } = await makeTestApp();
    const missing = await app.inject({ method: "GET", url: "/v1/there-is-no-such-thing" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toHaveProperty("error", "not_found");
  });

  it("never returns a stack trace", async () => {
    const { app } = await makeTestApp();
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/v1/nope" }),
      app.inject({ method: "GET", url: "/v1/wallet", headers: { authorization: "Bearer nonsense" } }),
      app.inject({ method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" }, payload: "{" }),
    ]);
    for (const response of responses) {
      const body = response.payload;
      expect(body).not.toContain("at Object.");
      expect(body).not.toContain(".ts:");
      expect(response.json()).toHaveProperty("error");
    }
  });
});

describe("DFT a staff account is judged by its role", () => {
  it("does not let an operator in another area reach a ticket by id", async () => {
    const { app } = await makeTestApp();
    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ category: "delivery_issue", description: "Round 6 scope check" }),
    });
    const ticketId = raised.json().ticket.id as string;
    const outsider = await loginOtherOperator(app);
    const direct = await app.inject({ method: "GET", url: `/v1/support/tickets/${ticketId}`, headers: bearer(outsider) });
    expect([403, 404]).toContain(direct.statusCode);
  });
});
