import { Account } from "../domain/accounts";
import type { Order } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import { serviceDay } from "./scheduling-service";
import { withinServiceDays } from "./scheduling-service";

// Revenue, sliced the way an admin actually asks about it: over a period, narrowed
// to a place or a person, and broken down so the total can be explained rather than
// only stated. Every figure here comes from orders and the ledger, never from a
// number a client supplied.

export type DateRangePreset =
  | "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month"
  | "this_quarter" | "this_year" | "all" | "custom";

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
  "this_quarter", "this_year", "all", "custom",
];

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
  all: "All time",
  custom: "Custom range",
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// A preset resolved to the pair of dates it means, so the client never has to work
// out what "last month" was and the two can never disagree about it.
export function resolveRange(preset: DateRangePreset | undefined, from?: string, to?: string, now: Date = new Date()): { from?: string; to?: string; preset: DateRangePreset } {
  // "Today" is the operation's own day, the same one slots and pickups are counted
  // against, so a report run before dawn does not silently mean yesterday.
  const [y, m, d] = serviceDay(now).split("-").map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
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
    case "last_week": {
      const weekday = (today.getUTCDay() + 6) % 7;
      return { from: day(-weekday - 7), to: day(-weekday - 1), preset };
    }
    case "this_month":
      return { from: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: day(0), preset };
    case "this_quarter": {
      const firstMonth = Math.floor(today.getUTCMonth() / 3) * 3;
      return { from: isoDay(new Date(Date.UTC(today.getUTCFullYear(), firstMonth, 1))), to: day(0), preset };
    }
    case "this_year":
      return { from: isoDay(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))), to: day(0), preset };
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
  societyId?: string;
  blockId?: string;
  supervisorUserId?: string;
  operatorUserId?: string;
  planId?: string;
  // paid | pending | failed | refunded | none
  paymentStatus?: string;
}

