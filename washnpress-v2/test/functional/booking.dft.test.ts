import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, giveSubscription, bearer, loginAdmin, loginResident,
} from "./helpers";
import type { Container } from "../../src/container";

// Book and Regular used to be two separate resident features, each with its own idea
// of what applied. There is one Booking module now: the backend says whether the
// resident is on a plan and what therefore applies, and the screen renders that.

// A plan built for one test rather than the seeded ones, so a rule can be shown
// working without making the demo data strange.
async function planWith(container: Container, id: string, services: unknown[]) {
  return container.store.plans.put({
    id, tier: id, name: id, description: null,
    garmentCap: 100, turnaroundHours: 24, monthlyPaise: 99900,
    annualDiscountPercent: 0, isActive: true,
    coveredServiceIds: (services as { serviceId: string }[]).map((s) => s.serviceId),
    services,
  } as never);
}

function planService(over: Record<string, unknown>) {
  return {
    serviceId: "wash_iron", serviceName: "Wash and Iron", unit: "kg", includedQuantity: 40,
    frequency: "daily", frequencyDays: [], maxPerFrequency: null, maxPerCycle: null,
    carryForward: false, additionalUsage: "pay_per_use", additionalRatePaise: 6000,
    ...over,
  };
}

describe("DFT one booking module for everybody", () => {
  it("tells a resident with no plan what they would be paying", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const res = await app.inject({ method: "GET", url: "/v1/booking/options", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.audience).toBe("standard");
    expect(body.subscriber).toBe(false);
    expect(body.plan).toBeNull();
    // Every service is offered, priced, and says what it is measured in. Nothing is
    // included, because there is no plan to include it.
    const wash = (body.services as Array<{ id: string; unit: string; pricePaise: number; includedInPlan: boolean; allowedDays: number[] }>)
      .find((s) => s.id === "wash_iron");
    expect(wash).toMatchObject({ unit: "kg", includedInPlan: false });
    expect(wash!.pricePaise).toBeGreaterThan(0);
    // With no plan governing it, every day is available.
    expect(wash!.allowedDays).toHaveLength(7);
  });

  it("tells a subscriber what their own plan allows, service by service", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);
    const res = await app.inject({ method: "GET", url: "/v1/booking/options", headers: bearer(token) });
    const body = res.json();
    expect(body.audience).toBe("subscriber");
    expect(body.plan).toMatchObject({ tier: "Standard" });

    const services = body.services as Array<{
      id: string; includedInPlan: boolean; allowance: { remaining: number; unit: string } | null;
      pricePaise: number; additionalRatePaise: number | null;
    }>;
    const wash = services.find((s) => s.id === "wash_iron")!;
    expect(wash.includedInPlan).toBe(true);
    expect(wash.allowance).toMatchObject({ unit: "kg", remaining: 40 });
    // A service outside the plan is still offered, at the ordinary price.
    const dryclean = services.find((s) => s.id === "dryclean_iron")!;
    expect(dryclean.includedInPlan).toBe(false);
    expect(dryclean.pricePaise).toBeGreaterThan(0);
    // The subscriber price list applies to a subscriber, not the standard one.
    expect(body.turnaroundHours).toBe(36);
  });

  it("says which days a restricted service may be collected on", async () => {
    const { app, container } = await makeTestApp();
    await planWith(container, "plan-tuefri", [
      planService({ serviceId: "iron_only", serviceName: "Iron only", unit: "piece", includedQuantity: 30, frequency: "twice_weekly", frequencyDays: [2, 5], additionalRatePaise: 1500 }),
    ]);
    await giveSubscription(container, "res-demo", "plan-tuefri");
    const token = await loginResident(app);
    const body = (await app.inject({ method: "GET", url: "/v1/booking/options", headers: bearer(token) })).json();
    const iron = (body.services as Array<{ id: string; allowedDays: number[]; frequencyLabel: string | null }>)
      .find((s) => s.id === "iron_only")!;
    expect(iron.allowedDays).toEqual([2, 5]);
    expect(iron.frequencyLabel).toBe("Twice a week on Tuesday and Friday");
  });
});

