import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, loginResident, staffBody } from "./helpers";

// ST1-I104. The complaint under the two issues beside it: a rejected form came back
// as `{ "error": "invalid_request" }` and nothing else, so the person filling it in
// was told the request was invalid and never which of fourteen boxes to go back to.
//
// `humanMessage` in both clients reads `message` first and `details.fieldErrors`
// second, and neither was being sent by most routes. So the shape of a refusal is
// what is tested here — a sentence, and the field it belongs to — as well as the
// particular rules the issue lists.

describe("what a refused form is told", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let admin: string;

  beforeEach(async () => {
    ({ app } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  it("carries a sentence and a field on every refusal, not a bare code", async () => {
    // One write route from each portal, given a body that is wrong in a way the
    // schema can see. Before this they answered `invalid_request` and stopped.
    const refusals = [
      { name: "admin society", method: "POST", url: "/v1/admin/societies", token: admin, body: { name: "X", address: {} } },
      { name: "admin tower", method: "POST", url: "/v1/admin/societies/soc-demo/blocks", token: admin, body: { name: "D", floorCount: 2.5 } },
      { name: "admin slot", method: "POST", url: "/v1/admin/slots", token: admin, body: { societyId: "soc-demo", date: "2099-01-01", window: "Midnight", capacityTotal: 5 } },
      { name: "admin user status", method: "PATCH", url: "/v1/admin/users/user-op/status", token: admin, body: { status: "sleeping" } },
      { name: "admin charge", method: "POST", url: "/v1/admin/charges", token: admin, body: { name: "Express", chargingType: "per_fortnight", amountPaise: 500 } },
      { name: "admin config", method: "PATCH", url: "/v1/admin/config", token: admin, body: { gstRatePercent: 120 } },
    ] as const;

    for (const refusal of refusals) {
      const response = await app.inject({
        method: refusal.method, url: refusal.url, headers: bearer(refusal.token),
        payload: JSON.stringify(refusal.body),
      });
      expect(response.statusCode, refusal.name).toBe(400);
      const body = response.json();
      expect(body.error, refusal.name).toBe("invalid_request");
      // A sentence a person can act on, not the machine code repeated.
      expect(typeof body.message, refusal.name).toBe("string");
      expect(body.message, refusal.name).not.toBe(body.error);
      expect(body.message, refusal.name).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
      // And the box it belongs to, for a form that highlights one.
      expect(Object.keys(body.details.fieldErrors), refusal.name).not.toHaveLength(0);
    }
  });

  it("names a bad email address and a bad mobile number", async () => {
    const badEmail = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(admin),
      payload: JSON.stringify({ firstName: "Asha", lastName: "Rao", phone: "9876500077", email: "asha@deepthi@gmail.com", societyId: "soc-demo" }),
    });
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json().message).toBe("Enter a valid email address.");
    expect(badEmail.json().details.fieldErrors.email).toContain("Enter a valid email address.");

    for (const phone of ["12345", "1234567890", "98765abcde"]) {
      const badPhone = await app.inject({
        method: "POST", url: "/v1/admin/supervisors", headers: bearer(admin),
        payload: staffBody({ firstName: "Asha", lastName: "Rao", phone, societyId: "soc-demo" } as never),
      });
      expect(badPhone.statusCode, phone).toBe(400);
      expect(badPhone.json().message, phone).toBe("Enter a valid 10-digit mobile number.");
    }
  });

  it("names a required field that was left out", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(admin),
      payload: JSON.stringify({ lastName: "Rao", phone: "9876500078", societyId: "soc-demo" }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("A first name is required.");
    expect(response.json().details.fieldErrors.firstName).toContain("A first name is required.");
  });

  it("names a dropdown nobody chose from", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
      payload: JSON.stringify({ date: "2099-01-01", window: "Morning", capacityTotal: 5 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Choose a society.");
  });

  it("names a count that is not a whole number", async () => {
    // The example in the client's own comment: "Floor count: must be a whole number".
    const response = await app.inject({
      method: "POST", url: "/v1/admin/societies/soc-demo/blocks", headers: bearer(admin),
      payload: JSON.stringify({ name: "D", floorCount: 2.5 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Floor count must be a whole number.");
    expect(response.json().details.fieldErrors.floorCount).toContain("Floor count must be a whole number.");
  });

  it("names a quantity a resident cannot have ordered", async () => {
    const resident = await loginResident(app);
    for (const [quantity, expected] of [
      [0, "Quantity must be at least 1."],
      [-2, "Quantity must be at least 1."],
      [1.5, "Quantity must be a whole number."],
      ["two", "Enter a valid quantity."],
    ] as const) {
      const response = await app.inject({
        method: "POST", url: "/v1/pickups", headers: bearer(resident),
        payload: JSON.stringify({ slotId: "slot-demo-1", lines: [{ category: "Shirts", quantity, serviceId: "wash_iron" }] }),
      });
      expect(response.statusCode, String(quantity)).toBe(400);
      expect(response.json().message, String(quantity)).toBe(expected);
    }
  });

  it("names a date that is not a date", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
      payload: JSON.stringify({ societyId: "soc-demo", date: "31-12-2099", window: "Morning", capacityTotal: 5 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Enter a valid date in YYYY-MM-DD form.");

    // Well-formed but not a day anybody has.
    const impossible = await app.inject({
      method: "POST", url: "/v1/admin/slots", headers: bearer(admin),
      payload: JSON.stringify({ societyId: "soc-demo", date: "2099-02-31", window: "Morning", capacityTotal: 5 }),
    });
    expect(impossible.statusCode).toBe(400);
    expect(impossible.json().message).toBe("Enter a real date.");
  });

  it("refuses a working day that ends before it starts", async () => {
    const response = await app.inject({
      method: "PATCH", url: "/v1/admin/config", headers: bearer(admin),
      payload: JSON.stringify({
        workingHours: {
          mon: { enabled: true, start: "18:00", end: "09:00" },
          tue: { enabled: true, start: "09:00", end: "18:00" },
          wed: { enabled: true, start: "09:00", end: "18:00" },
          thu: { enabled: true, start: "09:00", end: "18:00" },
          fri: { enabled: true, start: "09:00", end: "18:00" },
          sat: { enabled: true, start: "09:00", end: "18:00" },
          sun: { enabled: false, start: "09:00", end: "18:00" },
        },
      }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("A working day must start before it ends.");
  });

  it("names a GST rate outside the range a rate can be", async () => {
    for (const [rate, expected] of [
      [120, "GST rate cannot exceed 50%."],
      [-1, "GST rate cannot be negative."],
      ["eighteen", "Enter a valid gst rate."],
    ] as const) {
      const response = await app.inject({
        method: "PATCH", url: "/v1/admin/config", headers: bearer(admin),
        payload: JSON.stringify({ gstRatePercent: rate }),
      });
      expect(response.statusCode, String(rate)).toBe(400);
      expect(response.json().message, String(rate)).toBe(expected);
    }
  });

  it("says what is already taken, rather than which field is malformed", async () => {
    // Uniqueness is not something a schema can see, so these are 409s from the
    // service — but the sentence still has to be one a person can act on.
    const first = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(admin),
      payload: staffBody({ firstName: "Asha", lastName: "Rao", phone: "9876500079", societyId: "soc-aparna" } as never),
    });
    expect(first.statusCode, first.payload).toBe(201);

    const samePhone = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(admin),
      payload: staffBody({ firstName: "Bala", lastName: "Rao", phone: "9876500079", societyId: "soc-lakeview" } as never),
    });
    expect(samePhone.statusCode).toBe(409);
    expect(samePhone.json().message).toMatch(/already registered/i);

    const sameEmail = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(admin),
      payload: JSON.stringify({ firstName: "Bala", lastName: "Rao", phone: "9876500080", societyId: "soc-lakeview", email: "asha.rao.9876500079@washnpress.example" }),
    });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json().message).toMatch(/already registered/i);

    const society = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(admin),
      payload: JSON.stringify({ name: "My Home Bhooja", address: { house: "1", street: "Main Road", locality: "Madhapur", city: "Hyderabad", state: "Telangana", pincode: "500081" }, blocks: [{ name: "A" }] }),
    });
    expect(society.statusCode, society.payload).toBe(409);
    expect(society.json().message).toMatch(/already has a society called/i);
  });

  it("is the same answer from the supervisor portal as from the admin one", async () => {
    // The two portals share these forms, and the rule was written twice, so one of
    // them was always the one that drifted.
    const supervisor = await loginSupervisor(app);
    const response = await app.inject({
      method: "POST", url: "/v1/supervisor/societies/soc-demo/blocks", headers: bearer(supervisor),
      payload: JSON.stringify({ name: "D", flatCount: 0 }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Flat count must be at least 1.");
  });
});
