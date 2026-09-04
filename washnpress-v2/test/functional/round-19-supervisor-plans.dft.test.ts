import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginSupervisor, loginResident, loginOperator, loginAdmin } from "./helpers";

// Subscription plans are system-wide, and the issue asked for the same plan-creation
// flow in the supervisor portal as in the admin one. These check the supervisor plan
// routes do what the admin ones do — create, list, edit, and refuse a duplicate name —
// and that a supervisor's plan is the same plan an admin sees.

function planBody(name: string) {
  return {
    tier: name,
    name,
    monthlyPaise: 100000,
    garmentCap: 40,
    turnaroundHours: 48,
    validity: "monthly" as const,
    taxPercent: 5,
    discountPercent: 10,
    services: [
      {
        serviceId: "wash_iron",
        serviceName: "Wash and Iron",
        unit: "kg" as const,
        includedQuantity: 40,
        frequency: "daily" as const,
        additionalUsage: "pay_per_use" as const,
        additionalRatePaise: 2000,
      },
    ],
    coveredServiceIds: ["wash_iron"],
  };
}

describe("DFT supervisor subscription plans", () => {
  it("lets a supervisor create a plan, and lists it back", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);

    const created = await app.inject({
      method: "POST", url: "/v1/supervisor/plans",
      headers: bearer(token), payload: JSON.stringify(planBody("Supervisor Premium")),
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.plan.name).toBe("Supervisor Premium");
    // Tax and discount are applied by the same billing arithmetic the admin route uses.
    expect(body.pricing.payablePaise).toBeGreaterThan(0);

    const list = await app.inject({ method: "GET", url: "/v1/supervisor/plans", headers: bearer(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().plans.some((p: { name?: string; tier: string }) => (p.name ?? p.tier) === "Supervisor Premium")).toBe(true);
  });

  it("refuses a duplicate plan name with the exact message the wizard shows", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);

    const first = await app.inject({
      method: "POST", url: "/v1/supervisor/plans",
      headers: bearer(token), payload: JSON.stringify(planBody("Duplicate Plan")),
    });
    expect(first.statusCode).toBe(201);

    // Same name, different case and padding: the check is case-insensitive and trimmed.
    const clash = await app.inject({
      method: "POST", url: "/v1/supervisor/plans",
      headers: bearer(token), payload: JSON.stringify(planBody("  duplicate plan  ")),
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe("plan_name_taken");
  });

  it("lets a supervisor edit and deactivate a plan", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);

    const created = await app.inject({
      method: "POST", url: "/v1/supervisor/plans",
      headers: bearer(token), payload: JSON.stringify(planBody("Editable Plan")),
    });
    const id = created.json().plan.id;

    const patched = await app.inject({
      method: "PATCH", url: `/v1/supervisor/plans/${id}`,
      headers: bearer(token), payload: JSON.stringify({ isActive: false }),
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().plan.isActive).toBe(false);
  });

  it("is the same plan store the admin manages", async () => {
    const { app } = await makeTestApp();
    const supToken = await loginSupervisor(app);
    const adminToken = await loginAdmin(app);

    await app.inject({
      method: "POST", url: "/v1/supervisor/plans",
      headers: bearer(supToken), payload: JSON.stringify(planBody("Shared Plan")),
    });

    const adminList = await app.inject({ method: "GET", url: "/v1/admin/plans", headers: bearer(adminToken) });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().plans.some((p: { name?: string; tier: string }) => (p.name ?? p.tier) === "Shared Plan")).toBe(true);
  });

  it("refuses a resident or an operator", async () => {
    const { app } = await makeTestApp();
    const resident = await loginResident(app);
    const operator = await loginOperator(app);

    for (const token of [resident, operator]) {
      const res = await app.inject({
        method: "POST", url: "/v1/supervisor/plans",
        headers: bearer(token), payload: JSON.stringify(planBody("Should Not Exist")),
      });
      expect(res.statusCode).toBe(403);
    }
  });
});
