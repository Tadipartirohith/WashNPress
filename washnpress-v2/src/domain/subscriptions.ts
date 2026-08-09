import type { BillingCycle, Plan } from "./models";

export function cycleLengthDays(cycle: BillingCycle): number {
  return cycle === "annual" ? 365 : 30;
}

// Price for a full billing cycle in paise, applying the annual discount when annual.
export function cyclePricePaise(plan: Plan, cycle: BillingCycle): number {
  if (cycle === "annual") {
    const gross = plan.monthlyPaise * 12;
    const discounted = gross * (1 - plan.annualDiscountPercent / 100);
    return Math.round(discounted);
  }
  return plan.monthlyPaise;
}

// Proration when switching plans mid cycle. Returns the balancing amount in paise:
// a positive amount is owed by the resident for an upgrade, a negative amount is a
// credit for a downgrade, based on the unused days remaining in the current cycle.
export function computeProrationPaise(input: {
  currentCyclePaise: number;
  newCyclePaise: number;
  daysRemaining: number;
  cycleDays: number;
}): number {
  const { currentCyclePaise, newCyclePaise, daysRemaining, cycleDays } = input;
  if (cycleDays <= 0) return 0;
  const fraction = Math.max(0, Math.min(1, daysRemaining / cycleDays));
  const unusedCurrent = currentCyclePaise * fraction;
  const newForRemainder = newCyclePaise * fraction;
  return Math.round(newForRemainder - unusedCurrent);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function addDaysIso(fromIso: string, days: number): string {
  const d = new Date(fromIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
