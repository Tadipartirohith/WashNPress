import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, giveSubscription } from "./helpers";

// I-58: the Plan page classifies each plan as the current one, an upgrade or a
// downgrade by the tier hierarchy the admin configures (its garment allowance),
// not by comparing prices — and only one plan change may be pending at a time.

describe("DFT the plan list is classified by hierarchy, not price", () => {
  it("labels each plan current / upgrade / downgrade and says which can be changed to", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);

    const res = await app.inject({ method: "GET", url: "/v1/resident/subscription", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const plans = res.json().availablePlans as {
      id: string; isCurrent: boolean; direction: string; canChange: boolean; garmentCap: number;
    }[];

    const basic = plans.find((p) => p.id === "plan-basic")!;
    const standard = plans.find((p) => p.id === "plan-standard")!;
    const premium = plans.find((p) => p.id === "plan-premium")!;

    // Standard (80 garments) is the current plan; Basic (40) below it is a downgrade,
    // Premium (120) above it is an upgrade.
    expect(standard.isCurrent).toBe(true);
    expect(standard.direction).toBe("current");
    expect(standard.canChange).toBe(false);
    expect(basic.direction).toBe("downgrade");
    expect(basic.canChange).toBe(true);
    expect(premium.direction).toBe("upgrade");
    expect(premium.canChange).toBe(true);
  });

  it("treats a cheaper but larger-allowance plan as an upgrade", async () => {
    const { app, container } = await makeTestApp();
    // A plan that costs less than Standard but includes far more garments. By price
    // alone this looks like a downgrade; by the allowance hierarchy it is an upgrade.
    const value = await container.subscriptions.createPlan({
      tier: "Value", name: "Value", garmentCap: 150, turnaroundHours: 48, monthlyPaise: 70000,
      services: [{
        serviceId: "wash_iron", serviceName: "Wash and Iron", unit: "kg", includedQuantity: 150,
        frequency: "daily", frequencyDays: [], maxPerFrequency: null, maxPerCycle: null,
        carryForward: false, additionalUsage: "pay_per_use", additionalRatePaise: 6000,
      }],
    });
    await giveSubscription(container, "res-demo", "plan-standard"); // 80 garments, ₹899
    const token = await loginResident(app);

    const res = await app.inject({ method: "GET", url: "/v1/resident/subscription", headers: bearer(token) });
    const plans = res.json().availablePlans as { id: string; direction: string; monthlyPaise: number }[];
    const valueRow = plans.find((p) => p.id === value.id)!;

    expect(valueRow.monthlyPaise).toBeLessThan(89900); // cheaper than Standard
    expect(valueRow.direction).toBe("upgrade"); // but still an upgrade, by hierarchy

    // The change quote agrees: hierarchy decides the kind, not the price.
    const quote = await app.inject({
      method: "GET", url: `/v1/subscription/change/quote?planId=${value.id}`, headers: bearer(token),
    });
    expect(quote.json().quote.kind).toBe("upgrade");
  });
});

describe("DFT only one plan change may be pending at a time", () => {
  it("refuses a second change while one is already scheduled", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-premium"); // 120 garments
    const token = await loginResident(app);

    // Schedule a downgrade to Basic — a downgrade is scheduled, not applied, so it
    // leaves a pending change on the subscription.
    const first = await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-basic" }),
    });
    expect(first.json().status).toBe("scheduled");

    // A second change cannot be stacked on top of it.
    const second = await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-standard" }),
    });
    expect(second.statusCode).toBe(422);
    expect(second.json().message).toMatch(/already have a plan change scheduled/i);

    // And the available-plans list marks every non-current plan as not changeable.
    const list = await app.inject({ method: "GET", url: "/v1/resident/subscription", headers: bearer(token) });
    const plans = list.json().availablePlans as { id: string; isCurrent: boolean; canChange: boolean }[];
    expect(plans.filter((p) => !p.isCurrent).every((p) => p.canChange === false)).toBe(true);
  });

  it("lets the resident pick a different plan once the pending change is cancelled", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-premium");
    const token = await loginResident(app);
    await app.inject({
      method: "POST", url: "/v1/subscription/change", headers: bearer(token),
      payload: JSON.stringify({ planId: "plan-basic" }),
    });
    await app.inject({ method: "DELETE", url: "/v1/subscription/change", headers: bearer(token) });

    // With nothing pending, a fresh change is allowed again.
    const again = await app.inject({
      method: "GET", url: "/v1/subscription/change/quote?planId=plan-standard", headers: bearer(token),
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().quote.kind).toBe("downgrade"); // Standard (80) is below Premium (120)
  });
});
