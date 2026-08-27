import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginResident } from "./helpers";

// A service is configured once and published when it is ready, rather than becoming
// bookable the moment it is created.

const shoeCleaning = {
  name: "Shoe cleaning", category: "other", unit: "pair", unitPricePaise: 15000,
};

async function create(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, over: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/services", headers: bearer(token),
    payload: JSON.stringify({ ...shoeCleaning, ...over }),
  });
  return res;
}

describe("DFT a new service starts as a draft", () => {
  it("is created as a draft rather than put straight in front of residents", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await create(app, token);
    expect(created.statusCode).toBe(201);
    expect(created.json().service.status).toBe("draft");
    // The flag every older client reads follows the status rather than saying
    // something different about the same service.
    expect(created.json().service.isActive).toBe(false);
  });

  it("is not in the catalogue a resident sees", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    await create(app, admin);
    const resident = await loginResident(app);
    const catalogue = await app.inject({ method: "GET", url: "/v1/services/offerings", headers: bearer(resident) });
    const names = (catalogue.json().offerings as { name: string }[]).map((s) => s.name);
    expect(names).not.toContain("Shoe cleaning");
  });

  it("appears once it is published, and disappears when it is withdrawn", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    const id = (await create(app, admin)).json().service.id as string;
    const resident = await loginResident(app);

    await app.inject({
      method: "PATCH", url: `/v1/admin/services/${id}`, headers: bearer(admin),
      payload: JSON.stringify({ status: "active" }),
    });
    const published = await app.inject({ method: "GET", url: "/v1/services/offerings", headers: bearer(resident) });
    expect((published.json().offerings as { name: string }[]).map((s) => s.name)).toContain("Shoe cleaning");

    await app.inject({
      method: "PATCH", url: `/v1/admin/services/${id}`, headers: bearer(admin),
      payload: JSON.stringify({ status: "inactive" }),
    });
    const withdrawn = await app.inject({ method: "GET", url: "/v1/services/offerings", headers: bearer(resident) });
    expect((withdrawn.json().offerings as { name: string }[]).map((s) => s.name)).not.toContain("Shoe cleaning");
  });

  it("keeps a copy as a draft, so duplicating never publishes anything", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    const id = (await create(app, admin, { status: "active" })).json().service.id as string;
    const copy = await app.inject({
      method: "POST", url: `/v1/admin/services/${id}/duplicate`, headers: bearer(admin), payload: "{}",
    });
    expect(copy.json().service.status).toBe("draft");
    expect(copy.json().service.isActive).toBe(false);
  });
});

describe("DFT a service says when it may be booked at all", () => {
  it("is not offered before its start date", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    await create(app, admin, {
      status: "active",
      availabilityWindow: { startDate: "2099-01-01" },
    });
    const resident = await loginResident(app);
    const catalogue = await app.inject({ method: "GET", url: "/v1/services/offerings", headers: bearer(resident) });
    expect((catalogue.json().offerings as { name: string }[]).map((s) => s.name)).not.toContain("Shoe cleaning");
  });

  it("is not offered while it is paused, and the reason is kept", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    const created = await create(app, admin, {
      status: "active",
      availabilityWindow: { suspended: true, suspendedReason: "The machine is being repaired." },
    });
    expect(created.json().service.availabilityWindow.suspendedReason).toBe("The machine is being repaired.");
    const resident = await loginResident(app);
    const catalogue = await app.inject({ method: "GET", url: "/v1/services/offerings", headers: bearer(resident) });
    expect((catalogue.json().offerings as { name: string }[]).map((s) => s.name)).not.toContain("Shoe cleaning");
  });
});

describe("DFT the rest of a service's configuration is kept and checked", () => {
  it("keeps the options, add-ons, capacity, recurrence, workflow and notifications", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await create(app, token, {
      status: "active",
      options: [
        { id: "standard", label: "Standard clean", priceDeltaPaise: 0, isActive: true },
        { id: "deluxe", label: "Deluxe clean", priceDeltaPaise: 5000, isActive: true },
      ],
      addOns: [{ id: "laces", name: "New laces", pricePaise: 9900, isActive: true }],
      capacity: { maxBookingsPerDay: 20, maxConcurrentJobs: 3 },
      recurrence: { enabled: true, frequencies: ["weekly", "alternate_days"] },
      operations: { team: "Home Service Operators", workflow: ["scheduled", "assigned", "in_progress", "completed"] },
      notifyOn: ["booked", "completed"],
      cancellationRules: { feePaise: 5000, refundPercent: 50 },
      reschedulingRules: { maxReschedules: 2, deadlineMinutes: 180 },
    });
    expect(created.statusCode).toBe(201);
    const service = created.json().service;
    expect(service.options).toHaveLength(2);
    expect(service.addOns[0].name).toBe("New laces");
    expect(service.capacity.maxBookingsPerDay).toBe(20);
    expect(service.recurrence.frequencies).toContain("weekly");
    expect(service.operations.team).toBe("Home Service Operators");
    expect(service.notifyOn).toEqual(["booked", "completed"]);
    expect(service.cancellationRules.refundPercent).toBe(50);
    expect(service.reschedulingRules.maxReschedules).toBe(2);
  });

  it("refuses a workflow that cannot be finished", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await create(app, token, {
      operations: { workflow: ["scheduled", "in_progress"] },
    });
    expect(refused.statusCode).toBe(400);
    expect((refused.json().problems as string[]).join(" ")).toMatch(/never be finished/);
  });

  it("refuses two options a resident could not tell apart", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await create(app, token, {
      options: [
        { id: "a", label: "Deluxe", priceDeltaPaise: 0, isActive: true },
        { id: "b", label: "deluxe", priceDeltaPaise: 100, isActive: true },
      ],
    });
    expect(refused.statusCode).toBe(400);
  });

  it("holds an edit to the same rules", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const id = (await create(app, token, { status: "active" })).json().service.id as string;
    const refused = await app.inject({
      method: "PATCH", url: `/v1/admin/services/${id}`, headers: bearer(token),
      payload: JSON.stringify({ capacity: { maxBookingsPerDay: 0 } }),
    });
    expect(refused.statusCode).toBe(400);
  });
});
