import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginResident, loginAdmin } from "./helpers";

// A service slot's capacity was a number the booking screen was shown and the
// booking itself never read.
//
// `availableStarts` works out what is left in each window and hands it to the app so
// a full slot can be drawn as full. `create` then validated the offering, the
// vehicle, the hours, the quantity, the booking rules and the plan — and wrote the
// request without ever looking at the slot. So the capacity held only for as long as
// everybody believed the screen: two residents confirming the last space both got
// it, a screen left open overnight could book a window that filled hours ago, and
// nothing in between the two would say so.
//
// Capacity is checked where the booking is made now, which is the only place it can
// be checked truthfully.

// Tomorrow, because the offering's own booking rules refuse a date far out and a
// slot in the past. The window times below are what the capacity is counted by.
const SLOT_DATE = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const at = (time: string) => `${SLOT_DATE}T${time}:00.000Z`;

describe("a service slot holds only as many as it has room for", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let resident: string;

  // One window, room for two. Small enough that the third booking is the test.
  async function anOfferingWithATwoPersonSlot(capacity = 2) {
    const offering = (await container.store.offerings.get("wash-car"))!;
    await container.store.offerings.put({
      ...offering,
      timeSlots: [{ startTime: "10:00", endTime: "11:00", capacity, subscriberAvailable: true, nonSubscriberAvailable: true }],
    } as never);
  }

  const book = (time = "10:00") => app.inject({
    method: "POST", url: "/v1/services/requests", headers: bearer(resident),
    payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at(time) }),
  });

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    resident = await loginResident(app);
    await anOfferingWithATwoPersonSlot();
  });

  it("takes bookings up to the capacity", async () => {
    expect((await book()).statusCode).toBe(201);
    expect((await book()).statusCode).toBe(201);
  });

  it("refuses the one after the last space is gone", async () => {
    await book();
    await book();
    const third = await book();
    expect(third.statusCode).toBe(409);
    expect(third.json().error).toBe("slot_full");
  });

  it("does not quietly write the booking it refused", async () => {
    await book();
    await book();
    await book();
    const held = await container.store.serviceRequests.find((r) => r.scheduledFor === at("10:00"));
    expect(held).toHaveLength(2);
  });

  it("gives the space back when a booking is cancelled", async () => {
    const first = await book();
    await book();
    await app.inject({
      method: "POST", url: `/v1/services/requests/${first.json().request.id}/cancel`,
      headers: bearer(resident), payload: JSON.stringify({ reason: "Car is not here" }),
    });
    expect((await book()).statusCode).toBe(201);
  });

  it("holds the line when two residents confirm the last space at the same moment", async () => {
    // The case the report names. Both requests are in flight before either has
    // written, which is what makes it a race rather than a queue.
    await book();
    const [a, b] = await Promise.all([book(), book()]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    expect(await container.store.serviceRequests.find((r) => r.scheduledFor === at("10:00"))).toHaveLength(2);
  });

  it("counts each window separately rather than the day as a whole", async () => {
    const offering = (await container.store.offerings.get("wash-car"))!;
    await container.store.offerings.put({
      ...offering,
      timeSlots: [
        { startTime: "10:00", endTime: "11:00", capacity: 1, subscriberAvailable: true, nonSubscriberAvailable: true },
        { startTime: "11:00", endTime: "12:00", capacity: 1, subscriberAvailable: true, nonSubscriberAvailable: true },
      ],
    } as never);
    expect((await book("10:00")).statusCode).toBe(201);
    expect((await book("10:00")).statusCode).toBe(409);
    expect((await book("11:00")).statusCode).toBe(201);
  });

  it("refuses a time that is not one of the service's windows at all", async () => {
    // Posting a time nobody was offered is the same overbooking by another route.
    expect((await book("03:00")).statusCode).toBe(409);
  });

  it("leaves a service that publishes no windows alone", async () => {
    // Not every service runs to a timetable. One with no slots configured is
    // unconstrained rather than unbookable, which is how it behaved before.
    const offering = (await container.store.offerings.get("wash-car"))!;
    await container.store.offerings.put({ ...offering, timeSlots: [] } as never);
    expect((await book("03:00")).statusCode).toBe(201);
  });

  it("tells the resident what is left, and says nothing is", async () => {
    const remaining = async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/services/slots?offeringId=wash-car&date=${SLOT_DATE}`,
        headers: bearer(resident),
      });
      return res.json().windows.find((w: { startTime: string }) => w.startTime === "10:00").capacityRemaining;
    };
    expect(await remaining()).toBe(2);
    await book();
    expect(await remaining()).toBe(1);
    await book();
    expect(await remaining()).toBe(0);
  });
});

describe("the slot a staff booking is put into", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let resident: string;
  let admin: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    resident = await loginResident(app);
    admin = await loginAdmin(app);
    const offering = (await container.store.offerings.get("wash-car"))!;
    await container.store.offerings.put({
      ...offering,
      timeSlots: [{ startTime: "10:00", endTime: "11:00", capacity: 1, subscriberAvailable: true, nonSubscriberAvailable: true }],
    } as never);
  });

  it("names the supervisor who answers for the society the booking is in", async () => {
    // An admin looking at a booking that has gone wrong needs a person to ask, and
    // the chain to one runs through the society: the operator may have been
    // reassigned twice, and an unassigned booking has none at all.
    const made = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(resident),
      payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at("10:00") }),
    });
    expect(made.statusCode).toBe(201);

    const listed = await app.inject({ method: "GET", url: "/v1/admin/service-requests", headers: bearer(admin) });
    const row = (listed.json().requests as { id: string; supervisorName: string | null }[])
      .find((r) => r.id === made.json().request.id)!;
    expect(row.supervisorName).toBe("Ravi Kumar");
  });

  it("says nothing rather than guessing when the society is between supervisors", async () => {
    const society = (await container.store.societies.get("soc-demo"))!;
    await container.store.societies.put({ ...society, supervisorUserId: null });
    const made = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(resident),
      payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at("10:00") }),
    });
    const listed = await app.inject({ method: "GET", url: "/v1/admin/service-requests", headers: bearer(admin) });
    const row = (listed.json().requests as { id: string; supervisorName: string | null }[])
      .find((r) => r.id === made.json().request.id)!;
    expect(row.supervisorName).toBeNull();
  });

  it("still shows the full booking to the admin once the slot is taken", async () => {
    // Filling a slot must not make the booking in it disappear from the operations
    // list — that list is how somebody finds out the slot is full.
    const made = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(resident),
      payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at("10:00") }),
    });
    expect(made.statusCode).toBe(201);

    const listed = await app.inject({
      method: "GET", url: "/v1/admin/service-requests", headers: bearer(admin),
    });
    expect(listed.statusCode).toBe(200);
    const ids = (listed.json().requests as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(made.json().request.id);
  });
});
