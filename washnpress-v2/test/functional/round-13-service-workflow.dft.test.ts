import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginResident, loginAdmin, loginOperator } from "./helpers";

// The two halves of the service workflow the round asks for and the platform did
// not have: an operator cannot be given two jobs at the same hour, and a resident
// who cannot make Tuesday can move the booking instead of throwing it away.

const DAY = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const at = (time: string) => `${DAY}T${time}:00.000Z`;

describe("an operator is not given two jobs at once", () => {
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
      timeSlots: [
        { startTime: "10:00", endTime: "11:00", capacity: 5, subscriberAvailable: true, nonSubscriberAvailable: true },
        { startTime: "14:00", endTime: "15:00", capacity: 5, subscriberAvailable: true, nonSubscriberAvailable: true },
      ],
    } as never);
  });

  const book = (time: string) => app.inject({
    method: "POST", url: "/v1/services/requests", headers: bearer(resident),
    payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at(time) }),
  });

  const assign = (id: string, staffUserId = "user-op") => app.inject({
    method: "POST", url: `/v1/operations/services/${id}/assign`, headers: bearer(admin),
    payload: JSON.stringify({ staffUserId }),
  });

  it("gives an operator a job when the hour is free", async () => {
    const one = await book("10:00");
    expect((await assign(one.json().request.id)).statusCode).toBe(200);
  });

  it("refuses the second job at the same hour", async () => {
    const one = await book("10:00");
    const two = await book("10:00");
    await assign(one.json().request.id);
    const clash = await assign(two.json().request.id);
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe("operator_busy");
  });

  it("names what is in the way rather than only refusing", async () => {
    // A supervisor's next move is another operator or another time, and neither is
    // possible from a bare refusal.
    const one = await book("10:00");
    const two = await book("10:00");
    await assign(one.json().request.id);
    const clash = await assign(two.json().request.id);
    expect(clash.json().clashes).toHaveLength(1);
    expect(clash.json().clashes[0]).toMatchObject({ kind: "service", label: "Car wash" });
  });

  it("leaves the refused booking in the queue for somebody to act on", async () => {
    const one = await book("10:00");
    const two = await book("10:00");
    await assign(one.json().request.id);
    await assign(two.json().request.id);
    const still = (await container.store.serviceRequests.get(two.json().request.id))!;
    expect(still.status).toBe("requested");
    expect(still.assignedToUserId).toBeNull();
  });

  it("gives the same operator a job at a different hour", async () => {
    const morning = await book("10:00");
    const afternoon = await book("14:00");
    await assign(morning.json().request.id);
    expect((await assign(afternoon.json().request.id)).statusCode).toBe(200);
  });

  it("gives the clashing job to a different operator", async () => {
    const one = await book("10:00");
    const two = await book("10:00");
    await assign(one.json().request.id, "user-op");
    expect((await assign(two.json().request.id, "user-op-2")).statusCode).toBe(200);
  });

  it("stops counting a job that was cancelled", async () => {
    const one = await book("10:00");
    const two = await book("10:00");
    await assign(one.json().request.id);
    await app.inject({
      method: "POST", url: `/v1/services/requests/${one.json().request.id}/cancel`,
      headers: bearer(resident), payload: JSON.stringify({ reason: "Not needed" }),
    });
    expect((await assign(two.json().request.id)).statusCode).toBe(200);
  });

  it("does not count the booking being assigned against itself", async () => {
    // A job already assigned cannot be assigned again — that is the state machine,
    // not the workload check — but the refusal must be about the transition. If the
    // booking counted as a clash with itself, the reason would be wrong and every
    // reassignment after a hand-back would be refused for the same bad reason.
    const one = await book("10:00");
    await assign(one.json().request.id);
    const again = await assign(one.json().request.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("illegal_transition");
  });

  it("gives a handed-back job to the same operator again", async () => {
    // The path that would break if a booking clashed with itself: it goes back to
    // the queue and the same operator, who is otherwise free, takes it again.
    const one = await book("10:00");
    await assign(one.json().request.id);
    const held = (await container.store.serviceRequests.get(one.json().request.id))!;
    await container.store.serviceRequests.put({ ...held, status: "requested", assignedToUserId: null });
    expect((await assign(one.json().request.id)).statusCode).toBe(200);
  });
});

