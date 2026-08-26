import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, loginOperator, loginAdmin } from "./helpers";
import { quotePaise, roundToHalfHour, canTransitionRequest } from "../../src/domain/service-requests";

// #16 vehicle washing and #18 at-home ironing. Neither is laundry: nothing is
// collected, nothing goes through a machine, nothing comes back. They share a small
// booking shape of their own rather than being forced into the order model.

const tomorrow = () => new Date(Date.now() + 86400_000).toISOString();

async function book(payload: Record<string, unknown>) {
  const { app, container } = await makeTestApp();
  const token = await loginResident(app);
  const response = await app.inject({
    method: "POST", url: "/v1/services/requests", headers: bearer(token),
    payload: JSON.stringify({ scheduledFor: tomorrow(), ...payload }),
  });
  return { app, container, token, response };
}

describe("DFT what a service costs, before anybody commits to it", () => {
  it("prices a job once however much of it there is", () => {
    const wash = { pricingBasis: "per_job" as const, unitPricePaise: 39900 };
    expect(quotePaise(wash, {})).toBe(39900);
    expect(quotePaise(wash, { hours: 9 })).toBe(39900);
  });

  it("prices an hourly service by the time, in half hours", () => {
    const ironing = { pricingBasis: "per_hour" as const, unitPricePaise: 29900 };
    expect(quotePaise(ironing, { hours: 2 })).toBe(59800);
    expect(quotePaise(ironing, { hours: 1.5 })).toBe(44850);
    // Rounded to the nearest half hour rather than up to the next whole one.
    expect(roundToHalfHour(1.2)).toBe(1);
    expect(roundToHalfHour(1.3)).toBe(1.5);
    // Anything started is at least half an hour, because somebody travelled there.
    expect(roundToHalfHour(0.1)).toBe(0.5);
    expect(roundToHalfHour(0)).toBe(0);
  });

  it("quotes before booking", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const car = await app.inject({ method: "GET", url: "/v1/services/quote?offeringId=wash-car", headers: bearer(token) });
    expect(car.statusCode).toBe(200);
    expect(car.json().quote.quotedPaise).toBe(39900);
    expect(car.json().quote.vehicleTypes).toEqual(["Car"]);

    const ironing = await app.inject({
      method: "GET", url: "/v1/services/quote?offeringId=iron-at-home&estimatedHours=2", headers: bearer(token),
    });
    expect(ironing.json().quote.quotedPaise).toBe(59800);
    expect(ironing.json().quote.hours).toBe(2);
    expect(ironing.json().quote.minimumHours).toBe(1);
  });

  it("offers what is available without anybody signing in", async () => {
    const { app } = await makeTestApp();
    const listed = await app.inject({ method: "GET", url: "/v1/services/offerings" });
    expect(listed.statusCode).toBe(200);
    const names = (listed.json().offerings as { name: string }[]).map((o) => o.name);
    expect(names).toContain("Car wash");
    expect(names).toContain("Bike wash");
    expect(names).toContain("At-home ironing");

    const washesOnly = await app.inject({ method: "GET", url: "/v1/services/offerings?kind=vehicle_wash" });
    expect((washesOnly.json().offerings as { kind: string }[]).every((o) => o.kind === "vehicle_wash")).toBe(true);
  });
});

