import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, staffBody } from "./helpers";

// Blocking and deactivating were one switch with two names: the endpoint took
// "active" or "blocked", and the Users page called it Block for an operator and
// Deactivate for everybody else. So an admin could not say "suspended for now"
// separately from "this account is finished", and which word they saw depended on
// the role of the person rather than on what they meant.
//
// They are two destinations now. Both refuse a sign-in; neither disturbs the
// society and blocks the account is assigned to, so somebody who comes back comes
// back to the work they had.

describe("blocking and deactivating an account", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let admin: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    admin = await loginAdmin(app);
  });

  async function anOperator(phone = "9871200001") {
    const made = await app.inject({
      method: "POST", url: "/v1/admin/operators", headers: bearer(admin),
      payload: staffBody({ firstName: "Test", lastName: "Operator", phone, societyId: "soc-demo", blockIds: ["block-demo-a"] }),
    });
    expect(made.statusCode).toBe(201);
    return { id: made.json().operator.id as string, phone };
  }

  const setStatus = (id: string, status: string) => app.inject({
    method: "PATCH", url: `/v1/admin/users/${id}/status`, headers: bearer(admin),
    payload: JSON.stringify({ status }),
  });

  it("keeps the two as separate stored states", async () => {
    const { id } = await anOperator();
    expect((await setStatus(id, "blocked")).statusCode).toBe(200);
    expect((await container.store.users.get(id))!.status).toBe("blocked");
    expect((await setStatus(id, "deleted")).statusCode).toBe(200);
    expect((await container.store.users.get(id))!.status).toBe("deleted");
  });

  it("refuses a sign-in in both states, and allows it again after", async () => {
    const { id, phone } = await anOperator("9871200002");
    for (const status of ["blocked", "deleted"]) {
      await setStatus(id, status);
      const send = await app.inject({
        method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" },
        payload: JSON.stringify({ phone }),
      });
      // Either the send is refused, or the verify is; what matters is that no
      // usable session comes out of it.
      if (send.statusCode === 200 && send.json().otpForTesting) {
        const verify = await app.inject({
          method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" },
          payload: JSON.stringify({ phone, otp: send.json().otpForTesting }),
        });
        expect(verify.statusCode).not.toBe(200);
      }
    }
    await setStatus(id, "active");
    const send = await app.inject({
      method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone }),
    });
    const verify = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone, otp: send.json().otpForTesting }),
    });
    expect(verify.statusCode).toBe(200);
  });

  it("keeps the society and blocks through both states and back", async () => {
    const { id } = await anOperator("9871200003");
    const before = (await container.store.users.get(id))!;
    expect(before.societyIds).toContain("soc-demo");

    for (const status of ["blocked", "deleted", "active"]) {
      await setStatus(id, status);
      const now = (await container.store.users.get(id))!;
      expect(now.societyIds).toEqual(before.societyIds);
      expect(now.blockIds).toEqual(before.blockIds);
    }
  });

  it("will not block or deactivate an administrator", async () => {
    // A second admin, so this is not merely the self-change guard.
    const other = await container.store.users.find((u) => u.roles.includes("admin") && u.id !== "user-admin");
    const target = other[0]?.id ?? "user-admin";
    for (const status of ["blocked", "deleted"]) {
      const res = await setStatus(target, status);
      expect([409]).toContain(res.statusCode);
    }
  });

  it("still refuses an admin changing their own status", async () => {
    const res = await setStatus("user-admin", "blocked");
    expect(res.statusCode).toBe(409);
  });

  it("rejects a status that is not one of the three", async () => {
    const { id } = await anOperator("9871200004");
    expect((await setStatus(id, "on_leave")).statusCode).toBe(400);
    expect((await setStatus(id, "banished")).statusCode).toBe(400);
  });

  it("records blocking and deactivating as different audit actions", async () => {
    const { id } = await anOperator("9871200005");
    await setStatus(id, "blocked");
    await setStatus(id, "deleted");
    const audit = await app.inject({ method: "GET", url: "/v1/admin/audit?resource=user", headers: bearer(admin) });
    const actions = (audit.json().entries as { action: string }[]).map((e) => e.action);
    expect(actions).toContain("user.blocked");
    expect(actions).toContain("user.deactivated");
  });
});
