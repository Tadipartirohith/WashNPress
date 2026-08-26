import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, bearer, loginAdmin, loginSupervisor, loginResident, loginOperator, openSlotNow,
  staffBody,
} from "./helpers";
import { buildTransaction } from "../../src/domain/ledger";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";

// Where an order sits follows its lifecycle; what is owed on it is a separate fact.
// A delivered order with money outstanding was being treated as still active simply
// because the payment had not gone through.

describe("DFT a delivered order is a previous order, whatever is owed on it", () => {
  it("appears under previous with the payment still marked pending", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-prev-1", 5);
    const residentToken = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
      payload: JSON.stringify({ slotId: "slot-prev-1", estimatedCount: 10 }),
    });
    const orderId = booked.json().order.id as string;

    // Collected, with a charge the empty wallet cannot settle.
    const operatorToken = await loginOperator(app);
    await openSlotNow(container, "slot-prev-1");
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 10 }] }),
    });

    // Walked to delivered.
    const order = (await container.store.orders.get(orderId))!;
    order.state = "delivered";
    order.deliveredAt = new Date().toISOString();
    order.additionalChargeStatus = "pending";
    order.additionalChargePaise = 110000;
    await container.store.orders.put(order);

    const listed = await app.inject({ method: "GET", url: "/v1/resident/orders", headers: bearer(residentToken) });
    const previous = listed.json().previous as Array<{ id: string; additionalChargeStatus: string; additionalChargePaise: number }>;
    const current = listed.json().current as Array<{ id: string }>;

    // Its lifecycle is finished, so that is where it goes.
    expect(previous.some((o) => o.id === orderId)).toBe(true);
    expect(current.some((o) => o.id === orderId)).toBe(false);
    // And what is owed is said plainly beside it, rather than dragging it back into
    // the active list.
    const row = previous.find((o) => o.id === orderId)!;
    expect(row.additionalChargeStatus).toBe("pending");
    expect(row.additionalChargePaise).toBe(110000);
  });

  it("can be paid from where it sits, and then reads as paid", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-prev-2", 5);
    const residentToken = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
      payload: JSON.stringify({ slotId: "slot-prev-2", estimatedCount: 4 }),
    });
    const orderId = booked.json().order.id as string;
    const operatorToken = await loginOperator(app);
    await openSlotNow(container, "slot-prev-2");
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 4 }] }),
    });

    const order = (await container.store.orders.get(orderId))!;
    order.state = "delivered";
    order.additionalChargeStatus = "pending";
    order.additionalChargePaise = 5000;
    await container.store.orders.put(order);

    // Funded through the ledger, which is the only way money reaches a wallet.
    await container.store.ledger.post(buildTransaction({
      id: "test-topup-prev-2",
      reference: "test-topup-prev-2",
      entries: [
        { account: Account.GatewayClearing, direction: "debit", amount: 20000 },
        { account: walletAccount("res-demo"), direction: "credit", amount: 20000 },
      ],
      at: new Date(),
    }));

    const paid = await app.inject({
      method: "POST", url: `/v1/resident/orders/${orderId}/pay-additional`, headers: bearer(residentToken),
      payload: "{}",
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().order.additionalChargeStatus).toBe("paid");

    // Still a previous order — paying does not move it anywhere.
    const listed = await app.inject({ method: "GET", url: "/v1/resident/orders", headers: bearer(residentToken) });
    expect((listed.json().previous as Array<{ id: string }>).some((o) => o.id === orderId)).toBe(true);
  });
});

describe("DFT approving somebody happens where they are managed", () => {
  it("lets an admin approve a supervisor from the supervisors list", async () => {
    const { app } = await makeTestApp();
    const token = await loginAdmin(app);
    const created = await app.inject({
      method: "POST", url: "/v1/admin/supervisors", headers: bearer(token),
      payload: await staffBody(app, token, { firstName: "Nikhil", lastName: "Rao", phone: "9876500088", areaId: "area-madhapur" }),
    });
    expect(created.statusCode).toBe(201);
    const userId = created.json().supervisor.userId ?? created.json().supervisor.id;

    // Created, and waiting for somebody to let them in.
    const listed = await app.inject({ method: "GET", url: "/v1/admin/supervisors", headers: bearer(token) });
    const row = (listed.json().supervisors as Array<{ userId?: string; id?: string; verificationStatus: string }>)
      .find((s) => (s.userId ?? s.id) === userId)!;
    expect(row.verificationStatus).toBe("pending");

    const approved = await app.inject({
      method: "POST", url: `/v1/admin/staff/${userId}/verification`, headers: bearer(token),
      payload: JSON.stringify({ status: "approved" }),
    });
    expect(approved.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/v1/admin/supervisors", headers: bearer(token) });
    const updated = (after.json().supervisors as Array<{ userId?: string; id?: string; verificationStatus: string }>)
      .find((s) => (s.userId ?? s.id) === userId)!;
    // The list an admin manages people from is the list that shows the decision.
    expect(updated.verificationStatus).toBe("approved");
  });

  it("lets a supervisor approve their own operator from the operators list", async () => {
    const { app } = await makeTestApp();
    const token = await loginSupervisor(app);
    const created = await app.inject({
      method: "POST", url: "/v1/supervisor/operators", headers: bearer(token),
      payload: await staffBody(app, token, { firstName: "Sita", lastName: "Devi", phone: "9876500099", societyIds: ["soc-demo"] }),
    });
    expect(created.statusCode).toBe(201);
    const userId = created.json().operator.userId ?? created.json().operator.id;

    const approved = await app.inject({
      method: "POST", url: `/v1/supervisor/operators/${userId}/verification`, headers: bearer(token),
      payload: JSON.stringify({ status: "approved" }),
    });
    expect(approved.statusCode).toBe(200);

    const listed = await app.inject({ method: "GET", url: "/v1/supervisor/operators", headers: bearer(token) });
    const row = (listed.json().operators as Array<{ id: string; verificationStatus: string }>).find((o) => o.id === userId)!;
    expect(row.verificationStatus).toBe("approved");
  });
});

describe("DFT slot monitoring narrows to one day", () => {
  it("answers only the day asked for", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await container.store.slots.put({
      id: "slot-day-1", societyId: "soc-demo", date: soon, window: "Morning",
      startTime: "08:00", endTime: "11:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    await container.store.slots.put({
      id: "slot-day-2", societyId: "soc-demo", date: later, window: "Morning",
      startTime: "08:00", endTime: "11:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });

    const oneDay = await app.inject({
      method: "GET", url: `/v1/supervisor/slots?from=${soon}&to=${soon}`, headers: bearer(token),
    });
    const ids = (oneDay.json().slots as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain("slot-day-1");
    expect(ids).not.toContain("slot-day-2");
  });

  it("keeps a supervisor to their own societies", async () => {
    const { app, container } = await makeTestApp();
    const token = await loginSupervisor(app);
    await container.store.slots.put({
      id: "slot-other-area-2", societyId: "soc-gachibowli", date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      window: "Morning", startTime: "08:00", endTime: "11:00", capacityTotal: 5, capacityRemaining: 5, isActive: true,
    });
    const res = await app.inject({ method: "GET", url: "/v1/supervisor/slots", headers: bearer(token) });
    // The area filter narrows what is shown; it never widens it.
    expect((res.json().slots as Array<{ id: string }>).some((s) => s.id === "slot-other-area-2")).toBe(false);
  });
});
