import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, bearer, loginOperator, loginResident, loginSupervisor, openSlotNow,
} from "./helpers";

// The resident declares a quantity when they book; the operator counts what is
// actually in the bag. Both are real and they are not the same kind of fact: one is
// what was expected, the other is what was verified. The operator's count used to
// simply replace the declaration, so a resident who sent six shirts had no record
// that they ever said six.

async function bookedOrder(slotId: string, quantity = 6) {
  const { app, container } = await makeTestApp();
  await seedSlot(container, slotId, 5);
  const residentToken = await loginResident(app);
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
    payload: JSON.stringify({ slotId, lines: [{ category: "Shirts", quantity, serviceId: "iron_only" }] }),
  });
  expect(booked.statusCode).toBe(201);
  const orderId = booked.json().order.id as string;
  const operatorToken = await loginOperator(app);
  await openSlotNow(container, slotId);
  const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
  const lineId = (detail.json().order.lines as Array<{ id: string }>)[0].id;
  return { app, container, orderId, lineId, residentToken, operatorToken };
}

function confirm(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  orderId: string, token: string, body: unknown,
) {
  return app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`,
    headers: bearer(token), payload: JSON.stringify(body),
  });
}

describe("DFT a quantity discrepancy is recorded, not resolved silently", () => {
  it("offers the reasons rather than making the client keep a list", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/operations/discrepancy-reasons", headers: bearer(await loginOperator(app)) });
    expect(res.statusCode).toBe(200);
    const reasons = res.json().reasons as Array<{ key: string; label: string }>;
    expect(reasons.map((r) => r.key)).toContain("not_handed_over");
    expect(reasons.find((r) => r.key === "item_missing")?.label).toBe("Item missing");
  });

  it("refuses to confirm a short pickup without a reason and remarks", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-disc-1", 6);
    const bare = await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 4 }] });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error).toBe("discrepancy_incomplete");
    expect((bare.json().problems as string[]).length).toBe(2);

    const noRemarks = await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 4 }], discrepancyReason: "not_handed_over",
    });
    expect(noRemarks.statusCode).toBe(400);
    expect((noRemarks.json().problems as string[]).join(" ")).toMatch(/what happened/);
  });

  it("keeps both numbers once it is explained", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-disc-2", 6);
    const res = await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 4 }],
      discrepancyReason: "not_handed_over",
      discrepancyRemarks: "Only four shirts were handed over at the door",
    });
    expect(res.statusCode).toBe(200);
    const order = res.json().order;
    // What was declared survives; what was verified is what gets processed.
    expect(order.requestedCount).toBe(6);
    expect(order.acceptedCount).toBe(4);
    expect(order.quantityDiscrepancy).toMatchObject({
      requested: 6, received: 4, difference: 2, direction: "short",
      reason: "not_handed_over", acknowledgement: "pending",
    });
    expect(order.quantityDiscrepancy.remarks).toBe("Only four shirts were handed over at the door");
  });

  it("records an excess as a discrepancy too", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-disc-3", 4);
    const res = await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 6 }],
      discrepancyReason: "extra_items_handed_over",
      discrepancyRemarks: "Two more shirts were added at the door",
    });
    expect(res.statusCode).toBe(200);
    // Billing for an extra garment without saying so is how a resident finds a charge
    // they did not expect.
    expect(res.json().order.quantityDiscrepancy).toMatchObject({ direction: "excess", difference: 2 });
  });

  it("only processes what was physically received", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-disc-4", 6);
    await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 4 }],
      discrepancyReason: "item_missing", discrepancyRemarks: "Two shirts were not in the bag",
    });
    const batches = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}/batches`, headers: bearer(operatorToken) });
    // Four, not six: garments that were not received are not collected, processed or
    // billed as collected.
    expect((batches.json().batches as Array<{ quantity: number }>)[0].quantity).toBe(4);
  });

  it("says nothing where the counts match", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-disc-5", 5);
    const res = await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 5 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.quantityDiscrepancy).toBeFalsy();
  });

  it("does not hold an estimate to a declaration", async () => {
    // The booking screen says in as many words that the operator confirms the final
    // quantity, so an order booked without per-service lines is not a declaration.
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-disc-6", 5);
    const residentToken = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
      payload: JSON.stringify({ slotId: "slot-disc-6", estimatedCount: 10 }),
    });
    const orderId = booked.json().order.id as string;
    const operatorToken = await loginOperator(app);
    await openSlotNow(container, "slot-disc-6");
    const res = await confirm(app, orderId, operatorToken, { items: [{ category: "Shirts", quantity: 15 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.quantityDiscrepancy).toBeFalsy();
  });
});

