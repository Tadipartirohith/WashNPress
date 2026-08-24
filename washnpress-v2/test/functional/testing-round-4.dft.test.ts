import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, giveSubscription, bearer, loginResident, loginOperator, loginSupervisor, loginAdmin, openSlotNow,
} from "./helpers";

// The issues and enhancements raised in the fourth round of testing.

const YESTERDAY = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

const society = (over: Record<string, unknown> = {}) => JSON.stringify({
  name: "Kohinoor Towers", code: "KOH", areaId: "area-madhapur", address: "Road 5, KPHB", ...over,
});

describe("DFT creating a society answers what actually went wrong", () => {
  it("creates one and returns it as active", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({ method: "POST", url: "/v1/admin/societies", headers: bearer(token), payload: society() });
    expect(response.statusCode).toBe(201);
    expect(response.json().society.status).toBe("active");
    expect(response.json().society.areaId).toBe("area-madhapur");
  });

  it("answers 404 when the selected area does not exist", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: society({ areaId: "area-that-is-not-there" }),
    });
    // Not a conflict and certainly not a server fault: the thing referred to is
    // simply not there.
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("area_not_found");
  });

  it("answers 409 for a duplicate code", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: society({ code: "MHB", name: "Something else" }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/code/i);
  });

  it("answers 409 for a duplicate name inside the same area", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: society({ name: "My Home Bhooja", code: "NEWCODE" }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/name/i);
  });

  it("allows the same name in a different area, because they are different places", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: society({ name: "My Home Bhooja", code: "MHB2", areaId: "area-gachibowli" }),
    });
    expect(response.statusCode).toBe(201);
  });

  it("answers 422 when the area exists but is not active", async () => {
    const { app, container } = await makeTestApp();
    const area = await container.store.areas.get("area-gachibowli");
    area!.status = "inactive";
    await container.store.areas.put(area!);
    const token = await loginAdmin(app);
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(token),
      payload: society({ areaId: "area-gachibowli" }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("area_not_active");
  });

  it("requires a name, a code, an address and an area", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    for (const missing of ["name", "code", "address", "areaId"]) {
      const payload = JSON.parse(society()) as Record<string, unknown>;
      delete payload[missing];
      const response = await app.inject({
        method: "POST", url: "/v1/admin/societies", headers: bearer(token),
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode, `missing ${missing}`).toBe(400);
      expect(response.json().error).toBe("invalid_request");
    }
  });

  it("never answers 500 for any of them", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const attempts = [
      society({ areaId: "nope" }), society({ code: "MHB" }), society({ name: "" }),
      society({ address: "" }), society({ code: "" }), "{}", '{"name":',
    ];
    for (const payload of attempts) {
      const response = await app.inject({ method: "POST", url: "/v1/admin/societies", headers: bearer(token), payload });
      expect(response.statusCode, payload.slice(0, 40)).toBeLessThan(500);
    }
  });
});

describe("DFT a supervisor creating a society", () => {
  it("creates it inside their own area whatever areaId they send", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const response = await app.inject({
      method: "POST", url: "/v1/supervisor/societies", headers: bearer(token),
      payload: society({ areaId: "area-gachibowli" }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().society.areaId).toBe("area-madhapur");
  });

  it("appears in their own list straight away", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    await app.inject({ method: "POST", url: "/v1/supervisor/societies", headers: bearer(token), payload: society() });
    const list = await app.inject({ method: "GET", url: "/v1/supervisor/societies", headers: bearer(token) });
    expect(list.json().societies.some((s: { code: string }) => s.code === "KOH")).toBe(true);
  });

  it("is told plainly when they have no area assigned", async () => {
    const { app, container } = await makeTestApp();
    const admin = await loginAdmin(app);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(admin),
      payload: JSON.stringify({ fullName: "Unassigned Sup", phone: "9812000001" }),
    });
    expect(made.json().supervisor.areaId).toBeNull();

    const token = await loginSupervisor(app, "9812000001");
    const response = await app.inject({ method: "POST", url: "/v1/supervisor/societies", headers: bearer(token), payload: society() });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("no_area_assigned");
    // A sentence the supervisor can act on, not a bare status code.
    expect(response.json().message).toMatch(/no area is assigned/i);

    // And nothing else in their portal falls over for want of an area.
    for (const path of ["/v1/supervisor/dashboard", "/v1/supervisor/societies", "/v1/supervisor/slots",
                        "/v1/supervisor/operators", "/v1/supervisor/orders", "/v1/supervisor/issues"]) {
      const res = await app.inject({ method: "GET", url: path, headers: bearer(token) });
      expect(res.statusCode, path).toBe(200);
    }
    await container.shutdown();
  });
});

