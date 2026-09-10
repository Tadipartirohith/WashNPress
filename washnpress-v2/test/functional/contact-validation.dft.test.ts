import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginResident, loginSupervisor, staffBody } from "./helpers";

// Email and phone are checked in one place, on every path that writes one.
//
// They were not. Creating an operator ran a strict check; editing one ran zod's
// `.email()`, which is a different rule; and onboarding, a resident editing their
// profile and a staff member editing theirs ran no duplicate check at all — so the
// uniqueness the creation path enforced could be walked around by signing in and
// editing a profile. Phone had no duplicate story beyond an exact string compare,
// which "+91 9876543210" walked straight past.

describe("DFT a phone number belongs to one account only", () => {
  it("refuses a second operator on a number another account already holds", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const first = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "First", lastName: "Line", phone: "9812349001",
        email: "phone-one@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Second", lastName: "Line", phone: "9812349001",
        email: "phone-two@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("user_conflict");
    expect(second.json().message).toBe("This phone number is already registered. Please use a different phone number.");
  });

  it("recognises the same number written with a country code", async () => {
    // The hole the normalising closes: without it "+91 98123 49101" is a free number
    // and the same person gets a second account nobody can reconcile.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Plain", lastName: "Number", phone: "9812349101",
        email: "plain@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    const dressed = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Dressed", lastName: "Number", phone: "+91 98123 49101",
        email: "dressed@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(dressed.statusCode).toBe(409);
  });

  it("stores the number in the one form, whatever was typed", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Country", lastName: "Code", phone: "+919812349201",
        email: "country@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(made.statusCode).toBe(201);
    const found = await container.users.byPhone("9812349201");
    expect(found?.phone).toBe("9812349201");
  });
});

describe("DFT a mobile number has to be a mobile number", () => {
  it("refuses ten characters that are not ten digits", async () => {
    // z.string().min(10).max(10) accepted this, which is what the schema was.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Not", lastName: "Digits", phone: "abcdefghij",
        email: "letters@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a number that does not start 6, 7, 8 or 9", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: staffBody({
        firstName: "Wrong", lastName: "Start", phone: "1234567890",
        email: "start@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DFT an address is checked wherever one can be written", () => {
  it("refuses the two-at address on a resident profile", async () => {
    // The address from the report. It used to reach the browser's own validator,
    // whose message is about the grammar of an address rather than about what to do.
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const res = await app.inject({
      method: "PATCH", url: "/v1/resident/profile", headers: bearer(token),
      payload: { email: "lavanaya@deepthi@gmail.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a resident taking an address that belongs to a staff account", async () => {
    // The hole: this path wrote user.email with no uniqueness check at all, so the
    // rule the creation path enforced could be walked around from the profile screen.
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(admin),
      payload: staffBody({
        firstName: "Held", lastName: "Address", phone: "9812349301",
        email: "taken@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    const resident = await loginResident(app);
    const res = await app.inject({
      method: "PATCH", url: "/v1/resident/profile", headers: bearer(resident),
      payload: { email: "TAKEN@washnpress.example" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("user_conflict");
    expect(res.json().message).toBe("This email address is already registered to another user.");
  });

  it("lets an account keep its own address", async () => {
    // The rule that makes editing possible at all: only somebody else's address is
    // a conflict.
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const first = await app.inject({
      method: "PATCH", url: "/v1/resident/profile", headers: bearer(token),
      payload: { email: "mine@washnpress.example" },
    });
    expect(first.statusCode).toBe(200);
    const again = await app.inject({
      method: "PATCH", url: "/v1/resident/profile", headers: bearer(token),
      payload: { fullName: "Same Person", email: "mine@washnpress.example" },
    });
    expect(again.statusCode).toBe(200);
  });

  it("keeps the same rule on a staff member editing their own profile", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(admin),
      payload: staffBody({
        firstName: "Other", lastName: "Staff", phone: "9812349401",
        email: "staff-held@washnpress.example", societyId: "soc-demo", blockIds: ["block-demo-c"],
      }),
    });
    const supervisor = await loginSupervisor(app);
    const res = await app.inject({
      method: "PATCH", url: "/v1/supervisor/profile", headers: bearer(supervisor),
      payload: { email: "staff-held@washnpress.example" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("lets an address be cleared once it has been set", async () => {
    // An optional field that cannot be emptied is not optional.
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    await app.inject({
      method: "PATCH", url: "/v1/resident/profile", headers: bearer(token),
      payload: { email: "clearme@washnpress.example" },
    });
    const cleared = await app.inject({
      method: "PATCH", url: "/v1/resident/profile", headers: bearer(token),
      payload: { email: "" },
    });
    expect(cleared.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/v1/resident/profile", headers: bearer(token) });
    expect(after.json().profile.email ?? "").toBe("");
  });
});
