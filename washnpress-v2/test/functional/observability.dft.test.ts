import { describe, it, expect } from "vitest";
import { makeTestApp, loginResident, bearer } from "./helpers";

describe("DFT observability and audit", () => {
  it("serves Prometheus metrics after traffic", async () => {
    const { app } = await makeTestApp();
    await app.inject({ method: "GET", url: "/health" });
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("http_requests_total");
    await app.close();
  });

  it("records an audit entry when an admin creates a slot", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app, "9876500001"); // seeded admin
    const create = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(token),
      payload: JSON.stringify({ societyId: "soc-demo", date: "2099-02-02", window: "Morning", startTime: "08:00", endTime: "11:00", capacityTotal: 10 }),
    });
    expect(create.statusCode).toBe(201);
    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit", headers: bearer(token) });
    const entries = audit.json().entries as Array<{ action: string; resource: string; role: string; newValue: unknown }>;
    const entry = entries.find((e) => e.action === "slot.created");
    expect(entry).toBeDefined();
    expect(entry!.resource).toBe("slot");
    expect(entry!.role).toBe("admin");
    expect(entry!.newValue).toMatchObject({ capacityTotal: 10 });
    await app.close();
  });
});
