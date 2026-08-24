import { randomUUID } from "node:crypto";
import type { ServiceOffering, ServiceRequest } from "../domain/models";
import {
  canTransitionRequest, quotePaise, roundToHalfHour, ServiceTransitionError,
  SERVICE_STATUS_LABELS, SERVICE_KIND_LABELS,
  type ServiceKind, type ServiceRequestStatus,
} from "../domain/service-requests";
import type { DataStore } from "../ports/repositories";
import type { NotificationService } from "./notification-service";

// Booking, assigning and completing the services that are not laundry.
//
// The price is quoted before the resident confirms and is never taken from them.
// For an hourly service the quote is what the booking was expected to cost and the
// final figure is what the work actually took, kept separately so the difference can
// be seen rather than discovered on a bill.

export class OfferingNotFoundError extends Error {
  constructor() { super("No such service."); this.name = "OfferingNotFoundError"; }
}
export class OfferingInactiveError extends Error {
  constructor(name: string) { super(`${name} is not currently offered.`); this.name = "OfferingInactiveError"; }
}
export class RequestNotFoundError extends Error {
  constructor() { super("No such service request."); this.name = "RequestNotFoundError"; }
}
export class VehicleDetailsRequiredError extends Error {
  constructor(types: string[]) {
    super(`Say which vehicle this is for: ${types.join(" or ")}.`);
    this.name = "VehicleDetailsRequiredError";
  }
}
export class HoursRequiredError extends Error {
  constructor(minimum: number | null) {
    super(minimum ? `Say how long you need, at least ${minimum} hour${minimum === 1 ? "" : "s"}.` : "Say how long you need.");
    this.name = "HoursRequiredError";
  }
}

export interface ServiceRequestInput {
  residentId: string;
  societyId: string;
  areaId: string | null;
  offeringId: string;
  scheduledFor: string;
  vehicleType?: string;
  vehicleNumber?: string;
  estimatedHours?: number;
  address?: string;
  notes?: string;
}

export class ServiceRequestService {
  constructor(
    private readonly store: DataStore,
    private readonly notifications: NotificationService,
  ) {}

