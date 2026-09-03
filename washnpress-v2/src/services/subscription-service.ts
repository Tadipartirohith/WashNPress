import { randomUUID } from "node:crypto";
import { assertValidPlan, planPricing } from "../domain/plan-usage";
import { Account } from "../domain/accounts";
import { remainingAllowance } from "../domain/garments";
import { cyclePricePaise, cycleLengthDays, addDaysIso } from "../domain/subscriptions";
import { planChangeRefusal, quotePlanChange, type PlanChangeQuote } from "../domain/plan-change";
import type { BillingCycle, Plan, Subscription, PlanServiceRule } from "../domain/models";
import { normalisePlan } from "../domain/pricing";
import type { DataStore } from "../ports/repositories";
import { InsufficientBalanceError, type WalletService } from "./wallet-service";
import { allowances, decideCoverage, recordUsage, ruleFor } from "../domain/plan-usage";

export class AlreadySubscribedError extends Error {
  constructor() {
    super("This resident already has an active subscription. Change the plan instead.");
    this.name = "AlreadySubscribedError";
  }
}

// Two plans may not share a name. A resident choosing between "Premium" and "premium"
// is choosing between two things that read as one, so the name is unique.
export class PlanNameTakenError extends Error {
  constructor() {
    super("Plan name already exists. Please enter a different plan name.");
    this.name = "PlanNameTakenError";
  }
}

export class SubscriptionService {
  constructor(private readonly store: DataStore, private readonly wallet: WalletService) {}

  // A resident has at most one active subscription. Should a database ever hold
  // more than one, the most recently started wins, so every read agrees on which
  // one it is rather than depending on the order rows come back in.
  async getActive(residentId: string): Promise<Subscription | null> {
    const found = await this.store.subscriptions.find((s) => s.residentId === residentId && s.status === "active");
    if (found.length <= 1) return found[0] ?? null;
    return [...found].sort((a, b) => b.cycleStart.localeCompare(a.cycleStart))[0];
  }

