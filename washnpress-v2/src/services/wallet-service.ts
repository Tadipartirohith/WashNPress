import { randomUUID } from "node:crypto";
import { Account } from "../domain/accounts";
import { walletAccount } from "../domain/ledger-accounts";
import { buildTransaction, balanceOf, type LedgerEntry } from "../domain/ledger";
import type { DataStore } from "../ports/repositories";
import type { PaymentProvider } from "../domain/payments/provider";

export class InsufficientBalanceError extends Error {
  constructor() { super("Insufficient wallet balance"); this.name = "InsufficientBalanceError"; }
}

export class WalletService {
  constructor(
    private readonly store: DataStore,
    private readonly provider: PaymentProvider,
    private readonly currency: string,
  ) {}

  async balancePaise(residentId: string): Promise<number> {
    const account = walletAccount(residentId);
    return balanceOf(await this.store.ledger.transactionsForAccount(account), account);
  }

  // Start a top up. Returns a provider order the client pays against. The wallet is
  // only credited later, when the verified webhook arrives.
  async startTopUp(residentId: string, amountPaise: number) {
    return this.provider.createOrder({ amountPaise, currency: this.currency, receipt: `wallet-${residentId}-${Date.now()}` });
  }

  // Spend from the wallet for a subscription or add on. Debits the wallet and credits
  // the matching revenue account in one balanced transaction.
  async charge(residentId: string, amountPaise: number, revenue: Account, reference: string): Promise<void> {
    const balance = await this.balancePaise(residentId);
    if (balance < amountPaise) throw new InsufficientBalanceError();
    const entries: LedgerEntry[] = [
      { account: walletAccount(residentId), direction: "debit", amount: amountPaise },
      { account: revenue, direction: "credit", amount: amountPaise },
    ];
    await this.store.ledger.post(buildTransaction({ id: randomUUID(), reference, entries, at: new Date() }));
  }

  async transactions(residentId: string) {
    const account = walletAccount(residentId);
    const txns = await this.store.ledger.transactionsForAccount(account);
    return txns.map((t) => {
      const entry = t.entries.find((e) => e.account === account)!;
      return { reference: t.reference, direction: entry.direction, amountPaise: entry.amount, at: t.createdAt };
    });
  }
}
