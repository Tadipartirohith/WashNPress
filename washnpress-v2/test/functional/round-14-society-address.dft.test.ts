import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin } from "./helpers";

// A field the form calls optional has to be optional all the way down.
//
// The round that made a society's building and street optional changed the domain
// rule and changed the wizard, and left the request schema alone. So the form said
// "Finding it (optional)", the admin left both blank as invited, and the create came
// back `invalid_request` with nothing naming the field — because the schema still
// insisted on at least one character in each.
//
// The tests written at the time exercised `addressProblems` directly and the PATCH
// path with complete addresses, and never once posted the shape the form actually
// sends. This is that shape.

const complete = {
  house: "Tower A", street: "Main Road", locality: "Madhapur",
  city: "Hyderabad", state: "Telangana", pincode: "500081",
};

describe("creating a society with the optional address fields left blank", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let admin: string;

  beforeEach(async () => {
    ({ app } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  const create = (address: Record<string, string>, name = "Bhavani Complex") => app.inject({
    method: "POST", url: "/v1/admin/societies", headers: bearer(admin),
    payload: JSON.stringify({ name, address }),
  });

  it("accepts the empty strings the form actually sends", async () => {
    // The wizard trims every field and sends them all, so a blank box arrives as ""
    // rather than being left out.
    const res = await create({ ...complete, house: "", street: "" });
    expect(res.statusCode).toBe(201);
  });

  it("accepts the fields being left out altogether", async () => {
    // A different client may simply omit them.
    const { house, street, ...rest } = complete;
    void house; void street;
    const res = await create(rest as Record<string, string>);
    expect(res.statusCode).toBe(201);
  });

  it("stores the blanks as blanks rather than inventing something", async () => {
    const res = await create({ ...complete, house: "", street: "" });
    expect(res.json().society.address.house).toBe("");
    expect(res.json().society.address.street).toBe("");
  });

  it("still keeps the building and the street when they are given", async () => {
    const res = await create(complete);
    expect(res.json().society.address.house).toBe("Tower A");
    expect(res.json().society.address.street).toBe("Main Road");
  });

  it("still refuses the four that say where the society is", async () => {
    // Optional means optional for two fields, not for the address.
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

  it("lets the same blanks through when editing an existing society", async () => {
    const made = await create(complete);
    const id = made.json().society.id as string;
    const edited = await app.inject({
      method: "PATCH", url: `/v1/admin/societies/${id}`, headers: bearer(admin),
      payload: JSON.stringify({ address: { ...complete, house: "", street: "" } }),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().society.address.house).toBe("");
  });
});
