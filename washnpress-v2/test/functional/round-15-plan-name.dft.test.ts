import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// A plan name is what a resident chooses a subscription by, so no two plans may share
// one. The check is on the normalised name — trimmed and case-folded — and it holds at
// the API, not only in the wizard.

const base = {
  description: "A plan.", monthlyPaise: 100000, garmentCap: 100, turnaroundHours: 48,
  validity: "monthly", taxPercent: 5, discountPercent: 10,
  services: [
    { serviceId: "wash_iron", serviceName: "Wash and Iron", unit: "kg", includedQuantity: 40, frequency: "daily", frequencyDays: [], carryForward: false, additionalUsage: "pay_per_use", additionalRatePaise: 5000 },
  ],
};

async function create(app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, name: string) {
  return app.inject({
    method: "POST", url: "/v1/admin/plans", headers: bearer(token),
    payload: JSON.stringify({ ...base, name, tier: name }),
  });
}

describe("DFT a plan name belongs to one plan", () => {
  it("refuses a second plan with a name already in use", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    expect((await create(app, token, "Weekend Saver")).statusCode).toBe(201);
    const clash = await create(app, token, "Weekend Saver");
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe("plan_name_taken");
    expect(clash.json().message).toContain("already exists");
  });

  it("recognises the same name across case and surrounding space", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    expect((await create(app, token, "Monsoon Plan")).statusCode).toBe(201);
    expect((await create(app, token, "monsoon plan")).statusCode).toBe(409);
    expect((await create(app, token, "  MONSOON PLAN  ")).statusCode).toBe(409);
  });

  it("refuses one that collides with a seeded plan name", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    // "Basic" is created by the seed.
    expect((await create(app, token, "basic")).statusCode).toBe(409);
  });

  it("lets a plan keep its own name when edited", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await create(app, token, "Festival Plan");
    const id = created.json().plan.id as string;
    const edited = await app.inject({
      method: "PATCH", url: `/v1/admin/plans/${id}`, headers: bearer(token),
      payload: JSON.stringify({ name: "Festival Plan", monthlyPaise: 120000 }),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().plan.monthlyPaise).toBe(120000);
  });
});