describe("DFT the resident is told, and can answer", () => {
  it("is notified with both numbers", async () => {
    const { app, orderId, lineId, operatorToken, residentToken } = await bookedOrder("slot-disc-7", 6);
    await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 4 }],
      discrepancyReason: "not_handed_over", discrepancyRemarks: "Only four handed over",
    });
    const alerts = await app.inject({ method: "GET", url: "/v1/resident/notifications", headers: bearer(residentToken) });
    const notice = (alerts.json().notifications as Array<{ type: string; body: string }>).find((n) => n.type === "pickup.discrepancy");
    expect(notice).toBeTruthy();
    expect(notice!.body).toMatch(/requested 6/);
    expect(notice!.body).toMatch(/collected 4/);
  });

  it("can acknowledge it, and it stays on the record", async () => {
    const { app, orderId, lineId, operatorToken, residentToken } = await bookedOrder("slot-disc-8", 6);
    await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 4 }],
      discrepancyReason: "not_handed_over", discrepancyRemarks: "Only four handed over",
    });
    const res = await app.inject({
      method: "POST", url: `/v1/orders/${orderId}/discrepancy`, headers: bearer(residentToken),
      payload: JSON.stringify({ answer: "acknowledged" }),
    });
    expect(res.statusCode).toBe(200);
    // Acknowledging one does not erase it.
    expect(res.json().order.quantityDiscrepancy).toMatchObject({
      acknowledgement: "acknowledged", requested: 6, received: 4,
    });
  });

  it("can dispute it, and a supervisor hears about it", async () => {
    const { app, orderId, lineId, operatorToken, residentToken } = await bookedOrder("slot-disc-9", 6);
    await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 4 }],
      discrepancyReason: "not_handed_over", discrepancyRemarks: "Only four handed over",
    });
    const res = await app.inject({
      method: "POST", url: `/v1/orders/${orderId}/discrepancy`, headers: bearer(residentToken),
      payload: JSON.stringify({ answer: "disputed", note: "I handed over all six myself" }),
    });
    expect(res.statusCode).toBe(200);
    // Disputing one does not change the count that was verified.
    expect(res.json().order.quantityDiscrepancy).toMatchObject({ acknowledgement: "disputed", received: 4 });
    expect(res.json().order.quantityDiscrepancy.disputeNote).toBe("I handed over all six myself");

    const supervisorToken = await loginSupervisor(app);
    const alerts = await app.inject({ method: "GET", url: "/v1/resident/notifications", headers: bearer(supervisorToken) });
    expect((alerts.json().notifications as Array<{ type: string }>).some((n) => n.type === "pickup.discrepancy_disputed")).toBe(true);
  });

  it("refuses to answer somebody else's order", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-disc-10", 6);
    await confirm(app, orderId, operatorToken, {
      lines: [{ lineId, acceptedQuantity: 4 }],
      discrepancyReason: "item_missing", discrepancyRemarks: "Two missing",
    });
    const other = await loginResident(app, "9876543211");
    const res = await app.inject({
      method: "POST", url: `/v1/orders/${orderId}/discrepancy`, headers: bearer(other),
      payload: JSON.stringify({ answer: "acknowledged" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("says so when there is nothing to answer", async () => {
    const { app, orderId, lineId, operatorToken, residentToken } = await bookedOrder("slot-disc-11", 5);
    await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 5 }] });
    const res = await app.inject({
      method: "POST", url: `/v1/orders/${orderId}/discrepancy`, headers: bearer(residentToken),
      payload: JSON.stringify({ answer: "acknowledged" }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("no_discrepancy");
  });
});

describe("DFT an overdue pickup rises to the top", () => {
  it("is marked Due rather than left as Scheduled", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-due-1", 5);
    const residentToken = await loginResident(app);
    await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
      payload: JSON.stringify({ slotId: "slot-due-1" }),
    });

    const operatorToken = await loginOperator(app);
    // While its window is still ahead, it is scheduled.
    let queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    let row = (queue.json().pickups as Array<{ slotId?: string; pickupStatusLabel: string; due: boolean }>)[0];
    expect(row.due).toBe(false);
    expect(row.pickupStatusLabel).toBe("Scheduled");

    // Once the window has finished, it is due — without anybody reordering anything.
    const slot = (await container.store.slots.get("slot-due-1"))!;
    slot.date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await container.store.slots.put(slot);

    queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    row = (queue.json().pickups as Array<{ pickupStatusLabel: string; due: boolean }>)[0];
    expect(row.due).toBe(true);
    expect(row.pickupStatusLabel).toBe("Due");
  });

  it("puts due pickups above scheduled ones", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-due-2", 5);
    await seedSlot(container, "slot-due-3", 5);
    const residentToken = await loginResident(app);
    await app.inject({ method: "POST", url: "/v1/pickups", headers: bearer(residentToken), payload: JSON.stringify({ slotId: "slot-due-2" }) });
    await app.inject({ method: "POST", url: "/v1/pickups", headers: bearer(residentToken), payload: JSON.stringify({ slotId: "slot-due-3" }) });

    // The second one becomes overdue.
    const late = (await container.store.slots.get("slot-due-3"))!;
    late.date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await container.store.slots.put(late);

    const operatorToken = await loginOperator(app);
    const queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    const rows = queue.json().pickups as Array<{ due: boolean }>;
    // It moves to the top on its own rather than sitting quietly in the middle of the
    // list while the operator works through the ones above it.
    expect(rows[0].due).toBe(true);
    expect(rows.some((r) => !r.due)).toBe(true);
    expect(rows.findIndex((r) => !r.due)).toBeGreaterThan(rows.findIndex((r) => r.due));
  });
});

