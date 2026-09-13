import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// Round 14 made a society's building and street optional. I-126 reversed that: a
// society created with only a name and a city left an operator with nothing to find
// on the ground. Every part of the address is required again.
//
// What round 14 got right still holds and is still checked here: the request schema
// only checks shape, so a blank box reaches the rule that knows which field it is
// and the admin is told that field by name rather than `invalid_request`.

const complete = {
  house: "Tower A", street: "Main Road", locality: "Madhapur",
  city: "Hyderabad", state: "Telangana", pincode: "500081",
};

describe("creating a society with parts of the address left blank", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let admin: string;

  beforeEach(async () => {
    ({ app } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  const create = (address: Record<string, string>, name = "Bhavani Complex") => app.inject({
    method: "POST", url: "/v1/admin/societies", headers: bearer(admin),
    payload: JSON.stringify({ name, address, blocks: [{ name: "A" }] }),
  });

  it("refuses a blank building or street, naming the field", async () => {
    // The wizard sends every field, so a blank box arrives as "" rather than absent.
    const noHouse = await create({ ...complete, house: "" });
    expect(noHouse.statusCode).toBe(422);
    expect(noHouse.json().problems).toEqual(["Building/House is required"]);

    const noStreet = await create({ ...complete, street: "" });
    expect(noStreet.statusCode).toBe(422);
    expect(noStreet.json().problems).toEqual(["Street is required"]);
  });

  it("refuses the fields being left out altogether", async () => {
    // A different client may simply omit them.
    const { house, street, ...rest } = complete;
    void house; void street;
    const res = await create(rest as Record<string, string>);
    expect(res.statusCode).toBe(422);
    expect(res.json().problems).toEqual(["Building/House is required", "Street is required"]);
  });

  it("keeps the building and the street when they are given", async () => {
    const res = await create(complete);
    expect(res.statusCode).toBe(201);
    expect(res.json().society.address.house).toBe("Tower A");
    expect(res.json().society.address.street).toBe("Main Road");
  });

  it("refuses the four that say where the society is", async () => {
    expect((await create({ ...complete, locality: "" })).statusCode).toBe(422);
    expect((await create({ ...complete, city: "" })).statusCode).toBe(422);
    expect((await create({ ...complete, state: "" })).statusCode).toBe(422);
    expect((await create({ ...complete, pincode: "" })).statusCode).toBe(422);
  });

  it("names the field rather than answering invalid_request", async () => {
    // The complaint in the report was as much about the message as the refusal: a
    // 400 with no field named leaves an admin re-reading a form that looks correct.
    const res = await create({ ...complete, pincode: "" });
    expect(res.json().error).toBe("invalid_society");
    expect(res.json().problems.join(" ")).toMatch(/pincode/i);
  });

  it("holds an edit of an existing society's address to the same rule", async () => {
    const made = await create(complete);
    const id = made.json().society.id as string;
    const edited = await app.inject({
      method: "PATCH", url: `/v1/admin/societies/${id}`, headers: bearer(admin),
      payload: JSON.stringify({ address: { ...complete, house: "", street: "" } }),
    });
    expect(edited.statusCode).toBe(422);
    expect(edited.json().problems).toEqual(["Building/House is required", "Street is required"]);
  });
});
