import { describe, it, expect } from "vitest";
import {
  makeTestApp, bearer, loginAdmin, loginSupervisor, loginOperator, loginResident,
  seedSlot, openSlotNow,
} from "./helpers";

// What the round eight screens read from. A filter that the screen applies but the
// server does not is a filter that quietly does nothing, so the narrowing, the
// paging and the figures the cards show are all asserted here rather than trusted.

describe("DFT QC monitoring can be searched rather than only scrolled", () => {
  async function withFailedCheck() {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-qc-r8", 5);
    const booked = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-qc-r8",
    });
    const operator = await loginOperator(app);
    const id = booked.order.id;
    await openSlotNow(container, "slot-qc-r8");
    const headers = bearer(operator);
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${id}/picked-up`, headers,
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }),
    });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/start`, headers });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/wash/complete`, headers });
    await app.inject({ method: "POST", url: `/v1/operations/orders/${id}/ironing/complete`, headers });
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${id}/qc`, headers,
      payload: JSON.stringify({ pass: false, reason: "Stain remaining" }),
    });
    return { app, container, orderId: id, orderCode: booked.order.orderCode };
  }

  it("says when the check happened, not when the order was booked", async () => {
    const { app, orderId } = await withFailedCheck();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/qc", headers: bearer(token) });
    const row = (res.json().qc as Array<{ id: string; qcCheckedAt: string; createdAt: string }>)
      .find((o) => o.id === orderId)!;
    expect(row.qcCheckedAt).toBeTruthy();
    // The order was booked, walked through washing and ironing, and only then
    // checked. The two timestamps are not the same fact.
    expect(new Date(row.qcCheckedAt).getTime()).toBeGreaterThanOrEqual(new Date(row.createdAt).getTime());
  });

  it("narrows by status, and says which statuses there are to narrow by", async () => {
    const { app, orderId } = await withFailedCheck();
    const token = await loginSupervisor(app);
    const failed = await app.inject({ method: "GET", url: "/v1/supervisor/qc?status=failed", headers: bearer(token) });
    expect((failed.json().qc as Array<{ id: string }>).some((o) => o.id === orderId)).toBe(true);
    const passed = await app.inject({ method: "GET", url: "/v1/supervisor/qc?status=passed", headers: bearer(token) });
    expect((passed.json().qc as Array<{ id: string }>).some((o) => o.id === orderId)).toBe(false);
    expect(failed.json().filters.statuses).toContain("recheck");
  });

  it("searches by order code", async () => {
    const { app, orderCode, orderId } = await withFailedCheck();
    const token = await loginSupervisor(app);
    const hit = await app.inject({
      method: "GET", url: `/v1/supervisor/qc?q=${encodeURIComponent(orderCode)}`, headers: bearer(token),
    });
    expect((hit.json().qc as Array<{ id: string }>).map((o) => o.id)).toEqual([orderId]);
    const miss = await app.inject({ method: "GET", url: "/v1/supervisor/qc?q=ORD-000000", headers: bearer(token) });
    expect(miss.json().qc).toEqual([]);
  });

  it("answers a page rather than the whole table", async () => {
    const { app } = await withFailedCheck();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/qc?limit=1&offset=0", headers: bearer(token) });
    const page = res.json().page as { total: number; limit: number; offset: number; hasMore: boolean };
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(0);
    expect(res.json().qc.length).toBeLessThanOrEqual(1);
  });

  it("offers only the societies and operators actually in the list", async () => {
    const { app } = await withFailedCheck();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/qc", headers: bearer(token) });
    const societies = res.json().filters.societies as { id: string }[];
    // A supervisor runs one society, so the filter cannot offer another one.
    expect(societies.every((sc) => sc.id === "soc-demo")).toBe(true);
  });
});

