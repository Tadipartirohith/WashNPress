import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// Deactivating a society was refused for a reason that had nothing to do with it.
//
// An update validated the whole merged address whatever the patch contained, so a
// society stored before the address had six parts — a locality and a city and
// nothing else — could never be deactivated: the status patch came back 422 for a
// missing house, street and pincode it had not tried to set. From the Societies
// page it read as a dead button. The card kept saying Active, and the message
// explaining why was a form field the admin had not opened.
//
// An update is now held to the fields it actually carries. Setting an address is
// still held to all six, because that is the edit that can fix one.

describe("changing a society's status", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let admin: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  const patch = (id: string, body: Record<string, unknown>) => app.inject({
    method: "PATCH", url: `/v1/admin/societies/${id}`, headers: bearer(admin),
    payload: JSON.stringify(body),
  });

  // The shape the report was filed against: "Sainikpuri, Hyderabad, Telangana" on
  // the card, which is a locality, a city and a state and no house, street or
  // pincode.
  async function aSocietyWithAPartialAddress(id = "soc-partial") {
    const existing = (await container.store.societies.get("soc-demo"))!;
    await container.store.societies.put({
      ...existing,
      id,
      name: "Bhavani complex",
      status: "active",
      address: {
        house: "", street: "", locality: "Sainikpuri",
        city: "Hyderabad", state: "Telangana", pincode: "",
      },
    });
    return id;
  }

  it("deactivates a society whose stored address was never complete", async () => {
    const id = await aSocietyWithAPartialAddress();
    const res = await patch(id, { status: "inactive" });
    expect(res.statusCode).toBe(200);
    expect(res.json().society.status).toBe("inactive");
  });

  it("writes the status through to the record rather than only reporting it", async () => {
    const id = await aSocietyWithAPartialAddress();
    await patch(id, { status: "inactive" });
    expect((await container.store.societies.get(id))!.status).toBe("inactive");
  });

  it("brings the same society back, so the switch works in both directions", async () => {
    const id = await aSocietyWithAPartialAddress();
    await patch(id, { status: "inactive" });
    expect((await patch(id, { status: "active" })).statusCode).toBe(200);
    expect((await container.store.societies.get(id))!.status).toBe("active");
  });

  // Deactivating is not deleting. The fixture carries residents, blocks and a
  // supervisor allocation for soc-demo but no orders, so orders are the one part of
  // the rule this cannot speak to.
  it("keeps the society, its people and its towers", async () => {
    const before = (await container.store.societies.get("soc-demo"))!;
    const residents = await container.store.residents.find((r) => r.societyId === "soc-demo");
    const blocks = await container.store.blocks.find((b) => b.societyId === "soc-demo");
    expect(residents.length).toBeGreaterThan(0);
    expect(blocks.length).toBeGreaterThan(0);

    expect((await patch("soc-demo", { status: "inactive" })).statusCode).toBe(200);

    const society = await container.store.societies.get("soc-demo");
    expect(society).not.toBeNull();
    expect(society!.name).toBe("My Home Bhooja");
    expect(society!.createdAt).toBe(before.createdAt);
    expect(society!.supervisorUserId).toBe("user-sup");
    expect(society!.address.pincode).toBe("500081");
    expect(await container.store.residents.find((r) => r.societyId === "soc-demo")).toHaveLength(residents.length);
    expect(await container.store.blocks.find((b) => b.societyId === "soc-demo")).toHaveLength(blocks.length);
  });

  it("shows the new status everywhere the list is read, not only in the reply", async () => {
    const id = await aSocietyWithAPartialAddress();
    await patch(id, { status: "inactive" });

    const list = await app.inject({ method: "GET", url: "/v1/admin/societies", headers: bearer(admin) });
    const row = list.json().societies.find((s: { id: string }) => s.id === id);
    expect(row.status).toBe("inactive");

    const one = await app.inject({ method: "GET", url: `/v1/admin/societies/${id}`, headers: bearer(admin) });
    expect(one.json().society.status).toBe("inactive");
  });

  it("answers the Active and Inactive filters with what it just stored", async () => {
    const id = await aSocietyWithAPartialAddress();
    await patch(id, { status: "inactive" });

    const inactive = await app.inject({ method: "GET", url: "/v1/admin/societies?status=inactive", headers: bearer(admin) });
    expect(inactive.json().societies.map((s: { id: string }) => s.id)).toContain(id);

    const active = await app.inject({ method: "GET", url: "/v1/admin/societies?status=active", headers: bearer(admin) });
    expect(active.json().societies.map((s: { id: string }) => s.id)).not.toContain(id);
  });

  it("records the change as a status change, so the audit says what happened", async () => {
    const id = await aSocietyWithAPartialAddress();
    await patch(id, { status: "inactive" });
    const logs = (await container.store.audit.all()).filter((l) => l.resourceId === id);
    expect(logs.map((l) => l.action)).toContain("society.status_changed");
  });

  // The other half of the rule: the edit that sets an address is still the edit
  // that has to produce a complete one, or nothing would ever be repaired.
  it("still refuses an address that is missing its parts", async () => {
    const id = await aSocietyWithAPartialAddress();
    const res = await patch(id, { address: { locality: "Sainikpuri", city: "Hyderabad", state: "Telangana" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().problems.length).toBeGreaterThan(0);
  });

  it("accepts the address that repairs it", async () => {
    const id = await aSocietyWithAPartialAddress();
    const res = await patch(id, {
      address: {
        house: "Bhavani complex", street: "Sainikpuri Main Road", locality: "Sainikpuri",
        city: "Hyderabad", state: "Telangana", pincode: "500094",
      },
    });
    expect(res.statusCode).toBe(200);
    expect((await container.store.societies.get(id))!.address.pincode).toBe("500094");
  });

  // Renaming is not a status change, but it is the same mistake: a society with a
  // half-filled address could not be renamed either.
  it("renames a society without demanding its address be fixed first", async () => {
    const id = await aSocietyWithAPartialAddress();
    const res = await patch(id, { name: "Bhavani Complex Phase 2" });
    expect(res.statusCode).toBe(200);
    expect((await container.store.societies.get(id))!.name).toBe("Bhavani Complex Phase 2");
  });

  it("still refuses a rename onto a society already in that city", async () => {
    const id = await aSocietyWithAPartialAddress();
    const res = await patch(id, { name: "My Home Bhooja" });
    expect(res.statusCode).toBe(409);
  });
});
