import { Account } from "../domain/accounts";
import { addDaysIso, cycleLengthDays, cyclePricePaise } from "../domain/subscriptions";
import { rollCycle } from "../domain/plan-usage";
import { computeGst } from "../domain/tax";
import type { Subscription } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import { InsufficientBalanceError, type WalletService } from "./wallet-service";
import type { SystemConfigService } from "./system-config-service";

export interface RenewalRun {
  // Subscriptions whose cycle had ended when the job looked.
  due: number;
  renewed: number;
  expired: number;
}

type Outcome = "renewed" | "expired" | "claimed";

// Subscriptions did not renew. `cycleStart` and `cycleEnd` were written in exactly one
// place — the initial subscribe() — and nothing ever wrote them again, because there
// was no billing job of any kind. Everything downstream read those two dates and
// believed them, so a subscription stayed active past its own expiry indefinitely, was
// never charged for a second cycle, never had its garment or per-service usage reset
// (a resident who spent month one's allowance was capped for good), and every
// downgrade a resident scheduled sat in `pendingPlanId` waiting for a next cycle that
// could not arrive. `autoRenew` was written and read by nothing that renewed.
//
// This is that job. One boundary crossed is one cycle billed.
export class RenewalService {
  constructor(
    private readonly store: DataStore,
    private readonly wallet: WalletService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  async runOnce(now = new Date()): Promise<RenewalRun> {
    // Only "active". A paused subscription is not being served and is not billed for;
    // a cancelled or already expired one has nothing to roll.
    const due = await this.store.subscriptions.find(
      (s) => s.status === "active" && Date.parse(s.cycleEnd) <= now.getTime());
    let renewed = 0;
    let expired = 0;
    for (const sub of due) {
      const outcome = await this.renew(sub);
      if (outcome === "renewed") renewed += 1;
      else if (outcome === "expired") expired += 1;
    }
    return { due: due.length, renewed, expired };
  }

  private async renew(sub: Subscription): Promise<Outcome> {
    // The boundary, not the subscription, is what may only be crossed once. The job
    // runs on a timer and may run on several instances at the same time, and the
    // moment a renewal succeeds `cycleEnd` moves — so this key can never charge the
    // same cycle twice, and the boundary after it gets a key of its own.
    //
    // Claimed before the charge rather than after it. A crash between the two leaves
    // the row active with a cycle end in the past, which reads as expired everywhere
    // and is visible to an admin; claiming afterwards would instead risk charging a
    // resident twice for one month, which is not visible to anybody until they
    // complain.
    //
    // One call rather than a check followed by a mark: with two, both instances could
    // pass the check before either had marked, and both would go on to charge.
    if (!(await this.store.idempotency.claim(`renewal:${sub.id}:${sub.cycleEnd}`))) return "claimed";

    // A scheduled downgrade takes effect here, and only here: this is the "next cycle"
    // that changePlan promised the resident, and until this job existed it never came.
    // A pending plan deleted in the meantime is dropped rather than renewed onto.
    const pending = sub.pendingPlanId ? await this.store.plans.get(sub.pendingPlanId) : null;
    const plan = pending ?? (await this.store.plans.get(sub.planId));
    if (!plan) return this.expire(sub);

    if (!sub.autoRenew) return this.expire(sub);

    const price = cyclePricePaise(plan, sub.cycle);
    const gst = computeGst(price, await this.systemConfig.get());
    try {
      await this.wallet.chargeWithTax(
        sub.residentId, price, gst.taxPaise, Account.SubscriptionRevenue,
        // Referenced by the boundary as well as the subscription, so a year of
        // renewals reads as twelve distinct charges rather than one repeated.
        `sub-renew-${sub.id}-${sub.cycleEnd}`,
      );
    } catch (error) {
      if (!(error instanceof InsufficientBalanceError)) throw error;
      return this.expire(sub);
    }

    // The new cycle starts where the old one ended, never at "now". A job that runs an
    // hour late, or a day late after an outage, must not shorten the cycle it is
    // billing for or drift the renewal date forward a little every month. When several
    // boundaries have gone by, each is renewed and charged on its own pass rather than
    // being forgiven — the resident had the service for those months.
    const start = sub.cycleEnd;
    sub.cycleStart = start;
    sub.cycleEnd = addDaysIso(start, cycleLengthDays(sub.cycle));
    sub.planId = plan.id;
    sub.pendingPlanId = null;
    // A new cycle is a new allowance. `garmentsUsed` was monotonic and nothing reset
    // it, so a resident who reached the cap in month one stayed at the cap.
    sub.garmentsUsed = 0;
    sub.pickupsUsed = 0;
    // History is per-cycle, and it explains this cycle's total. Last month's entries
    // would sum to a number this month's counter no longer shows.
    sub.usageHistory = [];
    // Per-service usage, and what carries into the new cycle — measured against the
    // plan being renewed onto, so a downgrade's carry-forward is capped by what the
    // smaller plan actually includes.
    rollCycle(plan, sub);
    await this.store.subscriptions.put(sub);
    return "renewed";
  }

  // The cycle ended and was not paid for. The subscription expires rather than rolling
  // on unpaid: the model has no past-due state to sit in, and the alternative — leave
  // it active and hope — is the free-service defect this job exists to end. A resident
  // whose wallet was short tops up and subscribes again, which is a decision they make
  // rather than a debt the platform ran up on their behalf. The same applies to a
  // resident who turned auto-renew off and to a plan that has since been deleted:
  // neither is a reason to keep serving.
  private async expire(sub: Subscription): Promise<Outcome> {
    sub.status = "expired";
    await this.store.subscriptions.put(sub);
    return "expired";
  }
}