describe("DFT booking a vehicle wash", () => {
  it("books one, with the vehicle it is for", async () => {
    const { response } = await book({ offeringId: "wash-car", vehicleType: "Car", vehicleNumber: "TS 09 AB 1234" });
    expect(response.statusCode).toBe(201);
    const request = response.json().request;
    expect(request.kind).toBe("vehicle_wash");
    expect(request.kindLabel).toBe("Vehicle washing");
    expect(request.vehicleType).toBe("Car");
    expect(request.vehicleNumber).toBe("TS 09 AB 1234");
    expect(request.quotedPaise).toBe(39900);
    expect(request.status).toBe("requested");
  });

  it("insists on knowing what it is washing", async () => {
    const { response } = await book({ offeringId: "wash-car" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("vehicle_required");
    expect(response.json().message).toMatch(/Car/);
  });

  it("refuses a vehicle the offering is not for", async () => {
    const { response } = await book({ offeringId: "wash-car", vehicleType: "Bike" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("vehicle_required");
  });

  it("prices a bike differently from a car", async () => {
    const { response } = await book({ offeringId: "wash-bike", vehicleType: "Bike" });
    expect(response.json().request.quotedPaise).toBe(19900);
  });
});

describe("DFT booking at-home ironing", () => {
  it("books one for a number of hours", async () => {
    const { response } = await book({ offeringId: "iron-at-home", estimatedHours: 2, address: "Flat A-204" });
    expect(response.statusCode).toBe(201);
    const request = response.json().request;
    expect(request.kind).toBe("home_ironing");
    expect(request.estimatedHours).toBe(2);
    expect(request.quotedPaise).toBe(59800);
    expect(request.address).toBe("Flat A-204");
  });

  it("insists on being told how long", async () => {
    const { response } = await book({ offeringId: "iron-at-home" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("hours_required");
    expect(response.json().message).toMatch(/at least 1 hour/i);
  });

  it("refuses less than the minimum booking", async () => {
    const { response } = await book({ offeringId: "iron-at-home", estimatedHours: 0.5 });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("hours_required");
  });
});

describe("DFT a service job is worked and charged for what it took", () => {
  async function assigned() {
    const ctx = await book({ offeringId: "iron-at-home", estimatedHours: 2 });
    const id = ctx.response.json().request.id as string;
    const operatorToken = await loginOperator(ctx.app);
    await ctx.app.inject({
      method: "POST", url: `/v1/operations/services/${id}/assign`, headers: bearer(operatorToken),
      payload: JSON.stringify({}),
    });
    return { ...ctx, id, operatorToken };
  }

  it("appears in the operator's work list", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const operatorToken = await loginOperator(ctx.app);
    const listed = await ctx.app.inject({ method: "GET", url: "/v1/operations/services", headers: bearer(operatorToken) });
    expect(listed.statusCode).toBe(200);
    expect((listed.json().requests as { id: string }[]).map((r) => r.id))
      .toContain(ctx.response.json().request.id);
  });

  it("is taken, started and completed in order", () => {
    expect(canTransitionRequest("requested", "assigned")).toBe(true);
    expect(canTransitionRequest("assigned", "in_progress")).toBe(true);
    expect(canTransitionRequest("in_progress", "completed")).toBe(true);
    // Nothing skips to the end, and nothing comes back from it.
    expect(canTransitionRequest("requested", "completed")).toBe(false);
    expect(canTransitionRequest("requested", "in_progress")).toBe(false);
    expect(canTransitionRequest("completed", "in_progress")).toBe(false);
    expect(canTransitionRequest("cancelled", "assigned")).toBe(false);
  });

  it("refuses to start a job nobody has taken", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const operatorToken = await loginOperator(ctx.app);
    const started = await ctx.app.inject({
      method: "POST", url: `/v1/operations/services/${ctx.response.json().request.id}/start`,
      headers: bearer(operatorToken),
    });
    expect(started.statusCode).toBe(409);
    expect(started.json().error).toBe("illegal_transition");
  });

  it("charges an hourly job for the time it actually took", async () => {
    const { app, id, operatorToken } = await assigned();
    await app.inject({ method: "POST", url: `/v1/operations/services/${id}/start`, headers: bearer(operatorToken) });
    const completed = await app.inject({
      method: "POST", url: `/v1/operations/services/${id}/complete`, headers: bearer(operatorToken),
      payload: JSON.stringify({ actualHours: 3 }),
    });
    expect(completed.statusCode).toBe(200);
    const request = completed.json().request;
    // Both figures are kept: what it was expected to cost, and what it came to.
    expect(request.estimatedHours).toBe(2);
    expect(request.actualHours).toBe(3);
    expect(request.quotedPaise).toBe(59800);
    expect(request.finalPaise).toBe(89700);
    expect(request.payablePaise).toBe(89700);
    expect(request.chargeStatus).toBe("pending");
  });

  it("charges a per-job service its own price whatever the time", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const id = ctx.response.json().request.id as string;
    const operatorToken = await loginOperator(ctx.app);
    await ctx.app.inject({ method: "POST", url: `/v1/operations/services/${id}/assign`, headers: bearer(operatorToken), payload: JSON.stringify({}) });
    await ctx.app.inject({ method: "POST", url: `/v1/operations/services/${id}/start`, headers: bearer(operatorToken) });
    const completed = await ctx.app.inject({
      method: "POST", url: `/v1/operations/services/${id}/complete`, headers: bearer(operatorToken),
      payload: JSON.stringify({ actualHours: 4 }),
    });
    expect(completed.json().request.finalPaise).toBe(39900);
    expect(completed.json().request.actualHours).toBeNull();
  });

  it("keeps the whole thing on a timeline", async () => {
    const { app, id, operatorToken } = await assigned();
    await app.inject({ method: "POST", url: `/v1/operations/services/${id}/start`, headers: bearer(operatorToken) });
    const completed = await app.inject({
      method: "POST", url: `/v1/operations/services/${id}/complete`, headers: bearer(operatorToken),
      payload: JSON.stringify({ actualHours: 2 }),
    });
    const states = (completed.json().request.timeline as { status: string }[]).map((t) => t.status);
    expect(states).toEqual(["requested", "assigned", "in_progress", "completed"]);
  });
});

describe("DFT a resident sees and can stop their own bookings", () => {
  it("lists them", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const listed = await ctx.app.inject({ method: "GET", url: "/v1/services/requests", headers: bearer(ctx.token) });
    expect((listed.json().requests as unknown[]).length).toBe(1);
  });

  it("cancels one, with a reason", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const cancelled = await ctx.app.inject({
      method: "POST", url: `/v1/services/requests/${ctx.response.json().request.id}/cancel`,
      headers: bearer(ctx.token), payload: JSON.stringify({ reason: "Car is not here this week" }),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().request.status).toBe("cancelled");
    expect(cancelled.json().request.cancelledReason).toBe("Car is not here this week");
  });

  it("will not cancel without saying why", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const cancelled = await ctx.app.inject({
      method: "POST", url: `/v1/services/requests/${ctx.response.json().request.id}/cancel`,
      headers: bearer(ctx.token), payload: JSON.stringify({}),
    });
    expect(cancelled.statusCode).toBe(400);
  });

  it("cannot touch somebody else's", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const other = await loginResident(ctx.app, "9876543211");
    const attempt = await ctx.app.inject({
      method: "POST", url: `/v1/services/requests/${ctx.response.json().request.id}/cancel`,
      headers: bearer(other), payload: JSON.stringify({ reason: "Not mine" }),
    });
    expect(attempt.statusCode).toBe(404);
  });
});

