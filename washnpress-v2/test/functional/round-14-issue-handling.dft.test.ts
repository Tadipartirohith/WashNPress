import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginResident, loginSupervisor } from "./helpers";

// Which issue to solve first, and who is solving it.
//
// The service has held both since support was built: `setPriority`, `assign`, and a
// queue ordered emergency first and then oldest, so the order of work has always
// been decided by priority. The supervisor could set both. The admin — the one
// person seeing every society's tickets at once, and the last resort for anything
// escalated — could set neither, so the person best placed to say what counted as an
// emergency had no way to say it.

describe("an admin decides which issue comes first", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let admin: string;
  let resident: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    admin = await loginAdmin(app);
    resident = await loginResident(app);
  });

  async function aTicket(description = "The shirt came back stained") {
    const made = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(resident),
      payload: JSON.stringify({ category: "damaged_garment", description }),
    });
    expect(made.statusCode).toBe(201);
    return made.json().ticket.id as string;
  }

  const setPriority = (id: string, priority: string) => app.inject({
    method: "PATCH", url: `/v1/admin/issues/${id}/priority`, headers: bearer(admin),
    payload: JSON.stringify({ priority }),
  });

  const assign = (id: string, userId: string | null) => app.inject({
    method: "POST", url: `/v1/admin/issues/${id}/assign`, headers: bearer(admin),
    payload: JSON.stringify({ userId }),
  });

  it("raises a ticket to an emergency", async () => {
    const id = await aTicket();
    expect((await setPriority(id, "emergency")).statusCode).toBe(200);
    expect((await container.store.tickets.get(id))!.priority).toBe("emergency");
  });

  it("refuses a priority that is not one of the four", async () => {
    expect((await setPriority(await aTicket(), "urgent-ish")).statusCode).toBe(400);
  });

  it("moves the raised ticket to the front of the queue", async () => {
    // The point of the setting. Priority decides the order of work, so changing it
    // has to change the order and not only the badge.
    const first = await aTicket("Raised first");
    const second = await aTicket("Raised second");
    await setPriority(second, "emergency");
    const listed = await app.inject({ method: "GET", url: "/v1/admin/issues", headers: bearer(admin) });
    const order = (listed.json().issues as { id: string }[]).map((i) => i.id);
    expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
  });

  it("writes the change to the audit log with what it was before", async () => {
    const id = await aTicket();
    await setPriority(id, "high");
    const logs = (await container.store.audit.all()).filter((l) => l.resourceId === id);
    expect(logs.map((l) => l.action)).toContain("issue.priority_changed");
  });

  it("is admin only", async () => {
    const id = await aTicket();
    const asResident = await app.inject({
      method: "PATCH", url: `/v1/admin/issues/${id}/priority`, headers: bearer(resident),
      payload: JSON.stringify({ priority: "emergency" }),
    });
    expect([401, 403]).toContain(asResident.statusCode);
  });
});

describe("an admin says who is handling an issue", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let admin: string;
  let resident: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    admin = await loginAdmin(app);
    resident = await loginResident(app);
  });

  async function aTicket() {
    const made = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(resident),
      payload: JSON.stringify({ category: "damaged_garment", description: "The shirt came back stained" }),
    });
    return made.json().ticket.id as string;
  }

  const assign = (id: string, userId: string | null) => app.inject({
    method: "POST", url: `/v1/admin/issues/${id}/assign`, headers: bearer(admin),
    payload: JSON.stringify({ userId }),
  });

  it("hands it to a member of staff", async () => {
    const id = await aTicket();
    expect((await assign(id, "user-sup")).statusCode).toBe(200);
    expect((await container.store.tickets.get(id))!.assignedToUserId).toBe("user-sup");
  });

  it("names the person on the ticket, so the list can say who has it", async () => {
    const id = await aTicket();
    const res = await assign(id, "user-sup");
    expect(res.json().issue.assignedToName).toBe("Ravi Kumar");
  });

  it("starts the work, because taking a ticket is starting it", async () => {
    const id = await aTicket();
    await assign(id, "user-sup");
    expect((await container.store.tickets.get(id))!.status).toBe("in_progress");
  });

  it("puts it back on the pile when nobody is named", async () => {
    // The only way out of a ticket assigned to somebody who has since gone on leave.
    const id = await aTicket();
    await assign(id, "user-sup");
    expect((await assign(id, null)).statusCode).toBe(200);
    expect((await container.store.tickets.get(id))!.assignedToUserId).toBeNull();
  });

  it("leaves the work started when it is put back", async () => {
    // Rewinding to open would lose that somebody had already looked at it.
    const id = await aTicket();
    await assign(id, "user-sup");
    await assign(id, null);
    expect((await container.store.tickets.get(id))!.status).toBe("in_progress");
  });

  it("will not hand a ticket to the resident who raised it", async () => {
    const id = await aTicket();
    const res = await assign(id, "user-res");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not_staff");
  });

  it("answers for a person who does not exist", async () => {
    expect((await assign(await aTicket(), "nobody-at-all")).statusCode).toBe(404);
  });

  it("is not held to one society, unlike the supervisor's", async () => {
    // An admin covering a society between supervisors has to be able to hand a
    // ticket to somebody; insisting the assignee share a society they may not have
    // would refuse the very case the admin exists for.
    const id = await aTicket();
    const elsewhere = await container.store.users.find(
      (u) => u.roles.includes("operator") && !u.societyIds.includes("soc-demo"),
    );
    expect(elsewhere.length).toBeGreaterThan(0);
    expect((await assign(id, elsewhere[0].id)).statusCode).toBe(200);
  });

  it("offers the people a ticket could be handed to", async () => {
    // Sent with the list, because a screen cannot build that list from the tickets
    // in front of it: those only name people who already hold one.
    const listed = await app.inject({ method: "GET", url: "/v1/admin/issues", headers: bearer(admin) });
    const assignees = listed.json().assignees as { id: string; name: string; role: string }[];
    expect(assignees.map((a) => a.id)).toContain("user-sup");
    expect(assignees.map((a) => a.id)).not.toContain("user-res");
  });

  it("offers a supervisor only the people in their own societies", async () => {
    // The same boundary the supervisor's assign route enforces. Offering somebody
    // the server will then refuse is worse than not offering them.
    const supervisor = await loginSupervisor(app);
    const listed = await app.inject({ method: "GET", url: "/v1/supervisor/issues", headers: bearer(supervisor) });
    const assignees = listed.json().assignees as { id: string }[];
    expect(assignees.length).toBeGreaterThan(0);
    for (const person of assignees) {
      const user = (await container.store.users.get(person.id))!;
      expect(user.societyIds).toContain("soc-demo");
    }
  });
});