// How long a charge has before it counts as late. A figure rather than a policy
// engine: what matters is that "pending" and "overdue" stop being one number.
export const CHARGE_DUE_DAYS = 7;

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
    return withinServiceDays(order.createdAt, from, to);
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
    const blocks = new Map((await this.store.blocks.all()).map((b) => [b.id, b]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    const residents = new Map((await this.store.residents.all()).map((r) => [r.id, r]));
    const plans = new Map((await this.store.plans.all()).map((p) => [p.id, p]));
    const subscriptions = await this.store.subscriptions.all();

    // Which supervisor is responsible for an order is a property of its society.
    // It used to be read off the area, which credited one person with the revenue
    // of every society in the corridor.
    const supervisorOf = (societyId: string | null) => (societyId ? societies.get(societyId)?.supervisorUserId ?? null : null);

    let orders = (await this.store.orders.all()).filter((o) => this.inRange(o, range.from, range.to));
    if (filter.societyId) orders = orders.filter((o) => o.societyId === filter.societyId);
    if (filter.blockId) orders = orders.filter((o) => o.blockId === filter.blockId);
    if (filter.supervisorUserId) orders = orders.filter((o) => supervisorOf(o.societyId) === filter.supervisorUserId);
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
      .filter((t) => withinServiceDays(t.createdAt, range.from, range.to))
      .flatMap((t) => t.entries)
      .filter((e) => e.account === account && e.direction === "credit")
      .reduce((sum, e) => sum + e.amount, 0);

    // Subscription revenue is not attributable to a block or an operator, so any
    // filter that narrows to one of those excludes it rather than misreporting it.
    const narrowed = Boolean(filter.blockId || filter.societyId || filter.supervisorUserId || filter.operatorUserId || filter.planId);
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

    const byBlock = bucket((o) => ({
      id: o.blockId ?? null,
      name: o.blockId ? blocks.get(o.blockId)?.name ?? "Unknown block" : "No block recorded",
    }));
    const bySociety = bucket((o) => ({ id: o.societyId, name: societies.get(o.societyId)?.name ?? "Unknown society" }));
    const bySupervisor = bucket((o) => {
      const id = supervisorOf(o.societyId);
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
      const supervisorId = supervisorOf(order.societyId);
      return {
        id: order.id,
        orderCode: order.orderCode,
        createdAt: order.createdAt,
        state: order.state,
        residentName: residentUser?.fullName ?? null,
        unitNumber: resident?.unitNumber ?? null,
        societyId: order.societyId,
        societyName: society?.name ?? null,
        blockId: order.blockId ?? null,
        blockName: order.blockId ? blocks.get(order.blockId)?.name ?? null : null,
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

    const pendingOrders = orders
      .filter((o) => o.additionalChargeStatus === "pending" && (o.additionalChargePaise ?? 0) > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pendingCharges = pendingOrders.map(describe);

    // Pending and overdue are not the same money.
    //
    // Everything unpaid was reported as one figure, so "still to collect" mixed a
    // charge raised this morning with one that has been ignored for a fortnight.
    // A charge is overdue once its due date has passed; until then it is simply
    // not paid yet, and nobody needs to chase it.
    const dueBy = (order: Order): string =>
      isoDay(new Date(new Date(order.createdAt).getTime() + CHARGE_DUE_DAYS * 86400_000));
    const todayIso = serviceDay(new Date());
    const overdueOrders = pendingOrders.filter((o) => dueBy(o) < todayIso);
    const overdueCharges = overdueOrders.map((o) => ({ ...describe(o), dueDate: dueBy(o) }));
    const overduePaise = overdueOrders.reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0);

    // What each service earned, which is the breakdown that says where the money
    // in this business actually comes from. Counted from the services recorded on
    // each order, so it adds up to the service half of the order revenue rather
    // than to a number of its own.
    const serviceTotals = new Map<string, { id: string; name: string; orders: number; revenuePaise: number }>();
    for (const order of orders) {
      if (order.additionalChargeStatus !== "paid") continue;
      for (const line of order.lines ?? []) {
        const key = line.serviceId ?? line.serviceName ?? "unknown";
        const row = serviceTotals.get(key)
          ?? { id: line.serviceId ?? key, name: line.serviceName ?? "Unnamed service", orders: 0, revenuePaise: 0 };
        row.orders += 1;
        row.revenuePaise += line.linePricePaise ?? 0;
        serviceTotals.set(key, row);
      }
    }
    const totalServiceRevenue = [...serviceTotals.values()].reduce((sum, r) => sum + r.revenuePaise, 0);
    const byService = [...serviceTotals.values()]
      .sort((a, b) => b.revenuePaise - a.revenuePaise)
      .map((row) => ({
        ...row,
        // The share, so an admin can see which services carry the business without
        // dividing the column in their head.
        sharePercent: totalServiceRevenue > 0
          ? Math.round((row.revenuePaise / totalServiceRevenue) * 1000) / 10
          : 0,
      }));

    return {
      range: { ...range, label: DATE_RANGE_LABELS[range.preset] },
      // The headline figures, each one explainable from the breakdowns below it.
      summary: {
        totalRevenuePaise: subscriptionRevenuePaise + orderRevenuePaise,
        subscriptionRevenuePaise,
        orderRevenuePaise,
        pendingPaise,
        // Of the pending money, the part that is late.
        overduePaise,
        refundedPaise,
        netRevenuePaise: subscriptionRevenuePaise + orderRevenuePaise - refundedPaise,
        orders: orders.length,
        chargedOrders: chargedOrders.length,
        subscriptionsCounted: narrowed ? 0 : subscriptions.filter((s) => s.status === "active").length,
        narrowed,
      },
      byBlock, bySociety, bySupervisor, byOperator, byPlan, byService,
      chargedOrders,
      pendingCharges,
      overdueCharges,
      paymentStatuses: [...PAYMENT_STATUSES],
      presets: DATE_RANGE_PRESETS.map((p) => ({ value: p, label: DATE_RANGE_LABELS[p] })),
    };
  }
}
