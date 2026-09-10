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
  // The gateway's own event id, kept for logs. It is deliberately not what
  // idempotency turns on: see handleWebhook.
  id?: string; event?: string;
  payload?: {
    // Which top-up settled. Mandatory, and the only field the credit is derived
    // from — everything else in the payload is checked against the stored intent
    // rather than believed.
    providerOrderId?: string;
    residentId?: string; amountPaise?: number; purpose?: string;
    method?: string;
  };
}

export class PaymentService {
  constructor(private readonly store: DataStore, private readonly webhookSecret: string) {}

  // Verify the signature over the raw body, find the top-up the event claims to
  // settle, and credit that top-up's resident with that top-up's amount.
  //
  // It used to credit `payload.residentId` with `payload.amountPaise`, straight out
  // of the request body, and key replay protection on `payload.id` — three fields the
  // caller writes. The webhook secret ships with a committed default, so anyone who
  // read the repository could sign a body correctly and hand any resident any amount,
  // as many times as they liked by changing the event id. Nothing was ever compared
  // against what the platform itself had recorded.
  //
  // Now the stored PaymentIntent is the authority: no intent, no credit; an amount or
  // a resident that disagrees with it is a forgery and is refused rather than
  // reconciled; and an intent that is no longer pending has already been settled,
  // whether by an earlier event or by the reconciliation job. Idempotency keys on
  // `payment:<providerOrderId>` — the same key the reconciliation job uses — so the
  // two paths to a credit cannot both take it.
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<{ status: string; balancePaise?: number }> {
    if (!verifyWebhookSignature(rawBody, signature, this.webhookSecret)) throw new InvalidSignatureError();
    const event = JSON.parse(rawBody) as WebhookEvent;

    const providerOrderId = event.payload?.providerOrderId;
    if (!providerOrderId) throw new Error("Webhook payload is missing providerOrderId");
    const [intent] = await this.store.paymentIntents.find((i) => i.providerOrderId === providerOrderId);
    if (!intent) throw new Error("Webhook names a top-up this platform did not create");

    // What the body claims, against what was recorded when the top-up started. A
    // mismatch is not a discrepancy to reconcile; it is somebody asking to be credited
    // for a payment other than the one they made.
    const claimedAmount = event.payload?.amountPaise;
    if (typeof claimedAmount !== "number") throw new Error("Webhook payload is missing amountPaise");
    if (claimedAmount !== intent.amountPaise) throw new Error("Webhook amount does not match the top-up it settles");
    const claimedResident = event.payload?.residentId;
    if (typeof claimedResident !== "string" || !claimedResident) throw new Error("Webhook payload is missing residentId");
    if (claimedResident !== intent.residentId) throw new Error("Webhook resident does not match the top-up it settles");

    const account = walletAccount(intent.residentId);
    const balance = async () => balanceOf(await this.store.ledger.transactionsForAccount(account), account);

    if (intent.status !== "pending") return { status: "duplicate_ignored", balancePaise: await balance() };
    const key = `payment:${intent.providerOrderId}`;
    if (await this.store.idempotency.seen(key)) return { status: "duplicate_ignored", balancePaise: await balance() };

    const entries: LedgerEntry[] = [
      { account: Account.GatewayClearing, direction: "debit", amount: intent.amountPaise },
      { account, direction: "credit", amount: intent.amountPaise },
    ];
    await this.store.ledger.post(buildTransaction({
      // Referenced by the order, not the event, so a credit posted here and one posted
      // by reconciliation are the same transaction to anyone reading the ledger.
      id: randomUUID(), reference: intent.providerOrderId, entries, at: new Date(),
    }));
    await this.store.idempotency.markSeen(key);

    // How the money came in, recorded against the top-up it settled so the revenue
    // report can break inflows down by method. When the gateway names no method the
    // credit still stands and the method is left unrecorded rather than guessed.
    intent.status = "reconciled";
    intent.method = readMethod(event.payload?.method) ?? intent.method ?? null;
    await this.store.paymentIntents.put(intent);

    return { status: "processed", balancePaise: await balance() };
  }
}
