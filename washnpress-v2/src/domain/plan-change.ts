import type { BillingCycle, Plan, Subscription } from "./models";
import { computeProrationPaise, cycleLengthDays, cyclePricePaise, daysBetween } from "./subscriptions";

// What changing plan would cost, and when it would happen.
//
// Clicking Upgrade used to change the subscription there and then: the pending plan
// was written, a proration figure was quoted back, and nothing was ever charged. The
// resident was shown "Change to Premium Care takes effect on 2026-09-24. Proration
// ₹386.67" and had no way to tell whether that was a bill, a receipt, or a plan that
// had already changed.
//
// A quote answers all of it before anything is written: what they are on, what they
// would move to, what each costs, what the difference comes to, when it starts, and
// what they would pay right now.

export type PlanChangeKind = "upgrade" | "downgrade" | "same_price";

// Where a plan sits in the tier hierarchy, so moving between two of them can be
// called an upgrade or a downgrade by what the plan actually offers rather than by
// price alone. The included garment allowance is the clearest expression of a tier
// and is what an admin configures per plan; price then turnaround break ties. A
// future plan priced differently still ranks by what it gives, not what it costs.
export function comparePlanRank(a: Plan, b: Plan): number {
  if (a.garmentCap !== b.garmentCap) return a.garmentCap - b.garmentCap;
  if (a.monthlyPaise !== b.monthlyPaise) return a.monthlyPaise - b.monthlyPaise;
  // Fewer turnaround hours is the better (higher) plan.
  return b.turnaroundHours - a.turnaroundHours;
}

// Whether moving from the current plan to the next one is an upgrade, a downgrade,
// or a move between plans of the same standing — decided by hierarchy, not price.
export function planDirection(current: Plan, next: Plan): "upgrade" | "downgrade" | "same" {
  const c = comparePlanRank(next, current);
  return c > 0 ? "upgrade" : c < 0 ? "downgrade" : "same";
}

export interface PlanChangeQuote {
  currentPlanId: string;
  currentPlanTier: string;
  currentCyclePaise: number;
  newPlanId: string;
  newPlanTier: string;
  newCyclePaise: number;
  cycle: BillingCycle;
  kind: PlanChangeKind;
  // What the remaining days of this cycle are worth on each plan, netted off. A
  // positive figure is owed now; a negative one is what the resident would be giving
  // up, which is why a downgrade waits for the cycle to end rather than refunding.
  prorationPaise: number;
  // What they would actually pay to confirm. Never negative: a downgrade costs
  // nothing today.
  amountDuePaise: number;
  // When the new plan starts. Now for an upgrade that has been paid for, and the
  // end of the paid-for cycle for a downgrade.
  effectiveFrom: string;
  immediate: boolean;
  daysRemaining: number;
}

export function quotePlanChange(input: {
  subscription: Subscription;
  current: Plan;
  next: Plan;
  now?: Date;
}): PlanChangeQuote {
  const { subscription, current, next } = input;
  const now = input.now ?? new Date();
  const cycle = subscription.cycle;
  const currentCyclePaise = cyclePricePaise(current, cycle);
  const newCyclePaise = cyclePricePaise(next, cycle);
  const cycleDays = cycleLengthDays(cycle);
  const daysRemaining = daysBetween(now.toISOString(), subscription.cycleEnd);
  const prorationPaise = computeProrationPaise({
    currentCyclePaise, newCyclePaise, daysRemaining, cycleDays,
  });

  // Upgrade or downgrade is decided by the tier hierarchy the admin configures, not
  // by comparing prices, so a differently-priced future plan is still classed by
  // what it offers. Proration below stays a money calculation either way.
  const dir = planDirection(current, next);
  const kind: PlanChangeKind = dir === "upgrade" ? "upgrade"
    : dir === "downgrade" ? "downgrade" : "same_price";

  // An upgrade is what proration is for: the resident pays the difference for the
  // days left and gets the better plan for them. A downgrade is not refunded
  // mid-cycle — they paid for this cycle and keep what it bought — so it waits.
  const immediate = kind === "upgrade";
  const amountDuePaise = immediate ? Math.max(0, prorationPaise) : 0;

  return {
    currentPlanId: current.id,
    currentPlanTier: current.tier,
    currentCyclePaise,
    newPlanId: next.id,
    newPlanTier: next.tier,
    newCyclePaise,
    cycle,
    kind,
    prorationPaise,
    amountDuePaise,
    effectiveFrom: immediate ? now.toISOString() : subscription.cycleEnd,
    immediate,
    daysRemaining,
  };
}

// Why a change cannot be made, where it cannot. Answers rather than throws, so a
// screen can grey out the button and say why rather than offering it and failing.
export function planChangeRefusal(input: {
  subscription: Subscription | null;
  next: Plan | null;
}): string | null {
  if (!input.subscription) return "You do not have an active plan to change.";
  if (input.subscription.status !== "active") return "Your plan is not active, so it cannot be changed.";
  if (!input.next) return "That plan no longer exists.";
  if (!input.next.isActive) return `${input.next.tier} is not available at the moment.`;
  if (input.next.id === input.subscription.planId) return "You are already on that plan.";
  // One pending change at a time. A resident who has already scheduled a move cannot
  // stack a second on top of it; the first must be cancelled or take effect before
  // another can be chosen. Re-selecting the same pending plan is a no-op, allowed.
  if (input.subscription.pendingPlanId && input.subscription.pendingPlanId !== input.next.id) {
    return "You already have a plan change scheduled. Cancel the existing change before selecting another plan.";
  }
  return null;
}