  // Charge the wallet for the cycle price, then activate the subscription. If the
  // wallet is short, the wallet service throws and the caller prompts a top up.
  async subscribe(residentId: string, planId: string, cycle: BillingCycle): Promise<Subscription> {
    const plan = await this.store.plans.get(planId);
    if (!plan || !plan.isActive) throw new Error("Plan not found");
    // Subscribing while already subscribed is a plan change, not a second
    // subscription. Two active rows for one resident would make every later read
    // depend on which one it happened to find first.
    const existing = await this.getActive(residentId);
    if (existing) throw new AlreadySubscribedError();
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
  // What changing plan would cost, and when it would happen. Writes nothing.
  //
  // Clicking Upgrade used to change the subscription there and then, quote a
  // proration figure back, and charge nothing. The resident could not tell whether
  // what they were shown was a bill, a receipt, or a plan that had already changed.
  async quoteChange(residentId: string, newPlanId: string): Promise<
    { ok: true; quote: PlanChangeQuote } | { ok: false; reason: string }
  > {
    const subscription = await this.getActive(residentId);
    const next = await this.store.plans.get(newPlanId);
    const refusal = planChangeRefusal({ subscription, next });
    if (refusal) return { ok: false, reason: refusal };
    const current = await this.store.plans.get(subscription!.planId);
    if (!current) return { ok: false, reason: "Your current plan no longer exists." };
    return { ok: true, quote: quotePlanChange({ subscription: subscription!, current, next: next! }) };
  }

  // Making the change, once it has been paid for.
  //
  // Nothing about the subscription moves until the money does. An upgrade is what
  // proration is for — pay the difference for the days left, get the better plan for
  // them — so it takes effect at once. A downgrade is not refunded mid-cycle: the
  // resident paid for this cycle and keeps what it bought, so it waits for the end
  // of it and shows as a scheduled change until then.
  async changePlan(residentId: string, newPlanId: string): Promise<
    | { status: "applied"; subscription: Subscription; quote: PlanChangeQuote }
    | { status: "scheduled"; subscription: Subscription; quote: PlanChangeQuote }
    | { status: "payment_failed"; quote: PlanChangeQuote; reason: string }
    | { status: "refused"; reason: string }
  > {
    const quoted = await this.quoteChange(residentId, newPlanId);
    if (!quoted.ok) return { status: "refused", reason: quoted.reason };
    const quote = quoted.quote;
    const sub = (await this.getActive(residentId))!;

    if (quote.amountDuePaise > 0) {
      try {
        await this.wallet.charge(
          residentId, quote.amountDuePaise, Account.SubscriptionRevenue,
          `plan-change-${sub.id}-${newPlanId}`,
        );
      } catch (error) {
        // The plan is untouched. A failed payment must not leave the resident on
        // something they have not paid for, nor on something they did not ask for.
        return {
          status: "payment_failed",
          quote,
          reason: error instanceof InsufficientBalanceError
            ? "There is not enough in your wallet to cover the difference."
            : (error as Error).message,
        };
      }
    }

    if (quote.immediate) {
      sub.planId = newPlanId;
      sub.pendingPlanId = null;
      // A new plan means a new allowance, and what was used of the old one is not
      // what has been used of this one.
      sub.garmentsUsed = 0;
      sub.serviceUsage = {};
      sub.usageHistory = [];
      await this.store.subscriptions.put(sub);
      return { status: "applied", subscription: sub, quote };
    }

    sub.pendingPlanId = newPlanId;
    await this.store.subscriptions.put(sub);
    return { status: "scheduled", subscription: sub, quote };
  }

  // A scheduled change is not a commitment: it can be called off while the current
  // cycle is still running, and the resident stays on the plan they are already on.
  async cancelPlanChange(residentId: string): Promise<Subscription | null> {
    const sub = await this.getActive(residentId);
    if (!sub) return null;
    sub.pendingPlanId = null;
    return this.store.subscriptions.put(sub);
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

  // Deduct collected garments from the cap, never below zero remaining and never
  // past the allowance, and record which order spent them.
  //
  // The entry is what makes the running total explainable: "used 30 of 80" on its
  // own cannot say which collections made it 30, and the resident asking is usually
  // asking about one particular order.
  async deductGarments(
    subscriptionId: string,
    count: number,
    order?: { id: string; orderCode: string },
  ): Promise<{ used: number; cap: number } | null> {
    const sub = await this.store.subscriptions.get(subscriptionId);
    if (!sub) return null;
    const plan = await this.store.plans.get(sub.planId);
    const cap = plan?.garmentCap ?? 0;
    const usedBefore = sub.garmentsUsed;
    sub.garmentsUsed = Math.min(cap, sub.garmentsUsed + count);
    if (order) {
      // Only what was actually spent. A deduction clipped by the allowance records
      // the amount that moved, not the amount that was asked for.
      const spent = sub.garmentsUsed - usedBefore;
      sub.usageHistory = [
        ...(sub.usageHistory ?? []).filter((e) => e.orderId !== order.id || e.reversed),
        {
          orderId: order.id, orderCode: order.orderCode, quantity: spent,
          usedBefore, usedAfter: sub.garmentsUsed, at: new Date().toISOString(),
        },
      ];
    }
    await this.store.subscriptions.put(sub);
    return { used: sub.garmentsUsed, cap };
  }

  // Give an order's garments back. An order that was collected and then cancelled
  // has not been laundered, so it must not go on holding allowance the resident
  // could otherwise use.
  async releaseGarments(order: { id: string; orderCode: string; subscriptionId: string | null }): Promise<void> {
    if (!order.subscriptionId) return;
    const sub = await this.store.subscriptions.get(order.subscriptionId);
    if (!sub) return;
    const spent = (sub.usageHistory ?? [])
      .filter((e) => e.orderId === order.id && !e.reversed)
      .reduce((sum, e) => sum + e.quantity, 0);
    if (spent <= 0) return;
    const usedBefore = sub.garmentsUsed;
    sub.garmentsUsed = Math.max(0, sub.garmentsUsed - spent);
    sub.usageHistory = [
      ...(sub.usageHistory ?? []),
      {
        orderId: order.id, orderCode: order.orderCode, quantity: -spent,
        usedBefore, usedAfter: sub.garmentsUsed, at: new Date().toISOString(), reversed: true,
      },
    ];
    await this.store.subscriptions.put(sub);
  }

  // The usage panel the resident dashboard and subscription page render. Usage is
  // read from garmentsUsed, which is only ever written from the accepted quantity
  // recorded at pickup.
// What this resident may ask for of this service, and what the part beyond their
  // allowance would cost. Answers rather than throws, so a preview can show the
  // consequence before the resident commits to it.
  async coverageFor(residentId: string, serviceId: string, requested: number) {
    const subscription = await this.getActive(residentId);
    if (!subscription) return null;
    const plan = await this.store.plans.get(subscription.planId);
    return decideCoverage(plan, subscription, serviceId, requested);
  }

  // Record what was used, against that service alone. Usage of one service must
  // never reduce another's allowance, which a single shared counter could not
  // promise and this can.
  async useService(subscriptionId: string, serviceId: string, quantity: number) {
    const subscription = await this.store.subscriptions.get(subscriptionId);
    if (!subscription) return null;
    const plan = await this.store.plans.get(subscription.planId);
    const rule = ruleFor(plan, serviceId);
    if (!rule) return subscription;
    recordUsage(subscription, serviceId, rule.unit, quantity);
    return this.store.subscriptions.put(subscription);
  }

  async usage(residentId: string) {
    const subscription = await this.getActive(residentId);
    if (!subscription) return null;
    const plan = await this.store.plans.get(subscription.planId);
    if (!plan) return null;
    const remaining = remainingAllowance(plan.garmentCap, subscription.garmentsUsed);
    const pending = subscription.pendingPlanId ? await this.store.plans.get(subscription.pendingPlanId) : null;
    const covered = normalisePlan(plan).coveredServiceIds;
    return {
      subscriptionId: subscription.id,
      planId: plan.id,
      planTier: plan.tier,
      monthlyPaise: plan.monthlyPaise,
      turnaroundHours: plan.turnaroundHours,
      allowance: plan.garmentCap,
      used: subscription.garmentsUsed,
      remaining,
      // What is left of each service, in that service's own unit. The single
      // garment figure above is the old shared allowance, kept so a client written
      // against it keeps working while it has anything to say.
      services: allowances(plan, subscription),
      // Which orders spent the allowance, newest first. The total above is the sum
      // of these, so a resident querying it can be shown the working.
      history: [...(subscription.usageHistory ?? [])].reverse(),
      usedPercent: plan.garmentCap > 0 ? Math.round((subscription.garmentsUsed / plan.garmentCap) * 1000) / 10 : 0,
      cycle: subscription.cycle,
      cycleStart: subscription.cycleStart,
      renewalDate: subscription.cycleEnd,
      expiryDate: subscription.cycleEnd,
      status: subscription.status,
      pendingPlanId: subscription.pendingPlanId,
      // A scheduled plan change is shown in full: which plan, what it costs, when it
      // starts and whether it is an upgrade or a downgrade. "You have a change
      // pending" on its own tells the resident nothing they can act on.
      pendingPlan: pending
        ? {
            planId: pending.id,
            tier: pending.tier,
            monthlyPaise: pending.monthlyPaise,
            allowance: pending.garmentCap,
            turnaroundHours: pending.turnaroundHours,
            effectiveFrom: subscription.cycleEnd,
            direction: pending.monthlyPaise > plan.monthlyPaise
              ? "upgrade"
              : pending.monthlyPaise < plan.monthlyPaise ? "downgrade" : "sidegrade",
            canCancel: true,
          }
        : null,
      coveredServiceIds: covered,
      autoRenew: subscription.autoRenew,
    };
  }

  // ------------------------------------------------------------ plan catalogue
  // Plans are global configuration, so only an admin route reaches these.

  async listPlans(includeInactive = false): Promise<Plan[]> {
    const plans = (await this.store.plans.all()).map(normalisePlan);
    const filtered = includeInactive ? plans : plans.filter((p) => p.isActive);
    filtered.sort((a, b) => a.monthlyPaise - b.monthlyPaise);
    return filtered;
  }

  async createPlan(input: {
    tier: string; garmentCap: number; turnaroundHours: number; monthlyPaise: number;
    annualDiscountPercent?: number; coveredServiceIds?: string[];
    name?: string; description?: string | null; services?: PlanServiceRule[];
    validity?: "monthly" | "annual"; taxPercent?: number; discountPercent?: number;
  }): Promise<Plan> {
    // Everything wrong with the plan, said at once. A plan that names no service, or
    // names one twice, is not something to store and discover later.
    assertValidPlan(input);
    if (await this.planNameTaken(input.name ?? input.tier)) throw new PlanNameTakenError();
    const plan: Plan = {
      id: randomUUID(), tier: input.tier, garmentCap: input.garmentCap,
      turnaroundHours: input.turnaroundHours, monthlyPaise: input.monthlyPaise,
      annualDiscountPercent: input.annualDiscountPercent ?? 0, isActive: true,
      name: input.name ?? input.tier,
      description: input.description ?? null,
      // The services the plan includes, each allowanced in its own unit. A plan
      // created without any is still legal; it simply covers nothing per service and
      // falls back to the overall cap.
      services: input.services ?? [],
      validity: input.validity ?? "monthly",
      taxPercent: input.taxPercent ?? 0,
      discountPercent: input.discountPercent ?? 0,
      // A plan with no stated coverage still covers the ordinary wash and iron, so
      // creating one without thinking about services behaves the way it always did.
      coveredServiceIds: input.coveredServiceIds ?? ["wash_iron", "wash_only"],
    };
    return this.store.plans.put(plan);
  }

  // Whether a plan name is already in use, on its normalised form — trimmed and
  // case-folded — so "Premium" and "premium" are the same name. A plan keeps its own
  // name on edit, so it is excluded by id. The name falls back to the tier, which is
  // what a plan without an explicit name is stored and shown under.
  async planNameTaken(name: string | null | undefined, exceptId?: string): Promise<boolean> {
    const wanted = (name ?? "").trim().toLowerCase();
    if (!wanted) return false;
    const clash = await this.store.plans.find(
      (p) => p.id !== exceptId && (p.name ?? p.tier ?? "").trim().toLowerCase() === wanted);
    return clash.length > 0;
  }

  async updatePlan(planId: string, patch: Partial<Omit<Plan, "id">>): Promise<{
    previous: Plan; current: Plan; activeSubscriptions: number;
  } | null> {
    const previous = await this.store.plans.get(planId);
    if (!previous) return null;
    const current: Plan = { ...previous, ...patch, id: planId };
    // Edited plans are held to the same rules as new ones. A plan can be made
    // invalid by editing just as easily as by creating.
    assertValidPlan(current);
    if ((patch.name !== undefined || patch.tier !== undefined)
      && await this.planNameTaken(current.name ?? current.tier, planId)) {
      throw new PlanNameTakenError();
    }
    await this.store.plans.put(current);
    // How many people this change actually reaches, so the caller can say so rather
    // than changing what a hundred residents are paying for without mentioning it.
    const activeSubscriptions = (await this.store.subscriptions.find(
      (s) => s.planId === planId && s.status === "active",
    )).length;
    return { previous, current, activeSubscriptions };
  }

  // What this plan costs once its discount and tax are applied.
  pricingFor(plan: Plan): ReturnType<typeof planPricing> {
    return planPricing(plan);
  }

  // What an admin sees against each plan: who is on it and what it earns.
  async planUsage() {
    // Normalised, so a plan written before service coverage existed still reports
    // what it actually covers rather than an empty list the admin might "correct".
    const plans = (await this.store.plans.all()).map(normalisePlan);
    const subs = await this.store.subscriptions.all();
    return plans.map((plan) => {
      const mine = subs.filter((s) => s.planId === plan.id);
      const active = mine.filter((s) => s.status === "active");
      return {
        ...plan,
        subscribers: mine.length,
        activeSubscribers: active.length,
        garmentsUsed: active.reduce((sum, s) => sum + s.garmentsUsed, 0),
        allowance: active.length * plan.garmentCap,
        revenuePaise: active.length * plan.monthlyPaise,
      };
    });
  }
}
