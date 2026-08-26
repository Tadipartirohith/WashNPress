import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// An area is the state it is in and its name. There is no area code.

describe("DFT creating an area", () => {
  it("takes a state and a name, and no code", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      payload: JSON.stringify({ region: "Karnataka", name: "Indiranagar", description: "Indiranagar and 100ft road" }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().area.region).toBe("Karnataka");
    expect(created.json().area.name).toBe("Indiranagar");
    expect(created.json().area).not.toHaveProperty("code");
  });

  it("refuses an area with no state", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      payload: JSON.stringify({ name: "Nowhere" }),
    });
    expect(refused.statusCode).toBe(400);
  });

  it("refuses a region that is not a state anybody operates in", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      payload: JSON.stringify({ region: "Atlantis", name: "Somewhere" }),
    });
    expect(refused.statusCode).toBe(409);
  });

  it("refuses the same name twice in one state, and allows it in another", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const first = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      payload: JSON.stringify({ region: "Telangana", name: "Gandhinagar" }),
    });
    expect(first.statusCode).toBe(201);

    const again = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      payload: JSON.stringify({ region: "Telangana", name: "gandhinagar" }),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toContain("Telangana");

    // There is a Gandhinagar in more than one state, and neither is the other.
    const elsewhere = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      payload: JSON.stringify({ region: "Gujarat", name: "Gandhinagar" }),
    });
    expect(elsewhere.statusCode).toBe(201);
  });

  it("holds an edit to the same rule creation is held to", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/areas", headers: bearer(token),
      payload: JSON.stringify({ region: "Telangana", name: "Kompally" }),
    });
    const id = created.json().area.id as string;
    // Madhapur is seeded in Telangana; renaming this one onto it would make two.
    const clash = await app.inject({
      method: "PATCH", url: `/v1/admin/areas/${id}`, headers: bearer(token),
      payload: JSON.stringify({ name: "Madhapur" }),
    });
    expect(clash.statusCode).toBe(409);
  });
});

describe("DFT areas are looked at one state at a time", () => {
  it("narrows the list to the chosen state", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const telangana = await app.inject({
      method: "GET", url: "/v1/admin/areas?region=Telangana", headers: bearer(token),
    });
    const names = (telangana.json().areas as { name: string; region: string }[]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((a) => a.region === "Telangana")).toBe(true);
    // The seeded Karnataka area is not a Telangana area.
    expect(names.some((a) => a.name === "Whitefield")).toBe(false);

    const karnataka = await app.inject({
      method: "GET", url: "/v1/admin/areas?region=Karnataka", headers: bearer(token),
    });
    expect((karnataka.json().areas as { name: string }[]).map((a) => a.name)).toEqual(["Whitefield"]);
  });

  it("says which states have areas, and which states may be used", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/areas", headers: bearer(token) });
    // The states worth offering as a filter are the ones with something in them.
    expect(res.json().regions).toEqual(["Karnataka", "Telangana"]);
    // And the whole supported list, for creating an area somewhere new.
    expect(res.json().supportedRegions).toContain("Tamil Nadu");
  });
});

describe("DFT an area written before the field held states", () => {
  it("reads as the state its city is in rather than dropping out of every list", async () => {
    const { app, container } = await makeTestApp();
    // Written the old way: a city in the region field, and an area code.
    await container.store.areas.put({
      id: "area-legacy", name: "Legacy Nagar", description: null,
      region: "Bengaluru", status: "active", supervisorUserId: null,
      createdAt: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately a shape that predates the change
    } as any);

    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "GET", url: "/v1/admin/areas?region=Karnataka", headers: bearer(token),
    });
    const names = (res.json().areas as { name: string }[]).map((a) => a.name);
    expect(names).toContain("Legacy Nagar");
  });
});
