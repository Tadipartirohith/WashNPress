import type { Order, Session, User } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { AuditService } from "./audit-service";
import type { NotificationService } from "./notification-service";
import type { OrderService } from "./order-service";

export class StaffingError extends Error {
  constructor(message: string) { super(message); this.name = "StaffingError"; }
}

export interface HandoverResult {
  user: User;
  reassigned: { orderId: string; orderCode: string; toUserId: string | null }[];
  unassigned: number;
}

// Employee availability must not be a single point of failure. Taking somebody off
// duty never deletes them and never deletes their work: the account is marked, and
// anything they were holding is either handed to a named colleague or returned to
// the shared queue where any authorised colleague can pick it up.
export class StaffingService {
  constructor(
    private readonly store: DataStore,
    private readonly orders: OrderService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  private async requireUser(userId: string): Promise<User> {
    const user = await this.store.users.get(userId);
    if (!user) throw new StaffingError("User not found");
    return user;
  }

  // Who can take work in an area right now.
  async availableOperators(areaId: string | null, options: { societyId?: string; excludeUserId?: string } = {}): Promise<User[]> {
    if (!areaId) return [];
    return this.store.users.find((u) =>
      u.roles.includes("operator") &&
      u.areaId === areaId &&
      u.status === "active" &&
      u.id !== options.excludeUserId &&
      (!options.societyId || u.societyIds.includes(options.societyId)));
  }

  // A view of what one operator is still holding, so a supervisor can decide before
  // taking them off duty.
  async workloadHandoverPreview(operatorUserId: string) {
    const user = await this.requireUser(operatorUserId);
    const open = await this.orders.openWorkFor(operatorUserId);
    const candidates = await this.availableOperators(user.areaId, { excludeUserId: operatorUserId });
    return {
      operator: { id: user.id, fullName: user.fullName, status: user.status, areaId: user.areaId, societyIds: user.societyIds },
      openOrders: await this.orders.summarise(open),
      openCount: open.length,
      availableOperators: candidates.map((c) => ({ id: c.id, fullName: c.fullName, societyIds: c.societyIds })),
    };
  }

  // Marking somebody on leave, blocked or active again. Open work is moved in the
  // same step so it is never left behind an unavailable person.
  async setAvailability(input: {
    userId: string;
    status: User["status"];
    reassignToUserId?: string | null;
    session: Session;
    reason?: string;
  }): Promise<HandoverResult> {
    const user = await this.requireUser(input.userId);
    if (user.roles.includes("admin")) throw new StaffingError("An admin account cannot be taken off duty here");

    const previousStatus = user.status;
    user.status = input.status;
    await this.store.users.put(user);
    await this.audit.record({
      session: input.session,
      action: input.status === "active" ? "user.returned_to_duty" : input.status === "on_leave" ? "user.marked_on_leave" : "user.deactivated",
      resource: "user", resourceId: user.id,
      previousValue: { status: previousStatus },
      newValue: { status: input.status, reason: input.reason ?? null },
    });

    // Only operators hold order level work. A supervisor going off duty leaves the
    // area and everything in it intact; the admin covers it until a replacement is
    // assigned, which is why no area data is touched here.
    if (!user.roles.includes("operator") || input.status === "active") {
      return { user, reassigned: [], unassigned: 0 };
    }

    const open = await this.orders.openWorkFor(user.id);
    const target = input.reassignToUserId ? await this.requireUser(input.reassignToUserId) : null;
    if (target && (!target.roles.includes("operator") || target.status !== "active" || target.areaId !== user.areaId)) {
      throw new StaffingError("The replacement must be an active operator in the same area");
    }

    const reassigned = await this.handOver(open, target?.id ?? null, input.session, input.reason);
    await this.notifications.notifyRoleInArea(user.areaId, "supervisor", {
      type: "staff.availability_changed",
      title: target ? "Work reassigned" : "Work returned to the queue",
      body: `${user.fullName ?? "An operator"} is ${input.status === "on_leave" ? "on leave" : "unavailable"}. ${open.length} order(s) ${target ? `moved to ${target.fullName ?? "another operator"}` : "are back in the shared queue"}.`,
    });

    return { user, reassigned, unassigned: target ? 0 : reassigned.length };
  }

  // Move a set of orders to a named operator, or back to the shared queue when the
  // target is null. The order state and its history are untouched, so a batch that
  // was mid wash stays mid wash.
  async handOver(orders: Order[], toUserId: string | null, session: Session, reason?: string) {
    const moved: HandoverResult["reassigned"] = [];
    for (const order of orders) {
      const note = toUserId
        ? `Reassigned${reason ? ` (${reason})` : ""}`
        : `Returned to the unassigned queue${reason ? ` (${reason})` : ""}`;
      const result = await this.orders.assignOperator(order.id, toUserId, { userId: session.userId, session }, note);
      await this.audit.record({
        session, action: "order.operator_reassigned", resource: "order", resourceId: order.id,
        previousValue: { assignedOperatorUserId: result.previousOperatorUserId },
        newValue: { assignedOperatorUserId: toUserId, reason: reason ?? null },
      });
      moved.push({ orderId: order.id, orderCode: order.orderCode, toUserId });
    }
    return moved;
  }

  async reassignOrder(orderId: string, toUserId: string | null, session: Session, reason?: string) {
    const order = await this.store.orders.get(orderId);
    if (!order) throw new StaffingError("Order not found");
    if (toUserId) {
      const target = await this.requireUser(toUserId);
      if (!target.roles.includes("operator") || target.status !== "active") {
        throw new StaffingError("The operator must be active to receive work");
      }
    }
    const [moved] = await this.handOver([order], toUserId, session, reason);
    return moved;
  }

  // Whether an area currently has a supervisor able to act. When it does not, the
  // admin is the cover, which is what the admin portal surfaces.
  async areaCoverage(areaId: string) {
    const area = await this.store.areas.get(areaId);
    if (!area) return null;
    const supervisor = area.supervisorUserId ? await this.store.users.get(area.supervisorUserId) : null;
    const covered = Boolean(supervisor && supervisor.status === "active");
    return {
      areaId: area.id,
      areaName: area.name,
      supervisorUserId: area.supervisorUserId,
      supervisorName: supervisor?.fullName ?? null,
      supervisorStatus: supervisor?.status ?? null,
      covered,
      // The admin steps in whenever the area has no active supervisor.
      needsAdminCover: !covered,
    };
  }

  async areasNeedingCover() {
    const areas = await this.store.areas.all();
    const coverage = await Promise.all(areas.map((a) => this.areaCoverage(a.id)));
    return coverage.filter((c): c is NonNullable<typeof c> => Boolean(c) && c!.needsAdminCover);
  }
}
