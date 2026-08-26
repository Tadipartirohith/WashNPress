import { describe, it, expect } from "vitest";
import {
  makeTestApp, bearer, loginAdmin, loginSupervisor, loginOperator, loginResident,
  seedSlot, openSlotNow,
  staffBody,
} from "./helpers";

// Area → Society → Supervisor → Blocks → Operators → Residents/Orders.
//
// The chain used to be two fields on a user record: a supervisor answered for an
// area, and an operator for whole societies. Nothing could show a society and say
// who ran it, or show a tower and say who collected from it.

describe("DFT a society says who runs it", () => {
  it("shows the seeded society with its supervisor and its towers", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const res = await app.inject({
      method: "GET", url: "/v1/admin/societies/soc-demo/assignments", headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.supervisor.id).toBe("user-sup");
    expect(body.blocks.map((b: { blockName: string }) => b.blockName)).toEqual(["A", "B", "C"]);
    // Each block says how much work it is, which is the point of showing them.
    const blockA = body.blocks.find((b: { blockName: string }) => b.blockName === "A");
    expect(blockA.flatCount).toBe(40);
    expect(blockA.residentCount).toBe(1);
  });

  it("refuses to give a supervisor a second society, and names the one they hold", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const refused = await app.inject({
      method: "PUT", url: "/v1/admin/societies/soc-aparna/supervisor", headers: bearer(token),
      payload: JSON.stringify({ supervisorUserId: "user-sup" }),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain("My Home Bhooja");
  });

  it("moves a supervisor between societies once the first is released", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const cleared = await app.inject({
      method: "PUT", url: "/v1/admin/societies/soc-demo/supervisor", headers: bearer(token),
      payload: JSON.stringify({ supervisorUserId: null }),
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().society.supervisorUserId).toBeNull();

    const moved = await app.inject({
      method: "PUT", url: "/v1/admin/societies/soc-aparna/supervisor", headers: bearer(token),
      payload: JSON.stringify({ supervisorUserId: "user-sup" }),
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().society.supervisorUserId).toBe("user-sup");

    // And the supervisor's own view follows, in the same breath: what they run is
    // read from the same fact the admin just changed.
    const supervisorToken = await loginSupervisor(app);
    const mine = await app.inject({ method: "GET", url: "/v1/supervisor/society", headers: bearer(supervisorToken) });
    expect(mine.json().society.id).toBe("soc-aparna");
  });

  it("refuses a supervisor nobody has approved yet", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: await staffBody(app, token, {
        firstName: "Waiting", lastName: "Person", phone: "9876500077", areaId: "area-kondapur",
      }),
    });
    const userId = created.json().supervisor.userId ?? created.json().supervisor.id;
    const refused = await app.inject({
      method: "PUT", url: "/v1/admin/societies/soc-aparna/supervisor", headers: bearer(token),
      payload: JSON.stringify({ supervisorUserId: userId }),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/approved/);
  });
});

