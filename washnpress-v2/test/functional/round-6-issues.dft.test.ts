import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, loginOperator, loginSupervisor, loginAdmin } from "./helpers";
import { IssueService } from "../../src/services/issue-service";

// The issue lifecycle defects from the sixth round: two escalation implementations
// that left tickets in different states, analytics that counted only the last rung,
// an admin who could resolve but not close, and a cancellation that answered the
// wrong question when asked badly.

const raise = async (app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string) => {
  const response = await app.inject({
    method: "POST", url: "/v1/support/tickets", headers: bearer(token),
    payload: JSON.stringify({ category: "delivery_issue", description: "Round 6 issue lifecycle" }),
  });
  expect(response.statusCode).toBe(201);
  return response.json().ticket.id as string;
};

describe("DFT there is one way to escalate an issue", () => {
  it("no longer offers a second implementation that skips the state machine", () => {
    // The old escalate() set escalatedToAdmin and bumped the priority without
    // touching status or responsibleRole, so the same word meant two different
    // things depending on which path was taken.
    expect((IssueService.prototype as unknown as Record<string, unknown>).escalate).toBeUndefined();
    expect(typeof (IssueService.prototype as unknown as Record<string, unknown>).escalateOneLevel).toBe("function");
  });

  it("leaves the same state whichever role escalates", async () => {
    const { app } = await makeTestApp();
    const ticketId = await raise(app, await loginResident(app));

    const toSupervisor = await app.inject({
      method: "POST", url: `/v1/operations/issues/${ticketId}/escalate`, headers: bearer(await loginOperator(app)),
      payload: JSON.stringify({ note: "Cannot settle it" }),
    });
    const afterOperator = toSupervisor.json().issue;
    expect(afterOperator.responsibleRole).toBe("supervisor");
    expect(afterOperator.status).toBe("escalated_supervisor");
    expect(afterOperator.escalatedToSupervisor).toBe(true);

    const toAdmin = await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticketId}/escalate`, headers: bearer(await loginSupervisor(app)),
      payload: JSON.stringify({ note: "Needs a decision" }),
    });
    const afterSupervisor = toAdmin.json().issue;
    // Every field the escalation is supposed to move, moved — which the old second
    // path did not do.
    expect(afterSupervisor.responsibleRole).toBe("admin");
    expect(afterSupervisor.status).toBe("escalated_admin");
    expect(afterSupervisor.escalatedToAdmin).toBe(true);
    expect(afterSupervisor.escalatedToSupervisor).toBe(true);
  });
});

describe("DFT analytics count an escalation at whichever rung it reached", () => {
  it("counts one that is only with the supervisor", async () => {
    const { app } = await makeTestApp();
    const ticketId = await raise(app, await loginResident(app));
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${ticketId}/escalate`, headers: bearer(await loginOperator(app)),
      payload: JSON.stringify({ note: "Up to you" }),
    });

    const analytics = await app.inject({
      method: "GET", url: "/v1/admin/issues/analytics", headers: bearer(await loginAdmin(app)),
    });
    const body = analytics.json().analytics;
    // It used to be reported as never escalated, because only escalatedToAdmin counted.
    expect(body.escalated).toBe(1);
    expect(body.escalatedToAdmin).toBe(0);
  });

  it("reports how long the open issues have been waiting", async () => {
    const { app, container } = await makeTestApp();
    const common = {
      residentId: "res-demo", orderId: null, societyId: "soc-demo", areaId: "area-madhapur",
      category: "delivery_issue", status: "open", priority: "normal", reportedByUserId: "user-res",
      reportedByRole: "resident", assignedToUserId: null, resolution: null, resolvedAt: null,
      closedAt: null, escalatedToAdmin: false, responsibleRole: "operator",
      escalatedToSupervisor: false, messages: [],
    };
    await container.store.tickets.put({ ...common, id: "tkt-fresh", description: "Just now", createdAt: new Date().toISOString() } as never);
    await container.store.tickets.put({ ...common, id: "tkt-two-days", description: "Two days", createdAt: new Date(Date.now() - 48 * 3600_000).toISOString() } as never);
    await container.store.tickets.put({ ...common, id: "tkt-ancient", description: "Ten days", createdAt: new Date(Date.now() - 10 * 86400_000).toISOString() } as never);

    const analytics = await app.inject({
      method: "GET", url: "/v1/admin/issues/analytics", headers: bearer(await loginAdmin(app)),
    });
    const bands = analytics.json().analytics.ageBands as { key: string; count: number }[];
    const count = (key: string) => bands.find((b) => b.key === key)?.count ?? 0;
    expect(count("under_24h")).toBe(1);
    expect(count("1_3d")).toBe(1);
    expect(count("over_7d")).toBe(1);
    expect(analytics.json().analytics.oldestOpen.id).toBe("tkt-ancient");
  });
});

