import { describe, it, expect } from "vitest";
import { makeTestApp, loginResident, loginOperator, bearer } from "./helpers";

describe("DFT admin and roles", () => {
  it("forbids a resident from admin reports", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/reports/revenue", headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows an admin to read reports", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app, "9876500001"); // seeded admin phone
    const res = await app.inject({ method: "GET", url: "/v1/admin/reports/subscriptions", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("active");
    await app.close();
  });

  it("lets an operator see today's bookings", async () => {
    const { app } = await makeTestApp();
    const token = await loginOperator(app);
    const res = await app.inject({ method: "GET", url: "/v1/operations/bookings", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
