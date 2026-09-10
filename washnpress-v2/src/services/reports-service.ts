import { Account } from "../domain/accounts";
import type { Order, Session } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { AccessService } from "./access-service";
import type { OrderService } from "./order-service";
import type { SystemConfigService } from "./system-config-service";
import { withinServiceDays } from "./scheduling-service";

export interface ReportFilter {
  from?: string;
  to?: string;
  societyId?: string;
  blockId?: string;
  supervisorUserId?: string;
  operatorUserId?: string;
  state?: string;
}

// Read-only analytics computed from the store. In production these read from a
// replica so reporting never competes with transactional traffic. Every report is
// filtered through the caller's scope first, so a supervisor's report can never
// include another society's orders.
export class ReportsService {
  constructor(
    private readonly store: DataStore,
    private readonly access: AccessService,
    private readonly orders: OrderService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  private async scopedOrders(session: Session, filter: ReportFilter): Promise<Order[]> {
    let orders = await this.access.visibleOrders(session);
    if (filter.societyId) orders = orders.filter((o) => o.societyId === filter.societyId);
    if (filter.blockId) orders = orders.filter((o) => o.blockId === filter.blockId);
    if (filter.operatorUserId) orders = orders.filter((o) => o.assignedOperatorUserId === filter.operatorUserId);
    if (filter.state) orders = orders.filter((o) => o.state === filter.state);
    if (filter.from || filter.to) orders = orders.filter((o) => withinServiceDays(o.createdAt, filter.from, filter.to));
    if (filter.supervisorUserId) {
      const societies = await this.store.societies.find((s) => s.supervisorUserId === filter.supervisorUserId);
      const societyIds = new Set(societies.map((s) => s.id));
      orders = orders.filter((o) => societyIds.has(o.societyId));
    }
    return orders;
  }

  private bucket(orders: Order[], keyOf: (o: Order) => string | null) {
    const map = new Map<string, { key: string; orders: Order[] }>();
    for (const order of orders) {
      const key = keyOf(order) ?? "unassigned";
      if (!map.has(key)) map.set(key, { key, orders: [] });
      map.get(key)!.orders.push(order);
    }
    return [...map.values()];
  }

  private async metrics(orders: Order[]) {
    const config = await this.systemConfig.get();
    const additionalQuantity = orders.reduce((sum, o) => sum + (o.additionalCount ?? 0), 0);
    return {
      orders: orders.length,
      delivered: orders.filter((o) => o.state === "delivered").length,
      cancelled: orders.filter((o) => o.state === "cancelled").length,
      failedPickups: orders.filter((o) => o.state === "pickup_failed").length,
      qcFailures: orders.filter((o) => o.qcPassed === false).length,
      delayed: orders.filter((o) => this.orders.isDelayed(o, config.delayGraceHours)).length,
      garments: orders.reduce((sum, o) => sum + (o.acceptedCount ?? 0), 0),
      subscriptionCovered: orders.reduce((sum, o) => sum + (o.subscriptionCoveredCount ?? 0), 0),
      additionalQuantity,
      additionalRevenuePaise: orders
        .filter((o) => o.additionalChargeStatus === "paid")
        .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0),
      pendingAdditionalChargesPaise: orders
        .filter((o) => o.additionalChargeStatus === "pending" || o.additionalChargeStatus === "failed")
        .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0),
    };
  }

  // Blocks side by side. This used to compare areas, a rung the work was never
  // actually divided at; a block is what one operator covers, so it is the level a
  // supervisor can act on.
  async byBlock(session: Session, filter: ReportFilter = {}) {
    const orders = await this.scopedOrders(session, filter);
    const blocks = new Map((await this.store.blocks.all()).map((b) => [b.id, b]));
    return Promise.all(this.bucket(orders, (o) => o.blockId ?? null).map(async (group) => ({
      blockId: group.key,
      blockName: blocks.get(group.key)?.name ?? "Unassigned / no block",
      // Not a block. Orders whose block was never recorded were listed beside A, B
      // and C as though "No block recorded" were a fourth tower, which reads as a
      // building rather than as the data problem it is.
      unassigned: !blocks.has(group.key),
      ...(await this.metrics(group.orders)),
    })));
  }

  async bySociety(session: Session, filter: ReportFilter = {}) {
    const orders = await this.scopedOrders(session, filter);
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const residents = await this.store.residents.all();
    return Promise.all(this.bucket(orders, (o) => o.societyId).map(async (group) => ({
      societyId: group.key,
      societyName: societies.get(group.key)?.name ?? "Unknown",
      residents: residents.filter((r) => r.societyId === group.key).length,
      ...(await this.metrics(group.orders)),
    })));
  }

  async bySupervisor(session: Session, filter: ReportFilter = {}) {
    const orders = await this.scopedOrders(session, filter);
    const societies = await this.store.societies.all();
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    return Promise.all(societies.map(async (society) => ({
      societyId: society.id,
      societyName: society.name,
      supervisorUserId: society.supervisorUserId ?? null,
      supervisorName: society.supervisorUserId ? users.get(society.supervisorUserId)?.fullName ?? null : null,
      // A society nobody runs is a gap in the assignment, not a supervisor whose
      // numbers are poor.
      unassigned: !society.supervisorUserId,
      ...(await this.metrics(orders.filter((o) => o.societyId === society.id))),
    })));
  }

  async byOperator(session: Session, filter: ReportFilter = {}) {
    const orders = await this.scopedOrders(session, filter);
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    return Promise.all(this.bucket(orders, (o) => o.assignedOperatorUserId).map(async (group) => ({
      operatorUserId: group.key,
      operatorName: users.get(group.key)?.fullName ?? "Orders awaiting an operator",
      // Not an operator. "Unassigned" sat in the performance table as though
      // somebody by that name were doing badly.
      unassigned: !users.has(group.key),
      ...(await this.metrics(group.orders)),
    })));
  }

  async residentStatistics(session: Session) {
    const societies = await this.access.visibleSocieties(session);
    const societyIds = new Set(societies.map((s) => s.id));
    const residents = await this.store.residents.find((r) => societyIds.has(r.societyId));
    const residentIds = new Set(residents.map((r) => r.id));
    const subscriptions = await this.store.subscriptions.find((s) => residentIds.has(s.residentId));
    return {
      residents: residents.length,
      onboarded: residents.filter((r) => r.onboardingCompleted).length,
      pendingOnboarding: residents.filter((r) => !r.onboardingCompleted).length,
      withActiveSubscription: new Set(subscriptions.filter((s) => s.status === "active").map((s) => s.residentId)).size,
    };
  }

  async subscriptionReport(session: Session) {
    const societies = await this.access.visibleSocieties(session);
    const societyIds = new Set(societies.map((s) => s.id));
    const residentIds = new Set((await this.store.residents.find((r) => societyIds.has(r.societyId))).map((r) => r.id));
    const subs = await this.store.subscriptions.find((s) => residentIds.has(s.residentId));
    const plans = new Map((await this.store.plans.all()).map((p) => [p.id, p]));

    // Money that actually moved, attributed to the plan the paying resident is on.
    // A subscription charge is posted with the reference "sub-<residentId>-<stamp>",
    // which is the only link the ledger keeps back to who paid.
    const planOfResident = new Map(subs.map((s) => [s.residentId, s.planId]));
    const collectedByPlan = new Map<string, number>();
    for (const txn of await this.store.ledger.all()) {
      if (!txn.reference?.startsWith("sub-")) continue;
      const residentId = txn.reference.slice(4, txn.reference.lastIndexOf("-"));
      const planId = planOfResident.get(residentId);
      if (!planId) continue;
      for (const entry of txn.entries) {
        if (entry.account !== Account.SubscriptionRevenue || entry.direction !== "credit") continue;
        collectedByPlan.set(planId, (collectedByPlan.get(planId) ?? 0) + entry.amount);
      }
    }

    const byPlan = [...plans.values()].map((plan) => {
      const mine = subs.filter((s) => s.planId === plan.id);
      const active = mine.filter((s) => s.status === "active");
      return {
        planId: plan.id, tier: plan.tier, monthlyPaise: plan.monthlyPaise, garmentCap: plan.garmentCap,
        subscribers: mine.length, activeSubscribers: active.length,
        garmentsUsed: active.reduce((sum, s) => sum + s.garmentsUsed, 0),
        allowance: active.length * plan.garmentCap,
        // What the plan is worth on paper if every active subscriber renews. This is
        // not revenue and is no longer called revenue: it used to be reported as
        // revenuePaise alongside figures that came from the ledger, so two numbers
        // meaning different things sat in the same report under the same name.
        contractedMonthlyPaise: active.length * plan.monthlyPaise,
        // What was actually collected against this plan, from the ledger.
        collectedPaise: collectedByPlan.get(plan.id) ?? 0,
      };
    });
    return {
      total: subs.length,
      active: subs.filter((s) => s.status === "active").length,
      paused: subs.filter((s) => s.status === "paused").length,
      cancelled: subs.filter((s) => s.status === "cancelled").length,
      byPlan,
    };
  }

  async issueReport(session: Session, filter: ReportFilter = {}) {
    const societies = await this.access.visibleSocieties(session);
    const societyIds = new Set(societies.map((s) => s.id));
    let tickets = await this.store.tickets.find((t) => (t.societyId ? societyIds.has(t.societyId) : false));
    if (filter.societyId) tickets = tickets.filter((t) => t.societyId === filter.societyId);
    if (filter.from || filter.to) tickets = tickets.filter((t) => withinServiceDays(t.createdAt, filter.from, filter.to));
    const byType = new Map<string, number>();
    for (const ticket of tickets) byType.set(ticket.category, (byType.get(ticket.category) ?? 0) + 1);
    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      escalated: tickets.filter((t) => t.status === "escalated_supervisor" || t.status === "escalated_admin").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
      closed: tickets.filter((t) => t.status === "closed").length,
      emergency: tickets.filter((t) => t.priority === "emergency" && t.status !== "closed").length,
      byType: [...byType.entries()].map(([type, count]) => ({ type, count })),
    };
  }

  async revenueReport(session: Session, filter: ReportFilter = {}) {
    const orders = await this.scopedOrders(session, filter);
    const txns = await this.store.ledger.all();
    const credited = (account: string) => txns
      .flatMap((t) => t.entries)
      .filter((e) => e.account === account && e.direction === "credit")
      .reduce((sum, e) => sum + e.amount, 0);
    const subscriptionRevenuePaise = credited(Account.SubscriptionRevenue);
    const metrics = await this.metrics(orders);
    return {
      subscriptionRevenuePaise,
      additionalGarmentRevenuePaise: metrics.additionalRevenuePaise,
      pendingAdditionalChargesPaise: metrics.pendingAdditionalChargesPaise,
      totalRevenuePaise: subscriptionRevenuePaise + metrics.additionalRevenuePaise,
      addonRevenuePaise: credited(Account.AddonRevenue),
    };
  }

  // Retained for the existing admin report endpoints and their tests.
  async subscriptions(filter: DateSocietyFilter = {}) {
    let subs = await this.store.subscriptions.all();
    subs = inRange(subs, (s) => s.cycleStart, filter);
    if (filter.societyId) {
      const residentIds = new Set((await this.store.residents.find((r) => r.societyId === filter.societyId)).map((r) => r.id));
      subs = subs.filter((s) => residentIds.has(s.residentId));
    }
    // What each plan is carrying, and what it has actually collected.
    //
    // Four status counts were the whole report, which says how many subscriptions
    // exist and nothing about which plans people are on or which of them earns
    // anything. Revenue is read off the ledger rather than multiplied out from the
    // plan price, because an active subscription is not a payment.
    const plans = new Map((await this.store.plans.all()).map((p) => [p.id, p]));
    const planOfResident = new Map(subs.map((sub) => [sub.residentId, sub.planId]));
    const collectedByPlan = new Map<string, number>();
    for (const txn of await this.store.ledger.all()) {
      // "sub-<residentId>-<stamp>" is the only link the ledger keeps back to who paid.
      if (!txn.reference?.startsWith("sub-")) continue;
      const residentId = txn.reference.slice(4, txn.reference.lastIndexOf("-"));
      const planId = planOfResident.get(residentId);
      if (!planId) continue;
      for (const entry of txn.entries) {
        if (entry.account !== Account.SubscriptionRevenue || entry.direction !== "credit") continue;
        collectedByPlan.set(planId, (collectedByPlan.get(planId) ?? 0) + entry.amount);
      }
    }

    const byPlan = [...plans.values()]
      .map((plan) => {
        const mine = subs.filter((sub) => sub.planId === plan.id);
        return {
          planId: plan.id,
          planName: plan.name ?? plan.tier,
          subscribers: mine.length,
          active: mine.filter((sub) => sub.status === "active").length,
          revenuePaise: collectedByPlan.get(plan.id) ?? 0,
        };
      })
      .filter((row) => row.subscribers > 0 || row.revenuePaise > 0)
      .sort((a, b) => b.subscribers - a.subscribers);

    return {
      total: subs.length,
      active: subs.filter((s) => s.status === "active").length,
      paused: subs.filter((s) => s.status === "paused").length,
      cancelled: subs.filter((s) => s.status === "cancelled").length,
      expired: subs.filter((s) => s.status === "expired").length,
      // A subscription whose next cycle is already booked to a different plan.
      changing: subs.filter((s) => s.pendingPlanId).length,
      subscriptionRevenuePaise: [...collectedByPlan.values()].reduce((a, b) => a + b, 0),
      byPlan,
    };
  }

  async revenue(filter: DateSocietyFilter = {}) {
    // Society does not tag a ledger entry, so the society filter does not narrow
    // revenue; the date range does, applied to when each transaction posted.
    let txns = await this.store.ledger.all();
    txns = inRange(txns, (t) => t.createdAt, filter);
    const entries = txns.flatMap((t) => t.entries);
    const credited = (account: string) => entries
      .filter((e) => e.account === account && e.direction === "credit")
      .reduce((a, e) => a + e.amount, 0);

    const subscriptionRevenuePaise = credited(Account.SubscriptionRevenue);
    const addonRevenuePaise = credited(Account.AddonRevenue);
    const cancellationFeePaise = credited(Account.CancellationFeeRevenue);
    const reschedulingFeePaise = credited(Account.RescheduleFeeRevenue);
    // Money owed back. A refund is a debit to RefundsPayable when it is paid out, so
    // what has actually left is the debit side, not the credit.
    const refundedPaise = entries
      .filter((e) => e.account === Account.RefundsPayable && e.direction === "debit")
      .reduce((a, e) => a + e.amount, 0);
    // GST is held on behalf of the tax authority. It is not revenue and is reported
    // apart from it, so a total that includes it cannot be mistaken for earnings.
    const taxCollectedPaise = credited(Account.TaxPayable);

    const grossPaise = subscriptionRevenuePaise + addonRevenuePaise + cancellationFeePaise + reschedulingFeePaise;
    return {
      subscriptionRevenuePaise,
      addonRevenuePaise,
      cancellationFeePaise,
      reschedulingFeePaise,
      refundedPaise,
      taxCollectedPaise,
      grossPaise,
      // What the platform kept.
      netPaise: grossPaise - refundedPaise,
    };
  }

  async operations(filter: DateSocietyFilter = {}) {
    let orders = await this.store.orders.all();
    orders = inRange(orders, (o) => o.createdAt, filter);
    if (filter.societyId) orders = orders.filter((o) => o.societyId === filter.societyId);
    const byState: Record<string, number> = {};
    for (const o of orders) byState[o.state] = (byState[o.state] ?? 0) + 1;

    // "Delayed" is a judgement about the clock against the configured grace, not a
    // flag on the record. Asked the same way the rest of the reports ask it, so two
    // tabs cannot disagree about how many orders are running late.
    const config = await this.systemConfig.get();
    const isDelayed = (order: Order) => this.orders.isDelayed(order, config.delayGraceHours);

    const completed = orders.filter((o) => o.state === "delivered").length;
    const cancelled = orders.filter((o) => o.state === "cancelled").length;
    const delayed = orders.filter(isDelayed).length;
    const inProgress = orders.length - completed - cancelled;
    // Rates as a share of every order in the period, rounded to a tenth. Reported as
    // null rather than as 0% when there are no orders, because "0% completed" reads
    // as a failure and an empty period is not one.
    const rate = (n: number) => (orders.length === 0 ? null : Math.round((n / orders.length) * 1000) / 10);

    // Day by day, so the chart has something to draw. Only days inside the data are
    // returned; inventing empty days would make a quiet week look like an outage.
    const perDay = new Map<string, { day: string; completed: number; delayed: number; cancelled: number; total: number }>();
    for (const order of orders) {
      const day = (order.createdAt ?? "").slice(0, 10);
      if (!day) continue;
      const row = perDay.get(day) ?? { day, completed: 0, delayed: 0, cancelled: 0, total: 0 };
      row.total += 1;
      if (order.state === "delivered") row.completed += 1;
      if (order.state === "cancelled") row.cancelled += 1;
      if (isDelayed(order)) row.delayed += 1;
      perDay.set(day, row);
    }

    return {
      totalOrders: orders.length,
      byState,
      completed,
      cancelled,
      delayed,
      inProgress,
      completionRate: rate(completed),
      delayRate: rate(delayed),
      cancellationRate: rate(cancelled),
      trend: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  async garmentRisk(filter: DateSocietyFilter = {}) {
    let tickets = await this.store.tickets.find((t) => t.category === "garment_quantity_mismatch" || t.category === "qc_fail" || t.category === "dispute");
    tickets = inRange(tickets, (t) => t.createdAt, filter);
    let orders = await this.store.orders.all();
    orders = inRange(orders, (o) => o.createdAt, filter);
    if (filter.societyId) orders = orders.filter((o) => o.societyId === filter.societyId);
    return { incidents: tickets.length, ordersProcessed: orders.length };
  }

  async sustainability(filter: DateSocietyFilter = {}) {
    let logs = await this.store.waterLogs.all();
    logs = inRange(logs, (l) => (l as { at?: string; date?: string }).at ?? (l as { date?: string }).date ?? "", filter);
    return {
      litersUsed: logs.reduce((a, l) => a + l.litersUsed, 0),
      litersSaved: logs.reduce((a, l) => a + l.litersSaved, 0),
    };
  }
}

// A from/to date range (yyyy-mm-dd) and an optional society, shared by the report
// tabs so one filter bar drives every tab.
export interface DateSocietyFilter { from?: string; to?: string; societyId?: string }
// Keep only the rows whose date (by the given accessor) falls in [from, to]. A blank
// accessor value keeps the row, so data without a date is never silently dropped.
function inRange<T>(rows: T[], at: (row: T) => string, filter: DateSocietyFilter): T[] {
  if (!filter.from && !filter.to) return rows;
  return rows.filter((r) => {
    const day = (at(r) || "").slice(0, 10);
    if (!day) return true;
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    return true;
  });
}
