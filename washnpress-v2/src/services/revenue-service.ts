import { Account } from "../domain/accounts";
import type { Order } from "../domain/models";
import type { DataStore } from "../ports/repositories";

// Revenue, sliced the way an admin actually asks about it: over a period, narrowed
// to a place or a person, and broken down so the total can be explained rather than
// only stated. Every figure here comes from orders and the ledger, never from a
// number a client supplied.

export type DateRangePreset =
  | "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all" | "custom";

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  "today", "yesterday", "this_week", "this_month", "last_month", "all", "custom",
];

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  all: "All time",
  custom: "Custom range",
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// A preset resolved to the pair of dates it means, so the client never has to work
// out what "last month" was and the two can never disagree about it.
export function resolveRange(preset: DateRangePreset | undefined, from?: string, to?: string, now: Date = new Date()): { from?: string; to?: string; preset: DateRangePreset } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (offset: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offset);
    return isoDay(d);
  };
  switch (preset) {
    case "today":
      return { from: day(0), to: day(0), preset };
    case "yesterday":
      return { from: day(-1), to: day(-1), preset };
    case "this_week": {
      // Weeks start on Monday, which is how the operation is actually rostered.
      const weekday = (today.getUTCDay() + 6) % 7;
      return { from: day(-weekday), to: day(0), preset };
    }
    case "this_month":
      return { from: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: day(0), preset };
    case "last_month": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: isoDay(first), to: isoDay(last), preset };
    }
    case "all":
      return { preset };
    default:
      return { from, to, preset: from || to ? "custom" : "all" };
  }
}

export interface RevenueFilter {
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  areaId?: string;
  societyId?: string;
  supervisorUserId?: string;
  operatorUserId?: string;
  planId?: string;
  // paid | pending | failed | refunded | none
  paymentStatus?: string;
}

export const PAYMENT_STATUSES = ["paid", "pending", "failed", "refunded", "none"] as const;

interface Bucket {
  id: string | null;
  name: string;
  orders: number;
  completedOrders: number;
  cancelledOrders: number;
  garmentChargePaise: number;
  servicesPaise: number;
  revenuePaise: number;
}

export class RevenueService {
  constructor(private readonly store: DataStore) {}

  // An order counts towards revenue on the day it was created, which is the day the
  // resident committed to it.
  private inRange(order: Order, from?: string, to?: string): boolean {
    const day = order.createdAt.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }

  private orderRevenuePaise(order: Order): number {
    // Only money actually collected counts as revenue. A charge still pending is
    // reported separately so the two are never confused.
    if (order.additionalChargeStatus !== "paid") return 0;
    return order.additionalChargePaise ?? 0;
  }

