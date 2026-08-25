import type {
  Addon, Area, Order, Pickup, Plan, Resident, Society, SupportTicket, Unit, User, ServiceOffering,
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
  // An account written before verification existed is one that was already in use,
  // so it reads as approved rather than being locked out by a rule added later.
  const verified: User["verificationStatus"] = user.verificationStatus ?? "approved";
  if (Array.isArray(user.societyIds) && Array.isArray(user.roles) && user.status
      && user.verificationStatus) return user;
  return {
    ...user,
    verificationStatus: verified,
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
      && Array.isArray(order.lines) && Array.isArray(order.addonIds)
      && Array.isArray(order.batches)) return order;
  return {
    ...order,
    // An order with no timeline has no recorded history, which is worth showing as
    // an empty history rather than refusing to show the order at all.
    items: arr(order.items),
    addonIds: arr(order.addonIds),
    lines: arr(order.lines),
    // Orders written before processing batches existed have none. They read as an
    // order with nothing on the floor rather than failing to load at all.
    batches: arr(order.batches),
    timeline: arr(order.timeline),
    servicesPaise: order.servicesPaise ?? 0,
    qcAttempts: order.qcAttempts ?? 0,
    payPerOrder: order.payPerOrder ?? false,
    additionalChargeStatus: order.additionalChargeStatus ?? "none",
    orderCode: str(order.orderCode),
  };
}

export function normaliseTicket(ticket: SupportTicket): SupportTicket {
  // "assigned" was the stage a ticket sat in once somebody had taken it. It is now
  // simply in progress, and a ticket stored under the old name is read as such rather
  // than left with a status nothing recognises.
  const status: SupportTicket["status"] = (ticket.status as string) === "assigned" ? "in_progress" : ticket.status;
  if (Array.isArray(ticket.messages) && status === ticket.status
      && ticket.responsibleRole !== undefined && ticket.escalatedToSupervisor !== undefined) {
    return ticket;
  }
  return {
    ...ticket,
    status,
    messages: arr(ticket.messages),
    escalatedToAdmin: ticket.escalatedToAdmin ?? false,
    // A ticket raised before the hierarchy existed is answered by whoever the rules
    // would pick for it today.
    responsibleRole: (ticket.responsibleRole
      ?? (ticket.reportedByRole === "resident" ? "operator" : "supervisor")) as SupportTicket["responsibleRole"],
    escalatedToSupervisor: ticket.escalatedToSupervisor ?? Boolean(ticket.escalatedToAdmin),
  };
}

export function normalisePlan(plan: Plan): Plan {
  if (Array.isArray(plan.coveredServiceIds)) return plan;
  // Left alone, a plan with no stated coverage would cover nothing, and residents on
  // it would start being charged for the wash and iron it has always included.
  return { ...plan, coveredServiceIds: ["wash_iron", "wash_only"] };
}

// A service offering written before the service wizard existed says what it is
// measured in only through its pricing basis, and says nothing at all about its
// category. Left alone it would fail the wizard's validation the first time somebody
// edited it — so a seeded car wash could not be deactivated.
export function normaliseOffering(offering: ServiceOffering): ServiceOffering {
  if (offering.unit && offering.category) return offering;
  return {
    ...offering,
    unit: offering.unit ?? (offering.pricingBasis === "per_hour" ? "hour" : "job"),
    category: offering.category
      ?? (offering.kind === "vehicle_wash" ? "vehicle_care" : "home_care"),
    vehicleTypes: arr(offering.vehicleTypes),
  };
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
