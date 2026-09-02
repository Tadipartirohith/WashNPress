import { describe, it, expect } from "vitest";
import {
  TRANSACTION_STATUSES, TRANSACTION_TYPES,
  filterTransactions, matchesSearch, newestFirst, statusOfCharge, tallyOf, totalOf,
  type RevenueTransaction,
} from "../../src/domain/revenue-transactions";

// The revenue report could always say what a period came to, and break that total
// down six ways. What it could not do is show the movements the total is made of, so
// a figure that looked wrong could be sliced and never opened.

const txn = (over: Partial<RevenueTransaction> = {}): RevenueTransaction => ({
  id: "txn-1", orderId: "ord-1", orderCode: "ORD-1001",
  customerName: "Anusha", customerPhone: "9876543210",
  societyId: "soc-demo", societyName: "My Home Bhooja",
  at: "2026-09-01T10:00:00.000Z",
  type: "order_payment", status: "successful", amountPaise: 24900,
  paymentMethod: null,
  ...over,
});

describe("what a charge's own word means here", () => {
  it("treats every settled spelling as successful", () => {
    for (const word of ["paid", "settled", "reconciled", "PAID"]) {
      expect(statusOfCharge(word), word).toBe("successful");
    }
  });

  it("keeps a failure a failure", () => {
    expect(statusOfCharge("failed")).toBe("failed");
  });

  it("keeps a refund and a cancellation apart", () => {
    expect(statusOfCharge("refunded")).toBe("refunded");
    expect(statusOfCharge("cancelled")).toBe("cancelled");
  });

  it("treats anything it does not recognise as still owing", () => {
    // Better to show money as outstanding and be corrected than to report it
    // collected because a word was unfamiliar.
    expect(statusOfCharge("pending")).toBe("pending");
    expect(statusOfCharge(undefined)).toBe("pending");
    expect(statusOfCharge("something-new")).toBe("pending");
  });

  it("covers every type and status the round names", () => {
    expect(TRANSACTION_TYPES).toHaveLength(6);
    expect(TRANSACTION_STATUSES).toHaveLength(5);
  });
});

describe("finding one", () => {
  it("matches the transaction, the order, the person or their number", () => {
    expect(matchesSearch(txn(), "txn-1")).toBe(true);
    expect(matchesSearch(txn(), "ORD-1001")).toBe(true);
    expect(matchesSearch(txn(), "Anusha")).toBe(true);
    expect(matchesSearch(txn(), "9876543210")).toBe(true);
  });

  it("does not make somebody know how a name starts", () => {
    expect(matchesSearch(txn({ customerName: "Gouri Priya" }), "priya")).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(matchesSearch(txn(), "  anusha ")).toBe(true);
  });

  it("matches everything when nothing was typed", () => {
    expect(matchesSearch(txn(), "")).toBe(true);
  });

  it("does not fall over on a row with no customer", () => {
    expect(matchesSearch(txn({ customerName: null, customerPhone: null }), "anusha")).toBe(false);
  });
});

describe("narrowing the list", () => {
  const rows = [
    txn({ id: "a", type: "order_payment", status: "successful" }),
    txn({ id: "b", type: "subscription_payment", status: "pending" }),
    txn({ id: "c", type: "refund", status: "refunded", customerName: "Ravi" }),
  ];

  it("narrows by type", () => {
    expect(filterTransactions(rows, { type: "refund" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("narrows by status", () => {
    expect(filterTransactions(rows, { status: "pending" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("narrows by both together", () => {
    expect(filterTransactions(rows, { type: "order_payment", status: "pending" })).toEqual([]);
  });

  it("narrows by search alongside the rest", () => {
    expect(filterTransactions(rows, { type: "refund", q: "ravi" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("returns everything when nothing is asked", () => {
    expect(filterTransactions(rows, {})).toHaveLength(3);
  });
});

describe("the order they are read in", () => {
  it("puts the newest at the top", () => {
    const rows = [
      txn({ id: "old", at: "2026-08-01T10:00:00.000Z" }),
      txn({ id: "new", at: "2026-09-01T10:00:00.000Z" }),
    ];
    expect(newestFirst(rows).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("does not reorder the caller's array underneath them", () => {
    const rows = [txn({ id: "old", at: "2026-08-01T10:00:00.000Z" }), txn({ id: "new" })];
    newestFirst(rows);
    expect(rows[0].id).toBe("old");
  });
});

describe("what the rows on screen come to", () => {
  it("totals them", () => {
    expect(totalOf([txn({ amountPaise: 100 }), txn({ amountPaise: 250 })])).toBe(350);
  });

  it("is zero for an empty list rather than undefined", () => {
    expect(totalOf([])).toBe(0);
  });

  it("separates what was taken, what went back, and what is still owed", () => {
    const tally = tallyOf([
      txn({ amountPaise: 1000, status: "successful" }),
      txn({ amountPaise: 400, type: "refund", status: "refunded" }),
      txn({ amountPaise: 250, status: "pending" }),
    ]);
    expect(tally).toEqual({ count: 3, settledPaise: 1000, refundedPaise: 400, pendingPaise: 250 });
  });
});
