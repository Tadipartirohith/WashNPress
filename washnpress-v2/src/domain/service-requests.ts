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
