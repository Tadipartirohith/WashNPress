import { describe, it, expect } from "vitest";
import { buildTransaction, balanceOf, validateEntries } from "../../src/domain/ledger";
import { Account } from "../../src/domain/accounts";

describe("ledger", () => {
  it("accepts a balanced transaction", () => {
    expect(() => validateEntries([
      { account: Account.GatewayClearing, direction: "debit", amount: 1000 },
      { account: Account.ResidentWallet, direction: "credit", amount: 1000 },
    ])).not.toThrow();
  });
  it("rejects an unbalanced transaction", () => {
    expect(() => validateEntries([
      { account: Account.GatewayClearing, direction: "debit", amount: 1000 },
      { account: Account.ResidentWallet, direction: "credit", amount: 900 },
    ])).toThrow(/Unbalanced/);
  });
  it("rejects a single entry and zero amounts", () => {
    expect(() => validateEntries([{ account: "a", direction: "debit", amount: 100 }])).toThrow();
    expect(() => validateEntries([
      { account: "a", direction: "debit", amount: 0 },
      { account: "b", direction: "credit", amount: 0 },
    ])).toThrow();
  });
  it("derives a wallet balance from posted transactions", () => {
    const topup = buildTransaction({
      id: "t1", reference: "evt_1", at: new Date(),
      entries: [
        { account: Account.GatewayClearing, direction: "debit", amount: 5000 },
        { account: Account.ResidentWallet, direction: "credit", amount: 5000 },
      ],
    });
    const spend = buildTransaction({
      id: "t2", reference: "ord_1", at: new Date(),
      entries: [
        { account: Account.ResidentWallet, direction: "debit", amount: 2000 },
        { account: Account.SubscriptionRevenue, direction: "credit", amount: 2000 },
      ],
    });
    expect(balanceOf([topup, spend], Account.ResidentWallet)).toBe(3000);
  });
});
