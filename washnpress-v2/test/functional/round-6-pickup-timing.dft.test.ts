import { describe, it, expect } from "vitest";
import { makeTestApp, openSlotNow, bearer, loginResident, loginOperator } from "./helpers";
import { pickupWindowOpen, minutesUntilPickup, today } from "../../src/services/scheduling-service";

// ISSUE-13, ISSUE-21 and ISSUE-22 from the sixth round: an order could be collected,
// processed and delivered before its own scheduled pickup date, and the pickup queue
// hid everything that had not come round yet.

async function bookFor(slotId: string, date: string) {
  const { app, container } = await makeTestApp();
  await container.store.slots.put({
    id: slotId, societyId: "soc-demo", date, window: "Evening",
    startTime: "17:00", endTime: "20:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
  });
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
    payload: JSON.stringify({ slotId, estimatedCount: 3 }),
  });
  expect(booked.statusCode).toBe(201);
  return {
    app, container,
    orderId: booked.json().order.id as string,
    pickupId: booked.json().pickup.id as string,
    operatorToken: await loginOperator(app),
  };
}

const tomorrow = () => {
  const d = new Date(Date.now() + 86400_000 + 330 * 60_000);
  return d.toISOString().slice(0, 10);
};

describe("DFT a pickup cannot be worked before its window opens", () => {
  it("knows when a slot has come round", () => {
    const past = { date: "2020-01-01", startTime: "09:00" };
    const future = { date: "2099-01-01", startTime: "09:00" };
    expect(pickupWindowOpen(past)).toBe(true);
    expect(pickupWindowOpen(future)).toBe(false);
    expect(minutesUntilPickup(future)).toBeGreaterThan(0);
    expect(minutesUntilPickup(past)).toBeLessThan(0);
  });

  it("refuses to collect tomorrow's order today, and says when it may be collected", async () => {
    const { app, orderId, operatorToken } = await bookFor("slot-due-1", tomorrow());
    const early = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }),
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("pickup_not_due");
    // Not just a refusal: it says when the work can actually be done.
    expect(early.json().availableFrom).toContain("17:00");
    expect(early.json().message).toContain("cannot be started yet");
  });

  it("allows it once the window has come round", async () => {
    const { app, container, orderId, operatorToken } = await bookFor("slot-due-2", tomorrow());
    await openSlotNow(container, "slot-due-2");
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }),
    });
    expect(picked.statusCode).toBe(200);
    expect(picked.json().order.state).toBe("picked_up");
    expect(picked.json().order.earlyPickup).toBe(false);
  });

  it("stops the whole downstream flow, not just the pickup", async () => {
    const { app, orderId, operatorToken } = await bookFor("slot-due-3", tomorrow());
    // Nothing can be processed on an order that was never legitimately collected,
    // because it never leaves the scheduled state.
    for (const path of ["wash/start", "advance", "qc"]) {
      const attempt = await app.inject({
        method: "POST", url: `/v1/operations/orders/${orderId}/${path}`, headers: bearer(operatorToken),
        payload: JSON.stringify({ passed: true }),
      });
      expect(attempt.statusCode).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("DFT an early collection is deliberate, and recorded as such", () => {
  it("goes ahead when it is asked for, and says why", async () => {
    const { app, orderId, operatorToken } = await bookFor("slot-early-1", tomorrow());
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({
        items: [{ category: "Shirts", quantity: 3 }],
        early: true, earlyReason: "Resident was leaving town and asked us to take it now",
      }),
    });
    expect(picked.statusCode).toBe(200);
    const order = picked.json().order;
    expect(order.earlyPickup).toBe(true);
    expect(order.earlyPickupReason).toContain("leaving town");
  });

  it("keeps the scheduled time beside the actual one rather than overwriting it", async () => {
    const { app, orderId, operatorToken } = await bookFor("slot-early-2", tomorrow());
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }], early: true, earlyReason: "Agreed with the resident" }),
    });
    const order = picked.json().order;
    // What was agreed, and what happened. The timeline used to say only the second.
    expect(order.scheduledPickupAt).toBeTruthy();
    expect(order.pickedUpAt).toBeTruthy();
    expect(new Date(order.pickedUpAt).getTime()).toBeLessThan(new Date(order.scheduledPickupAt).getTime());
  });

  it("says on the record that it was early", async () => {
    const { app, orderId, operatorToken } = await bookFor("slot-early-3", tomorrow());
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }], early: true, earlyReason: "Van was in the area" }),
    });
    const detail = await app.inject({
      method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken),
    });
    const timeline = detail.json().order.timeline as { state: string; note?: string }[];
    const entry = timeline.find((t) => t.state === "picked_up");
    expect(entry?.note).toContain("early");
    expect(entry?.note).toContain("Van was in the area");
  });

  it("is not marked early when the window had already opened", async () => {
    const { app, container, orderId, operatorToken } = await bookFor("slot-early-4", tomorrow());
    await openSlotNow(container, "slot-early-4");
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }], early: true, earlyReason: "Not actually early" }),
    });
    // Asking for an early collection on a slot that has come round is not an early
    // collection, and is not recorded as one.
    expect(picked.json().order.earlyPickup).toBe(false);
    expect(picked.json().order.earlyPickupReason).toBeNull();
  });
});

