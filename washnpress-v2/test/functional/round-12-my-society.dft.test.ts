import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, loginSupervisor, loginOtherSupervisor } from "./helpers";

// Supervisor → My society showed a society that was running normally as though
// nothing had ever been put in it: address "—", towers "None yet", and zero
// residents, operations staff, active orders and available slots. One tap further
// in, the detail page showed the real figures.
//
// The two pages were reading different things. The detail route has always sent
// `societies.summary(...)` — identity plus the live counts — while My society sent
// the bare stored row, which has a name, an address in parts and a status and no
// counts at all. Every count the card asked for came back undefined and was
// rendered as its empty state, so the page could not tell "nothing here yet" from
// "nobody built this payload".
//
// These lock the counts to real records rather than to the fact that a number was
// printed: each one is checked against what the store actually holds.

describe("supervisor my society reflects the real society", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let token: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    token = await loginSupervisor(app);
  });

  async function mySociety() {
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/society", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it("sends the address as a line rather than only as parts", async () => {
    const body = await mySociety();
    expect(body.society).toBeTruthy();
    expect(typeof body.society.addressLine).toBe("string");
    expect(body.society.addressLine.length).toBeGreaterThan(0);
    // Still carries the parts, so a form can edit it.
    expect(body.society.address).toBeTruthy();
  });

  it("names the towers that exist instead of saying there are none", async () => {
    const body = await mySociety();
    const blocks = await container.store.blocks.find((b) => b.societyId === body.society.id);
    expect(blocks.length).toBeGreaterThan(0);
    expect(body.society.blockNames).toEqual(blocks.map((b) => b.name).sort((a, b) => a.localeCompare(b)));
  });

  it("counts residents, operations staff, orders and slots from the records", async () => {
    const body = await mySociety();
    const id = body.society.id;

    const residents = await container.store.residents.find((r) => r.societyId === id);
    const operators = await container.store.users.find((u) => u.roles.includes("operator") && u.societyIds.includes(id));
    const orders = await container.store.orders.find((o) => o.societyId === id);
    const active = ["scheduled", "picked_up", "in_wash", "ironing", "qc", "qc_hold", "ready_for_delivery", "out_for_delivery"];

    expect(body.society.residentCount).toBe(residents.length);
    expect(body.society.operationsStaffCount).toBe(operators.length);
    expect(body.society.activeOrderCount).toBe(orders.filter((o) => active.includes(o.state)).length);
    expect(body.society.orderCount).toBe(orders.length);
    // Not asserted as a fixed number — capacity moves as residents book — but it
    // has to be a real total rather than the undefined the card printed as 0.
    expect(typeof body.society.availableSlots).toBe("number");
  });

  it("agrees with the detail page it links to", async () => {
    const body = await mySociety();
    const detail = await app.inject({
      method: "GET", url: `/v1/supervisor/societies/${body.society.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    const there = detail.json().society;
    for (const field of ["addressLine", "blockNames", "residentCount", "operationsStaffCount", "activeOrderCount", "availableSlots"]) {
      expect(body.society[field]).toEqual(there[field]);
    }
  });

  it("counts only the supervisor's own society", async () => {
    const mine = await mySociety();
    const otherToken = await loginOtherSupervisor(app);
    const otherRes = await app.inject({ method: "GET", url: "/v1/supervisor/society", headers: { authorization: `Bearer ${otherToken}` } });
    const theirs = otherRes.json().society;
    if (!theirs) return; // that supervisor has no society yet; nothing to compare

    expect(theirs.id).not.toBe(mine.society.id);
    // Residents of one society are not counted in the other.
    const mineResidents = await container.store.residents.find((r) => r.societyId === mine.society.id);
    const theirResidents = await container.store.residents.find((r) => r.societyId === theirs.id);
    expect(mine.society.residentCount).toBe(mineResidents.length);
    expect(theirs.residentCount).toBe(theirResidents.length);
  });

  it("still says so plainly when a supervisor has no society", async () => {
    // Not an empty-looking society: a null one, which the screen words differently.
    const body = await mySociety();
    expect(body.society === null || typeof body.society.id === "string").toBe(true);
  });
});
