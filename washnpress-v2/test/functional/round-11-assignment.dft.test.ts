import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, seedSlot } from "./helpers";

// Tower → Operator → Order, made true at the moment the order exists.
//
// The mapping was always there — a block names its operators — but nothing read it
// when a booking was made, so an order from Tower C sat as "Unassigned" until
// somebody opened the Pickups page and claimed it, in front of a supervisor who
// could see perfectly well who covers Tower C.

describe("DFT an order is assigned by the tower it comes from", () => {
  it("names the operator who covers that tower, from the moment it is booked", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r11-1", 5);
    const { order } = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-1",
    });
    // res-demo lives in Block A, which user-op covers.
    expect(order.blockId).toBe("block-demo-a");
    expect(order.assignedOperatorUserId).toBe("user-op");

    // And the screen that used to print "Unassigned" says the name.
    const token = await loginSupervisor(app);
    const pickups = await app.inject({ method: "GET", url: "/v1/supervisor/pickups", headers: bearer(token) });
    const mine = (pickups.json().pickups as { orderId: string; operatorName: string | null }[])
      .find((p) => p.orderId === order.id)!;
    expect(mine.operatorName).toBeTruthy();
  });

  it("does not assign by society, because two towers of one society are two people", async () => {
    const { container } = await makeTestApp();
    await seedSlot(container, "slot-r11-2", 5);
    // Moved to Block C, which a different operator covers.
    const resident = (await container.store.residents.get("res-demo"))!;
    await container.store.residents.put({ ...resident, blockId: "block-demo-c", towerBlock: "C" });

    const { order } = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-2",
    });
    expect(order.assignedOperatorUserId).toBe("user-op-3");
  });

  it("leaves an order from a tower nobody covers for a supervisor to hand out", async () => {
    const { container } = await makeTestApp();
    await container.store.blocks.put({
      ...(await container.store.blocks.get("block-demo-a"))!, operatorUserIds: [],
    });
    await seedSlot(container, "slot-r11-3", 5);
    const { order } = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-3",
    });
    // Unassigned is a real state, not a failure: somebody has to give that tower an
    // operator, and until they do nobody is going.
    expect(order.assignedOperatorUserId).toBeNull();
  });

  it("follows the tower when the supervisor changes who covers it", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r11-4", 5);
    const { order } = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-4",
    });
    expect(order.assignedOperatorUserId).toBe("user-op");

    const token = await loginSupervisor(app);
    const moved = await app.inject({
      method: "PUT", url: "/v1/supervisor/blocks/block-demo-a/operators",
      headers: { ...bearer(token), "content-type": "application/json" },
      payload: JSON.stringify({ operatorUserIds: ["user-op-3"] }),
    });
    expect(moved.statusCode).toBe(200);

    // Not yet collected, so the collection is still a plan and the plan changed.
    expect((await container.store.orders.get(order.id))!.assignedOperatorUserId).toBe("user-op-3");
  });

  it("leaves a collected order where it was, whoever covers the tower now", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r11-5", 5);
    const { order } = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-5",
    });
    await container.store.orders.put({
      ...(await container.store.orders.get(order.id))!, state: "picked_up",
    });

    const token = await loginSupervisor(app);
    await app.inject({
      method: "PUT", url: "/v1/supervisor/blocks/block-demo-a/operators",
      headers: { ...bearer(token), "content-type": "application/json" },
      payload: JSON.stringify({ operatorUserIds: ["user-op-3"] }),
    });

    // Somebody has already been to the door. Who did that is a record of what
    // happened, not a plan that a later reshuffle gets to rewrite.
    expect((await container.store.orders.get(order.id))!.assignedOperatorUserId).toBe("user-op");
  });
});

