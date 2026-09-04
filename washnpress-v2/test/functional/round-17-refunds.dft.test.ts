import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginAdmin, loginSupervisor, loginOtherSupervisor, loginOperator } from "./helpers";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";

// Refunds, finished. A refund is asked for and then approved or turned down, not a
// wallet credit that happens on its own. An operator or supervisor requests it; a
// supervisor for that society, or any admin, decides. Only on approval does the
// money move — the charge from RefundsPayable, any tax from TaxPayable, back to the
// resident's wallet — and the order is marked refunded so the report nets it out.

describe("DFT the refund approval workflow", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
  });

  // A delivered order in soc-demo with a settled charge and the GST that was taken
  // on it, so a refund has something real to return.
  async function aChargedOrder(id: string, chargePaise: number, taxPaise = 0) {
    const order = {
      id, orderCode: id.toUpperCase(), residentId: "res-demo", societyId: "soc-demo",
      blockId: "block-demo-a", state: "delivered", createdAt: new Date().toISOString(),
      servicesPaise: chargePaise, additionalChargePaise: chargePaise, taxPaise,
      additionalChargeStatus: "paid", assignedOperatorUserId: "user-op",
    };
    await container.store.orders.put(order as never);
    return id;
  }

  const request = (token: string, orderId: string, reason = "Garment returned damaged") =>
    app.inject({ method: "POST", url: "/v1/refunds", headers: bearer(token), payload: JSON.stringify({ orderId, reason }) });
  const approve = (token: string, id: string) =>
    app.inject({ method: "POST", url: `/v1/refunds/${id}/approve`, headers: bearer(token), payload: JSON.stringify({ note: "Approved" }) });
  const reject = (token: string, id: string) =>
    app.inject({ method: "POST", url: `/v1/refunds/${id}/reject`, headers: bearer(token), payload: JSON.stringify({ note: "Not our fault" }) });

  it("an operator asks, the society's supervisor approves, and the wallet is put back", async () => {
    const operator = await loginOperator(app);
    const supervisor = await loginSupervisor(app);
    await aChargedOrder("ord-ref-1", 10000, 1800);

    const asked = await request(operator, "ord-ref-1");
    expect(asked.statusCode).toBe(201);
    const refundId = asked.json().request.id as string;
    expect(asked.json().request.status).toBe("pending");

    const before = await container.wallet.balancePaise("res-demo");
    const decided = await approve(supervisor, refundId);
    expect(decided.statusCode).toBe(200);
    expect(decided.json().request.status).toBe("approved");

    // The resident is put back the charge and the tax: 11,800.
    expect(await container.wallet.balancePaise("res-demo")).toBe(before + 11800);
    // The order now reads refunded, which is what the revenue report nets out.
    expect((await container.store.orders.get("ord-ref-1"))!.additionalChargeStatus).toBe("refunded");

    // The tax that was collected is handed back out of TaxPayable, not kept.
    const ledger = await container.store.ledger.all();
    const taxDebits = ledger.flatMap((t) => t.entries)
      .filter((e) => e.account === Account.TaxPayable && e.direction === "debit")
      .reduce((s, e) => s + e.amount, 0);
    expect(taxDebits).toBe(1800);
    const walletCredit = ledger.flatMap((t) => t.entries)
      .filter((e) => e.account === walletAccount("res-demo") && e.direction === "credit" && e.amount === 11800);
    expect(walletCredit.length).toBe(1);
  });

  it("a supervisor cannot approve a refund for a society they do not manage", async () => {
    const operator = await loginOperator(app);
    const otherSupervisor = await loginOtherSupervisor(app); // manages soc-aparna, not soc-demo
    await aChargedOrder("ord-ref-2", 8000);
    const refundId = (await request(operator, "ord-ref-2")).json().request.id as string;

    const denied = await approve(otherSupervisor, refundId);
    expect(denied.statusCode).toBe(403);
    // Nothing moved: the request is still pending and the order still paid.
    const [row] = await container.store.refundRequests.find((r) => r.id === refundId);
    expect(row.status).toBe("pending");
    expect((await container.store.orders.get("ord-ref-2"))!.additionalChargeStatus).toBe("paid");
  });

  it("an admin can approve a refund in any society", async () => {
    const operator = await loginOperator(app);
    const admin = await loginAdmin(app);
    await aChargedOrder("ord-ref-3", 5000);
    const refundId = (await request(operator, "ord-ref-3")).json().request.id as string;
    expect((await approve(admin, refundId)).statusCode).toBe(200);
    expect((await container.store.orders.get("ord-ref-3"))!.additionalChargeStatus).toBe("refunded");
  });

  it("a rejected request moves no money and can be raised afresh", async () => {
    const supervisor = await loginSupervisor(app);
    await aChargedOrder("ord-ref-4", 6000);
    const first = (await request(supervisor, "ord-ref-4")).json().request.id as string;

    const before = await container.wallet.balancePaise("res-demo");
    expect((await reject(supervisor, first)).json().request.status).toBe("rejected");
    expect(await container.wallet.balancePaise("res-demo")).toBe(before);

    // A rejection is not the end of it: the order still has its charge, so a fresh
    // request is allowed rather than blocked by the one that was turned down.
    const second = await request(supervisor, "ord-ref-4");
    expect(second.statusCode).toBe(201);
  });

  it("refuses a second live request, and a refund on a charge that never settled", async () => {
    const operator = await loginOperator(app);
    await aChargedOrder("ord-ref-5", 7000);
    expect((await request(operator, "ord-ref-5")).statusCode).toBe(201);
    // A refund is already awaiting a decision.
    expect((await request(operator, "ord-ref-5")).statusCode).toBe(409);

    // An order whose charge is still pending has nothing to give back.
    await container.store.orders.put({
      id: "ord-ref-6", orderCode: "ORD-REF-6", residentId: "res-demo", societyId: "soc-demo",
      state: "delivered", createdAt: new Date().toISOString(),
      additionalChargePaise: 9000, additionalChargeStatus: "pending", assignedOperatorUserId: "user-op",
    } as never);
    const nothing = await request(operator, "ord-ref-6");
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json().error).toBe("nothing_to_refund");
  });

  it("a supervisor sees their societies' refunds; the boundary holds on the list too", async () => {
    const operator = await loginOperator(app);
    const supervisor = await loginSupervisor(app);
    const otherSupervisor = await loginOtherSupervisor(app);
    await aChargedOrder("ord-ref-7", 4000);
    await request(operator, "ord-ref-7");

    const mine = await app.inject({ method: "GET", url: "/v1/refunds", headers: bearer(supervisor) });
    expect(mine.json().requests.map((r: { orderId: string }) => r.orderId)).toContain("ord-ref-7");
    const theirs = await app.inject({ method: "GET", url: "/v1/refunds?status=pending", headers: bearer(otherSupervisor) });
    expect(theirs.json().requests.map((r: { orderId: string }) => r.orderId)).not.toContain("ord-ref-7");
  });
});
