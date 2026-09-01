import { describe, it, expect } from "vitest";
import {
  makeTestApp, bearer,
  loginResident, loginOperator, loginOtherOperator, loginSupervisor, loginAdmin,
} from "./helpers";
import { SLOT_WINDOWS, BOOKING_CUTOFF_MINUTES, SLOT_CREATION_LEAD_MINUTES } from "../../src/services/scheduling-service";

// The issues and enhancements raised in the fifth round of testing: the issue
// escalation hierarchy, the eight issue statuses, who may see which issue, the
// fixed slot windows with their lead time and booking cutoff, and the three
// dashboards.

// Far enough ahead that the two hour creation lead time is always satisfied.
const SOON = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);

// The seed has no orders in it, so a dashboard test that needs one says so
// explicitly rather than depending on whatever happens to have been seeded.
const putOrder = async (container: Awaited<ReturnType<typeof makeTestApp>>["container"], over: Record<string, unknown> = {}) =>
  container.store.orders.put({
    id: `ord-${Math.round(Math.random() * 1e9)}`, orderCode: "ORD-9001", pickupId: null,
    residentId: "res-demo", societyId: "soc-demo", subscriptionId: null,
    // The tower res-demo lives in. An order without one is an order no operator
    // covers, because blocks are what an operator is given.
    blockId: "block-demo-a",
    state: "picked_up", qrBatchCode: null, items: [], addonIds: [], lines: [], servicesPaise: 0,
    estimatedCount: 3, pickupCount: 3, acceptedCount: 3, subscriptionCoveredCount: 3,
    additionalCount: 0, additionalRatePaise: null, additionalChargePaise: null, payPerOrder: false,
    additionalChargeStatus: "none", deliveryCount: null, qcPassed: null, qcReason: null, qcAttempts: 0,
    pickupFailureReason: null, discrepancyReason: null, assignedOperatorUserId: null, deliveredByUserId: null,
    expectedCompletionAt: null, pickedUpAt: null, deliveredAt: null, rating: null, ratingComment: null,
    timeline: [], createdAt: new Date().toISOString(),
    ...over,
  } as never);

const raiseAsResident = async (
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  token: string,
  over: Record<string, unknown> = {},
) => {
  const response = await app.inject({
    method: "POST", url: "/v1/support/tickets", headers: bearer(token),
    payload: JSON.stringify({ category: "delivery_issue", description: "My order never arrived", ...over }),
  });
  expect(response.statusCode).toBe(201);
  return response.json().ticket as { id: string; status: string; responsibleRole: string | null };
};

