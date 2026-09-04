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

  // Start a top up. Returns a provider order the client pays against, and records a
  // pending intent. The wallet is credited later by the verified webhook, or by the
  // reconciliation job if the webhook was missed.
  async startTopUp(residentId: string, amountPaise: number) {
    const order = await this.provider.createOrder({ amountPaise, currency: this.currency, receipt: `wallet-${residentId}-${Date.now()}` });
    await this.store.paymentIntents.put({
      id: randomUUID(), providerOrderId: order.providerOrderId, residentId, amountPaise,
      status: "pending", createdAt: new Date().toISOString(),
    });
    return order;
  }

  // Spend from the wallet for a subscription or add on. Debits the wallet and credits
  // the matching revenue account in one balanced transaction.
  async charge(residentId: string, amountPaise: number, revenue: Account, reference: string): Promise<void> {
    return this.chargeWithTax(residentId, amountPaise, 0, revenue, reference);
  }

  // The same spend, with GST taken alongside it. The wallet is debited the whole of
  // what the resident pays — the charge and the tax — in one balanced transaction,
  // and the tax is credited to TaxPayable rather than to revenue, because tax
  // collected is money held for the authority and was never the platform's to earn.
  // A zero tax posts exactly the two entries `charge` always did, so nothing about
  // the untaxed path changes.
  async chargeWithTax(residentId: string, netPaise: number, taxPaise: number, revenue: Account, reference: string): Promise<void> {
    const total = netPaise + Math.max(0, taxPaise);
    const balance = await this.balancePaise(residentId);
    if (balance < total) throw new InsufficientBalanceError();
    const entries: LedgerEntry[] = [
      { account: walletAccount(residentId), direction: "debit", amount: total },
      { account: revenue, direction: "credit", amount: netPaise },
    ];
    if (taxPaise > 0) entries.push({ account: Account.TaxPayable, direction: "credit", amount: taxPaise });
    await this.store.ledger.post(buildTransaction({ id: randomUUID(), reference, entries, at: new Date() }));
  }

  // Put money back on the wallet for a refund. The mirror of a charge: the charge
  // leaves RefundsPayable, any tax collected leaves TaxPayable, and the whole lands
  // back in the resident's wallet. Reversing the tax as well means a refunded sale
  // leaves the platform holding neither the revenue nor the tax it briefly took.
  async refund(residentId: string, netPaise: number, taxPaise: number, reference: string): Promise<void> {
    const total = netPaise + Math.max(0, taxPaise);
    if (total <= 0) return;
    const entries: LedgerEntry[] = [
      { account: Account.RefundsPayable, direction: "debit", amount: netPaise },
      { account: walletAccount(residentId), direction: "credit", amount: total },
    ];
    if (taxPaise > 0) entries.push({ account: Account.TaxPayable, direction: "debit", amount: taxPaise });
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
