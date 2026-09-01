import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, loginResident } from "./helpers";

// A slot is one society, one day, one window. Nothing used to stop the same
// Morning being created twice for the same society on the same date, and two
// slots for one window is not twice the capacity — it is the same three hours
// offered to residents twice, with the bookings split across two records that no
// roster reconciles.
//
// The rest of what the round asks for was already enforced and is checked here so
// it stays that way: capacity cannot drop below what is booked, a slot is full
// when it is full, and a resident sees their own society's slots and no others.

// Far enough ahead to clear the two-hour notice rule.
function soon(days = 3): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

describe("creating slots", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let admin: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  const create = (body: Record<string, unknown>) => app.inject({
    method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
    payload: JSON.stringify({ societyId: "soc-demo", capacityTotal: 10, ...body }),
  });

  it("accepts each of the three windows on a day", async () => {
    const date = soon();
    for (const window of ["Morning", "Afternoon", "Evening"]) {
      expect((await create({ date, window })).statusCode).toBe(201);
    }
  });

  it("refuses the same society, day and window twice", async () => {
    const date = soon(4);
    expect((await create({ date, window: "Morning" })).statusCode).toBe(201);
    const again = await create({ date, window: "Morning" });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("slot_exists");
    expect(again.json().message).toMatch(/already exists/i);
  });

  it("allows the same window on a different day, and for a different society", async () => {
    const date = soon(5);
    expect((await create({ date, window: "Morning" })).statusCode).toBe(201);
    expect((await create({ date: soon(6), window: "Morning" })).statusCode).toBe(201);
    const other = (await container.store.societies.all()).find((s) => s.id !== "soc-demo");
    if (other) {
      expect((await create({ date, window: "Morning", societyId: other.id })).statusCode).toBe(201);
    }
  });

  it("lets a cancelled window be created again", async () => {
    // Recreating it is how a cancellation is undone; a dead record must not hold
    // the window for ever.
    const date = soon(7);
    const made = await create({ date, window: "Evening" });
    expect(made.statusCode).toBe(201);
    const slot = made.json().slot as { id: string };
    const stored = (await container.store.slots.get(slot.id))!;
    stored.isActive = false;
    await container.store.slots.put(stored);
    expect((await create({ date, window: "Evening" })).statusCode).toBe(201);
  });

  it("will not drop capacity below what residents have already booked", async () => {
    const date = soon(8);
    const made = await create({ date, window: "Afternoon", capacityTotal: 10 });
    const slot = made.json().slot as { id: string };
    // Three of them taken.
    const stored = (await container.store.slots.get(slot.id))!;
    stored.capacityRemaining = 7;
    await container.store.slots.put(stored);

    const shrink = await app.inject({
      method: "PATCH", url: `/v1/admin/slots/${slot.id}`, headers: bearer(admin),
      payload: JSON.stringify({ capacityTotal: 2 }),
    });
    expect(shrink.statusCode).toBe(409);

    const grow = await app.inject({
      method: "PATCH", url: `/v1/admin/slots/${slot.id}`, headers: bearer(admin),
      payload: JSON.stringify({ capacityTotal: 20 }),
    });
    expect(grow.statusCode).toBe(200);
    // What was booked survives the change rather than being reset.
    expect((await container.store.slots.get(slot.id))!.capacityRemaining).toBe(17);
  });

  it("is refused by a supervisor for a society that is not theirs", async () => {
    const supervisor = await loginSupervisor(app);
    const other = (await container.store.societies.all()).find((s) => s.id !== "soc-demo");
    if (!other) return;
    const res = await app.inject({
      method: "POST", url: "/v1/supervisor/slots", headers: bearer(supervisor),
      payload: JSON.stringify({ societyId: other.id, date: soon(9), window: "Morning", capacityTotal: 5 }),
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});

describe("what a resident is offered", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];

  beforeEach(async () => { ({ app, container } = await makeTestApp()); });

  it("shows a slot an admin has just created, with its remaining capacity", async () => {
    const admin = await loginAdmin(app);
    const date = soon(10);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
      payload: JSON.stringify({ societyId: "soc-demo", date, window: "Evening", capacityTotal: 15 }),
    });
    expect(made.statusCode).toBe(201);

    const resident = await loginResident(app);
    const seen = await app.inject({ method: "GET", url: `/v1/slots?date=${date}`, headers: bearer(resident) });
    expect(seen.statusCode).toBe(200);
    const slots = seen.json().slots as Array<{ window: string; availableCount?: number; capacityRemaining?: number }>;
    const evening = slots.find((s) => s.window === "Evening");
    expect(evening).toBeTruthy();
    expect(evening!.availableCount ?? evening!.capacityRemaining).toBe(15);
  });

  it("does not offer another society's slots", async () => {
    const other = (await container.store.societies.all()).find((s) => s.id !== "soc-demo");
    if (!other) return;
    const admin = await loginAdmin(app);
    const date = soon(11);
    await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
      payload: JSON.stringify({ societyId: other.id, date, window: "Morning", capacityTotal: 9 }),
    });
    const resident = await loginResident(app);
    const seen = await app.inject({ method: "GET", url: `/v1/slots?date=${date}`, headers: bearer(resident) });
    // Their own society has nothing that day; the other society's slot is not theirs.
    expect((seen.json().slots as unknown[]).length).toBe(0);
  });

  it("reads as full once its capacity is gone", async () => {
    const admin = await loginAdmin(app);
    const date = soon(12);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
      payload: JSON.stringify({ societyId: "soc-demo", date, window: "Morning", capacityTotal: 1 }),
    });
    const slot = made.json().slot as { id: string };
    const stored = (await container.store.slots.get(slot.id))!;
    stored.capacityRemaining = 0;
    await container.store.slots.put(stored);

    const resident = await loginResident(app);
    const seen = await app.inject({ method: "GET", url: `/v1/slots?date=${date}`, headers: bearer(resident) });
    const slots = seen.json().slots as Array<{ window: string; full?: boolean; availableCount?: number }>;
    const morning = slots.find((s) => s.window === "Morning");
    if (morning) {
      expect(morning.full ?? morning.availableCount === 0).toBeTruthy();
    } else {
      // A full slot may be filtered out entirely, which is also "not bookable".
      expect(slots.every((s) => s.window !== "Morning")).toBe(true);
    }
  });
});
