import { randomUUID } from "node:crypto";
import type { DataStore } from "../ports/repositories";

// A resident erasing their own account.
//
// Apple requires this of any app that creates an account, and is explicit that a
// support flow does not count: "only offering to temporarily deactivate or disable an
// account is insufficient", and an app outside a regulated industry may not make
// somebody send an email to be forgotten. Play wants the same thing plus a public web
// URL for people who have already uninstalled. From 13 May 2027 the DPDP Act's
// erasure right says it again in law.
//
// So this is a real deletion, and the only reason anything survives it is that
// something else compels the record to.

// What cannot be erased, and why.
//
// The ledger is double-entry accounting for money that actually moved. A GST-registered
// business in India has to be able to produce the invoice behind every rupee for years
// after the customer has gone, so the transactions stay and the person is unlinked from
// them instead. Same for the orders themselves: an operator's collection record is the
// evidence behind a bill that may still be disputed.
//
// Everything that identifies a human being goes.
export interface DeletionOutcome {
  deleted: true;
  // Named so a caller can tell the resident precisely what was kept and why, rather
  // than making them wonder.
  retained: { ledgerEntries: boolean; orderHistory: boolean; reason: string };
}

export class AccountDeletionService {
  constructor(private readonly store: DataStore) {}

  async deleteResidentAccount(userId: string): Promise<DeletionOutcome | null> {
    const user = await this.store.users.get(userId);
    if (!user) return null;

    // A tombstone rather than a blank.
    //
    // `uq_users_phone` is a unique index, so every deleted account needs a phone value
    // nothing else holds. Reusing one value would mean the second person to leave could
    // not be erased at all. The tombstone is deliberately not a phone number, so a
    // future `byPhone` can never match it and the number itself is genuinely released
    // for somebody else to sign up with.
    const tombstone = `deleted:${randomUUID()}`;

    user.phone = tombstone;
    user.fullName = null;
    user.firstName = null;
    user.lastName = null;
    user.email = null;
    user.status = "deleted";
    // Existing sessions die on their next request: sessionFromToken refuses any user
    // whose status is not active and deletes the session as it goes.
    await this.store.users.put(user);

    const residents = await this.store.residents.find((r) => r.userId === userId);
    for (const resident of residents) {
      // The flat is the address of a home somebody still lives in. It identifies them
      // as surely as their name does, and the society keeps its own record of who lives
      // where — this copy has no reason to outlive the account.
      resident.unitNumber = "";
      resident.towerBlock = null;
      resident.address = null;
      resident.pickupAddress = null;
      resident.preferredWindows = [];
      resident.onboardingCompleted = false;
      await this.store.residents.put(resident);

      // A subscription that keeps renewing against a deleted account would charge a
      // wallet nobody can reach and cut service nobody can restore.
      const subscriptions = await this.store.subscriptions.find((s) => s.residentId === resident.id);
      for (const subscription of subscriptions) {
        if (subscription.status !== "active") continue;
        subscription.status = "cancelled";
        subscription.autoRenew = false;
        subscription.pendingPlanId = null;
        subscription.cancelReason = "account deleted";
        await this.store.subscriptions.put(subscription);
      }
    }

    // Push tokens are a live channel to a handset. Nothing should be able to notify an
    // account that no longer exists.
    const tokens = await this.store.deviceTokens.find((t) => t.userId === userId);
    for (const token of tokens) await this.store.deviceTokens.remove(token.id);

    return {
      deleted: true,
      retained: {
        ledgerEntries: true,
        orderHistory: true,
        reason:
          "Financial transactions and the collection records behind them are kept to meet Indian tax and accounting obligations. They are no longer linked to your name, phone number or address.",
      },
    };
  }
}
