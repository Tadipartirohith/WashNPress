// Services that are not laundry.
//
// A vehicle wash and an hour of ironing at somebody's kitchen table are bookings, but
// they are not orders: nothing is collected, nothing goes through a machine, nothing
// comes back. Forcing them into the order model would mean an order with no garments,
// no batches and a state machine describing stages it never passes through — which is
// how a model stops meaning anything.
//
// They share a shape with each other, though. Somebody asks for a service at a time,
// somebody is sent to do it, it gets done, and it is charged for. That is what this
// is, and it is deliberately small enough that a third service line would fit in it
// without changing anything.

export type ServiceKind = "vehicle_wash" | "home_ironing";

export const SERVICE_KINDS: ServiceKind[] = ["vehicle_wash", "home_ironing"];

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  vehicle_wash: "Vehicle washing",
  home_ironing: "At-home ironing",
};

// What a request costs is measured differently by service. A wash is one job at one
// price; ironing at home is charged for the time it takes.
export type ServicePricingBasis = "per_job" | "per_hour";

export type ServiceRequestStatus =
  | "requested"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";

export const SERVICE_REQUEST_STATUSES: ServiceRequestStatus[] = [
  "requested", "assigned", "in_progress", "completed", "cancelled",
];

export const SERVICE_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  requested: "Requested",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Where a request may go from where it is. Completed and cancelled are ends.
export const SERVICE_TRANSITIONS: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  requested: ["assigned", "cancelled"],
  assigned: ["in_progress", "requested", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionRequest(from: ServiceRequestStatus, to: ServiceRequestStatus): boolean {
  return SERVICE_TRANSITIONS[from]?.includes(to) ?? false;
}

export class ServiceTransitionError extends Error {
  constructor(from: ServiceRequestStatus, to: ServiceRequestStatus) {
    super(`A ${SERVICE_STATUS_LABELS[from].toLowerCase()} request cannot become ${SERVICE_STATUS_LABELS[to].toLowerCase()}.`);
    this.name = "ServiceTransitionError";
  }
}

// The vehicle kinds a wash can be booked for. Configuration on the offering rather
// than a list in the client, so adding one does not need an application change.
export const DEFAULT_VEHICLE_TYPES = ["Car", "Bike"];

// What a request comes to. A per-job service is its own price; an hourly one is the
// rate times the hours, rounded to the nearest half hour worked, because charging a
// full hour for ten minutes is not what anybody agreed to.
export function quotePaise(
  offering: { pricingBasis: ServicePricingBasis; unitPricePaise: number },
  input: { hours?: number | null },
): number {
  if (offering.pricingBasis === "per_hour") {
    const hours = Math.max(0, input.hours ?? 0);
    return Math.round(offering.unitPricePaise * roundToHalfHour(hours));
  }
  return Math.max(0, Math.trunc(offering.unitPricePaise));
}

// Time is billed in half hours. Anything started is at least half an hour, because
// somebody travelled there.
export function roundToHalfHour(hours: number): number {
  if (hours <= 0) return 0;
  return Math.max(0.5, Math.round(hours * 2) / 2);
}

// ---------------------------------------------------------------- slot capacity

// Whether a service's timetable will accept a booking at a given time.
//
// The capacity on a window was, until this existed, a number the booking screen was
// shown and the booking itself never read: `availableStarts` worked out what was
// left so a full window could be drawn as full, and the write went ahead regardless.
// So the limit held only for as long as everybody believed the screen — two
// residents confirming the last space both got it, and a time nobody was ever
// offered could be posted directly.
//
// A service with no windows configured is not on a timetable and stays
// unconstrained. That is how services behaved before windows existed, and it is the
// right answer for one that genuinely runs to no schedule; refusing those would be a
// worse bug than the one being fixed.
export interface BookableWindow { startTime: string; capacity: number }

export type SlotRefusal = "no_such_window" | "full";

export function slotRefusal(
  windows: readonly BookableWindow[] | null | undefined,
  startTime: string,
  taken: number,
): SlotRefusal | null {
  if (!windows || windows.length === 0) return null;
  const window = windows.find((w) => w.startTime === startTime);
  if (!window) return "no_such_window";
  return taken >= window.capacity ? "full" : null;
}

export const SLOT_REFUSAL_MESSAGES: Record<SlotRefusal, string> = {
  no_such_window: "That is not one of the times this service runs.",
  full: "That time is fully booked. Please choose another.",
};

export class SlotUnavailableError extends Error {
  constructor(public readonly refusal: SlotRefusal) {
    super(SLOT_REFUSAL_MESSAGES[refusal]);
    this.name = "SlotUnavailableError";
  }
}