describe("DFT an admin manages what is offered", () => {
  it("adds a new service line without an application change", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/services", headers: bearer(token),
      payload: JSON.stringify({
        kind: "vehicle_wash", name: "SUV wash", category: "vehicle_care",
        unit: "vehicle", unitPricePaise: 59900, vehicleTypes: ["SUV"],
        // Published as it is created: a new service is a draft unless it says so,
        // and this test is about it appearing in the catalogue.
        status: "active",
      }),
    });
    expect(created.statusCode).toBe(201);
    const offeringId = created.json().service.id as string;

    // And a resident can book it straight away.
    const booked = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ offeringId, vehicleType: "SUV", scheduledFor: tomorrow() }),
    });
    expect(booked.statusCode).toBe(201);
    expect(booked.json().request.quotedPaise).toBe(59900);
  });

  it("withdraws one, and it can no longer be booked", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "PATCH", url: "/v1/admin/services/wash-bike", headers: bearer(token),
      payload: JSON.stringify({ isActive: false }),
    });
    const booked = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ offeringId: "wash-bike", vehicleType: "Bike", scheduledFor: tomorrow() }),
    });
    expect(booked.statusCode).toBe(409);
    expect(booked.json().error).toBe("offering_inactive");
  });

  it("does not rewrite what a resident was already told they were buying", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const adminToken = await loginAdmin(ctx.app);
    await ctx.app.inject({
      method: "PATCH", url: "/v1/admin/services/wash-car", headers: bearer(adminToken),
      payload: JSON.stringify({ name: "Deluxe car wash", unitPricePaise: 99900 }),
    });
    const listed = await ctx.app.inject({ method: "GET", url: "/v1/services/requests", headers: bearer(ctx.token) });
    const request = (listed.json().requests as { offeringName: string; quotedPaise: number }[])[0];
    // The booking is a snapshot: repricing later does not change what was agreed.
    expect(request.offeringName).toBe("Car wash");
    expect(request.quotedPaise).toBe(39900);
  });

  it("reports how the service lines are going", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const summary = await ctx.app.inject({
      // The bookings, which is what this list always was. /v1/admin/services is the
      // catalogue now, and never described a list of bookings.
      method: "GET", url: "/v1/admin/service-requests", headers: bearer(await loginAdmin(ctx.app)),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.total).toBe(1);
    expect(summary.json().summary.requested).toBe(1);
    const byKind = summary.json().summary.byKind as { kind: string; total: number }[];
    expect(byKind.find((k) => k.kind === "vehicle_wash")!.total).toBe(1);
  });
});

describe("DFT service jobs respect the same scope as everything else", () => {
  it("keeps them out of another area's work list", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const outsider = await loginResident(ctx.app, "9876500003");
    const listed = await ctx.app.inject({ method: "GET", url: "/v1/operations/services", headers: bearer(outsider) });
    expect((listed.json().requests as { id: string }[]).map((r) => r.id))
      .not.toContain(ctx.response.json().request.id);
  });

  it("refuses an operator from another area by id", async () => {
    const ctx = await book({ offeringId: "wash-car", vehicleType: "Car" });
    const outsider = await loginResident(ctx.app, "9876500003");
    const attempt = await ctx.app.inject({
      method: "POST", url: `/v1/operations/services/${ctx.response.json().request.id}/assign`,
      headers: bearer(outsider), payload: JSON.stringify({}),
    });
    expect(attempt.statusCode).toBe(403);
  });
});
