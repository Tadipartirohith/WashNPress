import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, proveContact, staffBody } from "./helpers";

// A staff account is made from a name in two parts, a number and an address that
// have both been proved, and a state before an area. The employee id is generated.

describe("DFT proving a number and an address", () => {
  it("sends a code and accepts it", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const sent = await app.inject({
      method: "POST", url: "/v1/admin/verifications/send", headers: bearer(token),
      payload: JSON.stringify({ channel: "phone", value: "9812345678" }),
    });
    expect(sent.statusCode).toBe(200);
    const { verificationId, otpForTesting } = sent.json();
    expect(verificationId).toBeTruthy();

    const wrong = await app.inject({
      method: "POST", url: "/v1/admin/verifications/confirm", headers: bearer(token),
      payload: JSON.stringify({ verificationId, otp: "000000" }),
    });
    expect(wrong.statusCode).toBe(400);

    const right = await app.inject({
      method: "POST", url: "/v1/admin/verifications/confirm", headers: bearer(token),
      payload: JSON.stringify({ verificationId, otp: otpForTesting }),
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().verified).toBe(true);
  });

  it("refuses something that is not a number or an address", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    for (const [channel, value] of [["phone", "12345"], ["email", "not-an-address"]]) {
      const res = await app.inject({
        method: "POST", url: "/v1/admin/verifications/send", headers: bearer(token),
        payload: JSON.stringify({ channel, value }),
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("is open to a supervisor, who creates the operators in their own area", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const sent = await app.inject({
      method: "POST", url: "/v1/admin/verifications/send", headers: bearer(token),
      payload: JSON.stringify({ channel: "phone", value: "9812345679" }),
    });
    expect(sent.statusCode).toBe(200);
  });
});

describe("DFT creating a supervisor", () => {
  it("takes a name in two parts and generates the employee id", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: await staffBody(app, token, {
        firstName: "Suresh", lastName: "Kumar", phone: "9812345001", areaId: "area-kondapur",
      }),
    });
    expect(created.statusCode).toBe(201);
    const supervisor = created.json().supervisor;
    expect(supervisor.firstName).toBe("Suresh");
    expect(supervisor.lastName).toBe("Kumar");
    // Kept joined as well, so every screen and search written against one name works.
    expect(supervisor.fullName).toBe("Suresh Kumar");
    // Generated, and never asked for.
    expect(supervisor.employeeId).toMatch(/^WNP-SUP-\d+$/);
    expect(supervisor.phoneVerifiedAt).toBeTruthy();
    expect(supervisor.emailVerifiedAt).toBeTruthy();
  });

  it("gives every supervisor a different employee id", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const ids: string[] = [];
    for (const [index, area] of ["area-kondapur", "area-kphb", "area-manikonda"].entries()) {
      const created = await app.inject({
        method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
        payload: await staffBody(app, token, {
          firstName: "Sup", lastName: `Number${index}`, phone: `981234510${index}`, areaId: area,
        }),
      });
      expect(created.statusCode).toBe(201);
      ids.push(created.json().supervisor.employeeId);
    }
    expect(new Set(ids).size).toBe(3);
  });

  it("refuses a number that was never confirmed", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const emailVerificationId = await proveContact(app, token, "email", "unproven@washnpress.example");
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "Unproven", lastName: "Person", phone: "9812345200",
        email: "unproven@washnpress.example",
        phoneVerificationId: "made-up", emailVerificationId,
        region: "Telangana", areaId: "area-kondapur",
      }),
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toBe("phone_not_verified");
  });

  it("refuses a confirmation obtained for a different number", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    // Proved one number, then submitted another. The proof is tied to what it
    // proved, or it is only a token saying somebody verified something.
    const phoneVerificationId = await proveContact(app, token, "phone", "9812345301");
    const emailVerificationId = await proveContact(app, token, "email", "swap@washnpress.example");
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "Swapped", lastName: "Number", phone: "9812345302",
        email: "swap@washnpress.example",
        phoneVerificationId, emailVerificationId,
        region: "Telangana", areaId: "area-kondapur",
      }),
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toBe("phone_not_verified");
  });

  it("refuses an address that was never confirmed", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const phoneVerificationId = await proveContact(app, token, "phone", "9812345400");
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "No", lastName: "Email", phone: "9812345400",
        email: "never@washnpress.example",
        phoneVerificationId, emailVerificationId: "made-up",
        region: "Telangana", areaId: "area-kondapur",
      }),
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toBe("email_not_verified");
  });

  it("refuses an area that is in another state", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const phoneVerificationId = await proveContact(app, token, "phone", "9812345500");
    const emailVerificationId = await proveContact(app, token, "email", "cross@washnpress.example");
    // Whitefield is seeded in Karnataka. A form that reloads its area list on a
    // state change still sends whatever ids it was given, and a caller that is not
    // the form sends whatever it likes.
    const refused = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "Cross", lastName: "State", phone: "9812345500",
        email: "cross@washnpress.example",
        phoneVerificationId, emailVerificationId,
        region: "Telangana", areaId: "area-whitefield",
      }),
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toBe("area_outside_region");
    expect(refused.json().message).toContain("Karnataka");
  });

  it("does not take a society: that follows from the area", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: await staffBody(app, token, {
        firstName: "No", lastName: "Societies", phone: "9812345600", areaId: "area-kondapur",
        societyIds: ["soc-demo"],
      }),
    });
    expect(created.statusCode).toBe(201);
    // The society list was ignored rather than honoured.
    expect(created.json().supervisor.societyIds).toEqual([]);
  });

  it("cannot reuse one confirmation to create a second account", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const phoneVerificationId = await proveContact(app, token, "phone", "9812345700");
    const emailVerificationId = await proveContact(app, token, "email", "once@washnpress.example");
    const body = {
      firstName: "Only", lastName: "Once", phone: "9812345700",
      email: "once@washnpress.example",
      phoneVerificationId, emailVerificationId,
      region: "Telangana", areaId: "area-kondapur",
    };
    const first = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token), payload: JSON.stringify(body),
    });
    expect(first.statusCode).toBe(201);
    const again = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: JSON.stringify({ ...body, phone: "9812345701" }),
    });
    expect(again.statusCode).toBe(422);
  });
});

describe("DFT creating an operator", () => {
  it("is held to the same proof, and generates an operations employee id", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(token),
      payload: await staffBody(app, token, {
        firstName: "Ops", lastName: "Person", phone: "9812346001",
        areaId: "area-madhapur", societyIds: ["soc-demo"],
      }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().operator.employeeId).toMatch(/^WNP-OPS-\d+$/);
  });

  it("refuses an unproven number from a supervisor too", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const emailVerificationId = await proveContact(app, token, "email", "supops@washnpress.example");
    const refused = await app.inject({
      method: "POST", url: "/v1/supervisor/operators", headers: bearer(token),
      payload: JSON.stringify({
        firstName: "Sup", lastName: "Ops", phone: "9812346100",
        email: "supops@washnpress.example",
        phoneVerificationId: "made-up", emailVerificationId,
      }),
    });
    expect(refused.statusCode).toBe(422);
  });
});
