import type {
  Addon, Area, Order, Pickup, Plan, Resident, Society, SupportTicket, Unit, User,
} from "./models";

// A record that has been in the database for a while may predate a field, or may have
// been written by an import or a tool that did not set one. The code above the store
// is entitled to assume the shape in models.ts is real: it calls `.map`, `.some` and
// `.toLowerCase` without checking, and it should be able to.
//
// So the store fills the gaps on the way out. One record missing one field then costs
// that record a sensible default, rather than costing the whole endpoint a 500 and
// every user of that screen their data.
//
// This is a floor under reads, not a substitute for writing records correctly. Every
// entity with an array or a string that callers dereference gets a normaliser, so the
// class of fault cannot come back through a different table.

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normaliseUser(user: User): User {
  if (Array.isArray(user.societyIds) && Array.isArray(user.roles) && user.status) return user;
  return {
    ...user,
    // An account with no roles can sign in and see nothing, which is the safe
    // reading of a missing value. An account with no societies covers none.
    roles: arr(user.roles),
    societyIds: arr(user.societyIds),
    status: user.status ?? "active",
    fullName: user.fullName ?? null,
    email: user.email ?? null,
    employeeId: user.employeeId ?? null,
    areaId: user.areaId ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function normaliseSociety(society: Society): Society {
  if (typeof society.name === "string" && typeof society.code === "string" && society.status) return society;
  return {
    ...society,
    // A society with no name still has an id, and showing it as unnamed is far more
    // useful than refusing to list any society at all.
    name: str(society.name),
    code: str(society.code),
    areaId: society.areaId ?? null,
    address: society.address ?? null,
    city: str(society.city),
    state: str(society.state),
    status: society.status ?? "active",
  };
}

export function normaliseOrder(order: Order): Order {
  if (Array.isArray(order.items) && Array.isArray(order.timeline)
      && Array.isArray(order.lines) && Array.isArray(order.addonIds)) return order;
  return {
    ...order,
    // An order with no timeline has no recorded history, which is worth showing as
    // an empty history rather than refusing to show the order at all.
    items: arr(order.items),
    addonIds: arr(order.addonIds),
    lines: arr(order.lines),
    timeline: arr(order.timeline),
    servicesPaise: order.servicesPaise ?? 0,
    qcAttempts: order.qcAttempts ?? 0,
    payPerOrder: order.payPerOrder ?? false,
    additionalChargeStatus: order.additionalChargeStatus ?? "none",
    orderCode: str(order.orderCode),
  };
}

export function normaliseTicket(ticket: SupportTicket): SupportTicket {
  if (Array.isArray(ticket.messages)) return ticket;
  return {
    ...ticket,
    messages: arr(ticket.messages),
    escalatedToAdmin: ticket.escalatedToAdmin ?? false,
  };
}

export function normalisePlan(plan: Plan): Plan {
  if (Array.isArray(plan.coveredServiceIds)) return plan;
  // Left alone, a plan with no stated coverage would cover nothing, and residents on
  // it would start being charged for the wash and iron it has always included.
  return { ...plan, coveredServiceIds: ["wash_iron", "wash_only"] };
}

export function normalisePickup(pickup: Pickup): Pickup {
  if (Array.isArray(pickup.recurringDays)) return pickup;
  return { ...pickup, recurringDays: arr(pickup.recurringDays), recurring: pickup.recurring ?? false };
}

export function normaliseResident(resident: Resident): Resident {
  if (Array.isArray(resident.preferredWindows)) return resident;
  return { ...resident, preferredWindows: arr(resident.preferredWindows) };
}

export function normaliseUnit(unit: Unit): Unit {
  if (Array.isArray(unit.operatorUserIds)) return unit;
  return { ...unit, operatorUserIds: arr(unit.operatorUserIds) };
}

export function normaliseArea(area: Area): Area {
  if (typeof area.name === "string" && typeof area.code === "string" && area.status) return area;
  // Lists of areas are sorted by name, and one area with no name should not stop the
  // whole list being sorted.
  return {
    ...area,
    name: str(area.name),
    code: str(area.code),
    description: area.description ?? null,
    region: area.region ?? null,
    status: area.status ?? "active",
    supervisorUserId: area.supervisorUserId ?? null,
  };
}

export function normaliseAddon(addon: Addon): Addon {
  if (typeof addon.name === "string") return addon;
  return { ...addon, name: str(addon.name), pricePaise: addon.pricePaise ?? 0, isActive: addon.isActive ?? true };
}