describe("DFT a resident chooses the block they live in", () => {
  it("is offered the blocks their society actually has", async () => {
    const { app } = await makeTestApp();
    // A brand new account, before onboarding.
    const send = await app.inject({
      method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876511111" }),
    });
    const verify = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876511111", otp: send.json().otpForTesting }),
    });
    const token = verify.json().token as string;

    const status = await app.inject({ method: "GET", url: "/v1/resident/onboarding", headers: bearer(token) });
    const society = (status.json().societies as Array<{ id: string; blocks: { id: string; name: string }[] }>)
      .find((s) => s.id === "soc-demo")!;
    expect(society.blocks.map((b) => b.name)).toEqual(["A", "B", "C"]);

    const done = await app.inject({
      method: "POST", url: "/v1/auth/onboarding", headers: bearer(token),
      payload: JSON.stringify({
        fullName: "New Resident", societyId: "soc-demo", unitNumber: "B-201",
        blockId: "block-demo-b", address: "B-201, My Home Bhooja",
      }),
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().resident.blockId).toBe("block-demo-b");
    expect(done.json().resident.towerBlock).toBe("B");
  });

  it("matches a block written out against the blocks that exist", async () => {
    const { app } = await makeTestApp();
    const send = await app.inject({
      method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876511112" }),
    });
    const verify = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876511112", otp: send.json().otpForTesting }),
    });
    const token = verify.json().token as string;
    const done = await app.inject({
      method: "POST", url: "/v1/auth/onboarding", headers: bearer(token),
      payload: JSON.stringify({
        fullName: "Typed Block", societyId: "soc-demo", unitNumber: "C-9",
        // "Block C" and "C" are the same tower, however somebody writes it.
        towerBlock: "Block C", address: "C-9, My Home Bhooja",
      }),
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().resident.blockId).toBe("block-demo-c");
  });

  it("keeps a block nobody set up as what they said rather than losing it", async () => {
    const { app } = await makeTestApp();
    const send = await app.inject({
      method: "POST", url: "/v1/auth/otp/send", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876511113" }),
    });
    const verify = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone: "9876511113", otp: send.json().otpForTesting }),
    });
    const token = verify.json().token as string;
    const done = await app.inject({
      method: "POST", url: "/v1/auth/onboarding", headers: bearer(token),
      payload: JSON.stringify({
        fullName: "Unknown Block", societyId: "soc-demo", unitNumber: "Z-1",
        towerBlock: "Z", address: "Z-1, My Home Bhooja",
      }),
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().resident.towerBlock).toBe("Z");
    expect(done.json().resident.blockId ?? null).toBeNull();
  });
});

describe("DFT the cards say who answers for whom", () => {
  it("gives an operator the towers they cover and the flats that comes to", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "PUT", url: "/v1/admin/blocks/block-demo-b/operators", headers: bearer(token),
      payload: JSON.stringify({ operatorUserIds: [] }),
    });
    const listed = await app.inject({ method: "GET", url: "/v1/admin/operators", headers: bearer(token) });
    const row = (listed.json().operators as Array<{ id: string; blockNames: string[]; flatsCovered: number }>)
      .find((o) => o.id === "user-op")!;
    expect(row.blockNames).toEqual(["A"]);
    expect(row.flatsCovered).toBe(40);
  });

  it("shows an operator with no towers as covering nothing", async () => {
    // Blocks are the assignment rather than a narrowing of one, so an empty list
    // is somebody waiting to be given work — and the card says so instead of
    // crediting them with every tower in the society.
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    for (const blockId of ["block-demo-a", "block-demo-b"]) {
      await app.inject({
        method: "PUT", url: `/v1/admin/blocks/${blockId}/operators`, headers: bearer(token),
        payload: JSON.stringify({ operatorUserIds: [] }),
      });
    }
    const listed = await app.inject({ method: "GET", url: "/v1/admin/operators", headers: bearer(token) });
    const row = (listed.json().operators as Array<{ id: string; blockNames: string[]; flatsCovered: number }>)
      .find((o) => o.id === "user-op")!;
    expect(row.blockNames).toEqual([]);
    expect(row.flatsCovered).toBe(0);
  });

  it("names an operator's supervisor from the society they work in", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const listed = await app.inject({ method: "GET", url: "/v1/admin/operators", headers: bearer(token) });
    const row = (listed.json().operators as Array<{ id: string; supervisorUserId: string | null }>)
      .find((o) => o.id === "user-op")!;
    expect(row.supervisorUserId).toBe("user-sup");

    // Release the society, and the operator has nobody answering for them — which
    // is the truth, rather than inheriting whoever runs the corridor.
    await app.inject({
      method: "PUT", url: "/v1/admin/societies/soc-demo/supervisor", headers: bearer(token),
      payload: JSON.stringify({ supervisorUserId: null }),
    });
    const after = await app.inject({ method: "GET", url: "/v1/admin/operators", headers: bearer(token) });
    const updated = (after.json().operators as Array<{ id: string; supervisorUserId: string | null }>)
      .find((o) => o.id === "user-op")!;
    expect(updated.supervisorUserId).toBeNull();
  });

  it("counts a supervisor's societies as the one they run", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const listed = await app.inject({ method: "GET", url: "/v1/admin/supervisors", headers: bearer(token) });
    const row = (listed.json().supervisors as Array<{ id?: string; userId?: string; societyCount: number; societyNames: string[] }>)
      .find((sup) => (sup.userId ?? sup.id) === "user-sup")!;
    // Two Madhapur societies are seeded; this supervisor runs one of them.
    expect(row.societyCount).toBe(1);
    expect(row.societyNames).toEqual(["My Home Bhooja"]);
  });
});

describe("DFT an order carries the tower it came from", () => {
  it("records the resident's block when the order is booked", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-block-r8", 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-block-r8", estimatedCount: 2 }),
    });
    const order = (await container.store.orders.get(booked.json().order.id as string))!;
    expect(order.blockId).toBe("block-demo-a");
  });
});
