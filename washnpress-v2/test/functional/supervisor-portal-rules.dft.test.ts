import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginResident, loginSupervisor, loginOtherSupervisor, seedSlot } from "./helpers";

// The Supervisor Portal rules behind ST1-I144, ST1-I146 and ST1-I148: a pickup can be
// opened on its own, a slot cannot be created without a capacity or a society, a
// date range cannot end before it starts, and the Issues list can be narrowed to the
// tickets nobody has acted on yet.

function soon(days = 3): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

describe("DFT supervisor portal rules", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let supervisor: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    supervisor = await loginSupervisor(app);
  });

  const get = (token: string, url: string) => app.inject({ method: "GET", url, headers: bearer(token) });
  const post = (token: string, url: string, body: Record<string, unknown>) => app.inject({
    method: "POST", url, headers: bearer(token), payload: JSON.stringify(body),
  });

  describe("ST1-I144 pickup detail", () => {
    it("describes the pickup that was asked for, with everything the drawer shows", async () => {
      await seedSlot(container, "slot-i144", 5);
      const { pickup, order } = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-i144" });

      const response = await get(supervisor, `/v1/supervisor/pickups/${pickup.id}`);
      expect(response.statusCode).toBe(200);
      const detail = response.json().pickup;
      expect(detail.pickupId).toBe(pickup.id);
      expect(detail.orderId).toBe(order.id);
      expect(detail.orderCode).toBe(order.orderCode);
      expect(detail.residentName).toBeTruthy();
      expect(detail.societyName).toBeTruthy();
      expect(detail.blockName).toBeTruthy();
      expect(detail.unitNumber).toBeTruthy();
      expect(detail.scheduledDate).toBe("2099-01-01");
      expect(detail.slot).toBe("08:00 - 11:00");
      expect(detail.operatorName).toBeTruthy();
      expect(detail.pickupStatus).toBe("scheduled");
      expect(detail.collectedAt).toBeNull();
    });

    it("still answers once the pickup is collected, and says when", async () => {
      await seedSlot(container, "slot-i144-done", 5);
      const { pickup, order } = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-i144-done" });
      const collectedAt = "2099-01-01T04:15:00.000Z";
      const stored = (await container.store.orders.get(order.id))!;
      await container.store.orders.put({ ...stored, pickedUpAt: collectedAt });
      await container.store.pickups.put({ ...pickup, status: "completed" });

      const response = await get(supervisor, `/v1/supervisor/pickups/${pickup.id}`);
      expect(response.statusCode).toBe(200);
      expect(response.json().pickup.pickupStatus).toBe("completed");
      expect(response.json().pickup.collectedAt).toBe(collectedAt);
    });

    it("refuses a pickup that does not exist, and one in another society", async () => {
      expect((await get(supervisor, "/v1/supervisor/pickups/no-such-pickup")).statusCode).toBe(404);

      await seedSlot(container, "slot-i144-scope", 5);
      const { pickup } = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-i144-scope" });
      const other = await loginOtherSupervisor(app);
      const response = await get(other, `/v1/supervisor/pickups/${pickup.id}`);
      expect(response.statusCode).toBe(403);
    });
  });

  describe("ST1-I146 slots", () => {
    it("refuses an empty capacity on both kinds of slot, with no fallback to one", async () => {
      const routes = [
        { url: "/v1/supervisor/slots", body: (capacity: unknown) => ({ societyId: "soc-demo", date: soon(5), window: "Morning", capacityTotal: capacity }) },
        { url: "/v1/supervisor/service-slots", body: (capacity: unknown) => ({ societyId: "soc-demo", date: soon(5), offeringId: "wash-car", window: "Morning", capacity }) },
      ];
      for (const route of routes) {
        const missing = await post(supervisor, route.url, route.body(undefined));
        expect(missing.statusCode, route.url).toBe(400);
        expect(missing.json().message, route.url).toBe("Capacity is required.");

        for (const [capacity, message] of [
          ["", "Enter a valid capacity."],
          [null, "Enter a valid capacity."],
          [1, "Capacity must be at least 2."],
          [31, "Capacity cannot exceed 30."],
        ] as const) {
          const refused = await post(supervisor, route.url, route.body(capacity));
          expect(refused.statusCode, `${route.url} ${String(capacity)}`).toBe(400);
          expect(refused.json().message, `${route.url} ${String(capacity)}`).toBe(message);
        }
      }
      // Nothing was created by any of those, at capacity one or otherwise.
      expect(await container.store.slots.find((s) => s.societyId === "soc-demo" && s.date === soon(5))).toHaveLength(0);
      expect(await container.scheduling.listServiceSlots({ societyId: "soc-demo", date: soon(5) })).toHaveLength(0);
    });

    it("requires a society for an additional-service slot, as for a laundry slot", async () => {
      for (const societyId of [undefined, ""]) {
        const service = await post(supervisor, "/v1/supervisor/service-slots", { societyId, date: soon(6), offeringId: "wash-car", window: "Morning", capacity: 5 });
        expect(service.statusCode).toBe(400);
        expect(service.json().message).toBe("Society is required.");
        expect(service.json().details.fieldErrors.societyId).toContain("Society is required.");

        const laundry = await post(supervisor, "/v1/supervisor/slots", { societyId, date: soon(6), window: "Morning", capacityTotal: 5 });
        expect(laundry.statusCode).toBe(400);
        expect(laundry.json().message).toBe("Society is required.");
      }
      expect(await container.scheduling.listServiceSlots({ date: soon(6) })).toHaveLength(0);

      const fine = await post(supervisor, "/v1/supervisor/service-slots", { societyId: "soc-demo", date: soon(6), offeringId: "wash-car", window: "Morning", capacity: 5 });
      expect(fine.statusCode).toBe(201);
    });

    it("refuses a date range whose From is after its To", async () => {
      const backwards = await get(supervisor, `/v1/supervisor/slots?from=${soon(5)}&to=${soon(2)}`);
      expect(backwards.statusCode).toBe(400);
      expect(backwards.json().error).toBe("invalid_range");
      expect(backwards.json().message).toBe("From date must be on or before To date.");

      expect((await get(supervisor, `/v1/supervisor/slots?from=${soon(2)}&to=${soon(2)}`)).statusCode).toBe(200);
      expect((await get(supervisor, `/v1/supervisor/slots?from=${soon(2)}&to=${soon(5)}`)).statusCode).toBe(200);
    });
  });

  describe("ST1-I148 the Open issue filter", () => {
    it("lists only open tickets, and combines with priority", async () => {
      const resident = await loginResident(app);
      const raise = async (priority: string) => {
        const response = await post(resident, "/v1/support/tickets", { category: "delivery_issue", description: `I-148 ${priority}`, priority });
        expect(response.statusCode).toBe(201);
        return response.json().ticket.id as string;
      };
      const acted = await raise("normal");
      const waiting = await raise("high");
      const moved = await app.inject({
        method: "PATCH", url: `/v1/supervisor/issues/${acted}/status`, headers: bearer(supervisor),
        payload: JSON.stringify({ status: "in_progress" }),
      });
      expect(moved.statusCode).toBe(200);

      type Row = { id: string; status: string; priority: string };
      const all = (await get(supervisor, "/v1/supervisor/issues")).json().issues as Row[];
      const open = (await get(supervisor, "/v1/supervisor/issues?status=open")).json().issues as Row[];
      expect(open.every((i) => i.status === "open")).toBe(true);
      expect(open.map((i) => i.id)).toContain(waiting);
      expect(open.map((i) => i.id)).not.toContain(acted);
      // Narrowed, not fallen back to everything.
      expect(all.map((i) => i.id)).toContain(acted);
      expect(open.length).toBeLessThan(all.length);

      const openHigh = (await get(supervisor, "/v1/supervisor/issues?status=open&priority=high")).json().issues as Row[];
      expect(openHigh.every((i) => i.status === "open" && i.priority === "high")).toBe(true);
      expect(openHigh.map((i) => i.id)).toContain(waiting);

      const openNormal = (await get(supervisor, "/v1/supervisor/issues?status=open&priority=normal")).json().issues as Row[];
      expect(openNormal.map((i) => i.id)).not.toContain(waiting);
      expect(openNormal.map((i) => i.id)).not.toContain(acted);
    });
  });
});