describe("DFT the pickup queue shows everything pending", () => {
  it("lists tomorrow's pickups as well as today's, marked not yet due", async () => {
    const { app, operatorToken } = await bookFor("slot-queue-1", tomorrow());
    const queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    expect(queue.statusCode).toBe(200);
    const rows = queue.json().pickups as { pickupId: string; dueNow: boolean; minutesUntilDue: number }[];
    // A future pickup used to be hidden until its own day arrived, so an operator
    // could not see tomorrow's workload at all.
    expect(rows.length).toBeGreaterThan(0);
    const upcoming = rows.find((r) => !r.dueNow);
    expect(upcoming).toBeTruthy();
    expect(upcoming!.minutesUntilDue).toBeGreaterThan(0);
    expect(queue.json().upcomingCount).toBeGreaterThan(0);
  });

  it("counts what may actually be worked now separately from what is merely booked", async () => {
    const { app, container, operatorToken } = await bookFor("slot-queue-2", tomorrow());
    const before = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    expect(before.json().dueNowCount).toBe(0);

    await openSlotNow(container, "slot-queue-2");
    const after = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    expect(after.json().dueNowCount).toBeGreaterThan(0);
    expect(after.json().upcomingCount).toBe(0);
  });

  it("narrows to a chosen day, and says which day it narrowed to", async () => {
    const { app, operatorToken } = await bookFor("slot-queue-3", tomorrow());
    const day = tomorrow();
    const filtered = await app.inject({
      method: "GET", url: `/v1/operations/pickups?date=${day}`, headers: bearer(operatorToken),
    });
    expect(filtered.json().date).toBe(day);
    for (const row of filtered.json().pickups as { scheduledDate: string }[]) {
      expect(row.scheduledDate).toBe(day);
    }

    const otherDay = await app.inject({
      method: "GET", url: `/v1/operations/pickups?date=${today()}`, headers: bearer(operatorToken),
    });
    // Nothing is scheduled today, and the answer is an empty day rather than
    // everything that happens to be pending.
    expect(otherDay.json().pickups).toEqual([]);
  });

  it("still badges an overdue pickup rather than dropping it", async () => {
    const { app, container, operatorToken } = await bookFor("slot-queue-4", tomorrow());
    const slot = await container.store.slots.get("slot-queue-4");
    slot!.date = "2020-01-02";
    await container.store.slots.put(slot!);
    for (const p of await container.store.pickups.find((x) => x.slotId === "slot-queue-4")) {
      p.scheduledFor = "2020-01-02T09:00:00.000Z";
      await container.store.pickups.put(p);
    }
    const queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(operatorToken) });
    const rows = queue.json().pickups as { overdue: boolean; dueNow: boolean }[];
    expect(rows.some((r) => r.overdue)).toBe(true);
    // Overdue and workable are different things, and both are said.
    expect(rows.every((r) => !r.overdue || r.dueNow)).toBe(true);
    expect(queue.json().overdueCount).toBeGreaterThan(0);
  });
});

describe("DFT scoping still holds on the pickup queue", () => {
  it("shows a supervisor's area but not another operator's societies", async () => {
    const { app } = await makeTestApp();
    const outsider = await loginResident(app, "9876500003");
    const queue = await app.inject({ method: "GET", url: "/v1/operations/pickups", headers: bearer(outsider) });
    expect(queue.statusCode).toBe(200);
    for (const row of queue.json().pickups as { societyName: string | null }[]) {
      expect(row.societyName).not.toBe("My Home Bhooja");
    }
  });
});
