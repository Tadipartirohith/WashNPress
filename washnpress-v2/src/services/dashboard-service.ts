import { Account } from "../domain/accounts";
import type { Area, AuditLog, CleanStage, Order, Pickup, Session, SupportTicket } from "../domain/models";
import { orderRequirement, CLEAN_STAGE_LABELS } from "../domain/processing";
import type { DataStore } from "../ports/repositories";
import type { AccessService } from "./access-service";
import type { IssueViewer } from "./issue-service";
import { IssueService } from "./issue-service";
import type { OrderService } from "./order-service";
import { ironingStarted } from "./order-service";
import { serviceDay, today as serviceToday } from "./scheduling-service";
import type { SystemConfigService } from "./system-config-service";

// Everything here counts by the service day rather than by UTC. Before this, an
// operator opening the dashboard at seven in the morning IST saw yesterday's work
// under "today", because the UTC date had not yet rolled over.
function onDay(iso: string | null | undefined, day: string): boolean {
  return Boolean(iso) && serviceDay(iso as string) === day;
}

// The three dashboards share one counting pass so a number never means one thing
// on the admin dashboard and something else on the supervisor dashboard.
export interface OrderCounts {
  total: number;
  today: number;
  pending: number;
  scheduled: number;
  active: number;
  completed: number;
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
  deliveredToday: number;
  cancelled: number;
  failedPickups: number;
  delayed: number;
  disputed: number;
}

// The processing counts the spec asks for: named after what the garments were
// actually sent for, so a facility handling only dry cleaning today does not see an
// empty "Washing" row and no dry cleaning row at all.
export interface ProcessingBreakdown {
  stages: { key: CleanStage; label: string; count: number }[];
  ironing: number;
  qcPending: number;
  qcFailed: number;
}

