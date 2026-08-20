import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, bearer, loginAdmin, loginSupervisor, loginOperator, loginResident, loginOtherSupervisor } from "./helpers";

// Customer support. The resident raises the issue, the supervisor for that area is
// the first line, and the resident closes it once they are satisfied. The resident
// never has to settle a dispute with the operator directly.
describe("DFT customer support", () => {
  it("runs a ticket from raised to closed with the conversation on the record", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-sup-1", 5);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-sup-1" });
    const residentToken = await loginResident(app);

    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
      payload: JSON.stringify({ category: "delivery_issue", description: "When will my order be delivered?", orderId: booked.order.id }),
    });
    expect(raised.statusCode).toBe(201);
    const ticketId = raised.json().ticket.id as string;
    expect(raised.json().ticket.status).toBe("open");
    // The ticket knows which order and which resident it belongs to.
    expect(raised.json().ticket.order.orderCode).toBe(booked.order.orderCode);
    expect(raised.json().ticket.residentName).toBe("Anusha");

    // The supervisor for that area sees it and replies.
    const supervisorToken = await loginSupervisor(app);
    const queue = await app.inject({ method: "GET", url: "/v1/supervisor/issues?open=true", headers: bearer(supervisorToken) });
    expect((queue.json().issues as Array<{ id: string }>).some((i) => i.id === ticketId)).toBe(true);

    const replied = await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticketId}/reply`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ body: "It is out for delivery and will arrive by 6pm." }),
    });
    expect(replied.statusCode).toBe(200);
    // Replying takes the ticket off the untouched pile.
    expect(replied.json().issue.status).toBe("in_progress");
    expect(replied.json().issue.messages).toHaveLength(1);
    expect(replied.json().issue.messages[0].authorRole).toBe("supervisor");

    const resolved = await app.inject({
      method: "PATCH", url: `/v1/supervisor/issues/${ticketId}/status`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "resolved", resolution: "Delivered at 5:40pm" }),
    });
    expect(resolved.json().issue.status).toBe("resolved");
    expect(resolved.json().issue.resolutionMinutes).not.toBeNull();

    // The resident sees the reply and closes the ticket themselves.
    const mine = await app.inject({ method: "GET", url: "/v1/support/tickets", headers: bearer(residentToken) });
    const ticket = (mine.json().tickets as Array<{ id: string; status: string; messages: unknown[] }>).find((t) => t.id === ticketId);
    expect(ticket!.status).toBe("resolved");
    expect(ticket!.messages).toHaveLength(1);

    const closed = await app.inject({ method: "POST", url: `/v1/support/tickets/${ticketId}/close`, headers: bearer(residentToken) });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().ticket.status).toBe("closed");

    // Closing is final.
    const afterClose = await app.inject({
      method: "POST", url: `/v1/support/tickets/${ticketId}/reply`, headers: bearer(residentToken),
      payload: JSON.stringify({ body: "One more thing" }),
    });
    expect(afterClose.statusCode).toBe(409);
  });

  it("puts a resolved ticket back into progress when the resident is still unhappy", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
      payload: JSON.stringify({ category: "missing_garment", description: "A shirt is missing" }),
    });
    const ticketId = raised.json().ticket.id as string;
    const supervisorToken = await loginSupervisor(app);
    await app.inject({
      method: "PATCH", url: `/v1/supervisor/issues/${ticketId}/status`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "resolved", resolution: "Found in the next batch" }),
    });

    const reply = await app.inject({
      method: "POST", url: `/v1/support/tickets/${ticketId}/reply`, headers: bearer(residentToken),
      payload: JSON.stringify({ body: "It still has not arrived" }),
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().ticket.status).toBe("in_progress");
  });

  it("flags an emergency and escalates it to admin", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
      payload: JSON.stringify({ category: "missing_garment", description: "Missing expensive garment", priority: "emergency" }),
    });
    const ticketId = raised.json().ticket.id as string;
    expect(raised.json().ticket.priority).toBe("emergency");

    const supervisorToken = await loginSupervisor(app);
    const urgent = await app.inject({ method: "GET", url: "/v1/supervisor/issues?emergency=true", headers: bearer(supervisorToken) });
    expect((urgent.json().issues as Array<{ id: string }>).map((i) => i.id)).toContain(ticketId);

    await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticketId}/escalate`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ note: "High value claim, needs a decision" }),
    });

    const adminToken = await loginAdmin(app);
    const escalated = await app.inject({ method: "GET", url: "/v1/admin/issues?escalated=true", headers: bearer(adminToken) });
    expect((escalated.json().issues as Array<{ id: string }>).map((i) => i.id)).toContain(ticketId);

    // Admin can read the whole exchange and the supervisor's actions.
    const detail = await app.inject({ method: "GET", url: `/v1/admin/issues/${ticketId}`, headers: bearer(adminToken) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().issue.escalatedToAdmin).toBe(true);
    expect((detail.json().issue.messages as Array<{ body: string }>).some((m) => m.body.includes("Escalated to admin"))).toBe(true);
  });

  it("reports support analytics for the admin", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    for (const [category, priority] of [["delivery_issue", "normal"], ["payment_issue", "emergency"], ["missing_garment", "high"]] as const) {
      await app.inject({
        method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
        payload: JSON.stringify({ category, description: `${category} raised`, priority }),
      });
    }
    const supervisorToken = await loginSupervisor(app);
    const open = await app.inject({ method: "GET", url: "/v1/supervisor/issues", headers: bearer(supervisorToken) });
    const first = (open.json().issues as Array<{ id: string }>)[0];
    await app.inject({
      method: "PATCH", url: `/v1/supervisor/issues/${first.id}/status`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "resolved", resolution: "Handled" }),
    });

    const adminToken = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: "/v1/admin/issues/analytics", headers: bearer(adminToken) });
    expect(res.statusCode).toBe(200);
    const a = res.json().analytics;
    expect(a.total).toBe(3);
    expect(a.resolved).toBe(1);
    expect(a.pending).toBe(2);
    expect(a.emergency).toBe(1);
    expect(a.averageResolutionMinutes).not.toBeNull();
    expect(a.byCategory.length).toBeGreaterThan(0);
    expect(a.bySupervisor.length).toBeGreaterThan(0);
    expect(a.ageing.length).toBe(2);
  });

  it("keeps tickets inside the area boundary and away from other residents", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const raised = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(residentToken),
      payload: JSON.stringify({ category: "delivery_issue", description: "Madhapur ticket" }),
    });
    const ticketId = raised.json().ticket.id as string;

    // The Gachibowli supervisor cannot read or act on a Madhapur ticket.
    const otherToken = await loginOtherSupervisor(app);
    expect((await app.inject({ method: "GET", url: `/v1/supervisor/issues/${ticketId}`, headers: bearer(otherToken) })).statusCode).toBe(403);
    const reply = await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticketId}/reply`, headers: bearer(otherToken),
      payload: JSON.stringify({ body: "Not my area" }),
    });
    expect(reply.statusCode).toBe(403);

    // An operator may read a ticket in their societies to supply information, but
    // resolving it stays with the supervisor.
    const operatorToken = await loginOperator(app);
    expect((await app.inject({ method: "GET", url: `/v1/support/tickets/${ticketId}`, headers: bearer(operatorToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/v1/supervisor/issues/${ticketId}/status`, headers: bearer(operatorToken), payload: JSON.stringify({ status: "resolved" }) })).statusCode).toBe(403);
  });
});