describe("DFT a pickup can be given to an operator", () => {
  it("offers only operators who cover the society", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/operations/assignable-operators", headers: bearer(await loginOperator(app)) });
    expect(res.statusCode).toBe(200);
    const operators = res.json().operators as Array<{ userId: string; fullName: string }>;
    expect(operators.length).toBeGreaterThan(0);
    expect(operators.every((o) => typeof o.fullName === "string")).toBe(true);
  });

  it("shows the assigned operator immediately, and it persists", async () => {
    const { app, orderId, operatorToken } = await bookedOrder("slot-assign-1", 4);
    const operators = (await app.inject({
      method: "GET", url: "/v1/operations/assignable-operators", headers: bearer(operatorToken),
    })).json().operators as Array<{ userId: string; fullName: string }>;
    const target = operators.find((o) => o.fullName === "Operator 02") ?? operators[0];

    const assigned = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/assign`, headers: bearer(operatorToken),
      payload: JSON.stringify({ operatorUserId: target.userId }),
    });
    expect(assigned.statusCode).toBe(200);
    // Immediately, in the answer to the assignment itself.
    expect(assigned.json().order.assignedOperatorUserId).toBe(target.userId);
    expect(assigned.json().order.operatorName).toBe(target.fullName);

    // And still there when the queue is read again.
    const queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    const row = (queue.json().pickups as Array<{ orderId: string; operatorName: string | null }>).find((p) => p.orderId === orderId)!;
    expect(row.operatorName).toBe(target.fullName);
  });

  it("refuses an operator who does not cover the society", async () => {
    const { app, container, orderId, operatorToken } = await bookedOrder("slot-assign-2", 4);
    const outsider = await container.store.users.put({
      id: "user-far-op", phone: "9876500077", fullName: "Far Operator", email: null, employeeId: "WNP-OP-77",
      status: "active", roles: ["operator"], lastLoginAt: null,
      areaId: "area-gachibowli", societyIds: ["soc-gachibowli"],
      verificationStatus: "approved", createdAt: new Date().toISOString(),
    } as never);
    const res = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/assign`, headers: bearer(operatorToken),
      payload: JSON.stringify({ operatorUserId: (outsider as { id: string }).id }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("operator_out_of_scope");
  });

  it("can hand it back to the shared queue", async () => {
    const { app, orderId, operatorToken } = await bookedOrder("slot-assign-3", 4);
    const operators = (await app.inject({
      method: "GET", url: "/v1/operations/assignable-operators", headers: bearer(operatorToken),
    })).json().operators as Array<{ userId: string }>;
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/assign`, headers: bearer(operatorToken),
      payload: JSON.stringify({ operatorUserId: operators[0].userId }),
    });
    const released = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/assign`, headers: bearer(operatorToken),
      payload: JSON.stringify({ operatorUserId: null, reason: "Not my round today" }),
    });
    expect(released.statusCode).toBe(200);
    expect(released.json().order.assignedOperatorUserId).toBeNull();
  });
});
