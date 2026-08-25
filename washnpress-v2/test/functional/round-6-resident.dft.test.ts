import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, giveSubscription, bearer, loginResident } from "./helpers";
import {
  occurrencesBetween, occurrencesPerMonth, validateRecurrence, describeRecurrence,
  InvalidRecurrenceError,
} from "../../src/domain/recurrence";
import { estimateDeliveryAt } from "../../src/services/scheduling-service";

// The resident enhancements from the sixth round: recurring schedules that can say
// which days (#24), preferred windows bounded by what the plan includes (#25), a
// delivery estimate given before the order is confirmed (#19), and a greeting that
// knows whether it has seen you before (#26).

describe("DFT a recurrence can say which days it means", () => {
  it("insists on being specific enough to act on", () => {
    // "Twice a week" without saying which two days is an intention, not a schedule.
    expect(() => validateRecurrence("twice_weekly", [])).toThrow(InvalidRecurrenceError);
    expect(() => validateRecurrence("twice_weekly", [1])).toThrow(InvalidRecurrenceError);
    expect(() => validateRecurrence("weekly", [])).toThrow(InvalidRecurrenceError);
    expect(() => validateRecurrence("weekly", [1, 4])).toThrow(InvalidRecurrenceError);
    // Alternate days is the interval itself, so it needs no days chosen.
    expect(() => validateRecurrence("alternate_days", [])).not.toThrow();
    expect(() => validateRecurrence("one_time", [])).not.toThrow();
    expect(() => validateRecurrence("weekly", [9])).toThrow(InvalidRecurrenceError);
  });

  it("works out the dates a weekly arrangement wants", () => {
    // 2026-08-24 is a Monday.
    const dates = occurrencesBetween(
      { frequency: "weekly", days: [1], startDate: "2026-08-24" },
      "2026-08-24", "2026-09-14",
    );
    expect(dates).toEqual(["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"]);
  });

  it("works out two chosen days a week", () => {
    const dates = occurrencesBetween(
      { frequency: "twice_weekly", days: [1, 4], startDate: "2026-08-24" },
      "2026-08-24", "2026-09-03",
    );
    // Mondays and Thursdays.
    expect(dates).toEqual(["2026-08-24", "2026-08-27", "2026-08-31", "2026-09-03"]);
  });

  it("keeps alternate days on their pattern rather than drifting", () => {
    const schedule = { frequency: "alternate_days" as const, days: [], startDate: "2026-08-24" };
    expect(occurrencesBetween(schedule, "2026-08-24", "2026-08-30"))
      .toEqual(["2026-08-24", "2026-08-26", "2026-08-28", "2026-08-30"]);
    // Recalculated from a later day, the pattern is the same days, not a new run
    // starting wherever the window happens to open.
    expect(occurrencesBetween(schedule, "2026-08-27", "2026-08-31"))
      .toEqual(["2026-08-28", "2026-08-30"]);
  });

  it("says what it means in words", () => {
    expect(describeRecurrence("twice_weekly", [1, 4])).toBe("Twice a week on Monday and Thursday");
    expect(describeRecurrence("alternate_days", [])).toBe("Alternate days");
  });

  it("counts what a frequency asks for in a month", () => {
    expect(occurrencesPerMonth("one_time", [])).toBe(1);
    expect(occurrencesPerMonth("weekly", [1])).toBe(4);
    expect(occurrencesPerMonth("twice_weekly", [1, 4])).toBe(8);
    expect(occurrencesPerMonth("alternate_days", [])).toBe(15);
  });
});