describe("narrowing the bookings list to a person and a span of days", () => {
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
      timeSlots: [
        { startTime: "10:00", endTime: "11:00", capacity: 5, subscriberAvailable: true, nonSubscriberAvailable: true },
        { startTime: "14:00", endTime: "15:00", capacity: 5, subscriberAvailable: true, nonSubscriberAvailable: true },
      ],
    } as never);
  });

  const list = (query: string) => app.inject({
    method: "GET", url: `/v1/admin/service-requests${query}`, headers: bearer(admin),
  });

  async function twoBookings() {
    const mine = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(resident),
      payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at("10:00") }),
    });
    const other = await app.inject({
      method: "POST", url: "/v1/services/requests", headers: bearer(resident),
      payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at("14:00") }),
    });
    await app.inject({
      method: "POST", url: `/v1/operations/services/${mine.json().request.id}/assign`,
      headers: bearer(admin), payload: JSON.stringify({ staffUserId: "user-op" }),
    });
    return { assigned: mine.json().request.id as string, waiting: other.json().request.id as string };
  }

  it("offers the operators a booking could be narrowed to", async () => {
    // Built from the operators who exist rather than from the rows on this page,
    // which would offer a different list on every page.
    const names = (await list("")).json().operators.map((o: { name: string }) => o.name);
    expect(names).toContain("Operator 01");
  });

  it("narrows to one operator's work", async () => {
    const { assigned, waiting } = await twoBookings();
    const ids = (await list("?operatorUserId=user-op")).json().requests.map((r: { id: string }) => r.id);
    expect(ids).toContain(assigned);
    expect(ids).not.toContain(waiting);
  });

  it("finds the bookings nobody is holding", async () => {
    // The ones that most need somebody to act, and the ones invisible under every
    // named operator.
    const { assigned, waiting } = await twoBookings();
    const ids = (await list("?operatorUserId=unassigned")).json().requests.map((r: { id: string }) => r.id);
    expect(ids).toContain(waiting);
    expect(ids).not.toContain(assigned);
  });

  it("narrows to a span of days", async () => {
    const { assigned } = await twoBookings();
    const onDay = (await list(`?from=${DAY}&to=${DAY}`)).json().requests.map((r: { id: string }) => r.id);
    expect(onDay).toContain(assigned);

    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const before = (await list(`?from=${yesterday}&to=${yesterday}`)).json().requests;
    expect(before).toEqual([]);
  });

  it("narrows by operator and days together", async () => {
    const { assigned, waiting } = await twoBookings();
    const ids = (await list(`?operatorUserId=user-op&from=${DAY}&to=${DAY}`)).json().requests.map((r: { id: string }) => r.id);
    expect(ids).toEqual([assigned]);
    expect(ids).not.toContain(waiting);
  });
});

