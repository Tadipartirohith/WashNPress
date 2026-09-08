import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginOperator } from "./helpers";

// I-89: an operator's profile and coverage are read-only. They may read them, but any
// attempt to change their own details — through the UI or a direct request — must be
// refused by the backend, not merely hidden by the client.
describe("DFT the operator profile is read-only (I-89)", () => {
  it("lets an operator read their profile", async () => {
    const { app } = await makeTestApp();
    const token = await loginOperator(app);
    const res = await app.inject({ method: "GET", url: "/v1/operations/profile", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.fullName).toBeTruthy();
  });

  it("refuses an operator's own profile update with 403", async () => {
    const { app } = await makeTestApp();
    const token = await loginOperator(app);
    const res = await app.inject({
      method: "PATCH", url: "/v1/operations/profile", headers: bearer(token),
      payload: JSON.stringify({ fullName: "Renamed Myself", email: "new@example.com" }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden_scope");

    // And it did not sneak the change through anyway.
    const after = await app.inject({ method: "GET", url: "/v1/operations/profile", headers: bearer(token) });
    expect(after.json().profile.fullName).not.toBe("Renamed Myself");
  });
});
