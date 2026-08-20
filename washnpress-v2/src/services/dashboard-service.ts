import { Account } from "../domain/accounts";
import type { Order, Session } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { AccessService } from "./access-service";
import type { OrderService } from "./order-service";
import { ironingStarted } from "./order-service";
import type { SystemConfigService } from "./system-config-service";

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

// The three dashboards share one counting pass so a number never means one thing
// on the admin dashboard and something else on the supervisor dashboard.
export interface OrderCounts {
  total: number;
  today: number;
  pending: number;
  scheduled: number;
  pickedUp: number;
  washingPending: number;
  washing: number;
  ironingPending: number;
  ironing: number;
  qcPending: number;
  qcFailed: number;
  readyForDelivery: number;
  outForDelivery: number;
  delivered: number;
  cancelled: number;
  failedPickups: number;
  delayed: number;
  disputed: number;
}

export class DashboardService {
  constructor(
    private readonly store: DataStore,
    private readonly access: AccessService,
    private readonly orders: OrderService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  async countOrders(orders: Order[]): Promise<OrderCounts> {
    const config = await this.systemConfig.get();
    const inState = (state: string) => orders.filter((o) => o.state === state);
    const ironingOrders = inState("ironing");
    return {
      total: orders.length,
      today: orders.filter((o) => isToday(o.createdAt)).length,
      // "Pending" is everything still waiting for its first physical action.
      pending: inState("scheduled").length,
      scheduled: inState("scheduled").length,
      pickedUp: inState("picked_up").length,
      washingPending: inState("picked_up").length,
      washing: inState("in_wash").length,
      ironingPending: ironingOrders.filter((o) => !ironingStarted(o)).length,
      ironing: ironingOrders.filter((o) => ironingStarted(o)).length,
      qcPending: inState("qc").length,
      qcFailed: inState("qc_hold").length,
      readyForDelivery: inState("ready_for_delivery").length,
      outForDelivery: inState("out_for_delivery").length,
      delivered: inState("delivered").length,
      cancelled: inState("cancelled").length,
      failedPickups: inState("pickup_failed").length,
      disputed: inState("disputed").length,
      delayed: orders.filter((o) => this.orders.isDelayed(o, config.delayGraceHours)).length,
    };
  }

  private async revenue(orders: Order[]) {
    const txns = await this.store.ledger.all();
    const credited = (account: string) => txns
      .flatMap((t) => t.entries)
      .filter((e) => e.account === account && e.direction === "credit")
      .reduce((sum, e) => sum + e.amount, 0);
    const subscriptionRevenuePaise = credited(Account.SubscriptionRevenue);
    const additionalGarmentRevenuePaise = orders
      .filter((o) => o.additionalChargeStatus === "paid")
      .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0);
    return {
      subscriptionRevenuePaise,
      additionalGarmentRevenuePaise,
      pendingAdditionalChargesPaise: orders
        .filter((o) => o.additionalChargeStatus === "pending" || o.additionalChargeStatus === "failed")
        .reduce((sum, o) => sum + (o.additionalChargePaise ?? 0), 0),
      totalRevenuePaise: subscriptionRevenuePaise + additionalGarmentRevenuePaise,
    };
  }

