import { describe, it, expect } from "vitest";
import {
  makeTestApp, bearer, loginAdmin, loginOperator, loginResident, loginSupervisor,
  seedSlot, openSlotNow, giveSubscription,
} from "./helpers";
import { buildTransaction } from "../../src/domain/ledger";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";

// The order details page was a column of dashes. Every fact it needed was either
// recorded and not read, or derivable and not derived.

async function bookAndCollect(
  ctx: Awaited<ReturnType<typeof makeTestApp>>, slotId: string, estimated: number, received: number,
) {
  const { app, container } = ctx;
  await seedSlot(container, slotId, 5);
  const resident = await loginResident(app);
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(resident),
    payload: JSON.stringify({ slotId, estimatedCount: estimated }),
  });
  const orderId = booked.json().order.id as string;
  const operator = await loginOperator(app);
  await openSlotNow(container, slotId);
  await app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operator),
    payload: JSON.stringify({ items: [{ category: "Shirts", quantity: received }] }),
  });
  return orderId;
}

describe("DFT an order says what was asked for and what turned up", () => {
  it("keeps both quantities and the difference between them", async () => {
    const ctx = await makeTestApp();
    const orderId = await bookAndCollect(ctx, "slot-hist-1", 9, 11);
    const token = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: bearer(token) });
    const history = res.json().order.quantityHistory;

    // The spec's own example: nine declared, eleven received, two more than expected.
    expect(history.residentEstimate).toBe(9);
    expect(history.operatorReceived).toBe(11);
    expect(history.difference).toBe(2);
    // And when it was counted, and by whom.
    expect(history.recordedAt).toBeTruthy();
    expect(history.recordedByName).toBeTruthy();
  });

  it("itemises the charge instead of showing a total and nothing else", async () => {
    const ctx = await makeTestApp();
    await giveSubscription(ctx.container, "res-demo", "plan-basic", 38);
    const orderId = await bookAndCollect(ctx, "slot-hist-2", 6, 6);
    const token = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: bearer(token) });
    const charges = res.json().order.charges;

    // Two garments of allowance were left, so four are extra and priced as such.
    expect(charges.subscriptionCoveredCount).toBe(2);
    expect(charges.additionalCount).toBe(4);
    expect(charges.additionalRatePaise).toBeGreaterThan(0);
    expect(charges.additionalChargePaise).toBeGreaterThan(0);
    expect(charges.status).not.toBe("none");
  });
});

describe("DFT an order keeps every attempt to settle what it owes", () => {
  it("records the attempt that could not be paid, and the one that could", async () => {
    const ctx = await makeTestApp();
    const { app, container } = ctx;
    // No allowance and an empty wallet, so the charge cannot go through.
    await giveSubscription(container, "res-demo", "plan-basic", 40);
    const orderId = await bookAndCollect(ctx, "slot-hist-3", 5, 5);

    const admin = await loginAdmin(app);
    const first = await app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: bearer(admin) });
    const attempts = first.json().order.paymentHistory as { status: string; note: string | null; amountPaise: number }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("pending");
    // Why it did not go through, rather than only that it did not.
    expect(attempts[0].note).toMatch(/wallet/i);

    // Fund the wallet and let the resident settle it.
    await container.store.ledger.post(buildTransaction({
      id: "test-topup-hist-3", reference: "test-topup-hist-3",
      entries: [
        { account: Account.GatewayClearing, direction: "debit", amount: 500000 },
        { account: walletAccount("res-demo"), direction: "credit", amount: 500000 },
      ],
      at: new Date(),
    }));
    const resident = await loginResident(app);
    const paid = await app.inject({
      method: "POST", url: `/v1/resident/orders/${orderId}/pay-additional`, headers: bearer(resident), payload: "{}",
    });
    expect(paid.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: bearer(admin) });
    const all = after.json().order.paymentHistory as { status: string; kind: string; reference: string | null }[];
    // Both attempts survive: the failure is not overwritten by the success.
    expect(all).toHaveLength(2);
    expect(all[0].status).toBe("pending");
    expect(all[1].status).toBe("paid");
    expect(all[1].kind).toBe("retry");
    // And the money can be found from here.
    expect(all[1].reference).toContain(orderId);
  });
});

describe("DFT an order says who has held it", () => {
  it("records the operator the tower gave it to, from the moment it was booked", async () => {
    // The operator is no longer whoever happened to open the order first. The block
    // names who covers it, so the order is assigned when it is created and the
    // history says so from the start.
    const ctx = await makeTestApp();
    const orderId = await bookAndCollect(ctx, "slot-hist-4", 3, 3);
    const token = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: bearer(token) });
    const history = res.json().order.assignmentHistory as { toName: string | null; note: string | null }[];
    expect(history).toHaveLength(1);
    expect(history[0].toName).toBeTruthy();
    expect(history[0].note).toMatch(/tower/i);
  });

  it("records a reassignment with both names, not just the new one", async () => {
    const ctx = await makeTestApp();
    const { app } = ctx;
    const orderId = await bookAndCollect(ctx, "slot-hist-5", 3, 3);

    const supervisor = await loginSupervisor(app);
    const moved = await app.inject({
      method: "POST", url: `/v1/supervisor/orders/${orderId}/assign`, headers: bearer(supervisor),
      payload: JSON.stringify({ operatorUserId: null, reason: "Back to the queue" }),
    });
    expect(moved.statusCode).toBe(200);

    const admin = await loginAdmin(app);
    const res = await app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: bearer(admin) });
    const history = res.json().order.assignmentHistory as { fromName: string | null; toName: string | null; byName: string | null }[];
    expect(history).toHaveLength(2);
    // Who had it, who has it now, and who moved it.
    expect(history[1].fromName).toBeTruthy();
    expect(history[1].toName).toBeNull();
    expect(history[1].byName).toBeTruthy();
  });

  it("names the actor on every step of the status history", async () => {
    const ctx = await makeTestApp();
    const orderId = await bookAndCollect(ctx, "slot-hist-6", 3, 3);
    const token = await loginAdmin(ctx.app);
    const res = await ctx.app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: bearer(token) });
    const history = res.json().order.statusHistory as { state: string; actorName: string | null }[];
    expect(history.map((h) => h.state)).toContain("picked_up");
    expect(history.find((h) => h.state === "picked_up")!.actorName).toBeTruthy();
  });
});
