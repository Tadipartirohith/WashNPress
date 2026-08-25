import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginResident } from "./helpers";

// The Services page and the twelve-step wizard behind it. A car wash, a carpet clean
// and an hour of ironing were all "an offering with a name and a price"; a fourth
// service line should be a form somebody fills in rather than a release.

const carpetCleaning = {
  name: "Carpet cleaning",
  category: "home_care",
  description: "Deep cleaned in your flat.",
  unit: "sqft",
  unitPricePaise: 1200,
  minimumQuantity: 50,
  maximumQuantity: 2000,
  quantityIncrement: 10,
  eligibility: "both",
  mode: "at_home",
  operatingDays: [1, 2, 3, 4, 5],
  timeSlots: [
    { window: "Morning", startTime: "09:00", endTime: "12:00", capacity: 2, subscriberAvailable: true, nonSubscriberAvailable: true },
  ],
  bookingRules: {
    advanceBookingRequired: true, minAdvanceMinutes: 240, maxAdvanceDays: 14,
    cancellationAllowed: true, cancellationDeadlineMinutes: 120, reschedulingAllowed: true,
  },
  additionalCharges: [
    { kind: "home_visit", label: "Home visit", amountPaise: 5000 },
    { kind: "weekend", label: "Weekend charge", amountPaise: 2000 },
  ],
};

describe("DFT the service wizard", () => {
  it("creates a service configured on all twelve steps", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(token),
      payload: JSON.stringify(carpetCleaning),
    });
    expect(res.statusCode).toBe(201);
    const service = res.json().service;
    // Measured in its own unit, with the quantities it will actually accept.
    expect(service).toMatchObject({ unit: "sqft", minimumQuantity: 50, maximumQuantity: 2000, quantityIncrement: 10 });
    expect(service.operatingDays).toEqual([1, 2, 3, 4, 5]);
    expect(service.additionalCharges).toHaveLength(2);
    expect(service.bookingRules.minAdvanceMinutes).toBe(240);
  });

  it("refuses one that says too little, naming every problem at once", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(token),
      payload: JSON.stringify({ ...carpetCleaning, minimumQuantity: 400, maximumQuantity: 100 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_service");
    expect((res.json().problems as string[]).join(" ")).toMatch(/cannot be below the minimum/);
  });

  it("holds an edited service to the same rules, and says what it reaches", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(token), payload: JSON.stringify(carpetCleaning),
    });
    const id = created.json().service.id as string;

    const broken = await app.inject({
      method: "PATCH", url: `/v1/admin/services/${id}`, headers: bearer(token),
      payload: JSON.stringify({ unit: undefined, name: "" }),
    });
    expect(broken.statusCode).toBe(400);

    const saved = await app.inject({
      method: "PATCH", url: `/v1/admin/services/${id}`, headers: bearer(token),
      payload: JSON.stringify({ unitPricePaise: 1500 }),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().service.unitPricePaise).toBe(1500);
    // Nothing is booked against it yet, and it says so rather than staying silent.
    expect(saved.json().openBookings).toBe(0);
  });

  it("copies one, inactive, so a half-configured service is never put in front of anybody", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(token), payload: JSON.stringify(carpetCleaning),
    });
    const id = created.json().service.id as string;
    const copy = await app.inject({ method: "POST", url: `/v1/admin/services/${id}/duplicate`, headers: bearer(token), payload: "{}" });
    expect(copy.statusCode).toBe(201);
    expect(copy.json().service.name).toBe("Carpet cleaning (copy)");
    expect(copy.json().service.isActive).toBe(false);
    expect(copy.json().service.id).not.toBe(id);
  });
});

