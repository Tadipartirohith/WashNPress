// Money, one row per movement.
//
// The revenue report has always been able to say what a period came to, and to break
// that total down by society, block, supervisor, operator, plan and service. What it
// could not do is show the movements the total is made of — so a figure that looked
// wrong could be sliced six ways and never opened.
//
// This is the opening. Each row is one thing that happened to money: an order paid, a
// subscription charged, a refund made. It is a projection over records the platform
// already keeps rather than a second ledger: inventing one would give the platform
// two places to disagree with itself about what it earned.

export type TransactionType =
  | "order_payment"
  | "subscription_payment"
  | "refund"
  | "manual_payment"
  | "discount"
  | "adjustment";

export type TransactionStatus =
  | "successful"
  | "pending"
  | "failed"
  | "refunded"
  | "cancelled";

export const TRANSACTION_TYPES: TransactionType[] = [
  "order_payment", "subscription_payment", "refund", "manual_payment", "discount", "adjustment",
];

export const TRANSACTION_STATUSES: TransactionStatus[] = [
  "successful", "pending", "failed", "refunded", "cancelled",
];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  order_payment: "Order payment",
  subscription_payment: "Subscription payment",
  refund: "Refund",
  manual_payment: "Manual payment",
  discount: "Discount",
  adjustment: "Adjustment",
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  successful: "Successful",
  pending: "Pending",
  failed: "Failed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export interface RevenueTransaction {
  id: string;
  // What it was for. An order payment carries the order it settles; a subscription
  // charge does not have one, and saying so is better than borrowing an unrelated id.
  orderId: string | null;
  orderCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  societyId: string | null;
  societyName: string | null;
  at: string;
  type: TransactionType;
  status: TransactionStatus;
  amountPaise: number;
  // How it was taken. Null wherever the platform did not record one, which is most
  // of what exists today: the method was only introduced with the payment
  // configuration, so older movements genuinely do not know. Guessing "card" because
  // card is enabled would be inventing a fact about somebody's money.
  paymentMethod: string | null;
}

// What a charge's own status word means in the language this list speaks.
//
// The platform records "paid", "pending", "failed" and "none" against a charge.
// "none" is not a status a transaction can have — it means no charge was raised —
// so a row is never built from one.
export function statusOfCharge(status: string | null | undefined): TransactionStatus {
  switch ((status ?? "").toLowerCase()) {
    case "paid":
    case "settled":
    case "reconciled":
      return "successful";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

// Search across the four things somebody actually has in front of them when they go
// looking: the transaction, the order, the person, or the number they rang from.
//
// Case-insensitive, and matched on a substring rather than a prefix — somebody
// looking up "priya" should not have to know the name starts that way.
export function matchesSearch(txn: RevenueTransaction, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [txn.id, txn.orderId, txn.orderCode, txn.customerName, txn.customerPhone]
    .some((field) => (field ?? "").toLowerCase().includes(needle));
}

export interface TransactionFilter {
  type?: string;
  status?: string;
  q?: string;
}

export function filterTransactions(
  transactions: RevenueTransaction[],
  filter: TransactionFilter,
): RevenueTransaction[] {
  return transactions.filter((txn) => {
    if (filter.type && txn.type !== filter.type) return false;
    if (filter.status && txn.status !== filter.status) return false;
    if (filter.q && !matchesSearch(txn, filter.q)) return false;
    return true;
  });
}

// Newest first. A transaction list is read from the top by somebody asking what has
// happened lately, not from the bottom by somebody reading history forwards.
export function newestFirst(transactions: RevenueTransaction[]): RevenueTransaction[] {
  return [...transactions].sort((a, b) => b.at.localeCompare(a.at));
}

// What the rows on screen come to.
//
// Counted from the rows themselves rather than taken from the summary, because a
// filtered list showing four refunds should total those four refunds — a total that
// disagrees with the list above it is worse than no total.
export function totalOf(transactions: RevenueTransaction[]): number {
  return transactions.reduce((sum, txn) => sum + txn.amountPaise, 0);
}

// Money in, money out, and what is still owed — of whatever is currently on screen.
export function tallyOf(transactions: RevenueTransaction[]) {
  const settled = transactions.filter((t) => t.status === "successful");
  const refunds = transactions.filter((t) => t.type === "refund" || t.status === "refunded");
  const waiting = transactions.filter((t) => t.status === "pending");
  return {
    count: transactions.length,
    settledPaise: totalOf(settled),
    refundedPaise: totalOf(refunds),
    pendingPaise: totalOf(waiting),
  };
}
