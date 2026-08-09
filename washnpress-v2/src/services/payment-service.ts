import { randomUUID } from "node:crypto";
import { Account } from "../domain/accounts";
import { walletAccount } from "../domain/ledger-accounts";
import { buildTransaction, balanceOf, type LedgerEntry } from "../domain/ledger";
import { verifyWebhookSignature } from "../domain/payments/signature";
import type { DataStore } from "../ports/repositories";

export class InvalidSignatureError extends Error {
  constructor() { super("Webhook signature verification failed"); this.name = "InvalidSignatureError"; }
}

interface WebhookEvent {
  id?: string; event?: string;
  payload?: { residentId?: string; amountPaise?: number; purpose?: string };
}

export class PaymentService {
  constructor(private readonly store: DataStore, private readonly webhookSecret: string) {}

  // Verify the signature over the raw body, ignore replays, then credit the wallet
  // with a balanced ledger transaction. A forged or duplicated event does nothing.
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<{ status: string; balancePaise?: number }> {
    if (!verifyWebhookSignature(rawBody, signature, this.webhookSecret)) throw new InvalidSignatureError();
    const event = JSON.parse(rawBody) as WebhookEvent;
    if (!event.id) throw new Error("Webhook event is missing an id");
    if (await this.store.idempotency.seen(event.id)) return { status: "duplicate_ignored" };

    const residentId = event.payload?.residentId;
    const amountPaise = event.payload?.amountPaise;
    if (!residentId || !amountPaise) throw new Error("Webhook payload is missing residentId or amountPaise");

    const account = walletAccount(residentId);
    const entries: LedgerEntry[] = [
      { account: Account.GatewayClearing, direction: "debit", amount: amountPaise },
      { account, direction: "credit", amount: amountPaise },
    ];
    await this.store.ledger.post(buildTransaction({ id: randomUUID(), reference: event.id, entries, at: new Date() }));
    await this.store.idempotency.markSeen(event.id);
    return { status: "processed", balancePaise: balanceOf(await this.store.ledger.transactionsForAccount(account), account) };
  }
}
