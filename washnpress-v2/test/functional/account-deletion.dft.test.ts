import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident } from "./helpers";

// A resident deleting their own account, and what that has to mean.
//
// Apple 5.1.1(v) requires deletion in the app for anything that creates an account and
// says plainly that deactivating is not deletion; Play wants the same plus a public
// URL. From 13 May 2027 the DPDP Act's erasure right says it again. Until this route
// existed the web app called it, got a 404, and quietly filed a support ticket
// instead — which is the exact substitute Apple forecloses.

describe("DFT a resident can erase their own account", () => {
  it("removes every identifying detail rather than deactivating", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const before = await container.store.users.find((u) => u.phone === "9876543210");
    expect(before).toHaveLength(1);
    const userId = before[0].id;

    const res = await app.inject({ method: "DELETE", url: "/v1/resident/account", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    const after = (await container.store.users.get(userId))!;
    expect(after.status).toBe("deleted");
    expect(after.fullName).toBeNull();
    expect(after.email).toBeNull();
    // The number is not merely blanked — it must stop being this person's number, and
    // must not collide with the next account to be deleted.
    expect(after.phone).not.toBe("9876543210");
    expect(after.phone.startsWith("deleted:")).toBe(true);
  });

  it("releases the phone number so it can sign up again", async () => {
    // If deletion held the number hostage, somebody who left could never come back,
    // and a recycled Indian mobile number could never be used by its new owner.
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    await app.inject({ method: "DELETE", url: "/v1/resident/account", headers: bearer(token) });

    const stillHeld = await container.users.byPhone("9876543210");
    expect(stillHeld).toBeNull();
  });

  it("erases the flat, which identifies a home as surely as a name", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const [resident] = await container.store.residents.find((r) => r.id === "res-demo");
    expect(resident.unitNumber).toBeTruthy();

    await app.inject({ method: "DELETE", url: "/v1/resident/account", headers: bearer(token) });

    const after = (await container.store.residents.get("res-demo"))!;
    expect(after.unitNumber).toBe("");
    expect(after.towerBlock).toBeNull();
    expect(after.address).toBeNull();
  });

  it("stops an active subscription from renewing against a deleted account", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    await app.inject({ method: "DELETE", url: "/v1/resident/account", headers: bearer(token) });

    const subs = await container.store.subscriptions.find((s) => s.residentId === "res-demo");
    for (const sub of subs) {
      expect(sub.status).not.toBe("active");
      expect(sub.autoRenew).toBe(false);
    }
  });

  it("kills the session on the next request", async () => {
    // Deletion that leaves a working token is not deletion.
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    await app.inject({ method: "DELETE", url: "/v1/resident/account", headers: bearer(token) });

    const after = await app.inject({ method: "GET", url: "/v1/resident/profile", headers: bearer(token) });
    expect(after.statusCode).toBe(401);
  });

  it("keeps the money records, and says so", async () => {
    // A GST-registered business has to produce the invoice behind every rupee for
    // years. The transactions stay; the person is unlinked from them. Telling the
    // resident that plainly is part of the obligation, not a footnote.
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    const res = await app.inject({ method: "DELETE", url: "/v1/resident/account", headers: bearer(token) });

    const body = res.json();
    expect(body.retained.ledgerEntries).toBe(true);
    expect(body.retained.reason).toMatch(/tax|accounting/i);
  });

  it("refuses an anonymous caller", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "DELETE", url: "/v1/resident/account" });
    expect(res.statusCode).toBe(401);
  });
});
