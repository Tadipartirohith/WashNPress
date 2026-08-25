import type { Plan, PlanServiceRule, Subscription } from "./models";
import {
  splitAgainstAllowance, normaliseQuantity, formatQuantity, amountPaise,
  AllowanceExceededError, AdditionalUsageNeedsApprovalError,
  type MeasurementUnit, type AllowanceSplit,
} from "./measurement";

// What a subscriber has left, service by service.
//
// The rule the requirements state most plainly is the one the old model could not
// keep: **usage of one service must never reduce another service's allowance**. A
// single garment count shared by washing, ironing and dry cleaning cannot express
// that, so the allowance is now held per service, in that service's own unit.

export interface ServiceAllowance {
  serviceId: string;
  serviceName: string;
  unit: MeasurementUnit;
  included: number;
  // Anything unused that survived the last cycle, for services that allow it.
  carriedForward: number;
  used: number;
  remaining: number;
  // Said in words, because "18 / 40 kg remaining" is what a resident reads.
  remainingLabel: string;
  additionalUsage: PlanServiceRule["additionalUsage"];
  additionalRatePaise: number;
  frequency: PlanServiceRule["frequency"];
  frequencyDays: number[];
}

export function planServiceRules(plan: Plan | null): PlanServiceRule[] {
  return plan?.services ?? [];
}

export function ruleFor(plan: Plan | null, serviceId: string): PlanServiceRule | null {
  return planServiceRules(plan).find((r) => r.serviceId === serviceId) ?? null;
}

// Whether the plan includes this service at all. A service the plan does not name is
// not covered, which is different from being covered with nothing left.
export function planIncludes(plan: Plan | null, serviceId: string): boolean {
  return ruleFor(plan, serviceId) !== null;
}

export function allowanceFor(
  plan: Plan | null,
  subscription: Subscription | null,
  serviceId: string,
): ServiceAllowance | null {
  const rule = ruleFor(plan, serviceId);
  if (!rule) return null;
  const used = normaliseQuantity(rule.unit, subscription?.serviceUsage?.[serviceId] ?? 0);
  const carried = rule.carryForward
    ? normaliseQuantity(rule.unit, subscription?.carriedForward?.[serviceId] ?? 0)
    : 0;
  const included = normaliseQuantity(rule.unit, rule.includedQuantity);
  const remaining = normaliseQuantity(rule.unit, Math.max(0, included + carried - used));
  return {
    serviceId: rule.serviceId,
    serviceName: rule.serviceName,
    unit: rule.unit,
    included,
    carriedForward: carried,
    used,
    remaining,
    remainingLabel: `${formatQuantity(rule.unit, remaining)} of ${formatQuantity(rule.unit, included + carried)} remaining`,
    additionalUsage: rule.additionalUsage,
    additionalRatePaise: rule.additionalRatePaise,
    frequency: rule.frequency,
    frequencyDays: rule.frequencyDays,
  };
}

// Every service the plan covers, as the resident sees it.
export function allowances(plan: Plan | null, subscription: Subscription | null): ServiceAllowance[] {
  return planServiceRules(plan)
    .map((rule) => allowanceFor(plan, subscription, rule.serviceId))
    .filter((a): a is ServiceAllowance => a !== null);
}

export interface CoverageDecision {
  serviceId: string;
  unit: MeasurementUnit;
  split: AllowanceSplit;
  // What the part outside the allowance costs, at this service's own overage rate.
  additionalPaise: number;
  // Whether it may go ahead at all, and whether somebody has to say yes first.
  allowed: boolean;
  needsApproval: boolean;
  reason: string | null;
}

// What happens if this resident asks for this much of this service. Answers rather
// than throws, so a caller previewing a booking can show the consequence before the
// resident commits to it.
export function decideCoverage(
  plan: Plan | null,
  subscription: Subscription | null,
  serviceId: string,
  requested: number,
): CoverageDecision | null {
  const rule = ruleFor(plan, serviceId);
  const allowance = allowanceFor(plan, subscription, serviceId);
  if (!rule || !allowance) return null;

  const split = splitAgainstAllowance(rule.unit, requested, allowance.remaining);

  // A ceiling on one request, where the plan sets one.
  if (rule.maxPerFrequency && split.requested > rule.maxPerFrequency) {
    return {
      serviceId, unit: rule.unit, split, additionalPaise: 0,
      allowed: false, needsApproval: false,
      reason: `This plan allows at most ${formatQuantity(rule.unit, rule.maxPerFrequency)} of ${rule.serviceName} at a time.`,
    };
  }

  if (split.additional === 0) {
    return { serviceId, unit: rule.unit, split, additionalPaise: 0, allowed: true, needsApproval: false, reason: null };
  }

  // Beyond the allowance, and what the plan says about that.
  switch (rule.additionalUsage) {
    case "block":
      return {
        serviceId, unit: rule.unit, split, additionalPaise: 0,
        allowed: false, needsApproval: false,
        reason: `Your plan includes ${formatQuantity(rule.unit, allowance.remaining)} of ${rule.serviceName} and does not allow going beyond it.`,
      };
    case "admin_approval":
      return {
        serviceId, unit: rule.unit, split,
        additionalPaise: amountPaise(rule.unit, split.additional, rule.additionalRatePaise),
        allowed: false, needsApproval: true,
        reason: `Going beyond your ${rule.serviceName} allowance needs approval.`,
      };
    default:
      return {
        serviceId, unit: rule.unit, split,
        additionalPaise: amountPaise(rule.unit, split.additional, rule.additionalRatePaise),
        allowed: true, needsApproval: false,
        reason: null,
      };
  }
}

