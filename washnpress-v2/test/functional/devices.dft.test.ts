import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, loginOperator } from "./helpers";

// Registering the handset a notification is delivered to, over HTTP.
//
// The app calls this on every start rather than once on install, because an
// operating system rotates a push token and an app that registered once would
// quietly stop being reachable some weeks later with nothing on the screen to say
// so.

const handset = { token: "ExponentPushToken[abcdefghij]", platform: "android", app: "resident" };

function json(token: string) {
  return { ...bearer(token), "content-type": "application/json" };
}

describe("DFT registering a handset for push", () => {
  it("records it against the signed-in account", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const res = await app.inject({
      method: "POST", url: "/v1/auth/devices", headers: json(token), payload: JSON.stringify(handset),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().device.app).toBe("resident");

    const stored = await container.store.deviceTokens.get(handset.token);
    expect(stored?.userId).toBe("user-res");
    expect(stored?.active).toBe(true);
  });

  it("refuses a registration nobody is signed in for", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({
      method: "POST", url: "/v1/auth/devices",
      headers: { "content-type": "application/json" }, payload: JSON.stringify(handset),
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a platform or an app it does not have", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    for (const body of [
      { ...handset, platform: "blackberry" },
      { ...handset, app: "admin" },
      { ...handset, token: "short" },
    ]) {
      const res = await app.inject({
        method: "POST", url: "/v1/auth/devices", headers: json(token), payload: JSON.stringify(body),
      });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("lets the same handset be registered again without growing a second row", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    for (let i = 0; i < 3; i += 1) {
      await app.inject({ method: "POST", url: "/v1/auth/devices", headers: json(token), payload: JSON.stringify(handset) });
    }
    expect((await container.devices.forUser("user-res")).length).toBe(1);
  });
});

describe("DFT standing a handset down", () => {
  it("stops it being one of the places the account is reachable", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    await app.inject({ method: "POST", url: "/v1/auth/devices", headers: json(token), payload: JSON.stringify(handset) });

    const gone = await app.inject({
      method: "DELETE", url: "/v1/auth/devices", headers: json(token),
      payload: JSON.stringify({ token: handset.token }),
    });
    expect(gone.statusCode).toBe(200);
    expect(await container.devices.forUser("user-res")).toEqual([]);
  });

  it("will not silence somebody else's phone", async () => {
    // Otherwise knowing a token — which is a string that travels through logs and
    // support conversations — would be enough to stop another person's alerts.
    const { app, container } = await makeTestApp();
    const resident = await loginResident(app);
    await app.inject({ method: "POST", url: "/v1/auth/devices", headers: json(resident), payload: JSON.stringify(handset) });

    const operator = await loginOperator(app);
    const refused = await app.inject({
      method: "DELETE", url: "/v1/auth/devices", headers: json(operator),
      payload: JSON.stringify({ token: handset.token }),
    });
    expect(refused.statusCode).toBe(404);
    expect((await container.devices.forUser("user-res")).length).toBe(1);
  });

  it("goes with signing out, which is what matters on a shared device", async () => {
    // The next person to sign in on the counter tablet must not be handed the last
    // person's notifications.
    const { app, container } = await makeTestApp();
    const token = await loginOperator(app);
    await app.inject({
      method: "POST", url: "/v1/auth/devices", headers: json(token),
      payload: JSON.stringify({ token: "counter-tablet-token", platform: "android", app: "staff" }),
    });

    const out = await app.inject({
      method: "POST", url: "/v1/auth/logout", headers: json(token),
      payload: JSON.stringify({ deviceToken: "counter-tablet-token" }),
    });
    expect(out.statusCode).toBe(200);
    expect(await container.devices.forUser("user-op")).toEqual([]);
  });

  it("still signs out when the app did not send a handset", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const out = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(token) });
    expect(out.statusCode).toBe(200);
    expect(out.json().loggedOut).toBe(true);
  });
});