describe("DFT the plan decides what may be booked", () => {
  it("refuses a service on a day the plan does not collect it", async () => {
    const { app, container } = await makeTestApp();
    // 2099-01-01 is a Thursday; this plan collects on Tuesdays and Fridays.
    await seedSlot(container, "slot-freq", 5);
    await planWith(container, "plan-tuefri", [
      planService({ serviceId: "iron_only", serviceName: "Iron only", unit: "piece", includedQuantity: 30, frequency: "twice_weekly", frequencyDays: [2, 5], additionalRatePaise: 1500 }),
    ]);
    await giveSubscription(container, "res-demo", "plan-tuefri");
    const token = await loginResident(app);

    const res = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-freq", lines: [{ category: "Shirts", quantity: 4, serviceId: "iron_only" }] }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("plan_does_not_allow");
    expect(res.json().message).toMatch(/Tuesday and Friday/);
    // And the slot still has every place it had.
    expect((await container.store.slots.get("slot-freq"))!.capacityRemaining).toBe(5);
  });

  it("refuses going beyond an allowance the plan says may not be exceeded", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-block", 5);
    await planWith(container, "plan-blocked", [
      planService({ serviceId: "wash_iron", includedQuantity: 10, additionalUsage: "block" }),
    ]);
    await giveSubscription(container, "res-demo", "plan-blocked");
    const token = await loginResident(app);

    const res = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-block", lines: [{ category: "Mixed", quantity: 20, serviceId: "wash_iron", measuredQuantity: 15 }] }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("plan_does_not_allow");
    expect((await container.store.slots.get("slot-block"))!.capacityRemaining).toBe(5);
  });

  it("asks for approval where the plan says so rather than quietly charging", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-approve", 5);
    await planWith(container, "plan-approval", [
      planService({ serviceId: "wash_iron", includedQuantity: 10, additionalUsage: "admin_approval" }),
    ]);
    await giveSubscription(container, "res-demo", "plan-approval");
    const token = await loginResident(app);

    const res = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-approve", lines: [{ category: "Mixed", quantity: 20, serviceId: "wash_iron", measuredQuantity: 15 }] }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("needs_approval");
  });

  it("says all of this in the preview, before the resident commits", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-preview", 5);
    await planWith(container, "plan-blocked-2", [
      planService({ serviceId: "wash_iron", includedQuantity: 10, additionalUsage: "block" }),
    ]);
    await giveSubscription(container, "res-demo", "plan-blocked-2");
    const token = await loginResident(app);

    const lines = [{ category: "Mixed", quantity: 20, serviceId: "wash_iron", measuredQuantity: 15 }];
    const res = await app.inject({
      method: "GET",
      url: `/v1/pickups/preview?slotId=slot-preview&lines=${encodeURIComponent(JSON.stringify(lines))}`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    // A preview says what would happen; it does not refuse.
    expect(res.json().canBook).toBe(false);
    expect(res.json().blockedBy.reason).toMatch(/does not allow going beyond it/);
  });

  it("lets a plan that charges for the excess go through", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-payg", 5);
    await planWith(container, "plan-payg", [
      planService({ serviceId: "wash_iron", includedQuantity: 10, additionalUsage: "pay_per_use", additionalRatePaise: 6000 }),
    ]);
    await giveSubscription(container, "res-demo", "plan-payg");
    const token = await loginResident(app);

    const res = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-payg", lines: [{ category: "Mixed", quantity: 20, serviceId: "wash_iron", measuredQuantity: 15 }] }),
    });
    expect(res.statusCode).toBe(201);
    // Five kilograms over, at this plan's own rate for washing.
    expect(res.json().order.servicesPaise).toBe(5 * 6000);
  });
});

