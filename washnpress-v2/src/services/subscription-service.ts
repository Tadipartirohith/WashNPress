import { randomUUID } from "node:crypto";
import { Account } from "../domain/accounts";
import { cyclePricePaise, cycleLengthDays, computeProrationPaise, daysBetween, addDaysIso } from "../domain/subscriptions";
import type { BillingCycle, Subscription } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { WalletService } from "./wallet-service";

export class SubscriptionService {
  constructor(private readonly store: DataStore, private readonly wallet: WalletService) {}

  async getActive(residentId: string): Promise<Subscription | null> {
    const found = await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active");
    return found[0] ?? null;
  }

  // Charge the wallet for the cycle price, then activate the subscription. If the
  // wallet is short, the wallet service throws and the caller prompts a top up.
  async subscribe(residentId: string, planId: string, cycle: BillingCycle): Promise<Subscription> {
    const plan = await this.store.plans.get(planId);
    if (!plan || !plan.isActive) throw new Error("Plan not found");
    const price = cyclePricePaise(plan, cycle);
    const now = new Date().toISOString();
    const reference = `sub-${residentId}-${Date.now()}`;
    await this.wallet.charge(residentId, price, Account.SubscriptionRevenue, reference);

    const subscription: Subscription = {
      id: randomUUID(), residentId, planId, status: "active", cycle,
      cycleStart: now, cycleEnd: addDaysIso(now, cycleLengthDays(cycle)),
      garmentsUsed: 0, autoRenew: true, pendingPlanId: null, pauseUntil: null, cancelReason: null,
    };
    return this.store.subscriptions.put(subscription);
  }

  // Upgrade or downgrade takes effect next cycle. We record the pending plan and
  // return the proration amount that would apply for the remainder of this cycle.
  async changePlan(residentId: string, newPlanId: string): Promise<{ subscription: Subscription; prorationPaise: number }> {
    const sub = await this.getActive(residentId);
    if (!sub) throw new Error("No active subscription");
    const current = await this.store.plans.get(sub.planId);
    const next = await this.store.plans.get(newPlanId);
    if (!current || !next) throw new Error("Plan not found");

    const cycleDays = cycleLengthDays(sub.cycle);
    const daysRemaining = daysBetween(new Date().toISOString(), sub.cycleEnd);
    const prorationPaise = computeProrationPaise({
      currentCyclePaise: cyclePricePaise(current, sub.cycle),
      newCyclePaise: cyclePricePaise(next, sub.cycle),
      daysRemaining, cycleDays,
    });
    sub.pendingPlanId = newPlanId;
    await this.store.subscriptions.put(sub);
    return { subscription: sub, prorationPaise };
  }

  async pause(residentId: string, until: string): Promise<Subscription> {
    const sub = await this.getActive(residentId);
    if (!sub) throw new Error("No active subscription");
    sub.status = "paused"; sub.pauseUntil = until;
    return this.store.subscriptions.put(sub);
  }

  async cancel(residentId: string, reason: string): Promise<Subscription> {
    const sub = await this.getActive(residentId);
    if (!sub) throw new Error("No active subscription");
    sub.status = "cancelled"; sub.cancelReason = reason;
    return this.store.subscriptions.put(sub);
  }

  // Deduct delivered garments from the cap, never below zero remaining.
  async deductGarments(subscriptionId: string, count: number): Promise<{ used: number; cap: number } | null> {
    const sub = await this.store.subscriptions.get(subscriptionId);
    if (!sub) return null;
    const plan = await this.store.plans.get(sub.planId);
    const cap = plan?.garmentCap ?? 0;
    sub.garmentsUsed = Math.min(cap, sub.garmentsUsed + count);
    await this.store.subscriptions.put(sub);
    return { used: sub.garmentsUsed, cap };
  }
}