describe("DFT the services page", () => {
  it("is a list of services and nothing else", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/services", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // No dashboard, no statistics: the services, and the vocabulary the filters are
    // built from so the client never keeps its own copy of a list.
    expect(Object.keys(body).sort()).toEqual(["filters", "services"]);
    const seeded = body.services as Array<{ name: string; unit: string; categoryLabel: string; isActive: boolean }>;
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((s) => typeof s.unit === "string" && s.unit.length > 0)).toBe(true);
    // An offering written before units existed still reads: a per-job wash is a job.
    expect(seeded.find((s) => s.name === "Car wash")).toMatchObject({ unit: "job", categoryLabel: "Vehicle Care" });
    expect(seeded.find((s) => s.name === "At-home ironing")).toMatchObject({ unit: "hour" });
  });

  it("searches by name, category and unit", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const byName = await app.inject({ method: "GET", url: "/v1/admin/services?q=bike", headers: bearer(token) });
    expect((byName.json().services as { name: string }[]).map((s) => s.name)).toEqual(["Bike wash"]);

    const byUnit = await app.inject({ method: "GET", url: "/v1/admin/services?q=hour", headers: bearer(token) });
    expect((byUnit.json().services as { name: string }[]).map((s) => s.name)).toContain("At-home ironing");

    const byCategory = await app.inject({ method: "GET", url: "/v1/admin/services?q=vehicle care", headers: bearer(token) });
    expect((byCategory.json().services as { name: string }[]).length).toBe(2);
  });

  it("combines filters", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(token),
      payload: JSON.stringify({ ...carpetCleaning, isActive: false }),
    });

    const active = await app.inject({ method: "GET", url: "/v1/admin/services?category=home_care&status=active", headers: bearer(token) });
    expect((active.json().services as unknown[]).length).toBe(1); // the seeded ironing

    const inactive = await app.inject({ method: "GET", url: "/v1/admin/services?category=home_care&status=inactive", headers: bearer(token) });
    expect((inactive.json().services as { name: string }[]).map((s) => s.name)).toEqual(["Carpet cleaning"]);

    const byUnit = await app.inject({ method: "GET", url: "/v1/admin/services?unit=hour", headers: bearer(token) });
    expect((byUnit.json().services as { name: string }[]).map((s) => s.name)).toEqual(["At-home ironing"]);
  });

  it("exports what is on screen rather than everything", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const all = await app.inject({ method: "GET", url: "/v1/admin/services/export", headers: bearer(token) });
    expect(all.statusCode).toBe(200);
    expect(all.headers["content-type"]).toMatch(/text\/csv/);
    const rows = all.body.trim().split("\n");
    expect(rows[0]).toBe("Service,Category,Unit,Subscriber price,Non-subscriber price,Availability,Status");
    expect(rows.length).toBe(4); // three seeded services plus the header

    // The same query narrows the export exactly as it narrows the page.
    const narrowed = await app.inject({ method: "GET", url: "/v1/admin/services/export?q=bike", headers: bearer(token) });
    expect(narrowed.body.trim().split("\n").length).toBe(2);
    expect(narrowed.body).toMatch(/Bike wash/);
  });

  it("shows one service in full, because Edit opens the same wizard pre-filled", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/services/iron-at-home", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().service.id).toBe("iron-at-home");
    expect(res.json().bookings).toBe(0);
  });

  it("refuses the whole page to anybody who is not an admin", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    expect((await app.inject({ method: "GET", url: "/v1/admin/services", headers: bearer(token) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/admin/services/export", headers: bearer(token) })).statusCode).toBe(403);
  });
});

describe("DFT a service's own rules decide what may be booked", () => {
  function inHours(hours: number): string {
    return new Date(Date.now() + hours * 3600_000).toISOString();
  }

  async function makeService(app: Awaited<ReturnType<typeof makeTestApp>>["app"], over: Record<string, unknown> = {}) {
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(token),
      payload: JSON.stringify({
        name: "Shoe cleaning", category: "personal_care", unit: "pair",
        unitPricePaise: 15000,
        bookingRules: {
          advanceBookingRequired: true, minAdvanceMinutes: 240, maxAdvanceDays: 7,
          cancellationAllowed: true, cancellationDeadlineMinutes: 120, reschedulingAllowed: true,
        },
        ...over,
      }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().service.id as string;
  }

  it("refuses a booking made with too little notice", async () => {
    const { app } = await makeTestApp();
    const id = await makeService(app);
    const res = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ offeringId: id, scheduledFor: inHours(1) }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("service_rule");
    expect(res.json().message).toMatch(/at least 4 hours ahead/);
  });

  it("refuses one too far ahead", async () => {
    const { app } = await makeTestApp();
    const id = await makeService(app);
    const res = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ offeringId: id, scheduledFor: inHours(24 * 30) }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/at most 7 days ahead/);
  });

  it("refuses a quantity the service does not sell", async () => {
    const { app } = await makeTestApp();
    const id = await makeService(app, { minimumQuantity: 2, quantityIncrement: 2 });
    const res = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ offeringId: id, scheduledFor: inHours(12), quantity: 3 }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/steps of/);
  });

  it("accepts one that follows every rule, and quotes it with its extras", async () => {
    const { app } = await makeTestApp();
    const id = await makeService(app, {
      minimumQuantity: 1,
      mode: "at_home",
      additionalCharges: [{ kind: "home_visit", label: "Home visit", amountPaise: 5000 }],
    });
    const token = await loginResident(app);
    const quoted = await app.inject({
      method: "GET", url: `/v1/services/quote?offeringId=${id}&quantity=2&atHome=true`, headers: bearer(token),
    });
    expect(quoted.statusCode).toBe(200);
    // Two pairs at ₹150, plus one home visit — not one per pair.
    expect(quoted.json().quote.totalPaise).toBe(2 * 15000 + 5000);
    expect(quoted.json().quote.charges).toHaveLength(1);

    const booked = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(token),
      payload: JSON.stringify({ offeringId: id, scheduledFor: inHours(12), quantity: 2 }),
    });
    expect(booked.statusCode).toBe(201);
  });

  it("accepts a cancellation before the deadline and refuses one inside it", async () => {
    const { app, container } = await makeTestApp();
    const id = await makeService(app, { minimumQuantity: 1 });
    const token = await loginResident(app);

    // Five hours away, against a two hour cancellation deadline: still fine.
    const early = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(token),
      payload: JSON.stringify({ offeringId: id, scheduledFor: inHours(5) }),
    });
    expect(early.statusCode).toBe(201);
    const cancelled = await app.inject({
      method: "POST", url: `/v1/services/requests/${early.json().request.id}/cancel`, headers: bearer(token),
      payload: JSON.stringify({ reason: "Changed my mind" }),
    });
    expect(cancelled.statusCode).toBe(200);

    // A second booking, moved to within the deadline the way time would move it.
    const later = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(token),
      payload: JSON.stringify({ offeringId: id, scheduledFor: inHours(6) }),
    });
    const request = (await container.store.serviceRequests.get(later.json().request.id))!;
    request.scheduledFor = inHours(1);
    await container.store.serviceRequests.put(request);

    const refused = await app.inject({
      method: "POST", url: `/v1/services/requests/${request.id}/cancel`, headers: bearer(token),
      payload: JSON.stringify({ reason: "Too late now" }),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("service_rule");
    expect(refused.json().message).toMatch(/up to 2 hours before/);
  });
});