describe("DFT slots held back for subscribers", () => {
  it("is not offered to a resident without a plan, and is refused if they ask", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-members", 5);
    const slot = (await container.store.slots.get("slot-members"))!;
    slot.subscribersOnly = true;
    slot.date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await container.store.slots.put(slot);
    const token = await loginResident(app);

    const listed = await app.inject({ method: "GET", url: `/v1/slots?date=${slot.date}`, headers: bearer(token) });
    expect((listed.json().slots as Array<{ id: string }>).some((s) => s.id === "slot-members")).toBe(false);

    // A client that never saw it can still be asked to book it, so the booking
    // refuses as well rather than trusting the listing to have hidden it.
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-members" }),
    });
    expect(booked.statusCode).toBe(409);
    expect(booked.json().error).toBe("subscribers_only_slot");
    expect((await container.store.slots.get("slot-members"))!.capacityRemaining).toBe(5);
  });

  it("is offered to a subscriber and books normally", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-members-2", 5);
    const slot = (await container.store.slots.get("slot-members-2"))!;
    slot.subscribersOnly = true;
    slot.date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await container.store.slots.put(slot);
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);

    const listed = await app.inject({ method: "GET", url: `/v1/slots?date=${slot.date}`, headers: bearer(token) });
    expect((listed.json().slots as Array<{ id: string }>).some((s) => s.id === "slot-members-2")).toBe(true);

    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-members-2" }),
    });
    expect(booked.statusCode).toBe(201);
  });
});

describe("DFT an admin builds a plan service by service", () => {
  const wizardPlan = {
    name: "Premium Care", tier: "Premium Care", description: "Everything, including dry cleaning.",
    monthlyPaise: 129900, garmentCap: 120, turnaroundHours: 48,
    validity: "monthly", taxPercent: 18, discountPercent: 10,
    services: [
      { serviceId: "wash_iron", serviceName: "Wash and Iron", unit: "kg", includedQuantity: 40, frequency: "daily", frequencyDays: [], carryForward: false, additionalUsage: "pay_per_use", additionalRatePaise: 5000 },
      { serviceId: "iron_only", serviceName: "Iron only", unit: "piece", includedQuantity: 30, frequency: "twice_weekly", frequencyDays: [2, 5], carryForward: false, additionalUsage: "pay_per_use", additionalRatePaise: 1000 },
    ],
  };

  it("creates one and works out what it costs", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/plans", headers: bearer(token),
      payload: JSON.stringify(wizardPlan),
    });
    expect(res.statusCode).toBe(201);
    expect((res.json().plan.services as unknown[]).length).toBe(2);
    // The final payable amount is worked out by the backend rather than the wizard.
    const pricing = res.json().pricing;
    expect(pricing.discountPaise).toBe(12990);
    expect(pricing.payablePaise).toBe(129900 - 12990 + pricing.taxPaise);
  });

  it("refuses one that says too little, naming every problem", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/plans", headers: bearer(token),
      payload: JSON.stringify({ ...wizardPlan, name: "No services", services: [] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_plan");
    expect(res.json().problems).toContain("A plan needs at least one service.");
  });

  it("refuses the same service configured twice", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/plans", headers: bearer(token),
      payload: JSON.stringify({ ...wizardPlan, services: [wizardPlan.services[0], wizardPlan.services[0]] }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json().problems as string[]).join(" ")).toMatch(/more than once/);
  });

  it("says how many residents an edit actually reaches", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/plans/plan-standard", headers: bearer(token),
      payload: JSON.stringify({ monthlyPaise: 94900 }),
    });
    expect(res.statusCode).toBe(200);
    // Changing what one resident pays is a different act from changing nothing.
    expect(res.json().activeSubscriptions).toBe(1);
  });

  it("holds an edited plan to the same rules as a new one", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/plans/plan-standard", headers: bearer(token),
      payload: JSON.stringify({ services: [] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_plan");
  });
});
