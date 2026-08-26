import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, loginSupervisor, loginOperator, loginAdmin, approveStaff , staffBody } from "./helpers";
import { UserService } from "../../src/services/user-service";
import type { User } from "../../src/domain/models";

// ISSUE-27 from the sixth round: a supervisor is vouched for by an admin, an
// operator by their supervisor, and the portal stays shut until that has happened.
// Enforced at the backend, because a hidden screen is still a reachable endpoint.

const staff = (over: Partial<User>): User => ({
  id: "u", phone: "1", fullName: "Somebody", email: null, employeeId: null,
  status: "active", roles: [], lastLoginAt: null, areaId: null, societyIds: [],
  verificationStatus: "approved", verifiedByUserId: null, verifiedAt: null, verificationNote: null,
  createdAt: new Date().toISOString(),
  ...over,
} as User);

describe("DFT who may vouch for whom", () => {
  it("lets an admin decide about a supervisor, and nobody else", () => {
    const subject = staff({ id: "s1", roles: ["supervisor"], areaId: "area-madhapur" });
    expect(UserService.mayVerify(staff({ id: "a", roles: ["admin"] }), subject)).toBe(true);
    expect(UserService.mayVerify(staff({ id: "s2", roles: ["supervisor"], areaId: "area-madhapur" }), subject)).toBe(false);
    expect(UserService.mayVerify(staff({ id: "o", roles: ["operator"], areaId: "area-madhapur" }), subject)).toBe(false);
  });

  it("lets a supervisor decide about the operators in their own area", () => {
    const mine = staff({ id: "o1", roles: ["operator"], areaId: "area-madhapur" });
    const theirs = staff({ id: "o2", roles: ["operator"], areaId: "area-gachibowli" });
    const supervisor = staff({ id: "s1", roles: ["supervisor"], areaId: "area-madhapur" });
    expect(UserService.mayVerify(supervisor, mine)).toBe(true);
    expect(UserService.mayVerify(supervisor, theirs)).toBe(false);
  });

  it("stops an unapproved supervisor vouching for anybody", () => {
    // Otherwise the chain could be started from the middle: create a supervisor,
    // have them approve themselves an operator, and the admin never sees either.
    const pending = staff({ id: "s1", roles: ["supervisor"], areaId: "area-madhapur", verificationStatus: "pending" });
    const operator = staff({ id: "o1", roles: ["operator"], areaId: "area-madhapur" });
    expect(UserService.mayVerify(pending, operator)).toBe(false);
  });
});

describe("DFT a new supervisor cannot use the portal until an admin approves", () => {
  async function newSupervisor(phone: string) {
    const { app, container } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(adminToken),
      payload: await staffBody(app, adminToken, { firstName: "Fresh", lastName: "Supervisor", phone, areaId: "area-madhapur" }),
    });
    expect(made.statusCode).toBe(201);
    return { app, container, adminToken, userId: made.json().supervisor.id as string, phone };
  }

  it("starts pending rather than working immediately", async () => {
    const { app, adminToken, userId } = await newSupervisor("9812100001");
    const listed = await app.inject({ method: "GET", url: "/v1/admin/staff/pending", headers: bearer(adminToken) });
    expect((listed.json().staff as { id: string }[]).map((u) => u.id)).toContain(userId);
  });

  it("is refused the portal, and told why", async () => {
    const { app, phone } = await newSupervisor("9812100002");
    const token = await loginSupervisor(app, phone);
    // Signing in works. Getting through the door does not, which used to be the
    // same thing.
    const dashboard = await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(403);
    expect(dashboard.json().error).toBe("verification_pending");
    expect(dashboard.json().message).toMatch(/pending verification/i);
  });

  it("opens once the admin approves", async () => {
    const { app, adminToken, userId, phone } = await newSupervisor("9812100003");
    const approved = await app.inject({
      method: "POST", url: `/v1/admin/staff/${userId}/verification`, headers: bearer(adminToken),
      payload: JSON.stringify({ status: "approved", note: "Checked their references" }),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().user.verificationStatus).toBe("approved");

    const token = await loginSupervisor(app, phone);
    expect((await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(token) })).statusCode).toBe(200);
  });

  it("stays shut when the admin rejects, and says so differently", async () => {
    const { app, adminToken, userId, phone } = await newSupervisor("9812100004");
    await app.inject({
      method: "POST", url: `/v1/admin/staff/${userId}/verification`, headers: bearer(adminToken),
      payload: JSON.stringify({ status: "rejected", note: "Not who they said they were" }),
    });
    const token = await loginSupervisor(app, phone);
    const dashboard = await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(403);
    // A rejection is a decision, not the absence of one, and reads differently.
    expect(dashboard.json().error).toBe("verification_rejected");
  });

  it("records who decided and why", async () => {
    const { app, adminToken, userId } = await newSupervisor("9812100005");
    const approved = await app.inject({
      method: "POST", url: `/v1/admin/staff/${userId}/verification`, headers: bearer(adminToken),
      payload: JSON.stringify({ status: "approved", note: "Known to the area manager" }),
    });
    expect(approved.json().user.verifiedByUserId).toBe("user-admin");
    expect(approved.json().user.verifiedAt).toBeTruthy();
    expect(approved.json().user.verificationNote).toBe("Known to the area manager");

    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit?resource=user", headers: bearer(adminToken) });
    expect((audit.json().entries as { action: string }[]).some((e) => e.action === "staff.approved")).toBe(true);
  });
});

