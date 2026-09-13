import { describe, it, expect } from "vitest";
import type { ServiceRequest } from "../../src/domain/models";
import { makeTestApp, seedSlot, bearer, loginOperator, loginResident, openSlotNow } from "./helpers";

type App = Awaited<ReturnType<typeof makeTestApp>>["app"];

// Three operator portal fixes (I-135, I-137, I-138), each checked at the API so a
// client that skips the screen cannot get round them.

async function bookedOrder(slotId: string, quantity: number, open = true) {
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
  if (open) await openSlotNow(container, slotId);
  const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
  const lineId = (detail.json().order.lines as Array<{ id: string }>)[0].id;
  return { app, orderId, lineId, operatorToken };
}

const preview = (app: App, orderId: string, token: string, lines: unknown[]) => app.inject({
  method: "POST", url: `/v1/operations/orders/${orderId}/reconcile`, headers: bearer(token), payload: JSON.stringify({ lines }),
});
const confirm = (app: App, orderId: string, token: string, body: unknown) => app.inject({
  method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(token), payload: JSON.stringify(body),
});
const explained = { discrepancyReason: "not_handed_over", discrepancyRemarks: "Only some shirts were handed over" };

describe("DFT I-135 a changed quantity cannot be confirmed without a fresh preview", () => {
  it("refuses a changed quantity that was never previewed, and leaves the order uncollected", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-i135-1", 6);
    const res = await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 4 }], ...explained });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("reconciliation_required");
    expect(res.json().message).toMatch(/Preview the collection again/);
    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    expect(detail.json().order.state).toBe("scheduled");
  });

  it("confirms the quantities that were previewed, and the preview shows expected against collected", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-i135-2", 6);
    const previewed = await preview(app, orderId, operatorToken, [{ lineId, acceptedQuantity: 4 }]);
    expect(previewed.statusCode).toBe(200);
    expect(previewed.json().reconciliation).toMatchObject({ requestedTotal: 6, actualTotal: 4 });
    expect(previewed.json().reconciliation.lines[0]).toMatchObject({ requested: 6, actual: 4, status: "short" });

    const res = await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 4 }], ...explained });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.acceptedCount).toBe(4);
  });

  it("requires the preview again when the quantity changes after it", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-i135-3", 6);
    await preview(app, orderId, operatorToken, [{ lineId, acceptedQuantity: 4 }]);
    const changed = await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 5 }], ...explained });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe("reconciliation_required");

    await preview(app, orderId, operatorToken, [{ lineId, acceptedQuantity: 5 }]);
    const res = await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 5 }], ...explained });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.acceptedCount).toBe(5);
  });

  it("does not ask for a preview when nothing changed", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-i135-4", 6);
    const res = await confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 6 }] });
    expect(res.statusCode).toBe(200);
  });

  it("cannot be bypassed by sending a per category total instead of lines", async () => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder("slot-i135-5", 6);
    const bypass = await confirm(app, orderId, operatorToken, { items: [{ category: "Shirts", quantity: 4 }], ...explained });
    expect(bypass.statusCode).toBe(409);
    expect(bypass.json().error).toBe("reconciliation_required");

    await preview(app, orderId, operatorToken, [{ lineId, acceptedQuantity: 4 }]);
    const res = await confirm(app, orderId, operatorToken, { items: [{ category: "Shirts", quantity: 4 }], ...explained });
    expect(res.statusCode).toBe(200);
  });
});

describe("DFT I-137 an early collection needs a reason", () => {
  const early = async (slotId: string, extra: Record<string, unknown>) => {
    const { app, orderId, lineId, operatorToken } = await bookedOrder(slotId, 3, false);
    return confirm(app, orderId, operatorToken, { lines: [{ lineId, acceptedQuantity: 3 }], early: true, ...extra });
  };

  for (const [label, extra] of [
    ["an empty reason", { earlyReason: "" }],
    ["a reason of only spaces", { earlyReason: "    " }],
    ["no reason at all", {}],
  ] as const) {
    it(`refuses ${label} with a message a person can read`, async () => {
      const res = await early(`slot-i137-${label.length}`, extra);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_request");
      expect(res.json().message).toBe("Early collection reason is required.");
    });
  }

  it("accepts a one character reason, the existing minimum", async () => {
    const res = await early("slot-i137-one", { earlyReason: "x" });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.earlyPickup).toBe(true);
    expect(res.json().order.earlyPickupReason).toBe("x");
  });

  it("stores the reason trimmed", async () => {
    const res = await early("slot-i137-trim", { earlyReason: "  Resident is travelling  " });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.earlyPickupReason).toBe("Resident is travelling");
  });
});

// ------------------------------------------------------------------ I-138

const OFFERING = "paging-test";