// The same decision, as a refusal a route can map to a status code.
export function assertCoverage(decision: CoverageDecision, serviceName: string): void {
  if (decision.allowed) return;
  if (decision.needsApproval) throw new AdditionalUsageNeedsApprovalError(serviceName);
  throw new AllowanceExceededError(serviceName, decision.unit, decision.split.remainingAfter + decision.split.covered);
}

// Record what was used. Only ever touches the service that was used, which is the
// whole point of holding usage per service.
export function recordUsage(
  subscription: Subscription,
  serviceId: string,
  unit: MeasurementUnit,
  quantity: number,
): Subscription {
  const used = { ...(subscription.serviceUsage ?? {}) };
  used[serviceId] = normaliseQuantity(unit, (used[serviceId] ?? 0) + quantity);
  subscription.serviceUsage = used;
  return subscription;
}

// At the end of a cycle, what survives into the next one. Only for the services the
// plan says may carry forward, and never more than one cycle's worth, so an unused
// year does not accumulate into an unbounded allowance.
export function rollCycle(plan: Plan | null, subscription: Subscription): Subscription {
  const carried: Record<string, number> = {};
  for (const rule of planServiceRules(plan)) {
    if (!rule.carryForward) continue;
    const allowance = allowanceFor(plan, subscription, rule.serviceId);
    if (!allowance) continue;
    carried[rule.serviceId] = normaliseQuantity(
      rule.unit,
      Math.min(allowance.remaining, rule.includedQuantity),
    );
  }
  subscription.carriedForward = carried;
  subscription.serviceUsage = {};
  return subscription;
}

// ------------------------------------------------------------------- the ledger

// One order can hold several lines of the same service — 3 kg of washing for shirts
// and 2 kg for bedsheets — and they must draw down one balance between them rather
// than each line seeing the full allowance. The ledger holds that running balance
// for the length of one pricing pass.
//
// It is deliberately per-service: taking from washing never touches ironing.
export class AllowanceLedger {
  private readonly rules = new Map<string, PlanServiceRule>();
  private readonly remaining = new Map<string, number>();
  private readonly taken = new Map<string, number>();

  constructor(readonly plan: Plan | null, subscription: Subscription | null) {
    for (const rule of planServiceRules(plan)) {
      this.rules.set(rule.serviceId, rule);
      const allowance = allowanceFor(plan, subscription, rule.serviceId);
      this.remaining.set(rule.serviceId, allowance?.remaining ?? 0);
    }
  }

  // Whether this plan governs anything at all. A plan written before per-service
  // allowances existed has no rules, and the old garment cap still applies to it.
  get active(): boolean {
    return this.rules.size > 0;
  }

  rule(serviceId: string): PlanServiceRule | null {
    return this.rules.get(serviceId) ?? null;
  }

  // Draw `quantity` of a service, returning what the allowance covered and what fell
  // outside it. Decrements, so the next line of the same service sees the remainder.
  take(serviceId: string, quantity: number): AllowanceSplit | null {
    const rule = this.rules.get(serviceId);
    if (!rule) return null;
    const split = splitAgainstAllowance(rule.unit, quantity, this.remaining.get(serviceId) ?? 0);
    this.remaining.set(serviceId, split.remainingAfter);
    this.taken.set(serviceId, normaliseQuantity(rule.unit, (this.taken.get(serviceId) ?? 0) + split.requested));
    return split;
  }

  // What this pass used, per service, ready to be written back to the subscription.
  usage(): Record<string, number> {
    return Object.fromEntries(this.taken);
  }
}

// Write a pass's usage back to the subscription, one service at a time.
export function applyLedger(subscription: Subscription, ledger: AllowanceLedger): Subscription {
  for (const [serviceId, quantity] of Object.entries(ledger.usage())) {
    const rule = ledger.rule(serviceId);
    if (!rule || quantity <= 0) continue;
    recordUsage(subscription, serviceId, rule.unit, quantity);
  }
  return subscription;
}