describe("DFT an admin controls the whole issue lifecycle", () => {
  it("closes an issue directly", async () => {
    const { app } = await makeTestApp();
    const ticketId = await raise(app, await loginResident(app));
    const closed = await app.inject({
      method: "POST", url: `/v1/admin/issues/${ticketId}/close`, headers: bearer(await loginAdmin(app)),
      payload: JSON.stringify({ resolution: "Settled by phone" }),
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().issue.status).toBe("closed");
  });

  it("reopens one, and says on the ticket why", async () => {
    const { app } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const ticketId = await raise(app, await loginResident(app));
    await app.inject({
      method: "POST", url: `/v1/admin/issues/${ticketId}/close`, headers: bearer(adminToken),
      payload: JSON.stringify({ resolution: "Closed too soon" }),
    });

    const reopened = await app.inject({
      method: "POST", url: `/v1/admin/issues/${ticketId}/reopen`, headers: bearer(adminToken),
      payload: JSON.stringify({ reason: "The resident says it is not settled" }),
    });
    expect(reopened.statusCode).toBe(200);
    const issue = reopened.json().issue;
    expect(issue.status).toBe("in_progress");
    expect(issue.closedAt).toBeNull();
    expect(issue.resolution).toBeNull();
    expect((issue.messages as { body: string; authorRole: string }[]).some(
      (m) => m.authorRole === "system" && m.body.includes("The resident says it is not settled"),
    )).toBe(true);
  });

  it("will not reopen without saying why", async () => {
    const { app } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const ticketId = await raise(app, await loginResident(app));
    await app.inject({
      method: "POST", url: `/v1/admin/issues/${ticketId}/close`, headers: bearer(adminToken),
      payload: JSON.stringify({}),
    });
    const reopened = await app.inject({
      method: "POST", url: `/v1/admin/issues/${ticketId}/reopen`, headers: bearer(adminToken),
      payload: JSON.stringify({}),
    });
    expect(reopened.statusCode).toBe(400);
  });

  it("keeps closing to the admin, not to everybody", async () => {
    const { app } = await makeTestApp();
    const ticketId = await raise(app, await loginResident(app));
    const asSupervisor = await app.inject({
      method: "POST", url: `/v1/admin/issues/${ticketId}/reopen`, headers: bearer(await loginSupervisor(app)),
      payload: JSON.stringify({ reason: "Let me" }),
    });
    expect(asSupervisor.statusCode).toBe(403);
  });
});

describe("DFT cancelling a pickup answers the question that was asked", () => {
  it("says the request was malformed rather than that nothing was found", async () => {
    const { app } = await makeTestApp();
    const token = await loginResident(app);
    for (const payload of ["{}", JSON.stringify({ pickupId: "" }), JSON.stringify({ pickup: "x" })]) {
      const cancelled = await app.inject({
        method: "POST", url: "/v1/pickups/cancel", headers: bearer(token), payload,
      });
      // It used to look up an empty id and answer 404, which said the pickup did not
      // exist rather than that the question was wrong.
      expect(cancelled.statusCode).toBe(400);
      expect(cancelled.json().error).toBe("invalid_request");
    }
  });

  it("still cancels a real pickup", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginResident(app);
    const soon = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
    await container.store.slots.put({
      id: "slot-cancel", societyId: "soc-demo", date: soon, window: "Morning",
      startTime: "09:00", endTime: "12:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-cancel", estimatedCount: 2 }),
    });
    const pickupId = booked.json().pickup.id as string;

    const cancelled = await app.inject({
      method: "POST", url: "/v1/pickups/cancel", headers: bearer(token),
      payload: JSON.stringify({ pickupId }),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().pickup.status).toBe("cancelled");
    expect((await container.store.slots.get("slot-cancel"))!.capacityRemaining).toBe(5);
  });

  it("still refuses to cancel somebody else's", async () => {
    const { app, container } = await makeTestApp();
    const soon = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
    await container.store.slots.put({
      id: "slot-mine", societyId: "soc-demo", date: soon, window: "Morning",
      startTime: "09:00", endTime: "12:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({ slotId: "slot-mine", estimatedCount: 2 }),
    });
    const pickupId = booked.json().pickup.id as string;

    const asOther = await app.inject({
      method: "POST", url: "/v1/pickups/cancel", headers: bearer(await loginResident(app, "9876543211")),
      payload: JSON.stringify({ pickupId }),
    });
    expect(asOther.statusCode).toBe(404);
  });
});
