import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor } from "./helpers";

// ST1-I113. How many bookings a slot holds was `positive()` and nothing else, on all
// four routes that create or edit one, so Supervisor → Slots and Admin → Slots took
// a capacity of one — an appointment, not a slot — and a capacity of nine thousand,
// which is a typo residents can book into and nobody can service.
//
// Two to thirty, whole numbers, and a refusal that names the field and says what is
// wrong with it rather than zod's "Number must be greater than 0".

function soon(days = 3): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

describe("how large a slot may be", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let admin: string;
  let supervisor: string;

  beforeEach(async () => {
    ({ app } = await makeTestApp());
    admin = await loginAdmin(app);
    supervisor = await loginSupervisor(app);
  });

  // The four routes that decide a capacity. A rule enforced on three of them is not
  // a rule: whichever one is left is the one the number arrives through.
  const routes = () => [
    {
      name: "admin laundry slot",
      create: (capacity: unknown, date: string) => app.inject({
        method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
        payload: JSON.stringify({ societyId: "soc-demo", date, window: "Morning", capacityTotal: capacity }),
      }),
      field: "capacityTotal",
    },
    {
      name: "supervisor laundry slot",
      create: (capacity: unknown, date: string) => app.inject({
        method: "POST", url: "/v1/supervisor/slots", headers: bearer(supervisor),
        payload: JSON.stringify({ societyId: "soc-demo", date, window: "Afternoon", capacityTotal: capacity }),
      }),
      field: "capacityTotal",
    },
    {
      name: "admin additional-service slot",
      create: (capacity: unknown, date: string) => app.inject({
        method: "POST", url: "/v1/admin/service-slots", headers: bearer(admin),
        payload: JSON.stringify({ societyId: "soc-demo", date, offeringId: "wash-car", window: "Morning", capacity }),
      }),
      field: "capacity",
    },
    {
      name: "supervisor additional-service slot",
      create: (capacity: unknown, date: string) => app.inject({
        method: "POST", url: "/v1/supervisor/service-slots", headers: bearer(supervisor),
        payload: JSON.stringify({ societyId: "soc-demo", date, offeringId: "wash-bike", window: "Evening", capacity }),
      }),
      field: "capacity",
    },
  ];

  it("refuses one, and says the smallest a slot may be", async () => {
    for (const route of routes()) {
      const response = await route.create(1, soon(3));
      expect(response.statusCode, route.name).toBe(400);
      expect(response.json().message, route.name).toBe("Capacity must be at least 2.");
      expect(response.json().details.fieldErrors[route.field], route.name).toContain("Capacity must be at least 2.");
    }
  });

  it("refuses thirty-one, and says the largest a slot may be", async () => {
    for (const route of routes()) {
      const response = await route.create(31, soon(4));
      expect(response.statusCode, route.name).toBe(400);
      expect(response.json().message, route.name).toBe("Capacity cannot exceed 30.");
    }
  });

  it("refuses a fraction of a booking", async () => {
    for (const route of routes()) {
      const response = await route.create(2.5, soon(5));
      expect(response.statusCode, route.name).toBe(400);
      expect(response.json().message, route.name).toBe("Capacity must be a whole number.");
    }
  });

  it("refuses nothing, no number at all, and a negative one", async () => {
    for (const route of routes()) {
      for (const [capacity, expected] of [
        [0, "Capacity must be at least 2."],
        [-5, "Capacity must be at least 2."],
        ["abc", "Enter a valid capacity."],
        [undefined, "Capacity is required."],
      ] as const) {
        const response = await route.create(capacity, soon(6));
        expect(response.statusCode, `${route.name} ${String(capacity)}`).toBe(400);
        expect(response.json().message, `${route.name} ${String(capacity)}`).toBe(expected);
      }
    }
  });

  it("accepts both ends of the range", async () => {
    for (const [index, route] of routes().entries()) {
      // A day each, because one society holds one slot per window per day.
      expect((await route.create(2, soon(10 + index))).statusCode, route.name).toBe(201);
      expect((await route.create(30, soon(20 + index))).statusCode, route.name).toBe(201);
    }
  });

  it("holds when a slot is edited, not only when it is created", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
      payload: JSON.stringify({ societyId: "soc-demo", date: soon(7), window: "Evening", capacityTotal: 10 }),
    });
    const id = created.json().slot.id as string;

    for (const url of [`/v1/admin/slots/${id}`, `/v1/supervisor/slots/${id}`]) {
      const token = url.startsWith("/v1/admin") ? admin : supervisor;
      const tooSmall = await app.inject({ method: "PATCH", url, headers: bearer(token), payload: JSON.stringify({ capacityTotal: 1 }) });
      expect(tooSmall.statusCode, url).toBe(400);
      expect(tooSmall.json().message, url).toBe("Capacity must be at least 2.");

      const tooLarge = await app.inject({ method: "PATCH", url, headers: bearer(token), payload: JSON.stringify({ capacityTotal: 40 }) });
      expect(tooLarge.statusCode, url).toBe(400);
      expect(tooLarge.json().message, url).toBe("Capacity cannot exceed 30.");

      const fine = await app.inject({ method: "PATCH", url, headers: bearer(token), payload: JSON.stringify({ capacityTotal: 12 }) });
      expect(fine.statusCode, url).toBe(200);
    }
  });
});