export interface AttentionItem {
  kind: string;
  label: string;
  count: number;
  severity: "critical" | "warning" | "notice";
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
    const day = serviceToday();
    const inState = (state: string) => orders.filter((o) => o.state === state);
    const ironingOrders = inState("ironing");
    const delivered = inState("delivered");
    return {
      total: orders.length,
      today: orders.filter((o) => onDay(o.createdAt, day)).length,
      // "Pending" is everything still waiting for its first physical action.
      pending: inState("scheduled").length,
      scheduled: inState("scheduled").length,
      // Active is work in flight: booked or in the facility, but not yet finished.
      active: orders.filter((o) => !["delivered", "cancelled", "pickup_failed", "disputed"].includes(o.state)).length,
      completed: delivered.length,
      pickedUp: inState("picked_up").length,
      washingPending: inState("picked_up").length,
      washing: inState("in_wash").length,
      ironingPending: ironingOrders.filter((o) => !ironingStarted(o)).length,
      ironing: ironingOrders.filter((o) => ironingStarted(o)).length,
      qcPending: inState("qc").length,
      qcFailed: inState("qc_hold").length,
      readyForDelivery: inState("ready_for_delivery").length,
      outForDelivery: inState("out_for_delivery").length,
      delivered: delivered.length,
      deliveredToday: delivered.filter((o) => onDay(o.deliveredAt, day)).length,
      cancelled: inState("cancelled").length,
      failedPickups: inState("pickup_failed").length,
      disputed: inState("disputed").length,
      delayed: orders.filter((o) => this.orders.isDelayed(o, config.delayGraceHours)).length,
    };
  }

  // Only the stages the batch on the floor actually needs. An order sent for dry
  // cleaning is counted under Dry Cleaning, not lumped in with Washing.
  private processing(orders: Order[]): ProcessingBreakdown {
    const cleaning = orders.filter((o) => o.state === "in_wash");
    const byStage = new Map<CleanStage, number>();
    for (const order of cleaning) {
      const stage = orderRequirement(order.lines ?? []).cleanStage;
      byStage.set(stage, (byStage.get(stage) ?? 0) + 1);
    }
    return {
      stages: [...byStage.entries()].map(([key, count]) => ({ key, label: CLEAN_STAGE_LABELS[key], count })),
      ironing: orders.filter((o) => o.state === "ironing").length,
      qcPending: orders.filter((o) => o.state === "qc").length,
      qcFailed: orders.filter((o) => o.state === "qc_hold").length,
    };
  }

  // The counts the issue sections are described in terms of: who is being waited on,
  // rather than the raw status names.
  private issueCounts(tickets: SupportTicket[]) {
    const live = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      waitingResident: tickets.filter((t) => t.status === "waiting_resident").length,
      waitingOperator: tickets.filter((t) => t.status === "waiting_operator").length,
      assigned: tickets.filter((t) => t.assignedToUserId && t.status !== "resolved" && t.status !== "closed").length,
      escalatedSupervisor: live.filter((t) => t.responsibleRole === "supervisor").length,
      escalatedAdmin: live.filter((t) => t.responsibleRole === "admin").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
      closed: tickets.filter((t) => t.status === "closed").length,
      // Pending is everything still needing work, which is what a dashboard scans for.
      pending: live.length,
      emergency: live.filter((t) => t.priority === "emergency").length,
      escalated: live.filter((t) => t.escalatedToAdmin).length,
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

  private pickupCounts(pickups: Pickup[], day: string) {
    return {
      today: pickups.filter((p) => onDay(p.scheduledFor, day)).length,
      pending: pickups.filter((p) => p.status === "scheduled" || p.status === "rescheduled").length,
      completed: pickups.filter((p) => p.status === "completed").length,
      failed: pickups.filter((p) => p.status === "failed").length,
    };
  }

  // System wide. Admin only; nothing here is filtered by area.
  async admin() {
    const [areas, societies, residents, users, orders, subscriptions, tickets, pickups, audit] = await Promise.all([
      this.store.areas.all(), this.store.societies.all(), this.store.residents.all(),
      this.store.users.all(), this.store.orders.all(), this.store.subscriptions.all(),
      this.store.tickets.all(), this.store.pickups.all(), this.store.audit.all(),
    ]);
    const supervisors = users.filter((u) => u.roles.includes("supervisor"));
    const operators = users.filter((u) => u.roles.includes("operator"));
    const day = serviceToday();
    const counts = await this.countOrders(orders);
    const issues = this.issueCounts(tickets);
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
      residents: { total: residents.length, onboarded: residents.filter((r) => r.onboardingCompleted).length },
      operationsStaff: {
        total: operators.length,
        active: operators.filter((u) => u.status === "active").length,
        unassigned: operators.filter((u) => u.societyIds.length === 0).length,
      },
      orders: counts,
      // How the day is actually going, as opposed to the lifetime totals above.
      operations: { pickups: this.pickupCounts(pickups, day), processing: this.processing(orders) },
      subscriptions: {
        total: subscriptions.length,
        active: subscriptions.filter((s) => s.status === "active").length,
        paused: subscriptions.filter((s) => s.status === "paused").length,
        cancelled: subscriptions.filter((s) => s.status === "cancelled").length,
        expired: subscriptions.filter((s) => s.status === "expired").length,
      },
      revenue: await this.revenue(orders),
      issues,
      areaPerformance: await this.areaPerformance(areas, orders, tickets),
      recentActivity: this.recentActivity(audit),
      alerts: this.alerts(counts, issues, supervisors, operators, subscriptions),
    };
  }

  // Areas side by side, so the admin can see which one is falling behind.
  private async areaPerformance(areas: Area[], orders: Order[], tickets: SupportTicket[]) {
    const societies = await this.store.societies.all();
    const residents = await this.store.residents.all();
    const operators = (await this.store.users.all()).filter((u) => u.roles.includes("operator"));
    const config = await this.systemConfig.get();
    return areas.map((area) => {
      const areaSocieties = societies.filter((s) => s.areaId === area.id);
      const societyIds = new Set(areaSocieties.map((s) => s.id));
      const areaOrders = orders.filter((o) => (o.areaId ? o.areaId === area.id : societyIds.has(o.societyId)));
      return {
        areaId: area.id,
        name: area.name,
        societies: areaSocieties.length,
        residents: residents.filter((r) => societyIds.has(r.societyId)).length,
        operators: operators.filter((u) => u.areaId === area.id).length,
        totalOrders: areaOrders.length,
        pendingOrders: areaOrders.filter((o) => o.state === "scheduled").length,
        deliveredOrders: areaOrders.filter((o) => o.state === "delivered").length,
        delayedOrders: areaOrders.filter((o) => this.orders.isDelayed(o, config.delayGraceHours)).length,
        openIssues: tickets.filter(
          (t) => (t.areaId === area.id || (t.societyId ? societyIds.has(t.societyId) : false)) &&
            t.status !== "resolved" && t.status !== "closed",
        ).length,
      };
    });
  }

  // The audit log already records who did what and when, so recent activity reads
  // from it rather than keeping a second, divergent history.
  private recentActivity(audit: AuditLog[], limit = 12) {
    return [...audit]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((entry) => ({
        id: entry.id,
        action: entry.action,
        actor: entry.actorName ?? entry.actor,
        role: entry.role,
        resource: entry.resource,
        resourceId: entry.resourceId,
        at: entry.at,
      }));
  }

  // Only the things that are actually wrong. A zero count is left out rather than
  // shown as a reassuring green nothing, so the section is empty when all is well.
  private alerts(
    counts: OrderCounts,
    issues: ReturnType<DashboardService["issueCounts"]>,
    supervisors: { areaId: string | null }[],
    operators: { societyIds: string[] }[],
    subscriptions: { status: string }[],
  ): AttentionItem[] {
    const candidates: AttentionItem[] = [
      { kind: "qc_failed", label: "QC Failed", count: counts.qcFailed, severity: "critical" },
      { kind: "escalated_issues", label: "Escalated Issues", count: issues.escalated, severity: "critical" },
      { kind: "emergency_issues", label: "Critical Issues", count: issues.emergency, severity: "critical" },
      { kind: "delayed_orders", label: "Delayed Orders", count: counts.delayed, severity: "warning" },
      { kind: "failed_pickups", label: "Failed Pickups", count: counts.failedPickups, severity: "warning" },
      { kind: "disputed_orders", label: "Disputed Orders", count: counts.disputed, severity: "warning" },
      { kind: "unassigned_supervisors", label: "Unassigned Supervisors", count: supervisors.filter((s) => !s.areaId).length, severity: "notice" },
      { kind: "unassigned_operators", label: "Unassigned Operators", count: operators.filter((o) => o.societyIds.length === 0).length, severity: "notice" },
      { kind: "expired_subscriptions", label: "Expired Subscriptions", count: subscriptions.filter((s) => s.status === "expired").length, severity: "notice" },
    ];
    return candidates.filter((a) => a.count > 0);
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
    const viewer: IssueViewer = { userId: session.userId, role: "supervisor", areaId: session.areaId, societyIds };
    const tickets = (await this.store.tickets.all()).filter((t) => IssueService.canSee(t, viewer));
    const pickups = await this.store.pickups.find((p) => societyIds.has(p.societyId));
    const day = serviceToday();
    return {
      area: area ? { id: area.id, name: area.name, code: area.code } : null,
      societies: { total: societies.length, active: societies.filter((s) => s.status === "active").length },
      residents: { total: residents.length },
      operationsStaff: { total: operators.length, active: operators.filter((u) => u.status === "active").length },
      pickups: this.pickupCounts(pickups, day),
      orders: await this.countOrders(orders),
      processing: this.processing(orders),
      issues: this.issueCounts(tickets),
    };
  }

  async operations(session: Session) {
    const societies = await this.access.visibleSocieties(session);
    const area = session.areaId ? await this.store.areas.get(session.areaId) : null;
    const orders = await this.access.visibleOrders(session);
    const societyIds = new Set(societies.map((s) => s.id));
    const viewer: IssueViewer = { userId: session.userId, role: "operator", areaId: session.areaId, societyIds };
    const tickets = (await this.store.tickets.all()).filter((t) => IssueService.canSee(t, viewer));
    const day = serviceToday();
    const pickups = await this.store.pickups.find((p) => societyIds.has(p.societyId));
    const counts = await this.countOrders(orders);
    const societyNames = new Map(societies.map((s) => [s.id, s.name]));
    const residents = new Map((await this.store.residents.all()).map((r) => [r.id, r]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));

    const describe = (order: Order) => {
      const resident = residents.get(order.residentId);
      return {
        orderId: order.id,
        orderCode: order.orderCode,
        residentName: resident ? users.get(resident.userId)?.fullName ?? null : null,
        society: societyNames.get(order.societyId) ?? null,
        unit: resident?.unitNumber ?? null,
        items: order.acceptedCount ?? order.estimatedCount ?? 0,
      };
    };

    // What is actually waiting on this operator right now, most urgent first. The
    // dashboard is meant to answer "what work do I need to do?", so anything that is
    // merely in flight and needs nobody is deliberately absent.
    const actionRequired = [
      ...orders.filter((o) => o.state === "qc_hold").map((o) => ({ kind: "qc_failed", label: "QC Failed", action: "View Order", ...describe(o) })),
      ...orders.filter((o) => o.state === "scheduled").map((o) => ({ kind: "pending_pickup", label: "Pending Pickup", action: "View Pickup", ...describe(o) })),
      ...orders.filter((o) => o.state === "ready_for_delivery").map((o) => ({ kind: "ready_for_delivery", label: "Ready for Delivery", action: "View Order", ...describe(o) })),
    ];

    const upcomingPickups = pickups
      .filter((p) => (p.status === "scheduled" || p.status === "rescheduled") && serviceDay(p.scheduledFor) >= day)
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
      .slice(0, 10)
      .map((p) => {
        const resident = residents.get(p.residentId);
        const order = orders.find((o) => o.pickupId === p.id);
        return {
          pickupId: p.id,
          orderId: order?.id ?? null,
          orderCode: order?.orderCode ?? null,
          scheduledFor: p.scheduledFor,
          residentName: resident ? users.get(resident.userId)?.fullName ?? null : null,
          society: societyNames.get(p.societyId) ?? null,
          unit: resident?.unitNumber ?? null,
          items: order?.estimatedCount ?? 0,
          status: p.status,
        };
      });

    return {
      area: area ? { id: area.id, name: area.name } : null,
      societies: societies.map((s) => ({ id: s.id, name: s.name })),
      todaysPickups: pickups.filter((p) => onDay(p.scheduledFor, day)).length,
      pickups: this.pickupCounts(pickups, day),
      orders: counts,
      processing: this.processing(orders),
      actionRequired,
      upcomingPickups,
      issues: this.issueCounts(tickets),
      // Kept for clients built against the earlier shape.
      openIssues: this.issueCounts(tickets).pending,
    };
  }
}