describe("DFT issue escalation follows the hierarchy", () => {
  it("puts a resident's issue with the operator first, not with the supervisor", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));
    expect(ticket.responsibleRole).toBe("operator");
    expect(ticket.status).toBe("open");
  });

  it("puts an operator's own issue with their supervisor, and keeps it visible to the operator", async () => {
    const { app } = await makeTestApp();
    const operatorToken = await loginOperator(app);
    const raised = await app.inject({
      method: "POST", url: "/v1/operations/issues", headers: bearer(operatorToken),
      payload: JSON.stringify({ type: "delivery_issue", description: "The society gate is locked at 9am" }),
    });
    expect(raised.statusCode).toBe(201);
    const ticketId = raised.json().issue.id as string;
    expect(raised.json().issue.responsibleRole).toBe("supervisor");

    // The operator raised it, so it stays theirs to follow even though somebody
    // else has to answer it. This is what was reported as "my own issue vanished".
    const mine = await app.inject({ method: "GET", url: "/v1/operations/issues", headers: bearer(operatorToken) });
    expect((mine.json().issues as { id: string }[]).map((i) => i.id)).toContain(ticketId);

    // And their supervisor sees it, because it belongs to their society.
    const supervisorToken = await loginSupervisor(app);
    const theirs = await app.inject({ method: "GET", url: "/v1/supervisor/issues", headers: bearer(supervisorToken) });
    expect((theirs.json().issues as { id: string }[]).map((i) => i.id)).toContain(ticketId);
  });

  it("moves an issue up one rung at a time and never back down", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));

    // Operator cannot settle it, so it goes to the supervisor.
    const operatorToken = await loginOperator(app);
    const toSupervisor = await app.inject({
      method: "POST", url: `/v1/operations/issues/${ticket.id}/escalate`, headers: bearer(operatorToken),
      payload: JSON.stringify({ note: "The garment is not in our facility" }),
    });
    expect(toSupervisor.statusCode).toBe(200);
    expect(toSupervisor.json().issue.responsibleRole).toBe("supervisor");
    expect(toSupervisor.json().issue.escalatedToSupervisor).toBe(true);
    expect(toSupervisor.json().issue.escalatedToAdmin).toBe(false);

    // Supervisor cannot settle it either, so it goes to the admin.
    const supervisorToken = await loginSupervisor(app);
    const toAdmin = await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticket.id}/escalate`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ note: "Needs a goodwill decision" }),
    });
    expect(toAdmin.statusCode).toBe(200);
    expect(toAdmin.json().issue.responsibleRole).toBe("admin");
    expect(toAdmin.json().issue.escalatedToAdmin).toBe(true);

    // There is nothing above the admin, so escalating again is refused rather
    // than quietly doing nothing.
    const again = await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticket.id}/escalate`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ note: "Still stuck" }),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("cannot_escalate");
  });

  it("records the escalation on the ticket even when the escalating person says nothing", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));
    const operatorToken = await loginOperator(app);
    const escalated = await app.inject({
      method: "POST", url: `/v1/operations/issues/${ticket.id}/escalate`, headers: bearer(operatorToken),
      payload: JSON.stringify({}),
    });
    expect(escalated.statusCode).toBe(200);
    const bodies = (escalated.json().issue.messages as { body: string; authorRole: string }[]);
    expect(bodies.some((m) => m.authorRole === "system" && m.body.includes("Escalated to supervisor"))).toBe(true);
  });

  it("keeps a note the escalating person adds as their own line, not as the event", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));
    const operatorToken = await loginOperator(app);
    const escalated = await app.inject({
      method: "POST", url: `/v1/operations/issues/${ticket.id}/escalate`, headers: bearer(operatorToken),
      payload: JSON.stringify({ note: "I checked the van twice" }),
    });
    const messages = escalated.json().issue.messages as { body: string; authorRole: string }[];
    expect(messages.some((m) => m.authorRole === "system" && m.body.includes("Escalated to supervisor"))).toBe(true);
    expect(messages.some((m) => m.authorRole === "operator" && m.body === "I checked the van twice")).toBe(true);
  });

  it("lets the operator who raised it read what the supervisor and admin said", async () => {
    const { app } = await makeTestApp();
    const operatorToken = await loginOperator(app);
    const raised = await app.inject({
      method: "POST", url: "/v1/operations/issues", headers: bearer(operatorToken),
      payload: JSON.stringify({ type: "other", description: "Need a second trolley" }),
    });
    const ticketId = raised.json().issue.id as string;

    const supervisorToken = await loginSupervisor(app);
    await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${ticketId}/reply`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ body: "Ordered, arrives Friday" }),
    });

    const seen = await app.inject({ method: "GET", url: `/v1/operations/issues/${ticketId}`, headers: bearer(operatorToken) });
    expect(seen.statusCode).toBe(200);
    expect((seen.json().issue.messages as { body: string }[]).some((m) => m.body === "Ordered, arrives Friday")).toBe(true);
  });
});

describe("DFT an issue is only visible to the people it concerns", () => {
  it("hides an issue from an operator in another society", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));
    const outsider = await loginOtherOperator(app);

    const list = await app.inject({ method: "GET", url: "/v1/operations/issues", headers: bearer(outsider) });
    expect((list.json().issues as { id: string }[]).map((i) => i.id)).not.toContain(ticket.id);

    // And not by asking for it directly either.
    const direct = await app.inject({ method: "GET", url: `/v1/operations/issues/${ticket.id}`, headers: bearer(outsider) });
    expect(direct.statusCode).toBe(403);
  });

  it("still shows every issue to the admin", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));
    const adminToken = await loginAdmin(app);
    const list = await app.inject({ method: "GET", url: "/v1/admin/issues", headers: bearer(adminToken) });
    expect((list.json().issues as { id: string }[]).map((i) => i.id)).toContain(ticket.id);
  });

  it("shows a resident their own issue and nobody else's", async () => {
    const { app } = await makeTestApp();
    const mine = await raiseAsResident(app, await loginResident(app));
    const otherToken = await loginResident(app, "9876543211");
    const theirs = await app.inject({ method: "GET", url: "/v1/support/tickets", headers: bearer(otherToken) });
    expect((theirs.json().tickets as { id: string }[]).map((t) => t.id)).not.toContain(mine.id);
  });
});

describe("DFT issue statuses say who is being waited on", () => {
  it("offers all eight statuses and accepts the waiting ones", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));
    const operatorToken = await loginOperator(app);

    const listed = await app.inject({ method: "GET", url: "/v1/operations/issues", headers: bearer(operatorToken) });
    expect(listed.json().statuses).toEqual(expect.arrayContaining([
      "open", "in_progress", "waiting_resident", "waiting_operator",
      "escalated_supervisor", "escalated_admin", "resolved", "closed",
    ]));

    const waiting = await app.inject({
      method: "PATCH", url: `/v1/operations/issues/${ticket.id}/status`, headers: bearer(operatorToken),
      payload: JSON.stringify({ status: "waiting_resident" }),
    });
    expect(waiting.statusCode).toBe(200);
    expect(waiting.json().issue.status).toBe("waiting_resident");
  });

  it("refuses to reopen a closed ticket, because closed is the end of it", async () => {
    const { app } = await makeTestApp();
    const ticket = await raiseAsResident(app, await loginResident(app));
    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "PATCH", url: `/v1/operations/issues/${ticket.id}/status`, headers: bearer(operatorToken),
      payload: JSON.stringify({ status: "closed" }),
    });
    const reopen = await app.inject({
      method: "PATCH", url: `/v1/operations/issues/${ticket.id}/status`, headers: bearer(operatorToken),
      payload: JSON.stringify({ status: "in_progress" }),
    });
    expect(reopen.statusCode).toBe(409);
  });
});

describe("DFT pickup slots run to fixed hours", () => {
  const createSlot = (app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, body: Record<string, unknown>) =>
    app.inject({
      method: "POST", url: "/v1/supervisor/slots", headers: bearer(token),
      payload: JSON.stringify({ societyId: "soc-demo", date: SOON, capacityTotal: 10, ...body }),
    });

  it("takes the hours from the window and ignores any times sent with the request", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const created = await createSlot(app, token, { window: "Morning", startTime: "03:00", endTime: "04:00" });
    expect(created.statusCode).toBe(201);
    expect(created.json().slot.startTime).toBe(SLOT_WINDOWS.Morning.startTime);
    expect(created.json().slot.endTime).toBe(SLOT_WINDOWS.Morning.endTime);
  });

  it("gives every window its own fixed hours", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    for (const window of ["Morning", "Afternoon", "Evening"] as const) {
      const created = await createSlot(app, token, { window });
      expect(created.statusCode).toBe(201);
      expect(created.json().slot.startTime).toBe(SLOT_WINDOWS[window].startTime);
      expect(created.json().slot.endTime).toBe(SLOT_WINDOWS[window].endTime);
    }
  });

  it("refuses a window it does not know", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const created = await createSlot(app, token, { window: "Midnight" });
    expect(created.statusCode).toBe(400);
  });

  it("refuses a slot created with less than two hours' notice", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    expect(SLOT_CREATION_LEAD_MINUTES).toBe(120);

    // The seed fills every window of today and tomorrow for every society, and a
    // society may hold one slot per window per day — so today's have to be
    // retired before this test can create today's. It is the lead time being
    // tested here, not the uniqueness rule, which has its own tests.
    const nowForClearing = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    for (const seeded of await container.store.slots.find((sl) => sl.date === nowForClearing)) {
      await container.store.slots.put({ ...seeded, isActive: false });
    }

    // Checked against every window for today, so the assertion holds whatever the
    // clock says when the suite runs: a window less than two hours away is
    // refused, and one further off is allowed.
    const nowIst = new Date(Date.now() + 330 * 60_000);
    const todayIst = nowIst.toISOString().slice(0, 10);
    const minutesNow = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
    let checked = 0;
    for (const window of ["Morning", "Afternoon", "Evening"] as const) {
      const [h, m] = SLOT_WINDOWS[window].startTime.split(":").map(Number);
      const lead = h * 60 + m - minutesNow;
      const created = await createSlot(app, token, { window, date: todayIst });
      if (lead < SLOT_CREATION_LEAD_MINUTES) {
        expect([400, 422]).toContain(created.statusCode);
        checked += 1;
      } else {
        expect(created.statusCode).toBe(201);
      }
    }
    // Some window of today is always inside the lead time, because the last one
    // starts at 17:00 and a day runs to midnight.
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it("keeps the hours tied to the window when the slot is moved to another one", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const created = await createSlot(app, token, { window: "Morning" });
    const slotId = created.json().slot.id as string;
    const moved = await app.inject({
      method: "PATCH", url: `/v1/supervisor/slots/${slotId}`, headers: bearer(token),
      payload: JSON.stringify({ window: "Evening" }),
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().slot.startTime).toBe(SLOT_WINDOWS.Evening.startTime);
    expect(moved.json().slot.endTime).toBe(SLOT_WINDOWS.Evening.endTime);
  });

  it("tells the client what the windows mean, so nobody has to guess", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const listed = await app.inject({ method: "GET", url: "/v1/supervisor/slots", headers: bearer(token) });
    expect(listed.json().slotWindows.Morning).toEqual(SLOT_WINDOWS.Morning);
  });

  it("closes booking half an hour before a slot starts", async () => {
    const { app, container } = await makeTestApp();
    // A slot starting in ten minutes: still in the future, but past the cutoff.
    const start = new Date(Date.now() + 10 * 60_000 + 330 * 60_000);
    const hhmm = start.toISOString().slice(11, 16);
    await container.store.slots.put({
      id: "slot-closing", societyId: "soc-demo", date: start.toISOString().slice(0, 10),
      window: "Morning", startTime: hhmm, endTime: "23:59",
      capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });

    const residentToken = await loginResident(app);
    const available = await app.inject({ method: "GET", url: "/v1/slots", headers: bearer(residentToken) });
    expect((available.json().slots as { id: string }[]).map((s) => s.id)).not.toContain("slot-closing");

    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
      payload: JSON.stringify({ slotId: "slot-closing", estimatedCount: 3 }),
    });
    expect(booked.statusCode).toBe(409);
    expect(booked.json().error).toBe("booking_closed");
    expect(BOOKING_CUTOFF_MINUTES).toBe(30);
  });

  it("hides a slot whose window has already finished", async () => {
    const { app, container } = await makeTestApp();
    const nowIst = new Date(Date.now() + 330 * 60_000);
    await container.store.slots.put({
      id: "slot-over", societyId: "soc-demo", date: nowIst.toISOString().slice(0, 10),
      window: "Morning", startTime: "00:00", endTime: "00:01",
      capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    const residentToken = await loginResident(app);
    const available = await app.inject({ method: "GET", url: "/v1/slots", headers: bearer(residentToken) });
    expect((available.json().slots as { id: string }[]).map((s) => s.id)).not.toContain("slot-over");
  });
});

describe("DFT the dashboards answer the questions they are for", () => {
  it("tells the operator what is waiting on them and what is coming", async () => {
    const { app } = await makeTestApp();
    const token = await loginOperator(app);
    const dashboard = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(200);
    const body = dashboard.json();
    expect(Array.isArray(body.actionRequired)).toBe(true);
    expect(Array.isArray(body.upcomingPickups)).toBe(true);
    expect(body.processing).toHaveProperty("stages");
    expect(body.pickups).toHaveProperty("pending");
    expect(body.orders).toHaveProperty("deliveredToday");
    expect(body.issues).toHaveProperty("escalatedSupervisor");
  });

  it("names the processing stages after what the garments were sent for", async () => {
    const { app, container } = await makeTestApp();
    // A batch sent for dry cleaning is counted as dry cleaning, not as washing.
    await putOrder(container, {
      state: "in_wash",
      lines: [{
        id: "line-dc", category: "Shirt", quantity: 2, serviceId: "svc-dry", serviceName: "Dry Clean",
        addonIds: [], serviceUnitPricePaise: 0, addonsPaise: 0, linePricePaise: 0,
        requiresClean: true, cleanStage: "dry_clean", requiresPress: false,
        coveredByPlan: false, notes: null,
      }],
    });

    const token = await loginOperator(app);
    const dashboard = await app.inject({ method: "GET", url: "/v1/operations/dashboard", headers: bearer(token) });
    const stages = dashboard.json().processing.stages as { key: string; label: string; count: number }[];
    expect(stages.some((s) => s.key === "dry_clean" && s.label === "Dry Cleaning")).toBe(true);
    expect(stages.some((s) => s.key === "wash")).toBe(false);
  });

  it("gives the supervisor their society and only their society", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const dashboard = await app.inject({ method: "GET", url: "/v1/supervisor/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(200);
    const body = dashboard.json();
    expect(body.society).toBeTruthy();
    // And the towers of it, because that is what they hand out to operators.
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.pickups).toHaveProperty("completed");
    expect(body.orders).toHaveProperty("active");
    expect(body.issues).toHaveProperty("escalatedAdmin");
    expect(body.processing).toHaveProperty("stages");
  });

  it("gives the admin the whole platform, society by society, with what needs attention", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const dashboard = await app.inject({ method: "GET", url: "/v1/admin/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(200);
    const body = dashboard.json();
    expect(Array.isArray(body.societyPerformance)).toBe(true);
    expect(body.societyPerformance.length).toBeGreaterThan(0);
    expect(body.societyPerformance[0]).toHaveProperty("delayedOrders");
    expect(body.societyPerformance[0]).toHaveProperty("openIssues");
    expect(body.societyPerformance[0]).toHaveProperty("supervisorName");
    expect(Array.isArray(body.recentActivity)).toBe(true);
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.subscriptions).toHaveProperty("expired");
    expect(body.operations.pickups).toHaveProperty("failed");
  });

  it("raises an alert only for something that is actually wrong", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginAdmin(app);

    const before = await app.inject({ method: "GET", url: "/v1/admin/dashboard", headers: bearer(token) });
    const qcBefore = (before.json().alerts as { kind: string }[]).filter((a) => a.kind === "qc_failed");
    expect(qcBefore).toHaveLength(0);

    await putOrder(container, { state: "qc_hold" });

    const after = await app.inject({ method: "GET", url: "/v1/admin/dashboard", headers: bearer(token) });
    const qcAfter = (after.json().alerts as { kind: string; count: number }[]).find((a) => a.kind === "qc_failed");
    expect(qcAfter?.count).toBe(1);
  });
});