describe("DFT onboarding belongs to residents alone", () => {
  it("is offered to a resident", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const response = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("requiredFields");
  });

  it("is refused for a supervisor, an operator and an admin", async () => {
    const { app } = await makeTestApp();
    for (const login of [loginSupervisor, loginOperator, loginAdmin]) {
      const token = await login(app);
      const read = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(token) });
      expect(read.statusCode).toBe(403);
      expect(read.json().error).toBe("onboarding_not_applicable");

      const write = await app.inject({
        method: "POST", url: "/v1/auth/onboarding", headers: bearer(token),
        payload: JSON.stringify({ fullName: "Nope", societyId: "soc-demo", unitNumber: "A-1" }),
      });
      expect(write.statusCode).toBe(403);
    }
  });

  it("never asks staff to onboard when they sign in", async () => {
    const { app } = await makeTestApp();
    for (const login of [loginSupervisor, loginOperator, loginAdmin]) {
      const token = await login(app);
      const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) });
      expect(me.json().needsOnboarding).toBe(false);
    }
  });
});

describe("DFT an operator works a ticket rather than only reading it", () => {
  async function ticketFor(app: Awaited<ReturnType<typeof makeTestApp>>["app"]) {
    const resident = await loginResident(app);
    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(resident),
      payload: JSON.stringify({ category: "garment_quantity_mismatch", description: "One shirt is missing" }),
    });
    return raised.json().ticket;
  }

  it("takes it, answers the resident, resolves it and closes it", async () => {
    const { app } = await makeTestApp();
    const ticket = await ticketFor(app);
    const token = await loginOperator(app);

    const taken = await app.inject({ method: "POST", url: `/v1/operations/issues/${ticket.id}/take`, headers: bearer(token) });
    expect(taken.statusCode).toBe(200);
    // Taking a ticket starts work on it; there is no separate "taken" stage.
    expect(taken.json().issue.status).toBe("in_progress");

    const replied = await app.inject({
      method: "POST", url: `/v1/operations/issues/${ticket.id}/reply`, headers: bearer(token),
      payload: JSON.stringify({ body: "We found the shirt and it is on the next delivery." }),
    });
    expect(replied.statusCode).toBe(200);
    expect(replied.json().issue.status).toBe("in_progress");

    const resolved = await app.inject({
      method: "PATCH", url: `/v1/operations/issues/${ticket.id}/status`, headers: bearer(token),
      payload: JSON.stringify({ status: "resolved", resolution: "Returned with the next delivery" }),
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().issue.status).toBe("resolved");

    const closed = await app.inject({
      method: "PATCH", url: `/v1/operations/issues/${ticket.id}/status`, headers: bearer(token),
      payload: JSON.stringify({ status: "closed" }),
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().issue.status).toBe("closed");
  });

  it("lets the resident see the operator's answer in their own support screen", async () => {
    const { app } = await makeTestApp();
    const ticket = await ticketFor(app);
    const operator = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${ticket.id}/reply`, headers: bearer(operator),
      payload: JSON.stringify({ body: "Looking into it now." }),
    });

    const resident = await loginResident(app);
    const seen = await app.inject({ method: "GET", url: `/v1/support/tickets/${ticket.id}`, headers: bearer(resident) });
    const messages = seen.json().ticket.messages as Array<{ body: string }>;
    expect(messages.some((m) => m.body === "Looking into it now.")).toBe(true);
  });

  it("keeps the whole history of what happened to the ticket", async () => {
    const { app } = await makeTestApp();
    const ticket = await ticketFor(app);
    const token = await loginOperator(app);
    await app.inject({ method: "POST", url: `/v1/operations/issues/${ticket.id}/take`, headers: bearer(token) });
    await app.inject({
      method: "PATCH", url: `/v1/operations/issues/${ticket.id}/status`, headers: bearer(token),
      payload: JSON.stringify({ status: "in_progress" }),
    });
    const detail = await app.inject({ method: "GET", url: `/v1/operations/issues/${ticket.id}`, headers: bearer(token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().issue).toHaveProperty("messages");
  });

  it("filters tickets by status and counts each one", async () => {
    const { app } = await makeTestApp();
    await ticketFor(app);
    const token = await loginOperator(app);
    const all = await app.inject({ method: "GET", url: "/v1/operations/issues", headers: bearer(token) });
    expect(all.json().counts.all).toBeGreaterThan(0);
    expect(all.json().statuses).toContain("in_progress");

    const open = await app.inject({ method: "GET", url: "/v1/operations/issues?status=open", headers: bearer(token) });
    expect(open.json().issues.every((i: { status: string }) => i.status === "open")).toBe(true);
    // The counts are taken before the filter, so they do not move as it narrows.
    expect(open.json().counts).toEqual(all.json().counts);
  });

  it("cannot touch a ticket for a society outside its own", async () => {
    const { app } = await makeTestApp();
    const ticket = await ticketFor(app);
    const other = await loginOperator(app, "9876500003");
    const response = await app.inject({ method: "POST", url: `/v1/operations/issues/${ticket.id}/take`, headers: bearer(other) });
    expect(response.statusCode).toBe(403);
  });
});

describe("DFT slot monitoring", () => {
  it("reports capacity, bookings and utilisation for every slot", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-mon-1", 20);
    const resident = await loginResident(app);
    await app.inject({ method: "POST", url: "/v1/pickups", headers: bearer(resident), payload: JSON.stringify({ slotId: "slot-mon-1" }) });

    const token = await loginAdmin(app);
    const response = await app.inject({ method: "GET", url: "/v1/admin/slots", headers: bearer(token) });
    const row = response.json().slots.find((s: { id: string }) => s.id === "slot-mon-1");
    expect(row.capacityTotal).toBe(20);
    expect(row.bookedCount).toBe(1);
    expect(row.availableCount).toBe(19);
    expect(row.utilisationPercent).toBe(5);
    expect(row.status).toBe("open");
    expect(row.bookingStatus).toBe("partially_booked");
    expect(row.areaName).toBe("Madhapur");
    expect(row).toHaveProperty("supervisorName");
  });

  it("totals what the filters selected", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-mon-2", 10);
    const token = await loginAdmin(app);
    const response = await app.inject({ method: "GET", url: "/v1/admin/slots", headers: bearer(token) });
    const summary = response.json().summary;
    expect(summary.totalSlots).toBeGreaterThan(0);
    expect(summary.totalCapacity).toBeGreaterThanOrEqual(10);
    expect(summary).toHaveProperty("utilisationPercent");
    expect(summary.totalAvailable).toBe(summary.totalCapacity - summary.totalBookings);
  });

  it("filters by area, society, status and utilisation together", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-mon-3", 10);
    const token = await loginAdmin(app);

    const byArea = await app.inject({ method: "GET", url: "/v1/admin/slots?areaId=area-madhapur", headers: bearer(token) });
    expect(byArea.json().slots.every((s: { areaId: string }) => s.areaId === "area-madhapur")).toBe(true);

    const bySociety = await app.inject({ method: "GET", url: "/v1/admin/slots?societyId=soc-demo", headers: bearer(token) });
    expect(bySociety.json().slots.every((s: { societyId: string }) => s.societyId === "soc-demo")).toBe(true);

    const open = await app.inject({ method: "GET", url: "/v1/admin/slots?status=open", headers: bearer(token) });
    expect(open.json().slots.every((s: { status: string }) => s.status === "open")).toBe(true);

    const idle = await app.inject({ method: "GET", url: "/v1/admin/slots?utilisation=0-25", headers: bearer(token) });
    expect(idle.json().slots.every((s: { utilisationPercent: number }) => s.utilisationPercent <= 25)).toBe(true);

    const empty = await app.inject({ method: "GET", url: "/v1/admin/slots?areaId=area-kphb", headers: bearer(token) });
    // Nothing matching is an empty list, not an error.
    expect(empty.statusCode).toBe(200);
    expect(empty.json().slots).toEqual([]);
  });

  it("offers the filter values rather than making the client invent them", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({ method: "GET", url: "/v1/admin/slots", headers: bearer(token) });
    expect(response.json().shifts).toEqual(["Morning", "Afternoon", "Evening"]);
    expect(response.json().statuses).toContain("full");
    expect(response.json().utilisationBands).toContain("100");
  });

  it("treats a day that has passed as read only", async () => {
    const { app, container } = await makeTestApp();
    await container.store.slots.put({
      id: "slot-old", societyId: "soc-demo", date: YESTERDAY, window: "Morning",
      startTime: "08:00", endTime: "11:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    const token = await loginAdmin(app);

    const hidden = await app.inject({ method: "GET", url: "/v1/admin/slots", headers: bearer(token) });
    expect(hidden.json().slots.some((s: { id: string }) => s.id === "slot-old")).toBe(false);

    const shown = await app.inject({ method: "GET", url: "/v1/admin/slots?includePast=true", headers: bearer(token) });
    const row = shown.json().slots.find((s: { id: string }) => s.id === "slot-old");
    expect(row.status).toBe("closed");
    expect(row.readOnly).toBe(true);

    const edited = await app.inject({
      method: "PATCH", url: "/v1/admin/slots/slot-old", headers: bearer(token),
      payload: JSON.stringify({ capacityTotal: 50 }),
    });
    expect(edited.statusCode).toBe(409);
    const cancelled = await app.inject({ method: "POST", url: "/v1/admin/slots/slot-old/cancel", headers: bearer(token) });
    expect(cancelled.statusCode).toBe(409);
  });

  it("lets an admin create a slot, change its capacity and cancel it", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(token),
      payload: JSON.stringify({ societyId: "soc-demo", date: TOMORROW, window: "Evening", startTime: "18:00", endTime: "20:00", capacityTotal: 12 }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().slot.id;

    const patched = await app.inject({
      method: "PATCH", url: `/v1/admin/slots/${id}`, headers: bearer(token),
      payload: JSON.stringify({ capacityTotal: 25 }),
    });
    expect(patched.json().slot.capacityTotal).toBe(25);

    const cancelled = await app.inject({ method: "POST", url: `/v1/admin/slots/${id}/cancel`, headers: bearer(token) });
    expect(cancelled.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: `/v1/admin/slots?societyId=soc-demo`, headers: bearer(token) });
    expect(after.json().slots.find((s: { id: string }) => s.id === id).status).toBe("cancelled");
  });
});

describe("DFT revenue", () => {
  it("resolves a preset into the dates it means", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const today = await app.inject({ method: "GET", url: "/v1/admin/revenue?preset=today", headers: bearer(token) });
    const range = today.json().range;
    expect(range.preset).toBe("today");
    expect(range.from).toBe(range.to);
    expect(range.label).toBe("Today");

    const month = await app.inject({ method: "GET", url: "/v1/admin/revenue?preset=this_month", headers: bearer(token) });
    expect(month.json().range.from.endsWith("-01")).toBe(true);

    const all = await app.inject({ method: "GET", url: "/v1/admin/revenue?preset=all", headers: bearer(token) });
    expect(all.json().range.from).toBeUndefined();
  });

  it("breaks the total down by area, society, supervisor, operator and plan", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({ method: "GET", url: "/v1/admin/revenue?preset=all", headers: bearer(token) });
    const body = response.json();
    for (const key of ["byArea", "bySociety", "bySupervisor", "byOperator", "byPlan"]) {
      expect(Array.isArray(body[key]), key).toBe(true);
    }
    expect(body.summary).toHaveProperty("totalRevenuePaise");
    expect(body.summary).toHaveProperty("pendingPaise");
    expect(body.summary).toHaveProperty("netRevenuePaise");
    expect(body.byPlan.every((p: { name: string }) => typeof p.name === "string")).toBe(true);
  });

  it("lists every charged order with the people and places behind it", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({ method: "GET", url: "/v1/admin/revenue?preset=all", headers: bearer(token) });
    for (const row of response.json().chargedOrders as Array<Record<string, unknown>>) {
      for (const field of ["orderCode", "residentName", "societyName", "areaName", "supervisorName", "operatorName", "totalPaise", "paymentStatus", "state"]) {
        expect(row, field).toHaveProperty(field);
      }
    }
  });

  it("leaves subscription revenue out when narrowed to an operator, rather than misreporting it", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const response = await app.inject({ method: "GET", url: "/v1/admin/revenue?preset=all&operatorUserId=user-op", headers: bearer(token) });
    // A month's subscription fee was not earned by one operator, so attributing it
    // to them would be wrong. It is excluded and the response says so.
    expect(response.json().summary.subscriptionRevenuePaise).toBe(0);
    expect(response.json().summary.narrowed).toBe(true);
  });

  it("offers the filter options it accepts", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const body = (await app.inject({ method: "GET", url: "/v1/admin/revenue", headers: bearer(token) })).json();
    expect(body.filters.areas.length).toBeGreaterThan(0);
    expect(body.filters.societies.length).toBeGreaterThan(0);
    expect(body.presets.map((p: { value: string }) => p.value)).toContain("last_month");
    expect(body.paymentStatuses).toContain("pending");
  });
});

describe("DFT pricing is per garment, and the two models are kept apart", () => {
  it("publishes a price for every garment category", async () => {
    const { app } = await makeTestApp();
    const response = await app.inject({ method: "GET", url: "/v1/pricing" });
    expect(response.statusCode).toBe(200);
    const garments = response.json().garments as Array<{ category: string; payAsYouGoPaise: number }>;
    expect(garments.length).toBeGreaterThan(3);
    expect(garments.every((g) => g.payAsYouGoPaise > 0)).toBe(true);
    // A saree is not a shirt.
    const shirt = garments.find((g) => g.category === "Shirts")!;
    const saree = garments.find((g) => g.category === "Sarees")!;
    expect(saree.payAsYouGoPaise).toBeGreaterThan(shirt.payAsYouGoPaise);
  });

  it("tells a subscribed resident what their plan covers alongside the prices", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const response = await app.inject({ method: "GET", url: "/v1/pricing", headers: bearer(token) });
    const body = response.json();
    expect(body.hasSubscription).toBe(true);
    expect(body.subscription.planTier).toBe("Basic");
    expect(body.subscription.remaining).toBeGreaterThan(0);
    expect(body.services.some((s: { coveredBySubscription: boolean }) => s.coveredBySubscription)).toBe(true);
  });

  it("charges a resident with no plan the price of each garment category", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-price-1", 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-price-1" }),
    });
    const operator = await loginOperator(app);
    await openSlotNow(container, "slot-price-1");
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.json().order.id}/picked-up`, headers: bearer(operator),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }, { category: "Sarees", quantity: 1 }] }),
    });
    const config = await container.systemConfig.get();
    const expected = 2 * config.garmentPricesPaise.Shirts + 1 * config.garmentPricesPaise.Sarees;
    expect(picked.json().order.additionalChargePaise).toBe(expected);
  });

  it("keeps pay as you go pricing separate from what a plan covers", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const before = await app.inject({ method: "GET", url: "/v1/admin/plans", headers: bearer(token) });
    const coverageBefore = before.json().plans.map((p: { coveredServiceIds: string[] }) => p.coveredServiceIds);

    const changed = await app.inject({
      method: "PATCH", url: "/v1/admin/config", headers: bearer(token),
      payload: JSON.stringify({ garmentPricesPaise: { Shirts: 9900 } }),
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().config.garmentPricesPaise.Shirts).toBe(9900);

    const after = await app.inject({ method: "GET", url: "/v1/admin/plans", headers: bearer(token) });
    // Changing what a garment costs to a walk-up customer must not quietly change
    // what a subscriber's plan includes.
    expect(after.json().plans.map((p: { coveredServiceIds: string[] }) => p.coveredServiceIds)).toEqual(coverageBefore);
  });
});

describe("DFT a supervisor watching pickups", () => {
  it("can narrow to one of their own societies and is offered the list", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const response = await app.inject({ method: "GET", url: "/v1/supervisor/pickups", headers: bearer(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().societies.length).toBeGreaterThan(0);

    const scoped = await app.inject({ method: "GET", url: "/v1/supervisor/pickups?societyId=soc-demo", headers: bearer(token) });
    expect(scoped.json().pickups.every((p: { societyId: string }) => p.societyId === "soc-demo")).toBe(true);
  });

  it("is never given another area's society by asking for it", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const response = await app.inject({ method: "GET", url: "/v1/supervisor/pickups?societyId=soc-gachibowli", headers: bearer(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().pickups.every((p: { societyId: string }) => p.societyId !== "soc-gachibowli")).toBe(true);
  });
});
