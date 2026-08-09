import { assertPaise, type Paise } from "./money";

export type Direction = "debit" | "credit";

export interface LedgerEntry {
  account: string;
  direction: Direction;
  amount: Paise;
}

export interface PostedTransaction {
  id: string;
  reference: string;
  entries: LedgerEntry[];
  createdAt: string;
}

// A valid transaction has at least two entries and total debits equal total credits.
export function validateEntries(entries: LedgerEntry[]): void {
  if (entries.length < 2) {
    throw new Error("A ledger transaction needs at least two entries");
  }
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    assertPaise(entry.amount);
    if (entry.amount === 0) throw new Error("Ledger entry amount must be positive");
    if (entry.direction === "debit") debit += entry.amount;
    else credit += entry.amount;
  }
  if (debit !== credit) {
    throw new Error(`Unbalanced transaction: debits ${debit} do not equal credits ${credit}`);
  }
}

export function buildTransaction(input: {
  id: string;
  reference: string;
  entries: LedgerEntry[];
  at: Date;
}): PostedTransaction {
  validateEntries(input.entries);
  return {
    id: input.id,
    reference: input.reference,
    entries: input.entries,
    createdAt: input.at.toISOString(),
  };
}

// Balance is credits minus debits for the account across every posted transaction.
export function balanceOf(transactions: PostedTransaction[], account: string): Paise {
  let balance = 0;
  for (const txn of transactions) {
    for (const entry of txn.entries) {
      if (entry.account !== account) continue;
      balance += entry.direction === "credit" ? entry.amount : -entry.amount;
    }
  }
  return balance;
}
