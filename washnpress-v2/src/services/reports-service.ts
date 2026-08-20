import { Account } from "../domain/accounts";
import type { Order, Session } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { AccessService } from "./access-service";
import type { OrderService } from "./order-service";
import type { SystemConfigService } from "./system-config-service";

export interface ReportFilter {
  from?: string;
  to?: string;
  areaId?: string;
  societyId?: string;
  supervisorUserId?: string;
  operatorUserId?: string;
  state?: string;
}

// Read-only analytics computed from the store. In production these read from a
// replica so reporting never competes with transactional traffic. Every report is
// filtered through the caller's scope first, so a supervisor's area report can
// never include another area's orders.
export class ReportsService {
  constructor(
    private readonly store: DataStore,
    private readonly access: AccessService,
    private readonly orders: OrderService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  private async scopedOrders(session: Session, filter: ReportFilter): Promise<Order[]> {
    let orders = await this.access.visibleOrders(session);
    if (filter.areaId) orders = orders.filter((o) => o.areaId === filter.areaId);
    if (filter.societyId) orders = orders.filter((o) => o.societyId === filter.societyId);
    if (filter.operatorUserId) orders = orders.filter((o) => o.assignedOperatorUserId === filter.operatorUserId);
    if (filter.state) orders = orders.filter((o) => o.state === filter.state);
    if (filter.from) orders = orders.filter((o) => o.createdAt >= filter.from!);
    if (filter.to) orders = orders.filter((o) => o.createdAt <= filter.to!);
    if (filter.supervisorUserId) {
      const areas = await this.store.areas.find((a) => a.supervisorUserId === filter.supervisorUserId);
      const areaIds = new Set(areas.map((a) => a.id));
      orders = orders.filter((o) => (o.areaId ? areaIds.has(o.areaId) : false));
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

  async byArea(session: Session, filter: ReportFilter = {}) {
    const orders = await this.scopedOrders(session, filter);
    const areas = new Map((await this.store.areas.all()).map((a) => [a.id, a]));
    return Promise.all(this.bucket(orders, (o) => o.areaId).map(async (group) => ({
      areaId: group.key,
      areaName: areas.get(group.key)?.name ?? "Unassigned",
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
    const areas = await this.store.areas.all();
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    return Promise.all(areas.map(async (area) => ({
      areaId: area.id,
      areaName: area.name,
      supervisorUserId: area.supervisorUserId,
      supervisorName: area.supervisorUserId ? users.get(area.supervisorUserId)?.fullName ?? null : null,
      ...(await this.metrics(orders.filter((o) => o.areaId === area.id))),
    })));
  }

  async byOperator(session: Session, filter: ReportFilter = {}) {
    const orders = await this.scopedOrders(session, filter);
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    return Promise.all(this.bucket(orders, (o) => o.assignedOperatorUserId).map(async (group) => ({
      operatorUserId: group.key,
      operatorName: users.get(group.key)?.fullName ?? "Unassigned",
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
    const byPlan = [...plans.values()].map((plan) => {
      const mine = subs.filter((s) => s.planId === plan.id);
      const active = mine.filter((s) => s.status === "active");
      return {
        planId: plan.id, tier: plan.tier, monthlyPaise: plan.monthlyPaise, garmentCap: plan.garmentCap,
        subscribers: mine.length, activeSubscribers: active.length,
        garmentsUsed: active.reduce((sum, s) => sum + s.garmentsUsed, 0),
        allowance: active.length * plan.garmentCap,
        revenuePaise: active.length * plan.monthlyPaise,
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
    if (filter.from) tickets = tickets.filter((t) => t.createdAt >= filter.from!);
    if (filter.to) tickets = tickets.filter((t) => t.createdAt <= filter.to!);
    const byType = new Map<string, number>();
    for (const ticket of tickets) byType.set(ticket.category, (byType.get(ticket.category) ?? 0) + 1);
    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      underReview: tickets.filter((t) => t.status === "under_review").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
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
  async subscriptions() {
    const subs = await this.store.subscriptions.all();
    return {
      total: subs.length,
      active: subs.filter((s) => s.status === "active").length,
      paused: subs.filter((s) => s.status === "paused").length,
      cancelled: subs.filter((s) => s.status === "cancelled").length,
    };
  }

  async revenue() {
    const txns = await this.store.ledger.all();
    const sum = (account: string) => txns.flatMap((t) => t.entries).filter((e) => e.account === account && e.direction === "credit").reduce((a, e) => a + e.amount, 0);
    return { subscriptionRevenuePaise: sum(Account.SubscriptionRevenue), addonRevenuePaise: sum(Account.AddonRevenue) };
  }

  async operations() {
    const orders = await this.store.orders.all();
    const byState: Record<string, number> = {};
    for (const o of orders) byState[o.state] = (byState[o.state] ?? 0) + 1;
    return { totalOrders: orders.length, byState };
  }

  async garmentRisk() {
    const tickets = await this.store.tickets.find((t) => t.category === "garment_quantity_mismatch" || t.category === "qc_fail" || t.category === "dispute");
    const orders = await this.store.orders.all();
    return { incidents: tickets.length, ordersProcessed: orders.length };
  }

  async sustainability() {
    const logs = await this.store.waterLogs.all();
    return {
      litersUsed: logs.reduce((a, l) => a + l.litersUsed, 0),
      litersSaved: logs.reduce((a, l) => a + l.litersSaved, 0),
    };
  }
}
