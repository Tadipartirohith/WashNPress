import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, staffBody } from "./helpers";

// A staff account is made from a name in two parts, a number, and a place in the
// hierarchy: one society for a supervisor, blocks of that society for an operator.
//
// It is not made from an OTP. Creating an account and authenticating as that account
// are two different things, and they used to be run together: an admin filling in a
// form had to hold a code sent to somebody else's phone before the account could
// exist at all. The number is proved by whoever owns it, at their first sign-in.

describe("DFT creating a supervisor", () => {
  it("takes a name, a number and one society, and generates the employee id", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: staffBody({
        firstName: "Suresh", lastName: "Kumar", phone: "9812345001", societyId: "soc-aparna",
      }),
    });
    expect(created.statusCode).toBe(201);
    const supervisor = created.json().supervisor;
    expect(supervisor.firstName).toBe("Suresh");
    expect(supervisor.lastName).toBe("Kumar");
    // Kept joined as well, so every screen and search written against one name works.
    expect(supervisor.fullName).toBe("Suresh Kumar");
    // Generated, and never asked for.
    expect(supervisor.employeeId).toMatch(/^SUP-\d{3}$/);
    // And the society is theirs from the moment the account exists.
    expect(supervisor.societyId).toBe("soc-aparna");
    expect(supervisor.societyNames).toEqual(["Aparna Heights"]);
  });

  it("asks for no verification code at all", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "No", lastName: "Codes", phone: "9812345002", societyId: "soc-aparna",
      }),
    });
    expect(created.statusCode).toBe(201);
    // The endpoints that used to issue them are gone with the flow that needed them.
    const send = await app.inject({
      method: "POST", url: "/v1/admin/verifications/send", headers: bearer(token),
      payload: JSON.stringify({ channel: "phone", value: "9812345003" }),
    });
    expect(send.statusCode).toBe(404);
  });

  it("treats the email as optional, and still checks one that is given", async () => {
    // A supervisor is reached on their phone and signs in with it, so an address is
    // somewhere to send them things rather than something the account cannot exist
    // without. An optional field is not a field where anything goes.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const without = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({ firstName: "No", lastName: "Email", phone: "9812345010", societyId: "soc-aparna" }),
    });
    expect(without.statusCode).toBe(201);

    const nonsense = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "Bad", lastName: "Email", phone: "9812345011",
        email: "not-an-address", societyId: "soc-green-meadows",
      }),
    });
    expect(nonsense.statusCode).toBe(400);
  });

  it("gives every supervisor a different employee id", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const ids: string[] = [];
    for (const [index, societyId] of ["soc-aparna", "soc-green-meadows", "soc-lakeview"].entries()) {
      const created = await app.inject({
        method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
        payload: staffBody({
          firstName: "Sup", lastName: `Number${index}`, phone: `981234510${index}`, societyId,
        }),
      });
      expect(created.statusCode).toBe(201);
      ids.push(created.json().supervisor.employeeId);
    }
    expect(new Set(ids).size).toBe(3);
  });

  it("refuses a society that already has a supervisor, and says who runs it", async () => {
    // One supervisor per society. Refused before the account is made rather than
    // after, so a rejected assignment does not leave an orphaned supervisor behind.
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: staffBody({
        firstName: "Second", lastName: "Claim", phone: "9812345200", societyId: "soc-demo",
      }),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("society_taken");
    expect(refused.json().message).toContain("Ravi Kumar");
    expect(await container.users.byPhone("9812345200")).toBeNull();
  });

  it("refuses a society that does not exist", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: staffBody({
        firstName: "Nowhere", lastName: "Person", phone: "9812345300", societyId: "soc-imaginary",
      }),
    });
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error).toBe("society_not_found");
  });

  it("moves a supervisor to another society without leaving the old one half-assigned", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const moved = await app.inject({
      method: "PATCH", url: "/v1/admin/supervisors/user-sup", headers: bearer(token),
      payload: JSON.stringify({ societyId: "soc-aparna" }),
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().supervisor.societyId).toBe("soc-aparna");
    // Both sides: the society they left no longer names them, and the one they
    // joined does.
    expect((await container.store.societies.get("soc-demo"))!.supervisorUserId).toBeNull();
    expect((await container.store.societies.get("soc-aparna"))!.supervisorUserId).toBe("user-sup");
  });
});

describe("DFT creating an operator", () => {
  it("puts them on blocks of the society, and generates an operations id", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Ops", lastName: "Person", phone: "9812346001",
        societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(created.statusCode).toBe(201);
    const operator = created.json().operator;
    expect(operator.employeeId).toMatch(/^WNP-OPS-\d{3}$/);
    expect(operator.societyName).toBe("My Home Bhooja");
    expect(operator.blockNames).toEqual(["C"]);
  });

  it("writes both sides of the block assignment", async () => {
    // Or the block's list of operators and the operator's list of blocks disagree,
    // and the assignment screen shows one of them.
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Both", lastName: "Sides", phone: "9812346002",
        societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    const id = created.json().operator.id as string;
    expect((await container.store.blocks.get("block-demo-c"))!.operatorUserIds).toContain(id);
  });

  it("refuses a block belonging to another society", async () => {
    // Not a narrower permission but a wider one: it would quietly grant a whole
    // extra society, run by a different supervisor.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Cross", lastName: "Society", phone: "9812346003",
        societyId: "soc-demo", blockIds: ["block-gcb-north"],
      }),
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toBe("block_outside_society");
    expect(refused.json().message).toContain("My Home Bhooja");
  });

  it("asks an operator for an email, unlike a supervisor", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "No", lastName: "Email", phone: "9812346004", societyId: "soc-demo", blockIds: [],
      }),
    });
    expect(refused.statusCode).toBe(400);
  });

  it("never regenerates the employee id when an existing operator is edited", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const before = (await app.inject({
      method: "GET", url: "/v1/admin/operators", headers: bearer(token),
    })).json().operators.find((o: { id: string }) => o.id === "user-op");
    const edited = await app.inject({
      method: "PATCH", url: "/v1/admin/operators/user-op", headers: bearer(token),
      payload: JSON.stringify({ firstName: "Renamed", lastName: "Operator" }),
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().operator.employeeId).toBe(before.employeeId);
  });
});

describe("DFT a supervisor creating an operator inside their own society", () => {
  it("takes the society from the session and the blocks from the form", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const created = await app.inject({
      method: "POST", url: "/v1/supervisor/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Sup", lastName: "Ops", phone: "9812346100", blockIds: ["block-demo-c"],
      }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().operator.societyName).toBe("My Home Bhooja");
    expect(created.json().operator.blockNames).toEqual(["C"]);
  });

  it("refuses a block from a society they do not run", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const refused = await app.inject({
      method: "POST", url: "/v1/supervisor/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Reaching", lastName: "Out", phone: "9812346101", blockIds: ["block-gcb-north"],
      }),
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toContain("not a block of your society");
  });

  it("offers the blocks of their own society and nobody else's", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const listed = await app.inject({ method: "GET", url: "/v1/supervisor/operators", headers: bearer(token) });
    expect(listed.statusCode).toBe(200);
    expect((listed.json().blocks as { name: string }[]).map((b) => b.name).sort()).toEqual(["A", "B", "C"]);
  });
});
