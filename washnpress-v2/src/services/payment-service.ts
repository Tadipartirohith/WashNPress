import { randomUUID } from "node:crypto";
import { Account } from "../domain/accounts";
import { walletAccount } from "../domain/ledger-accounts";
import { buildTransaction, balanceOf, type LedgerEntry } from "../domain/ledger";
import { verifyWebhookSignature } from "../domain/payments/signature";
import type { DataStore } from "../ports/repositories";

export class InvalidSignatureError extends Error {
  constructor() { super("Webhook signature verification failed"); this.name = "InvalidSignatureError"; }
}

import type { PaymentMethod } from "../domain/models";

const KNOWN_METHODS: PaymentMethod[] = ["upi", "card", "netbanking", "wallet"];
function readMethod(value: unknown): PaymentMethod | null {
  return typeof value === "string" && (KNOWN_METHODS as string[]).includes(value) ? (value as PaymentMethod) : null;
}

interface WebhookEvent {
  id?: string; event?: string;
  payload?: {
    residentId?: string; amountPaise?: number; purpose?: string;
    // What the gateway settled the top-up with, and which top-up it settled. Both
    // are optional: an older gateway sends neither, and the credit still happens.
    providerOrderId?: string; method?: string;
  };
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

    // Record how the money came in against the top-up it settled, so the revenue
    // report can break inflows down by method. Matched on the provider order id the
    // top-up was created with; when the gateway does not name one, the credit still
    // stands and the method is simply left unrecorded rather than guessed.
    const providerOrderId = event.payload?.providerOrderId;
    const method = readMethod(event.payload?.method);
    if (providerOrderId) {
      const [intent] = await this.store.paymentIntents.find((i) => i.providerOrderId === providerOrderId);
      if (intent) {
        intent.status = "reconciled";
        intent.method = method ?? intent.method ?? null;
        await this.store.paymentIntents.put(intent);
      }
    }
    return { status: "processed", balancePaise: balanceOf(await this.store.ledger.transactionsForAccount(account), account) };
  }
}
