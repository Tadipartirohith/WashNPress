import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor } from "./helpers";

// ST1-I100. Creating a slot for an additional service from the Supervisor Portal.
//
// The original "Something went wrong. The problem has been logged." was the Postgres
// store writing to a table that was never in DOC_TABLES; that is fixed, and
// `schemaDrift` keeps it fixed. What was left is everything the issue asks for around
// it: the same slot cannot be created twice, not even by two requests that arrive
// together, a day that has gone cannot be scheduled, and a service that is not on
// offer cannot be slotted.
//
// Both routes, because a rule enforced on one of them is not a rule.

function soon(days = 3): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

// A store that takes a moment to answer, which every real one does.
//
// The duplicate check reads and then writes, and the gap between the two is however
// long the store takes to answer. The in-memory store answers within the same tick,
// so two requests against it happen to queue themselves and the race never shows;
// Postgres takes a network round trip, and that is where the second slot is created.
// Delaying the read here is what makes the test see what the deployed store sees.
function slowReads<T>(collection: { find(predicate: (row: T) => boolean): Promise<T[]> }): void {
  const original = collection.find.bind(collection);
  collection.find = async (predicate: (row: T) => boolean) => {
    const rows = await original(predicate);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return rows;
  };
}

describe("creating an additional-service slot", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let admin: string;
  let supervisor: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    admin = await loginAdmin(app);
    supervisor = await loginSupervisor(app);
  });

  const post = (token: string, url: string, body: Record<string, unknown>) => app.inject({
    method: "POST", url, headers: bearer(token), payload: JSON.stringify(body),
  });

  const both = () => [
    { name: "supervisor", token: supervisor, url: "/v1/supervisor/service-slots" },
    { name: "admin", token: admin, url: "/v1/admin/service-slots" },
  ];

  it("creates the slot the Supervisor Portal asks for", async () => {
    const created = await post(supervisor, "/v1/supervisor/service-slots", {
      societyId: "soc-demo", date: soon(3), offeringId: "wash-car", window: "Morning", capacity: 6,
    });
    expect(created.statusCode).toBe(201);
    const slot = created.json().slot;
    expect(slot.offeringId).toBe("wash-car");
    // The name is resolved from the offering rather than taken from the body, so the
    // list the supervisor lands back on can be read without a second lookup.
    expect(slot.offeringName).toBe("Car wash");
    expect(slot.capacityRemaining).toBe(6);
  });

  it("refuses the same society, date, service and window twice", async () => {
    for (const [index, route] of both().entries()) {
      const body = { societyId: "soc-demo", date: soon(4 + index), offeringId: "wash-car", window: "Morning", capacity: 5 };
      expect((await post(route.token, route.url, body)).statusCode, route.name).toBe(201);

      const again = await post(route.token, route.url, body);
      expect(again.statusCode, route.name).toBe(409);
      expect(again.json().error, route.name).toBe("slot_exists");
      expect(again.json().message, route.name).toBe("A slot already exists for this service on this date and time.");
    }
  });

  it("creates one slot, not two, when the same request arrives twice at once", async () => {
    // The double tap. Both requests read a store with no such slot in it before
    // either has written one, so the duplicate rule saw nothing to refuse and the
    // society ended up with the same car wash offered twice in one window.
    slowReads(container.store.additionalServiceSlots);
    const body = { societyId: "soc-demo", date: soon(8), offeringId: "wash-car", window: "Afternoon", capacity: 5 };
    const [first, second] = await Promise.all([
      post(supervisor, "/v1/supervisor/service-slots", body),
      post(supervisor, "/v1/supervisor/service-slots", body),
    ]);

    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const stored = await container.scheduling.listServiceSlots({ societyId: "soc-demo", date: body.date, offeringId: "wash-car" });
    expect(stored.filter((s) => s.window === "Afternoon")).toHaveLength(1);
  });

  it("creates one laundry slot, not two, when the same request arrives twice at once", async () => {
    // The same hole, on the route beside it.
    slowReads(container.store.slots);
    const body = { societyId: "soc-demo", date: soon(9), window: "Morning", capacityTotal: 8 };
    const [first, second] = await Promise.all([
      post(supervisor, "/v1/supervisor/slots", body),
      post(supervisor, "/v1/supervisor/slots", body),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    const stored = await container.store.slots.find((s) => s.societyId === "soc-demo" && s.date === body.date && s.window === "Morning");
    expect(stored).toHaveLength(1);
  });

  it("leaves the window free for another service, and for another day", async () => {
    const date = soon(10);
    expect((await post(supervisor, "/v1/supervisor/service-slots", { societyId: "soc-demo", date, offeringId: "wash-car", window: "Morning", capacity: 5 })).statusCode).toBe(201);
    expect((await post(supervisor, "/v1/supervisor/service-slots", { societyId: "soc-demo", date, offeringId: "wash-bike", window: "Morning", capacity: 5 })).statusCode).toBe(201);
    expect((await post(supervisor, "/v1/supervisor/service-slots", { societyId: "soc-demo", date: soon(11), offeringId: "wash-car", window: "Morning", capacity: 5 })).statusCode).toBe(201);
  });

  it("refuses a day that has already gone", async () => {
    for (const route of both()) {
      const response = await post(route.token, route.url, {
        societyId: "soc-demo", date: "2020-01-01", offeringId: "wash-car", window: "Morning", capacity: 5,
      });
      expect(response.statusCode, route.name).toBe(400);
      expect(response.json().error, route.name).toBe("slot_in_past");
    }
  });

  it("refuses a date that is not a date", async () => {
    // Accepted before, and stored: `isPastSlot` compares "tomorrow" to today's date
    // as a string and finds it in the future, so the slot was created on a day no
    // calendar has and no resident could ever book.
    for (const route of both()) {
      const response = await post(route.token, route.url, {
        societyId: "soc-demo", date: "tomorrow", offeringId: "wash-car", window: "Morning", capacity: 5,
      });
      expect(response.statusCode, route.name).toBe(400);
      expect(response.json().message, route.name).toBe("Enter a valid date in YYYY-MM-DD form.");
    }
    expect(await container.scheduling.listServiceSlots({ date: "tomorrow" })).toHaveLength(0);
  });

  it("refuses a service that does not exist, and one that has been switched off", async () => {
    const offering = (await container.store.offerings.get("wash-car"))!;
    await container.store.offerings.put({ ...offering, isActive: false });

    for (const route of both()) {
      const gone = await post(route.token, route.url, {
        societyId: "soc-demo", date: soon(12), offeringId: "no-such-service", window: "Morning", capacity: 5,
      });
      expect(gone.statusCode, route.name).toBe(400);
      expect(gone.json().error, route.name).toBe("unknown_service");

      const off = await post(route.token, route.url, {
        societyId: "soc-demo", date: soon(12), offeringId: "wash-car", window: "Morning", capacity: 5,
      });
      expect(off.statusCode, route.name).toBe(400);
      expect(off.json().error, route.name).toBe("unknown_service");
    }
  });

  it("refuses a society the supervisor does not hold", async () => {
    const response = await post(supervisor, "/v1/supervisor/service-slots", {
      societyId: "soc-gachibowli", date: soon(13), offeringId: "wash-car", window: "Morning", capacity: 5,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("forbidden_scope");
  });

  it("names the field that is missing rather than answering invalid_request and nothing else", async () => {
    const response = await post(supervisor, "/v1/supervisor/service-slots", {
      societyId: "soc-demo", date: soon(14), window: "Morning", capacity: 5,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Choose an additional service.");
    expect(response.json().details.fieldErrors.offeringId).toContain("Choose an additional service.");
  });
});