interface ListBody {
  requests: { id: string; status: string }[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
  page: { total: number; limit: number; offset: number; hasMore: boolean };
  counts: Record<string, number>;
}

async function withBookings(count: number, shape: (i: number) => Partial<ServiceRequest> = () => ({})) {
  const { app, container } = await makeTestApp();
  const base = (await container.store.offerings.get("wash-car"))!;
  await container.store.offerings.put({ ...base, id: OFFERING, name: "Paging test wash" });
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    await container.store.serviceRequests.put({
      id: `sr-page-${String(i).padStart(3, "0")}`, residentId: "res-demo", societyId: "soc-demo",
      kind: base.kind, offeringId: OFFERING, offeringName: "Paging test wash",
      vehicleType: "Car", vehicleNumber: null, estimatedHours: null, actualHours: null,
      // Many share a time, so the order between them rests on the tie-break.
      scheduledFor: `2026-10-0${1 + (i % 5)}T10:00:00.000Z`,
      address: null, status: "requested", assignedToUserId: null,
      quotedPaise: 50000, finalPaise: null, chargeStatus: "none", notes: null,
      timeline: [{ status: "requested", at: now, actorUserId: null }],
      createdAt: now, startedAt: null, completedAt: null, cancelledReason: null,
      ...shape(i),
    });
  }
  const token = await loginOperator(app);
  const raw = (query: Record<string, string | number>) => app.inject({
    method: "GET", headers: bearer(token),
    url: `/v1/operations/services?${new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)]))}`,
  });
  const list = async (query: Record<string, string | number> = {}): Promise<ListBody> => {
    const res = await raw({ offeringId: OFFERING, ...query });
    expect(res.statusCode).toBe(200);
    return res.json() as ListBody;
  };
  return { list, raw };
}

describe("DFT I-138 the operator services list is paged on the server", () => {
  it("answers an empty list with zero totals", async () => {
    const { list } = await withBookings(0);
    const body = await list();
    expect(body.requests).toEqual([]);
    expect(body.pagination).toEqual({ total: 0, page: 1, limit: 50, totalPages: 0 });
    expect(body.counts.all).toBe(0);
  });

  it("answers one booking as one page", async () => {
    const { list } = await withBookings(1);
    expect((await list()).pagination).toEqual({ total: 1, page: 1, limit: 50, totalPages: 1 });
  });

  it("fits exactly 50 on one page", async () => {
    const { list } = await withBookings(50);
    const first = await list({ page: 1 });
    expect(first.requests).toHaveLength(50);
    expect(first.pagination).toEqual({ total: 50, page: 1, limit: 50, totalPages: 1 });
    const second = await list({ page: 2 });
    expect(second.requests).toHaveLength(0);
    expect(second.pagination.total).toBe(50);
  });

  it("puts the 51st booking on a second page", async () => {
    const { list } = await withBookings(51);
    expect((await list({ page: 1 })).requests).toHaveLength(50);
    const second = await list({ page: 2 });
    expect(second.requests).toHaveLength(1);
    expect(second.pagination).toEqual({ total: 51, page: 2, limit: 50, totalPages: 2 });
  });

  it("walks 127 bookings over three pages in a stable order, none lost or repeated", async () => {
    const { list } = await withBookings(127);
    const pages = [await list({ page: 1 }), await list({ page: 2 }), await list({ page: 3 })];
    expect(pages.map((p) => p.requests.length)).toEqual([50, 50, 27]);
    for (const p of pages) expect(p.pagination).toMatchObject({ total: 127, limit: 50, totalPages: 3 });
    expect(pages[0].counts.all).toBe(127);

    const ids = pages.flatMap((p) => p.requests.map((r) => r.id));
    expect(new Set(ids).size).toBe(127);
    // The same order the second time round, which is what refreshing a later page needs.
    expect((await list({ page: 2 })).requests.map((r) => r.id)).toEqual(pages[1].requests.map((r) => r.id));

    // The older offset form still pages the same list.
    const byOffset = await list({ offset: 100, limit: 50 });
    expect(byOffset.requests.map((r) => r.id)).toEqual(pages[2].requests.map((r) => r.id));
    expect(byOffset.pagination.page).toBe(3);
    expect(byOffset.page).toMatchObject({ total: 127, offset: 100, hasMore: false });
  });

  it("caps the page size instead of returning everything", async () => {
    const { list, raw } = await withBookings(127);
    expect((await list({ limit: 5000 })).pagination.limit).toBe(200);
    // Without a filter the rows are still one page, and the total is the real one.
    const unfiltered = (await raw({})).json() as ListBody;
    expect(unfiltered.requests.length).toBeLessThanOrEqual(50);
    expect(unfiltered.pagination.total).toBeGreaterThanOrEqual(127);
  });

  it("applies the status filter before paging, and counts every status across all pages", async () => {
    const { list } = await withBookings(127, (i) => ({ status: i % 2 === 0 ? "completed" : "requested" }));
    const first = await list({ status: "completed", page: 1 });
    expect(first.pagination).toEqual({ total: 64, page: 1, limit: 50, totalPages: 2 });
    const second = await list({ status: "completed", page: 2 });
    expect(second.requests).toHaveLength(14);
    expect(second.requests.every((r) => r.status === "completed")).toBe(true);
    // The chip counts do not change with the chosen status or page.
    for (const body of [first, second]) {
      expect(body.counts).toMatchObject({ all: 127, completed: 64, requested: 63 });
    }
  });

  it("searches before paging", async () => {
    const { list } = await withBookings(127, (i) => ({ id: i < 80 ? `sr-alpha-${i}` : `sr-beta-${i}` }));
    const first = await list({ q: "alpha", page: 1 });
    expect(first.pagination).toEqual({ total: 80, page: 1, limit: 50, totalPages: 2 });
    const second = await list({ q: "alpha", page: 2 });
    expect(second.requests).toHaveLength(30);
    expect([...first.requests, ...second.requests].every((r) => r.id.includes("alpha"))).toBe(true);
    expect(second.counts.all).toBe(80);
  });

  it("answers a page past the end with no rows and the real totals", async () => {
    const { list } = await withBookings(51);
    const body = await list({ page: 9 });
    expect(body.requests).toHaveLength(0);
    expect(body.pagination).toEqual({ total: 51, page: 9, limit: 50, totalPages: 2 });
  });
});
