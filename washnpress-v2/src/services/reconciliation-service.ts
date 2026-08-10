import { randomUUID } from "node:crypto";
import { Account } from "../domain/accounts";
import { walletAccount } from "../domain/ledger-accounts";
import { buildTransaction, type LedgerEntry } from "../domain/ledger";
import type { DataStore } from "../ports/repositories";
import type { PaymentProvider } from "../domain/payments/provider";

// The reconciliation job is the safety net for payments. It looks at every pending
// top up intent, asks the provider for the real outcome, and credits the wallet for
// those that are paid. Crediting is guarded by an idempotency key on the provider
// order id, so a payment that a webhook already handled is never credited twice.
export class ReconciliationService {
  constructor(private readonly store: DataStore, private readonly provider: PaymentProvider) {}

  async runOnce(): Promise<{ checked: number; credited: number }> {
    const pending = await this.store.paymentIntents.find((i) => i.status === "pending");
    let credited = 0;
    for (const intent of pending) {
      const status = await this.provider.getOrderStatus(intent.providerOrderId);
      if (status === "paid") {
        const key = `payment:${intent.providerOrderId}`;
        if (!(await this.store.idempotency.seen(key))) {
          const account = walletAccount(intent.residentId);
          const entries: LedgerEntry[] = [
            { account: Account.GatewayClearing, direction: "debit", amount: intent.amountPaise },
            { account, direction: "credit", amount: intent.amountPaise },
          ];
          await this.store.ledger.post(buildTransaction({ id: randomUUID(), reference: intent.providerOrderId, entries, at: new Date() }));
          await this.store.idempotency.markSeen(key);
          credited += 1;
        }
        intent.status = "reconciled";
        await this.store.paymentIntents.put(intent);
      } else if (status === "failed") {
        intent.status = "failed";
        await this.store.paymentIntents.put(intent);
      }
    }
    return { checked: pending.length, credited };
  }
}
