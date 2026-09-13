import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// The admin Create Society wizard and Society page, as the Zoho round reported them.
//
// I-126: a society could be created with only a name, because the address rule did
// not ask for a building or a street. I-128: the naming preview showed two towers
// when none had been entered, and a society could be created with no towers at all.
// I-143: the Society page did not show how many residents have no tower recorded,
// although the assignments call already counts them.

const ADDRESS = {
  house: "Plot 7", street: "Road 12", locality: "Kondapur",
  city: "Hyderabad", state: "Telangana", pincode: "500084",
};

describe("DFT creating a society from the admin wizard", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let admin: string;

  beforeEach(async () => {
    ({ app } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  const create = (body: Record<string, unknown>) => app.inject({
    method: "POST", url: "/v1/admin/societies", headers: bearer(admin),
    payload: JSON.stringify({ name: "Kondapur Greens", address: ADDRESS, blocks: [{ name: "A" }], ...body }),
  });

  it("creates a society whose address and towers are complete", async () => {
    const res = await create({});
    expect(res.statusCode, res.payload).toBe(201);
  });

  it("refuses each missing part of the address with its own message", async () => {
    const cases: [keyof typeof ADDRESS, string][] = [
      ["house", "Building/House is required"],
      ["street", "Street is required"],
      ["locality", "Locality is required"],
      ["city", "City is required"],
      ["state", "Please select a state"],
      ["pincode", "Pincode must be 6 digits"],
    ];
    for (const [field, message] of cases) {
      const res = await create({ address: { ...ADDRESS, [field]: "  " } });
      expect(res.statusCode, field).toBe(422);
      expect(res.json().problems, field).toEqual([message]);
      expect(res.json().message, field).toBe(message);
    }
  });

  it("accepts only a six-digit Indian pincode", async () => {
    for (const pincode of ["5000", "5000841", "50008a"]) {
      const res = await create({ address: { ...ADDRESS, pincode } });
      expect(res.statusCode, pincode).toBe(422);
      expect(res.json().problems, pincode).toEqual(["Pincode must be 6 digits"]);
    }
    const leadingZero = await create({ address: { ...ADDRESS, pincode: "000000" } });
    expect(leadingZero.statusCode).toBe(422);
    expect(leadingZero.json().problems).toEqual(["Pincode cannot start with 0"]);
  });

  it("refuses a society with no towers, whether the list is empty or absent", async () => {
    const empty = await create({ blocks: [] });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().problems).toEqual(["Add at least one tower"]);

    const absent = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(admin),
      payload: JSON.stringify({ name: "Kondapur Greens", address: ADDRESS }),
    });
    expect(absent.statusCode).toBe(422);
    expect(absent.json().problems).toEqual(["Add at least one tower"]);
  });
});

describe("DFT the naming preview matches the towers entered", () => {
  it("previews none, one and three towers exactly", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    const towersFor = async (towers: number) => {
      const res = await app.inject({
        method: "GET", url: `/v1/admin/naming?tower=letter&floor=number&flat=floor_unit&towers=${towers}&floors=5&flatsPerFloor=4`,
        headers: bearer(admin),
      });
      expect(res.statusCode).toBe(200);
      return (res.json().preview as { tower: string }[]).map((t) => t.tower);
    };
    expect(await towersFor(0)).toEqual([]);
    expect(await towersFor(1)).toEqual(["A"]);
    expect(await towersFor(3)).toEqual(["A", "B", "C"]);
  });
});

describe("DFT the society's unassigned residents are counted for the admin", () => {
  it("returns the count as a number, zero included, and follows assignment changes", async () => {
    const { app, container } = await makeTestApp();
    const admin = await loginAdmin(app);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/societies", headers: bearer(admin),
      payload: JSON.stringify({ name: "Kondapur Greens", address: ADDRESS, blocks: [{ name: "A" }] }),
    });
    const societyId = made.json().society.id as string;
    const count = async () => {
      const res = await app.inject({ method: "GET", url: `/v1/admin/societies/${societyId}/assignments`, headers: bearer(admin) });
      expect(res.statusCode).toBe(200);
      return res.json().unassignedResidentCount;
    };

    expect(await count()).toBe(0);

    // A resident whose tower was never recorded is unassigned.
    const template = (await container.store.residents.all())[0]!;
    await container.store.residents.put({ ...template, id: "res-unassigned", societyId, blockId: null });
    expect(await count()).toBe(1);

    // Recording their tower takes them out of the count.
    const block = (await container.store.blocks.find((b) => b.societyId === societyId))[0]!;
    await container.store.residents.put({ ...template, id: "res-unassigned", societyId, blockId: block.id });
    expect(await count()).toBe(0);
  });
});