describe("DFT a new operator is vouched for by their supervisor", () => {
  async function newOperator(phone: string, areaId = "area-madhapur", societyIds = ["soc-demo"]) {
    const { app, container } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(adminToken),
      payload: await staffBody(app, adminToken, { firstName: "Fresh", lastName: "Operator", phone, areaId, societyIds }),
    });
    expect(made.statusCode).toBe(201);
    return { app, container, adminToken, userId: made.json().operator.id as string, phone };
  }

  it("is refused the portal until somebody vouches", async () => {
    const { app, phone } = await newOperator("9812200001");
    const token = await loginOperator(app, phone);
    const dashboard = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(403);
    expect(dashboard.json().error).toBe("verification_pending");
  });

  it("is approved by the supervisor of their own area", async () => {
    const { app, userId, phone } = await newOperator("9812200002");
    const supervisorToken = await loginSupervisor(app);

    const pending = await app.inject({
      method: "GET", url: "/v1/supervisor/operators/pending", headers: bearer(supervisorToken),
    });
    expect((pending.json().operators as { id: string }[]).map((o) => o.id)).toContain(userId);

    const approved = await app.inject({
      method: "POST", url: `/v1/supervisor/operators/${userId}/verification`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "approved" }),
    });
    expect(approved.statusCode).toBe(200);

    const token = await loginOperator(app, phone);
    expect((await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) })).statusCode).toBe(200);
  });

  it("cannot be approved by a supervisor from another area", async () => {
    const { app, userId } = await newOperator("9812200003");
    const outsider = await loginSupervisor(app, "9876500012");
    const attempt = await app.inject({
      method: "POST", url: `/v1/supervisor/operators/${userId}/verification`, headers: bearer(outsider),
      payload: JSON.stringify({ status: "approved" }),
    });
    expect(attempt.statusCode).toBe(403);
    expect(attempt.json().error).toBe("not_your_staff");
  });

  it("cannot approve a supervisor, which is the admin's to decide", async () => {
    const { app, adminToken } = await makeTestApp().then(async (ctx) => ({ ...ctx, adminToken: await loginAdmin(ctx.app) }));
    const made = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(adminToken),
      payload: await staffBody(app, adminToken, { firstName: "Peer", lastName: "Supervisor", phone: "9812200004", areaId: "area-madhapur" }),
    });
    const supervisorToken = await loginSupervisor(app);
    const attempt = await app.inject({
      method: "POST", url: `/v1/supervisor/operators/${made.json().supervisor.id}/verification`,
      headers: bearer(supervisorToken), payload: JSON.stringify({ status: "approved" }),
    });
    expect(attempt.statusCode).toBe(403);
  });
});

describe("DFT verification does not disturb what already worked", () => {
  it("leaves the seeded staff able to work", async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({
      method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(await loginSupervisor(app)),
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET", url: "/v1/operations/dashboard", headers: bearer(await loginOperator(app)),
    })).statusCode).toBe(200);
  });

  it("reads an account written before verification existed as one already in use", async () => {
    const { app, container } = await makeTestApp();
    const operator = await container.store.users.get("user-op");
    // Exactly what an older row looks like: no verification field at all.
    delete (operator as Partial<User>).verificationStatus;
    await container.store.users.put(operator!);

    const token = await loginOperator(app);
    expect((await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) })).statusCode).toBe(200);
  });

  it("does not gate residents or admins", async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({
      method: "GET", url: "/v1/resident/dashboard", headers: bearer(await loginResident(app)),
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET", url: "/v1/admin/dashboard", headers: bearer(await loginAdmin(app)),
    })).statusCode).toBe(200);
  });

  it("keeps a rejected account out even though it can still sign in", async () => {
    const { app, container } = await makeTestApp();
    const operator = await container.store.users.get("user-op");
    operator!.verificationStatus = "rejected";
    await container.store.users.put(operator!);

    const token = await loginOperator(app);
    // The token is valid; the door is shut. Those are different things now.
    expect(token).toBeTruthy();
    const dashboard = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(403);
    expect(dashboard.json().verificationStatus).toBe("rejected");
  });
});

describe("DFT the approval helper reflects the real workflow", () => {
  it("creates and then approves, in that order", async () => {
    const { app } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const made = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(adminToken),
      payload: await staffBody(app, adminToken, { firstName: "Helper", lastName: "Operator", phone: "9812300001", areaId: "area-madhapur", societyIds: ["soc-demo"] }),
    });
    await approveStaff(app, made.json().operator.id, adminToken);
    const token = await loginOperator(app, "9812300001");
    expect((await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) })).statusCode).toBe(200);
  });
});
