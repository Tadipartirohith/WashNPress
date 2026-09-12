import { describe, it, expect } from "vitest";
import { makeTestApp, loginResident, loginSupervisor, loginAdmin, bearer } from "./helpers";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

async function raiseTicket(app: App, residentToken: string, description: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
    payload: JSON.stringify({ category: "general_query", description }),
  });
  expect([200, 201]).toContain(res.statusCode);
  const body = res.json();
  const id = body.ticket?.id ?? body.id;
  expect(id, `no ticket id in ${res.body}`).toBeTruthy();
  return id as string;
}

// ST1-I111. Resolving an issue saved the status and the note, and recorded nobody. The
// audit log named the actor, but a resolved issue is opened far more often than the
// audit log is searched, and "who sorted this out" is the first thing asked.
describe("DFT a resolved issue says who resolved it", () => {
  it("records the person who resolved it, and names them on the issue", async () => {
    const { app, container } = await makeTestApp();
    const resident = await loginResident(app);
    const admin = await loginAdmin(app);
    const id = await raiseTicket(app, resident, "The shirt came back with a stain.");

    const resolved = await app.inject({
      method: "PATCH", url: `/v1/admin/issues/${id}/status`, headers: bearer(admin),
      payload: JSON.stringify({ status: "resolved", resolution: "Re-washed and returned the same day." }),
    });
    expect(resolved.statusCode).toBe(200);

    const adminUser = (await container.store.users.find((u) => u.phone === "9876500001"))[0];
    const stored = await container.store.tickets.get(id);
    expect(stored?.resolvedByUserId).toBe(adminUser.id);
    expect(stored?.resolvedAt).toBeTruthy();

    const detail = await app.inject({ method: "GET", url: `/v1/admin/issues/${id}`, headers: bearer(admin) });
    expect(detail.json().issue.resolvedByName).toBe(adminUser.fullName);
  });

  it("files the admin's resolution in the audit log under the same name the other portals use", async () => {
    // Supervisor and operations recorded "issue.resolved"; admin recorded the same act
    // as "issue.status_changed", so a search for resolutions silently missed them.
    const { app, container } = await makeTestApp();
    const resident = await loginResident(app);
    const admin = await loginAdmin(app);
    const id = await raiseTicket(app, resident, "Pickup never came.");

    await app.inject({
      method: "PATCH", url: `/v1/admin/issues/${id}/status`, headers: bearer(admin),
      payload: JSON.stringify({ status: "resolved", resolution: "Rebooked for tomorrow morning." }),
    });

    const entries = (await container.store.audit.all()).filter((e) => e.resourceId === id);
    expect(entries.map((e) => e.action)).toContain("issue.resolved");
  });
});

// ST1-I99 and ST1-I110. The resident details a supervisor and an admin open.
describe("DFT a resident's details are complete", () => {
  it("tells the supervisor when each resident in a tower joined", async () => {
    // A resident record has no date of its own; the user it belongs to does. The drawer
    // used to leave "joined" out entirely rather than show a date that meant something
    // else.
    const { app, container } = await makeTestApp();
    const supervisor = await loginSupervisor(app);
    const resident = (await container.store.residents.get("res-demo"))!;
    expect(resident.blockId, "the demo resident is not in a tower").toBeTruthy();
    const user = (await container.store.users.get(resident.userId))!;

    const res = await app.inject({ method: "GET", url: `/v1/supervisor/blocks/${resident.blockId}`, headers: bearer(supervisor) });
    expect(res.statusCode).toBe(200);
    const row = res.json().residents.find((r: { id: string }) => r.id === resident.id);
    expect(row.joinedAt).toBe(user.createdAt);
    // And the floor, from the same layout the admin's view uses.
    expect(row.floor).toBe(4);
  });

  it("gives the admin the floor, read from the tower rather than guessed from the flat number", async () => {
    const { app, container } = await makeTestApp();
    const admin = await loginAdmin(app);
    const resident = (await container.store.residents.get("res-demo"))!;
    const block = (await container.store.blocks.get(resident.blockId!))!;
    // The seeded resident lives in A-402, and Tower A's layout lists flat "402" on the
    // fourth floor. The unit carries the tower's name and the layout does not, which is
    // why an exact comparison used to find no floor for anybody.
    const expected = 4;
    expect(resident.unitNumber).toBe("A-402");

    const res = await app.inject({ method: "GET", url: `/v1/admin/users/${resident.userId}`, headers: bearer(admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().resident.floor).toBe(expected);
    expect(res.json().resident.blockName).toBe(block.name);
  });
});
