import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, loginResident, bearer } from "./helpers";

describe("DFT api surface", () => {
  it("reports health", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    await app.close();
  });

  it("logs in a resident and returns identity from /me", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().roles).toContain("resident");
    await app.close();
  });

  it("refuses protected routes without a session", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/wallet" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("books a pickup over HTTP and returns 409 when full", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-http", 1);
    const token = await loginResident(app);
    const first = await app.inject({ method: "POST", url: "/v1/pickups", headers: bearer(token), payload: JSON.stringify({ slotId: "slot-http" }) });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/v1/pickups", headers: bearer(token), payload: JSON.stringify({ slotId: "slot-http" }) });
    expect(second.statusCode).toBe(409);
    await app.close();
  });
});
