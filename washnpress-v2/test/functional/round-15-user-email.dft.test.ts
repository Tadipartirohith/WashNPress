import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, staffBody } from "./helpers";

// An email address identifies a person, so no two accounts may hold the same one.
// Format is already refused by the request schema; this is the other half of the
// rule — the address must not already belong to somebody else — enforced in the one
// place every staff account is created and edited, so it holds for admins,
// supervisors and operators alike and at the API, not only in the form.

describe("DFT an email address belongs to one account only", () => {
  it("refuses a second operator with an address another operator already holds", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const first = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "First", lastName: "Holder", phone: "9812347001",
        email: "shared@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Second", lastName: "Holder", phone: "9812347002",
        email: "shared@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("user_conflict");
    expect(second.json().message).toContain("already registered");
  });

  it("recognises the same address across case and surrounding space", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Case", lastName: "One", phone: "9812347010",
        email: "MixedCase@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    const clash = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Case", lastName: "Two", phone: "9812347011",
        email: "  mixedcase@washnpress.example  ", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    // The surrounding space also fails the schema's format check, so the request is
    // refused either way; what matters is that it does not slip through as a new,
    // second holder of the address.
    expect([400, 409]).toContain(clash.statusCode);
    const trimmedClash = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Case", lastName: "Three", phone: "9812347012",
        email: "MIXEDCASE@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(trimmedClash.statusCode).toBe(409);
    expect(trimmedClash.json().error).toBe("user_conflict");
  });

  it("refuses an address a supervisor already holds when creating another supervisor", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: staffBody({
        firstName: "Sup", lastName: "One", phone: "9812347020",
        email: "sup.shared@washnpress.example", societyId: "soc-aparna",
      }),
    });
    const clash = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: staffBody({
        firstName: "Sup", lastName: "Two", phone: "9812347021",
        email: "sup.shared@washnpress.example", societyId: "soc-green-meadows",
      }),
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe("user_conflict");
  });

  it("refuses editing an operator onto an address another account holds", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Edit", lastName: "Target", phone: "9812347030",
        email: "keeps.own@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().operator.id as string;

    // The seeded admin already holds admin@washnpress.example.
    const clash = await app.inject({
      method: "PATCH", url: `/v1/admin/operators/${id}`, headers: bearer(token),
      payload: JSON.stringify({ email: "admin@washnpress.example" }),
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe("user_conflict");
  });

  it("lets an account keep its own address when edited", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Same", lastName: "Address", phone: "9812347040",
        email: "unchanged@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    const id = created.json().operator.id as string;
    const edited = await app.inject({
      method: "PATCH", url: `/v1/admin/operators/${id}`, headers: bearer(token),
      payload: JSON.stringify({ firstName: "Renamed", email: "unchanged@washnpress.example" }),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().operator.firstName).toBe("Renamed");
  });
});