  // System wide. Admin only; nothing here is filtered by area.
  async admin() {
    const [areas, societies, residents, users, orders, subscriptions, tickets] = await Promise.all([
      this.store.areas.all(), this.store.societies.all(), this.store.residents.all(),
      this.store.users.all(), this.store.orders.all(), this.store.subscriptions.all(), this.store.tickets.all(),
    ]);
    const supervisors = users.filter((u) => u.roles.includes("supervisor"));
    const operators = users.filter((u) => u.roles.includes("operator"));
    return {
      areas: {
        total: areas.length,
        active: areas.filter((a) => a.status === "active").length,
        inactive: areas.filter((a) => a.status !== "active").length,
      },
      supervisors: {
        total: supervisors.length,
        active: supervisors.filter((u) => u.status === "active").length,
        inactive: supervisors.filter((u) => u.status !== "active").length,
        unassigned: supervisors.filter((u) => !u.areaId).length,
      },
      societies: {
        total: societies.length,
        active: societies.filter((s) => s.status === "active").length,
        inactive: societies.filter((s) => s.status === "inactive").length,
      },
      residents: { total: residents.length, onboarded: (await this.store.residents.find((r) => r.onboardingCompleted)).length },
      operationsStaff: { total: operators.length, active: operators.filter((u) => u.status === "active").length },
      orders: await this.countOrders(orders),
      subscriptions: {
        total: subscriptions.length,
        active: subscriptions.filter((s) => s.status === "active").length,
        paused: subscriptions.filter((s) => s.status === "paused").length,
        cancelled: subscriptions.filter((s) => s.status === "cancelled").length,
      },
      revenue: await this.revenue(orders),
      issues: {
        total: tickets.length,
        open: tickets.filter((t) => t.status === "open").length,
        underReview: tickets.filter((t) => t.status === "under_review").length,
        resolved: tickets.filter((t) => t.status === "resolved").length,
        escalated: tickets.filter((t) => t.escalatedToAdmin && t.status !== "resolved").length,
      },
    };
  }

  // Everything below is scoped: the supervisor sees only their own area, and the
  // operator only the societies they are assigned to.
  async supervisor(session: Session) {
    const area = session.areaId ? await this.store.areas.get(session.areaId) : null;
    const societies = await this.access.visibleSocieties(session);
    const societyIds = new Set(societies.map((s) => s.id));
    const residents = await this.store.residents.find((r) => societyIds.has(r.societyId));
    const operators = await this.store.users.find((u) => u.roles.includes("operator") && u.areaId === session.areaId);
    const orders = await this.access.visibleOrders(session);
    const tickets = await this.store.tickets.find((t) => (t.societyId ? societyIds.has(t.societyId) : false));
    const pickups = await this.store.pickups.find((p) => societyIds.has(p.societyId));
    const today = new Date().toISOString().slice(0, 10);
    return {
      area: area ? { id: area.id, name: area.name, code: area.code } : null,
      societies: { total: societies.length, active: societies.filter((s) => s.status === "active").length },
      residents: { total: residents.length },
      operationsStaff: { total: operators.length, active: operators.filter((u) => u.status === "active").length },
      pickups: {
        today: pickups.filter((p) => p.scheduledFor.slice(0, 10) === today).length,
        pending: pickups.filter((p) => p.status === "scheduled" || p.status === "rescheduled").length,
        failed: pickups.filter((p) => p.status === "failed").length,
      },
      orders: await this.countOrders(orders),
      issues: {
        open: tickets.filter((t) => t.status === "open").length,
        underReview: tickets.filter((t) => t.status === "under_review").length,
        resolved: tickets.filter((t) => t.status === "resolved").length,
      },
    };
  }

  async operations(session: Session) {
    const societies = await this.access.visibleSocieties(session);
    const area = session.areaId ? await this.store.areas.get(session.areaId) : null;
    const orders = await this.access.visibleOrders(session);
    const societyIds = new Set(societies.map((s) => s.id));
    const tickets = await this.store.tickets.find((t) => (t.societyId ? societyIds.has(t.societyId) : false));
    const today = new Date().toISOString().slice(0, 10);
    const pickups = await this.store.pickups.find((p) => societyIds.has(p.societyId));
    return {
      area: area ? { id: area.id, name: area.name } : null,
      societies: societies.map((s) => ({ id: s.id, name: s.name })),
      todaysPickups: pickups.filter((p) => p.scheduledFor.slice(0, 10) === today).length,
      orders: await this.countOrders(orders),
      openIssues: tickets.filter((t) => t.status !== "resolved").length,
    };
  }
}