describe("DFT a tower has floors as well as flats", () => {
  it("refuses a tower with no name, no floors or no flats", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    for (const body of [
      { name: "", floorCount: 10, flatCount: 40 },
      { name: "D", floorCount: 0, flatCount: 40 },
      { name: "D", floorCount: 10, flatCount: 0 },
      { name: "D", floorCount: -2, flatCount: 40 },
    ]) {
      const made = await app.inject({
        method: "POST", url: "/v1/supervisor/societies/soc-demo/blocks",
        headers: { ...bearer(token), "content-type": "application/json" },
        payload: JSON.stringify(body),
      });
      expect(made.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("adds the tower and shows it in the list below, with both numbers", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const made = await app.inject({
      method: "POST", url: "/v1/supervisor/societies/soc-demo/blocks",
      headers: { ...bearer(token), "content-type": "application/json" },
      payload: JSON.stringify({ name: "Tower D", floorCount: 12, flatCount: 48 }),
    });
    expect(made.statusCode).toBe(201);
    expect(made.json().block.floorCount).toBe(12);

    const mine = await app.inject({ method: "GET", url: "/v1/supervisor/society", headers: bearer(token) });
    const added = (mine.json().blocks as { blockName: string; floorCount: number; flatCount: number }[])
      .find((b) => b.blockName === "Tower D")!;
    expect(added.floorCount).toBe(12);
    expect(added.flatCount).toBe(48);
  });

  it("does not refuse an edit for a number the tower was never asked for", async () => {
    // Blocks recorded before towers had floors have none. Renaming one must not be
    // refused for a field that did not exist when it was created.
    const { app, container } = await makeTestApp();
    await container.store.blocks.put({
      ...(await container.store.blocks.get("block-demo-b"))!, floorCount: 0,
    });
    const token = await loginSupervisor(app);
    const renamed = await app.inject({
      method: "PATCH", url: "/v1/supervisor/blocks/block-demo-b",
      headers: { ...bearer(token), "content-type": "application/json" },
      payload: JSON.stringify({ name: "B Wing" }),
    });
    expect(renamed.statusCode).toBe(200);
  });
});

describe("DFT one tower, and everybody who lives in it", () => {
  it("gives the block, its operators and its residents in one reply", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r11-6", 5);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-6" });

    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/blocks/block-demo-a", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.block.name).toBe("A");
    expect(body.block.societyName).toBe("My Home Bhooja");
    expect(body.block.activeOrderCount).toBe(1);
    expect((body.block.operators as { id: string }[]).map((o) => o.id)).toContain("user-op");
    // The resident list is there without a second search: seeing who lives in a
    // tower is the ordinary question, and the card used to answer only the rare one.
    const resident = (body.residents as { id: string; unitNumber: string; activeOrderCount: number }[])[0];
    expect(resident.unitNumber).toBe("A-402");
    expect(resident.activeOrderCount).toBe(1);
  });

  it("never shows a resident of another tower", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const other = await app.inject({ method: "GET", url: "/v1/supervisor/blocks/block-demo-c", headers: bearer(token) });
    expect((other.json().residents as unknown[])).toEqual([]);
  });

  it("refuses a tower in somebody else's society exactly as a missing one", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const foreign = await app.inject({
      method: "GET", url: "/v1/supervisor/blocks/block-gcb-north", headers: bearer(token),
    });
    expect(foreign.statusCode).toBe(403);
  });
});

describe("DFT an issue says who raised it and what it is about", () => {
  it("carries the resident, their flat and the order behind a resident's ticket", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r11-7", 5);
    const { order } = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-7",
    });
    const raised = await container.issues.create({
      residentId: "res-demo", orderId: order.id, societyId: "soc-demo",
      category: "delivery_issue", description: "Garments not delivered",
      reportedByUserId: "user-res", reportedByRole: "resident",
    });

    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: `/v1/supervisor/issues/${raised.id}`, headers: bearer(token) });
    const issue = res.json().issue;
    expect(issue.raisedBy.role).toBe("resident");
    expect(issue.raisedBy.unitNumber).toBe("A-402");
    expect(issue.raisedBy.societyName).toBe("My Home Bhooja");
    // Issue → Raised by → Order → Resident → Operator, all of it on the page.
    expect(issue.order.orderCode).toBe(order.orderCode);
    expect(issue.order.unitNumber).toBe("A-402");
    expect(issue.order.operatorName).toBeTruthy();
    expect(issue.order.slotLabel).toBe("08:00 – 11:00");
  });

  it("still names the resident and the order when an operator raised it", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-r11-8", 5);
    const { order } = await container.scheduling.book({
      residentId: "res-demo", societyId: "soc-demo", slotId: "slot-r11-8",
    });
    const raised = await container.issues.create({
      residentId: "res-demo", orderId: order.id, societyId: "soc-demo",
      category: "missing_garment", description: "Garments missing after washing",
      reportedByUserId: "user-op", reportedByRole: "operator",
    });

    const token = await loginSupervisor(app);
    const res = await app.inject({ method: "GET", url: `/v1/supervisor/issues/${raised.id}`, headers: bearer(token) });
    const issue = res.json().issue;
    expect(issue.raisedBy.role).toBe("operator");
    expect(issue.raisedBy.employeeId).toBeTruthy();
    // The resident and the order are still there. An operator's ticket used to show
    // neither, so the supervisor reading it had to guess what it was about.
    expect(issue.residentName).toBeTruthy();
    expect(issue.order.residentName).toBeTruthy();
    expect(issue.order.orderCode).toBe(order.orderCode);
  });
});