  async report(filter: RevenueFilter) {
    const range = resolveRange(filter.preset, filter.from, filter.to);
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const areas = new Map((await this.store.areas.all()).map((a) => [a.id, a]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    const residents = new Map((await this.store.residents.all()).map((r) => [r.id, r]));
    const plans = new Map((await this.store.plans.all()).map((p) => [p.id, p]));
    const subscriptions = await this.store.subscriptions.all();

    // Which supervisor is responsible for an order is a property of its area.
    const supervisorOfArea = (areaId: string | null) => (areaId ? areas.get(areaId)?.supervisorUserId ?? null : null);

    let orders = (await this.store.orders.all()).filter((o) => this.inRange(o, range.from, range.to));
    if (filter.areaId) orders = orders.filter((o) => o.areaId === filter.areaId);
    if (filter.societyId) orders = orders.filter((o) => o.societyId === filter.societyId);
    if (filter.supervisorUserId) orders = orders.filter((o) => supervisorOfArea(o.areaId) === filter.supervisorUserId);
    if (filter.operatorUserId) orders = orders.filter((o) => o.assignedOperatorUserId === filter.operatorUserId);
    if (filter.paymentStatus && filter.paymentStatus !== "all") {
      orders = orders.filter((o) => (o.additionalChargeStatus ?? "none") === filter.paymentStatus);
    }
    if (filter.planId) {
      const planSubs = new Set(subscriptions.filter((s) => s.planId === filter.planId).map((s) => s.id));
      orders = orders.filter((o) => (o.subscriptionId ? planSubs.has(o.subscriptionId) : false));
    }

    // Subscription revenue comes from the ledger, because that is where the money
    // actually moved, and it is only attributable to a period, not to an order.
    const txns = await this.store.ledger.all();
    const creditedInRange = (account: string) => txns
      .filter((t) => {
        const day = (t.createdAt ?? "").slice(0, 10);
        if (range.from && day && day < range.from) return false;
        if (range.to && day && day > range.to) return false;
        return true;
      })
      .flatMap((t) => t.entries)
      .filter((e) => e.account === account && e.direction === "credit")
      .reduce((sum, e) => sum + e.amount, 0);

    // Subscription revenue is not attributable to an area or an operator, so any
    // filter that narrows to one of those excludes it rather than misreporting it.
    const narrowed = Boolean(filter.areaId || filter.societyId || filter.supervisorUserId || filter.operatorUserId || filter.planId);
    const subscriptionRevenuePaise = narrowed ? 0 : creditedInRange(Account.SubscriptionRevenue);

    const orderRevenuePaise = orders.reduce((sum, o) => sum + this.orderRevenuePaise(o), 0);
    const pendingPaise = orders
      .filter((o) => o.additionalChargeStatus === "pending")
      .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0);
    const refundedPaise = orders
      .filter((o) => o.additionalChargeStatus === "refunded")
      .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0);

    const bucket = (key: (o: Order) => { id: string | null; name: string }): Bucket[] => {
      const map = new Map<string, Bucket>();
      for (const order of orders) {
        const { id, name } = key(order);
        const k = id ?? "__none__";
        const row = map.get(k) ?? {
          id, name, orders: 0, completedOrders: 0, cancelledOrders: 0,
          garmentChargePaise: 0, servicesPaise: 0, revenuePaise: 0,
        };
        row.orders += 1;
        if (order.state === "delivered") row.completedOrders += 1;
        if (order.state === "cancelled") row.cancelledOrders += 1;
        row.garmentChargePaise += order.additionalChargeStatus === "paid" ? (order.additionalChargePaise ?? 0) - (order.servicesPaise ?? 0) : 0;
        row.servicesPaise += order.additionalChargeStatus === "paid" ? order.servicesPaise ?? 0 : 0;
        row.revenuePaise += this.orderRevenuePaise(order);
        map.set(k, row);
      }
      return [...map.values()].sort((a, b) => b.revenuePaise - a.revenuePaise);
    };

    const byArea = bucket((o) => ({ id: o.areaId, name: o.areaId ? areas.get(o.areaId)?.name ?? "Unknown area" : "No area" }));
    const bySociety = bucket((o) => ({ id: o.societyId, name: societies.get(o.societyId)?.name ?? "Unknown society" }));
    const bySupervisor = bucket((o) => {
      const id = supervisorOfArea(o.areaId);
      return { id, name: id ? users.get(id)?.fullName ?? "Unknown supervisor" : "No supervisor assigned" };
    });
    const byOperator = bucket((o) => ({
      id: o.assignedOperatorUserId,
      name: o.assignedOperatorUserId ? users.get(o.assignedOperatorUserId)?.fullName ?? "Unknown operator" : "Unassigned",
    }));

    // Plans are counted from live subscriptions, not from orders, because a plan
    // earns its monthly fee whether or not anybody sent laundry that month.
    const byPlan = [...plans.values()].map((plan) => {
      const mine = subscriptions.filter((s) => s.planId === plan.id && s.status === "active");
      return {
        id: plan.id, name: plan.tier,
        activeSubscribers: mine.length,
        garmentCap: plan.garmentCap,
        garmentsUsed: mine.reduce((sum, s) => sum + s.garmentsUsed, 0),
        revenuePaise: mine.length * plan.monthlyPaise,
      };
    }).sort((a, b) => b.revenuePaise - a.revenuePaise);

    const describe = (order: Order) => {
      const society = societies.get(order.societyId) ?? null;
      const resident = residents.get(order.residentId) ?? null;
      const residentUser = resident ? users.get(resident.userId) ?? null : null;
      const supervisorId = supervisorOfArea(order.areaId);
      return {
        id: order.id,
        orderCode: order.orderCode,
        createdAt: order.createdAt,
        state: order.state,
        residentName: residentUser?.fullName ?? null,
        unitNumber: resident?.unitNumber ?? null,
        societyId: order.societyId,
        societyName: society?.name ?? null,
        areaId: order.areaId,
        areaName: order.areaId ? areas.get(order.areaId)?.name ?? null : null,
        supervisorName: supervisorId ? users.get(supervisorId)?.fullName ?? null : null,
        operatorName: order.assignedOperatorUserId ? users.get(order.assignedOperatorUserId)?.fullName ?? null : null,
        acceptedCount: order.acceptedCount,
        servicesPaise: order.servicesPaise ?? 0,
        additionalChargePaise: order.additionalChargePaise ?? 0,
        totalPaise: order.additionalChargePaise ?? 0,
        paymentStatus: order.additionalChargeStatus ?? "none",
      };
    };

    const chargedOrders = orders
      .filter((o) => (o.additionalChargePaise ?? 0) > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(describe);

    const pendingCharges = orders
      .filter((o) => o.additionalChargeStatus === "pending" && (o.additionalChargePaise ?? 0) > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(describe);

    return {
      range: { ...range, label: DATE_RANGE_LABELS[range.preset] },
      // The headline figures, each one explainable from the breakdowns below it.
      summary: {
        totalRevenuePaise: subscriptionRevenuePaise + orderRevenuePaise,
        subscriptionRevenuePaise,
        orderRevenuePaise,
        pendingPaise,
        refundedPaise,
        netRevenuePaise: subscriptionRevenuePaise + orderRevenuePaise - refundedPaise,
        orders: orders.length,
        chargedOrders: chargedOrders.length,
        subscriptionsCounted: narrowed ? 0 : subscriptions.filter((s) => s.status === "active").length,
        narrowed,
      },
      byArea, bySociety, bySupervisor, byOperator, byPlan,
      chargedOrders,
      pendingCharges,
      paymentStatuses: [...PAYMENT_STATUSES],
      presets: DATE_RANGE_PRESETS.map((p) => ({ value: p, label: DATE_RANGE_LABELS[p] })),
    };
  }
}