describe("DFT a supervisor runs one society and cannot change which", () => {
  it("shows them their own society and says the choice is not theirs", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/society", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().society.id).toBe("soc-demo");
    expect(res.json().canChangeSociety).toBe(false);
  });

  it("keeps the other society in their own area out of their reach", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const listed = await app.inject({ method: "GET", url: "/v1/supervisor/societies", headers: bearer(token) });
    const ids = (listed.json().societies as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual(["soc-demo"]);

    const reach = await app.inject({ method: "GET", url: "/v1/supervisor/societies/soc-aparna", headers: bearer(token) });
    expect(reach.statusCode).toBe(403);
  });

  it("has no way to assign a supervisor to anything", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    // The admin route exists; a supervisor's token does not open it.
    const refused = await app.inject({
      method: "PUT", url: "/v1/admin/societies/soc-demo/supervisor", headers: bearer(token),
      payload: JSON.stringify({ supervisorUserId: null }),
    });
    expect(refused.statusCode).toBe(403);
  });

  it("refuses a block belonging to a society that is not theirs", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    const elsewhere = (await container.store.blocks.find((b) => b.societyId === "soc-gachibowli"))[0];
    const refused = await app.inject({
      method: "PUT", url: `/v1/supervisor/blocks/${elsewhere.id}/operators`, headers: bearer(token),
      payload: JSON.stringify({ operatorUserIds: [] }),
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe("DFT an operator works blocks, not whole societies", () => {
  it("covers everything until somebody says otherwise", async () => {
    const { app } = await makeTestApp();
    const token = await loginOperator(app);
    const res = await app.inject({ method: "GET", url: "/v1/operations/blocks", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    // Assigned to two societies and to no block in either, so every block in both
    // is theirs — which is what that assignment has always meant.
    const names = (res.json().blocks as { blockName: string }[]).map((b) => b.blockName).sort();
    expect(names).toEqual(["A", "B", "C", "Tower 1", "Tower 2"]);
  });

  it("is held to the blocks it is given", async () => {
    const { app } = await makeTestApp();
    const admin = await loginAdmin(app);
    const assigned = await app.inject({
      method: "PUT", url: "/v1/admin/blocks/block-demo-b/operators", headers: bearer(admin),
      payload: JSON.stringify({ operatorUserIds: ["user-op"] }),
    });
    expect(assigned.statusCode).toBe(200);

    const token = await loginOperator(app);
    const res = await app.inject({ method: "GET", url: "/v1/operations/blocks", headers: bearer(token) });
    expect((res.json().blocks as { blockName: string }[]).map((b) => b.blockName)).toEqual(["B"]);
  });

  it("cannot reach an order in a tower it does not cover", async () => {
    const { app, container } = await makeTestApp();
    // The resident lives in block A. Put the operator on block B only.
    const admin = await loginAdmin(app);
    await app.inject({
      method: "PUT", url: "/v1/admin/blocks/block-demo-b/operators", headers: bearer(admin),
      payload: JSON.stringify({ operatorUserIds: ["user-op"] }),
    });

    await seedSlot(container, "slot-block-1", 5);
    const residentToken = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
      payload: JSON.stringify({ slotId: "slot-block-1", estimatedCount: 3 }),
    });
    const orderId = booked.json().order.id as string;
    // The order records the tower it came from.
    expect((await container.store.orders.get(orderId))!.blockId).toBe("block-demo-a");

    await openSlotNow(container, "slot-block-1");
    const operatorToken = await loginOperator(app);
    const refused = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }),
    });
    // Same answer as an order that does not exist: knowing the id proves nothing.
    expect(refused.statusCode).toBe(403);

    // Given the tower as well, the same order is theirs.
    await app.inject({
      method: "PUT", url: "/v1/admin/blocks/block-demo-a/operators", headers: bearer(admin),
      payload: JSON.stringify({ operatorUserIds: ["user-op"] }),
    });
    const allowed = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }),
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("lets a supervisor put an operator on a tower of their own society", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const res = await app.inject({
      method: "PUT", url: "/v1/supervisor/blocks/block-demo-c/operators", headers: bearer(token),
      payload: JSON.stringify({ operatorUserIds: ["user-op"] }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().block.operatorUserIds).toEqual(["user-op"]);

    const allocation = await app.inject({ method: "GET", url: "/v1/supervisor/society", headers: bearer(token) });
    const blockC = (allocation.json().blocks as { blockName: string; operators: { id: string }[] }[])
      .find((b) => b.blockName === "C")!;
    expect(blockC.operators.map((o) => o.id)).toEqual(["user-op"]);
  });
});

describe("DFT blocks are managed where the society is", () => {
  it("adds a tower and refuses a second one by the same name", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/societies/soc-demo/blocks", headers: bearer(token),
      payload: JSON.stringify({ name: "D", flatCount: 24 }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().block.flatCount).toBe(24);

    // "Block D" and "D" are the same tower, however somebody types it.
    const duplicate = await app.inject({
      method: "POST", url: "/v1/admin/societies/soc-demo/blocks", headers: bearer(token),
      payload: JSON.stringify({ name: "Block D" }),
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("corrects a flat count without touching who covers it", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    await app.inject({
      method: "PUT", url: "/v1/admin/blocks/block-demo-a/operators", headers: bearer(token),
      payload: JSON.stringify({ operatorUserIds: ["user-op"] }),
    });
    const patched = await app.inject({
      method: "PATCH", url: "/v1/admin/blocks/block-demo-a", headers: bearer(token),
      payload: JSON.stringify({ flatCount: 44 }),
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().block.flatCount).toBe(44);
    expect(patched.json().block.operatorUserIds).toEqual(["user-op"]);
  });
});