describe("DFT a resident manages their own standing arrangement", () => {
  it("creates one, and can look at it afterwards", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(token),
      payload: JSON.stringify({ frequency: "weekly", days: [1], window: "Morning" }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().schedule.description).toBe("Weekly on Monday");

    const listed = await app.inject({ method: "GET", url: "/v1/resident/schedules", headers: bearer(token) });
    expect((listed.json().schedules as unknown[]).length).toBe(1);
    // The options are offered rather than hard coded in the client, and now include
    // the daily and custom cadences a plan can be built from.
    expect((listed.json().frequencies as { key: string }[]).map((f) => f.key))
      .toEqual(["one_time", "daily", "alternate_days", "twice_weekly", "weekly", "custom"]);
    expect(listed.json().windows).toEqual(["Morning", "Afternoon", "Evening"]);
  });

  it("refuses a schedule that does not say enough", async () => {
    const { app } = await makeTestApp();
    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ frequency: "twice_weekly", days: [1], window: "Morning" }),
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error).toBe("invalid_recurrence");
    expect(created.json().message).toMatch(/Choose 2 days/i);
  });

  it("changes one, and pauses it", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(token),
      payload: JSON.stringify({ frequency: "weekly", days: [1], window: "Morning" }),
    });
    const id = created.json().schedule.id as string;

    const changed = await app.inject({
      method: "PATCH", url: `/v1/resident/schedules/${id}`, headers: bearer(token),
      payload: JSON.stringify({ days: [3], window: "Evening" }),
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().schedule.description).toBe("Weekly on Wednesday");
    expect(changed.json().schedule.window).toBe("Evening");

    const paused = await app.inject({
      method: "PATCH", url: `/v1/resident/schedules/${id}`, headers: bearer(token),
      payload: JSON.stringify({ status: "paused" }),
    });
    expect(paused.json().schedule.status).toBe("paused");
  });

  it("stops one without disturbing what is already booked", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    await seedSlot(container, "slot-sched-1", 5);
    await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-sched-1", estimatedCount: 3 }),
    });
    const bookedBefore = (await container.store.pickups.find((p) => p.residentId === "res-demo")).length;

    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(token),
      payload: JSON.stringify({ frequency: "weekly", days: [1], window: "Morning" }),
    });
    const stopped = await app.inject({
      method: "DELETE", url: `/v1/resident/schedules/${created.json().schedule.id}`, headers: bearer(token),
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().schedule.status).toBe("cancelled");

    // Those collections were promised to the resident; stopping the arrangement
    // stops future ones, not the ones already made.
    expect((await container.store.pickups.find((p) => p.residentId === "res-demo")).length).toBe(bookedBefore);
    const listed = await app.inject({ method: "GET", url: "/v1/resident/schedules", headers: bearer(token) });
    expect(listed.json().schedules).toEqual([]);
  });

  it("does not let one resident touch another's", async () => {
    const { app } = await makeTestApp();
    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ frequency: "weekly", days: [1], window: "Morning" }),
    });
    const other = await loginResident(app, "9876543211");
    const attempt = await app.inject({
      method: "DELETE", url: `/v1/resident/schedules/${created.json().schedule.id}`, headers: bearer(other),
    });
    expect(attempt.statusCode).toBe(404);
  });
});

describe("DFT a plan says how many collections it includes", () => {
  it("refuses an arrangement that asks for more than the plan allows", async () => {
    const { app, container } = await makeTestApp();
    // Basic includes four collections a month.
    await giveSubscription(container, "res-demo", "plan-basic");
    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ frequency: "alternate_days", window: "Morning" }),
    });
    expect(created.statusCode).toBe(422);
    expect(created.json().error).toBe("pickup_allowance_exceeded");
    expect(created.json().allowed).toBe(4);
    expect(created.json().wanted).toBe(15);
    // A sentence the resident can act on, not a bare status code.
    expect(created.json().message).toMatch(/plan includes 4 pickups/i);
  });

  it("allows one that fits", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ frequency: "weekly", days: [1], window: "Morning" }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().schedule.allowance).toBe(4);
    expect(created.json().schedule.perMonth).toBe(4);
  });

  it("does not restrict a resident with no plan at all", async () => {
    const { app } = await makeTestApp();
    const created = await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ frequency: "alternate_days", window: "Morning" }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().schedule.allowance).toBeNull();
  });
});

describe("DFT a preferred window belongs to a subscription", () => {
  it("is not offered to somebody without one", async () => {
    const { app } = await makeTestApp();
    const read = await app.inject({ method: "GET", url: "/v1/resident/preferences", headers: bearer(await loginResident(app)) });
    expect(read.statusCode).toBe(409);
    expect(read.json().error).toBe("subscription_required");
  });

  it("is remembered for somebody who has one", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-basic");
    const token = await loginResident(app);
    const saved = await app.inject({
      method: "PUT", url: "/v1/resident/preferences", headers: bearer(token),
      payload: JSON.stringify({ preferredWindows: ["Morning", "Evening"] }),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().preferences.preferredWindows).toEqual(["Morning", "Evening"]);
    expect(saved.json().preferences.pickupsPerCycle).toBe(4);

    const read = await app.inject({ method: "GET", url: "/v1/resident/preferences", headers: bearer(token) });
    expect(read.json().preferences.preferredWindows).toEqual(["Morning", "Evening"]);
  });
});