  async offerings(kind?: ServiceKind): Promise<ServiceOffering[]> {
    const all = await this.store.offerings.find((o) => o.isActive && (!kind || o.kind === kind));
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  // What this booking would cost, before anybody commits to it.
  async quote(offeringId: string, input: { estimatedHours?: number }) {
    const offering = await this.store.offerings.get(offeringId);
    if (!offering) throw new OfferingNotFoundError();
    const hours = offering.pricingBasis === "per_hour" ? roundToHalfHour(input.estimatedHours ?? 0) : null;
    return {
      offeringId: offering.id,
      offeringName: offering.name,
      kind: offering.kind,
      kindLabel: SERVICE_KIND_LABELS[offering.kind],
      pricingBasis: offering.pricingBasis,
      unitPricePaise: offering.unitPricePaise,
      hours,
      quotedPaise: quotePaise(offering, { hours: input.estimatedHours }),
      vehicleTypes: offering.vehicleTypes,
      minimumHours: offering.minimumHours,
    };
  }

  async create(input: ServiceRequestInput): Promise<ServiceRequest> {
    const offering = await this.store.offerings.get(input.offeringId);
    if (!offering) throw new OfferingNotFoundError();
    if (!offering.isActive) throw new OfferingInactiveError(offering.name);

    // A wash has to say what it is washing; an hour has to say how many.
    if (offering.kind === "vehicle_wash") {
      const type = input.vehicleType?.trim();
      if (!type || !offering.vehicleTypes.includes(type)) throw new VehicleDetailsRequiredError(offering.vehicleTypes);
    }
    if (offering.pricingBasis === "per_hour") {
      const hours = input.estimatedHours ?? 0;
      if (hours <= 0 || (offering.minimumHours !== null && hours < offering.minimumHours)) {
        throw new HoursRequiredError(offering.minimumHours);
      }
    }

    const now = new Date().toISOString();
    const request: ServiceRequest = {
      id: randomUUID(),
      residentId: input.residentId,
      societyId: input.societyId,
      areaId: input.areaId,
      kind: offering.kind,
      offeringId: offering.id,
      // Snapshotted, so renaming or repricing the offering later never rewrites what
      // this resident was told they were buying.
      offeringName: offering.name,
      vehicleType: input.vehicleType?.trim() ?? null,
      vehicleNumber: input.vehicleNumber?.trim() ?? null,
      estimatedHours: offering.pricingBasis === "per_hour" ? roundToHalfHour(input.estimatedHours ?? 0) : null,
      actualHours: null,
      scheduledFor: input.scheduledFor,
      address: input.address?.trim() ?? null,
      status: "requested",
      assignedToUserId: null,
      quotedPaise: quotePaise(offering, { hours: input.estimatedHours }),
      finalPaise: null,
      chargeStatus: "none",
      notes: input.notes?.trim() ?? null,
      timeline: [{ status: "requested", at: now, actorUserId: null, note: null }],
      createdAt: now,
      startedAt: null,
      completedAt: null,
      cancelledReason: null,
    };
    await this.store.serviceRequests.put(request);

    await this.notifications.notifyRoleInArea(request.areaId, "supervisor", {
      type: "service.requested", orderId: null,
      title: `${SERVICE_KIND_LABELS[offering.kind]} requested`,
      body: `${offering.name} booked for ${new Date(request.scheduledFor).toDateString()}.`,
    });
    return request;
  }

  async listForResident(residentId: string): Promise<ServiceRequest[]> {
    const requests = await this.store.serviceRequests.find((r) => r.residentId === residentId);
    return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listForScope(filter: { societyIds: Set<string>; status?: ServiceRequestStatus; kind?: ServiceKind; assignedToUserId?: string }) {
    let requests = await this.store.serviceRequests.find((r) => filter.societyIds.has(r.societyId));
    if (filter.status) requests = requests.filter((r) => r.status === filter.status);
    if (filter.kind) requests = requests.filter((r) => r.kind === filter.kind);
    if (filter.assignedToUserId) requests = requests.filter((r) => r.assignedToUserId === filter.assignedToUserId);
    // Soonest first: this is a work list.
    return requests.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  private async moveTo(
    id: string,
    status: ServiceRequestStatus,
    actor: { userId: string | null },
    patch: Partial<ServiceRequest> = {},
    note?: string,
  ): Promise<ServiceRequest> {
    const request = await this.store.serviceRequests.get(id);
    if (!request) throw new RequestNotFoundError();
    if (!canTransitionRequest(request.status, status)) throw new ServiceTransitionError(request.status, status);
    Object.assign(request, patch);
    request.status = status;
    request.timeline = [...request.timeline, { status, at: new Date().toISOString(), actorUserId: actor.userId, note: note ?? null }];
    await this.store.serviceRequests.put(request);
    return request;
  }

  async assign(id: string, staffUserId: string, actor: { userId: string }): Promise<ServiceRequest> {
    const request = await this.moveTo(id, "assigned", actor, { assignedToUserId: staffUserId }, "Assigned");
    await this.notifications.notifyUser(staffUserId, {
      type: "service.assigned", orderId: null,
      title: `${SERVICE_KIND_LABELS[request.kind]} assigned to you`,
      body: `${request.offeringName} on ${new Date(request.scheduledFor).toDateString()}.`,
    });
    await this.notifications.notifyResident(request.residentId, {
      type: "service.assigned", orderId: null,
      title: "Somebody is coming",
      body: `${request.offeringName} has been assigned and is scheduled for ${new Date(request.scheduledFor).toDateString()}.`,
    });
    return request;
  }

  async start(id: string, actor: { userId: string }): Promise<ServiceRequest> {
    return this.moveTo(id, "in_progress", actor, { startedAt: new Date().toISOString() }, "Work started");
  }

  // The price follows the time the work actually took, not the time it was expected
  // to take. Both are kept so the difference can be seen rather than argued about.
  async complete(id: string, actor: { userId: string }, input: { actualHours?: number; note?: string }): Promise<ServiceRequest> {
    const existing = await this.store.serviceRequests.get(id);
    if (!existing) throw new RequestNotFoundError();
    const offering = await this.store.offerings.get(existing.offeringId);

    const actualHours = offering?.pricingBasis === "per_hour"
      ? roundToHalfHour(input.actualHours ?? existing.estimatedHours ?? 0)
      : null;
    const finalPaise = offering
      ? quotePaise(offering, { hours: actualHours ?? undefined })
      : existing.quotedPaise;

    const request = await this.moveTo(id, "completed", actor, {
      actualHours,
      finalPaise,
      chargeStatus: finalPaise > 0 ? "pending" : "none",
      completedAt: new Date().toISOString(),
    }, input.note ?? "Completed");

    await this.notifications.notifyResident(request.residentId, {
      type: "service.completed", orderId: null,
      title: `${request.offeringName} done`,
      body: actualHours !== null
        ? `Finished after ${actualHours} hour${actualHours === 1 ? "" : "s"}.`
        : "The work has been completed.",
    });
    return request;
  }

  async cancel(id: string, actor: { userId: string | null }, reason: string): Promise<ServiceRequest> {
    return this.moveTo(id, "cancelled", actor, { cancelledReason: reason }, reason);
  }

  // How a request reads to whoever is looking at it.
  describe(request: ServiceRequest) {
    return {
      ...request,
      kindLabel: SERVICE_KIND_LABELS[request.kind],
      statusLabel: SERVICE_STATUS_LABELS[request.status],
      // What it will cost, which is the final figure once there is one.
      payablePaise: request.finalPaise ?? request.quotedPaise,
    };
  }

  // The supervisor and admin view of how these services are going.
  async summary(societyIds: Set<string> | null) {
    const all = await this.store.serviceRequests.all();
    const scoped = societyIds ? all.filter((r) => societyIds.has(r.societyId)) : all;
    const count = (status: ServiceRequestStatus) => scoped.filter((r) => r.status === status).length;
    return {
      total: scoped.length,
      requested: count("requested"),
      assigned: count("assigned"),
      inProgress: count("in_progress"),
      completed: count("completed"),
      cancelled: count("cancelled"),
      byKind: (["vehicle_wash", "home_ironing"] as ServiceKind[]).map((kind) => ({
        kind,
        label: SERVICE_KIND_LABELS[kind],
        total: scoped.filter((r) => r.kind === kind).length,
        open: scoped.filter((r) => r.kind === kind && r.status !== "completed" && r.status !== "cancelled").length,
      })),
      revenuePaise: scoped
        .filter((r) => r.chargeStatus === "paid")
        .reduce((sum, r) => sum + (r.finalPaise ?? 0), 0),
      pendingPaise: scoped
        .filter((r) => r.chargeStatus === "pending")
        .reduce((sum, r) => sum + (r.finalPaise ?? 0), 0),
    };
  }
}