describe("moving a service booking instead of giving it up", () => {
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
      timeSlots: [
        { startTime: "10:00", endTime: "11:00", capacity: 1, subscriberAvailable: true, nonSubscriberAvailable: true },
        { startTime: "14:00", endTime: "15:00", capacity: 2, subscriberAvailable: true, nonSubscriberAvailable: true },
      ],
    } as never);
  });

  const book = (time: string) => app.inject({
    method: "POST", url: "/v1/services/requests", headers: bearer(resident),
    payload: JSON.stringify({ offeringId: "wash-car", vehicleType: "Car", scheduledFor: at(time) }),
  });

  const move = (id: string, time: string) => app.inject({
    method: "POST", url: `/v1/services/requests/${id}/reschedule`, headers: bearer(resident),
    payload: JSON.stringify({ scheduledFor: at(time) }),
  });

  it("moves it to another window", async () => {
    const made = await book("10:00");
    const moved = await move(made.json().request.id, "14:00");
    expect(moved.statusCode).toBe(200);
    expect((await container.store.serviceRequests.get(made.json().request.id))!.scheduledFor).toBe(at("14:00"));
  });

  it("keeps the booking rather than replacing it", async () => {
    const made = await book("10:00");
    await move(made.json().request.id, "14:00");
    expect(await container.store.serviceRequests.all()).toHaveLength(1);
  });

  it("keeps where it was, so the history is not deleted when the booking changes", async () => {
    const made = await book("10:00");
    await move(made.json().request.id, "14:00");
    const timeline = (await container.store.serviceRequests.get(made.json().request.id))!.timeline;
    expect(timeline.some((entry) => entry.note?.includes(at("10:00")) && entry.note?.includes(at("14:00")))).toBe(true);
  });

  it("gives the old window back to somebody else", async () => {
    const made = await book("10:00");
    // The ten o'clock window holds one. While it is occupied nobody else fits.
    expect((await book("10:00")).statusCode).toBe(409);
    await move(made.json().request.id, "14:00");
    expect((await book("10:00")).statusCode).toBe(201);
  });

  it("refuses to move it into a window that is full", async () => {
    const made = await book("14:00");
    await book("14:00");
    // Both afternoon spaces are gone, so the morning booking has nowhere to go.
    const other = await book("10:00");
    const moved = await move(other.json().request.id, "14:00");
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error).toBe("slot_full");
    expect((await container.store.serviceRequests.get(other.json().request.id))!.scheduledFor).toBe(at("10:00"));
    expect(made.statusCode).toBe(201);
  });

  it("refuses a time the service does not run at all", async () => {
    const made = await book("10:00");
    const moved = await move(made.json().request.id, "03:00");
    expect(moved.statusCode).toBe(409);
    expect(moved.json().reason).toBe("no_such_window");
  });

  it("will not move somebody else's booking", async () => {
    const made = await book("10:00");
    const operator = await loginOperator(app);
    const moved = await app.inject({
      method: "POST", url: `/v1/services/requests/${made.json().request.id}/reschedule`,
      headers: bearer(operator), payload: JSON.stringify({ scheduledFor: at("14:00") }),
    });
    expect([401, 403]).toContain(moved.statusCode);
  });

  it("will not move a booking that has already been cancelled", async () => {
    const made = await book("10:00");
    await app.inject({
      method: "POST", url: `/v1/services/requests/${made.json().request.id}/cancel`,
      headers: bearer(resident), payload: JSON.stringify({ reason: "Changed my mind" }),
    });
    expect((await move(made.json().request.id, "14:00")).statusCode).toBe(409);
  });

  it("hands it back to the queue when its operator is not free at the new hour", async () => {
    // The operator holds the afternoon already, so a booking moved into the
    // afternoon cannot stay with them. It goes back rather than quietly keeping an
    // operator who will not be there.
    const morning = await book("10:00");
    const afternoon = await book("14:00");
    await app.inject({
      method: "POST", url: `/v1/operations/services/${afternoon.json().request.id}/assign`,
      headers: bearer(admin), payload: JSON.stringify({ staffUserId: "user-op" }),
    });
    await app.inject({
      method: "POST", url: `/v1/operations/services/${morning.json().request.id}/assign`,
      headers: bearer(admin), payload: JSON.stringify({ staffUserId: "user-op" }),
    });

    await move(morning.json().request.id, "14:00");
    const moved = (await container.store.serviceRequests.get(morning.json().request.id))!;
    expect(moved.assignedToUserId).toBeNull();
    expect(moved.status).toBe("requested");
    expect(moved.timeline.some((e) => e.note?.includes("no longer free"))).toBe(true);
  });
});