describe("DFT a schedule takes what is actually available", () => {
  it("books the preferred window when it is there", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    // The weekday is read off the date itself, the same way the schedule reads it.
    const date = new Date(Date.now() + 2 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(token),
      payload: JSON.stringify({ frequency: "weekly", days: [weekday], window: "Evening" }),
    });
    for (const [id, window, startTime, endTime] of [
      ["slot-gen-morning", "Morning", "09:00", "12:00"],
      ["slot-gen-evening", "Evening", "17:00", "20:00"],
    ] as const) {
      await container.store.slots.put({
        id, societyId: "soc-demo", date, window, startTime, endTime,
        capacityTotal: 5, capacityRemaining: 5, isActive: true,
      });
    }
    const result = await container.schedules.generateUpcoming();
    expect(result.created).toBeGreaterThan(0);
    const booked = await container.store.pickups.find((p) => p.residentId === "res-demo");
    expect(booked.some((p) => p.slotId === "slot-gen-evening")).toBe(true);
  });

  it("says when it could not have what was asked for, rather than swallowing it", async () => {
    const { app, container } = await makeTestApp();
    const date = new Date(Date.now() + 3 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ frequency: "weekly", days: [weekday], window: "Evening" }),
    });
    // Nothing is open on that day, and the schedule says so rather than silently
    // producing nothing.
    const result = await container.schedules.generateUpcoming();
    expect(result.skipped.some((s) => s.reason === "no_slot_available" && s.date === date)).toBe(true);
  });

  it("does not book the same day twice", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const day = new Date(Date.now() + 2 * 86400_000 + 330 * 60_000);
    const date = day.toISOString().slice(0, 10);
    await container.store.slots.put({
      id: "slot-once", societyId: "soc-demo", date, window: "Morning",
      startTime: "09:00", endTime: "12:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    await app.inject({
      method: "POST", url: "/v1/resident/schedules", headers: bearer(token),
      payload: JSON.stringify({ frequency: "weekly", days: [new Date(`${date}T00:00:00.000Z`).getUTCDay()], window: "Morning" }),
    });
    const first = await container.schedules.generateUpcoming();
    const second = await container.schedules.generateUpcoming();
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
  });
});

describe("DFT the resident is told when their laundry is coming back", () => {
  it("takes longer for a specialised clean than for an ordinary one", () => {
    const from = "2026-08-24T09:00:00.000Z";
    const wash = estimateDeliveryAt({ from, quantity: 5, requiresClean: true, cleanStage: "wash", requiresPress: true, baseTurnaroundHours: 48 });
    const dry = estimateDeliveryAt({ from, quantity: 5, requiresClean: true, cleanStage: "dry_clean", requiresPress: true, baseTurnaroundHours: 48 });
    const premium = estimateDeliveryAt({ from, quantity: 5, requiresClean: true, cleanStage: "premium", requiresPress: true, baseTurnaroundHours: 48 });
    expect(new Date(dry).getTime()).toBeGreaterThan(new Date(wash).getTime());
    expect(new Date(premium).getTime()).toBeGreaterThan(new Date(dry).getTime());
  });

  it("takes longer for more garments", () => {
    const from = "2026-08-24T09:00:00.000Z";
    const few = estimateDeliveryAt({ from, quantity: 5, requiresClean: true, cleanStage: "wash", requiresPress: false, baseTurnaroundHours: 48 });
    const many = estimateDeliveryAt({ from, quantity: 60, requiresClean: true, cleanStage: "wash", requiresPress: false, baseTurnaroundHours: 48 });
    expect(new Date(many).getTime()).toBeGreaterThan(new Date(few).getTime());
  });

  it("says so before the resident confirms, and keeps it on the order", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-eta-1", 5);
    const token = await loginResident(app);
    const lines = [{ category: "Shirts", quantity: 4, serviceId: "dryclean_iron" }];

    const preview = await app.inject({
      method: "GET",
      url: `/v1/pickups/preview?slotId=slot-eta-1&lines=${encodeURIComponent(JSON.stringify(lines))}`,
      headers: bearer(token),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().estimatedDeliveryAt).toBeTruthy();

    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-eta-1", lines }),
    });
    expect(booked.json().order.estimatedDeliveryAt).toBeTruthy();
  });
});

describe("DFT a first login is not a return", () => {
  it("says so on the way in, and stops saying so afterwards", async () => {
    const { app } = await makeTestApp();
    const send = await app.inject({
      method: "POST", url: "/v1/auth/otp/send",
      headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone: "9876543210" }),
    });
    const first = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876543210", otp: send.json().otpForTesting }),
    });
    // The seeded resident has never signed in, so this is genuinely their first.
    expect(first.json().firstLogin).toBe(true);

    const again = await app.inject({
      method: "POST", url: "/v1/auth/otp/send",
      headers: { "content-type": "application/json" }, payload: JSON.stringify({ phone: "9876543210" }),
    });
    const second = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876543210", otp: again.json().otpForTesting }),
    });
    // "Welcome back" is now true, and was not before.
    expect(second.json().firstLogin).toBe(false);
  });

  it("says the same thing on every app start", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) });
    expect(me.json()).toHaveProperty("firstLogin");
    expect(me.json().firstLogin).toBe(false);
  });
});
