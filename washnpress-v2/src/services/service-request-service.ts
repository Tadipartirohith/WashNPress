import { randomUUID } from "node:crypto";
import type { ServiceOffering, ServiceRequest } from "../domain/models";
import {
  canTransitionRequest, quotePaise, roundToHalfHour, ServiceTransitionError,
  SERVICE_STATUS_LABELS, SERVICE_KIND_LABELS, slotRefusal, SlotUnavailableError,
  type ServiceKind, type ServiceRequestStatus,
} from "../domain/service-requests";
import {
  clashingCommitments, serviceSpan, slotSpan, OperatorBusyError,
  type Commitment,
} from "../domain/operator-workload";
import {
  assertValidService, checkQuantity, checkBookingRules, checkCancellation, checkRescheduling, continuousStarts,
  quoteService, SERVICE_CATEGORY_LABELS, extendedServiceProblems, serviceOnOffer,
  InvalidOfferingError,
  type ServiceCategory, type CustomerEligibility,
} from "../domain/service-catalogue";
import type { MeasurementUnit } from "../domain/measurement";
import type { DataStore } from "../ports/repositories";
import type { NotificationService } from "./notification-service";

// Booking, assigning and completing the services that are not laundry.
//
// The price is quoted before the resident confirms and is never taken from them.
// For an hourly service the quote is what the booking was expected to cost and the
// final figure is what the work actually took, kept separately so the difference can
// be seen rather than discovered on a bill.

// What a service is measured in. An offering written before units existed says so
// through its pricing basis, which is the only thing it had.
function unitOfOffering(offering: ServiceOffering): MeasurementUnit {
  if (offering.unit) return offering.unit;
  return offering.pricingBasis === "per_hour" ? "hour" : "job";
}

// The wizard's configuration, kept apart from the fields an offering always had, so
// creating one does not have to list every optional property by hand.
function configurationOf(input: Partial<ServiceOffering>) {
  return {
    category: input.category ?? ("other" as const),
    icon: input.icon ?? null,
    unit: input.unit,
    minimumQuantity: input.minimumQuantity ?? null,
    maximumQuantity: input.maximumQuantity ?? null,
    quantityIncrement: input.quantityIncrement ?? null,
    subscriberUnitPricePaise: input.subscriberUnitPricePaise ?? null,
    planRules: input.planRules ?? [],
    frequency: input.frequency ?? null,
    frequencyDays: input.frequencyDays ?? [],
    eligibility: input.eligibility ?? ("both" as const),
    eligiblePlanIds: input.eligiblePlanIds ?? [],
    availabilityScope: input.availabilityScope ?? ("all_societies" as const),
    societyIds: input.societyIds ?? [],
    mode: input.mode ?? ("at_society" as const),
    operatingDays: input.operatingDays ?? [],
    timeSlots: input.timeSlots ?? [],
    bookingRules: input.bookingRules,
    additionalCharges: input.additionalCharges ?? [],
    // The rest of the configuration. A section left out stays undefined rather
    // than being given an empty value, so "not configured" and "configured as
    // nothing" stay different answers.
    status: input.status,
    options: input.options ?? [],
    addOns: input.addOns ?? [],
    availabilityWindow: input.availabilityWindow,
    capacity: input.capacity,
    recurrence: input.recurrence,
    operations: input.operations,
    notifyOn: input.notifyOn,
    cancellationRules: input.cancellationRules,
    reschedulingRules: input.reschedulingRules,
  };
}

export class OfferingNotFoundError extends Error {
  constructor() { super("No such service."); this.name = "OfferingNotFoundError"; }
}
// Two services may not share a name. The name is how an admin, and everyone reading a
// booking, tells one service from another, so a duplicate is not a naming preference
// but a genuine ambiguity.
export class OfferingNameTakenError extends Error {
  constructor() {
    super("Service name already exists. Please enter a different service name.");
    this.name = "OfferingNameTakenError";
  }
}
export class OfferingInactiveError extends Error {
  constructor(name: string, reason?: string) {
    // Why it cannot be booked, where that is known. "Not currently offered" and
    // "starts on the fourteenth" are different things for the person asking.
    super(reason ? `${name}: ${reason}` : `${name} is not currently offered.`);
    this.name = "OfferingInactiveError";
  }
}
// The service's own rules refuse this booking: the wrong quantity, too little
// notice, a day it is not done on, or something the resident's plan does not allow.
// Distinct from the service being inactive, because the resident can fix it by
// asking for something different.
export class ServiceRuleError extends Error {
  constructor(message: string) { super(message); this.name = "ServiceRuleError"; }
}

export class RequestNotFoundError extends Error {
  constructor() { super("No such service request."); this.name = "RequestNotFoundError"; }
}
// Two operators both looking at the same job in the queue; the second to press Take
// this job is told it is already somebody else's rather than quietly overwriting the
// first. A supervisor moving a job hands it over deliberately and does not take this
// path.
export class AlreadyAssignedError extends Error {
  constructor(readonly assignedToName: string | null) {
    super(`This job has already been assigned to ${assignedToName ?? "another operator"}.`);
    this.name = "AlreadyAssignedError";
  }
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
  offeringId: string;
  scheduledFor: string;
  vehicleType?: string;
  vehicleNumber?: string;
  estimatedHours?: number;
  // For a service measured in something other than hours: how many vehicles, rooms
  // or square feet. One job where the service does not say.
  quantity?: number;
  address?: string;
  notes?: string;
}

export class ServiceRequestService {
  constructor(
    private readonly store: DataStore,
    private readonly notifications: NotificationService,
  ) {}

  // ----------------------------------------------------- managing the catalogue

  // Everything an admin sees on the Services page: the list, narrowed by whatever
  // they are looking for. Search and filters are answered here rather than by the
  // client filtering a full download, so the same rules apply to the export.
  async listOfferings(filter: {
    q?: string;
    category?: ServiceCategory;
    eligibility?: CustomerEligibility;
    status?: "active" | "inactive";
    unit?: MeasurementUnit;
  } = {}): Promise<ServiceOffering[]> {
    const all = await this.store.offerings.all();
    const needle = (filter.q ?? "").trim().toLowerCase();
    const matched = all.filter((offering) => {
      if (filter.category && (offering.category ?? "other") !== filter.category) return false;
      if (filter.eligibility && (offering.eligibility ?? "both") !== filter.eligibility) return false;
      if (filter.status && (offering.status ?? (offering.isActive ? "active" : "inactive")) !== filter.status) return false;
      if (filter.unit && unitOfOffering(offering) !== filter.unit) return false;
      if (!needle) return true;
      // Searched by name, category and unit, which is what an admin actually knows
      // about a service they are looking for.
      return [
        offering.name,
        SERVICE_CATEGORY_LABELS[offering.category ?? "other"],
        unitOfOffering(offering),
      ].some((field) => String(field ?? "").toLowerCase().includes(needle));
    });
    matched.sort((a, b) => a.name.localeCompare(b.name));
    return matched;
  }

  // One row of the services list, said in the terms the page shows.
  describeOffering(offering: ServiceOffering) {
    return {
      id: offering.id,
      name: offering.name,
      category: offering.category ?? "other",
      categoryLabel: SERVICE_CATEGORY_LABELS[offering.category ?? "other"],
      unit: unitOfOffering(offering),
      // What each side pays. A service included in a plan has no subscriber price of
      // its own, and says so rather than showing a number that is not charged.
      nonSubscriberPricePaise: offering.unitPricePaise,
      subscriberPricePaise: offering.subscriberUnitPricePaise ?? null,
      includedInPlans: (offering.planRules ?? []).filter((r) => r.mode === "included").map((r) => r.planName),
      eligibility: offering.eligibility ?? "both",
      availability: offering.availabilityScope ?? "all_societies",
      mode: offering.mode ?? "at_society",
      isActive: offering.isActive,
      status: offering.status ?? (offering.isActive ? "active" : "inactive"),
    };
  }

  // Whether a service name is already taken, compared on its normalised form —
  // trimmed and folded to lower case — so "Car Wash", "car wash" and " Car Wash " are
  // recognised as the same name. A service keeps its own name on edit, so it is
  // excluded by id.
  async offeringNameTaken(name: string, exceptId?: string): Promise<boolean> {
    const wanted = (name ?? "").trim().toLowerCase();
    if (!wanted) return false;
    const clash = await this.store.offerings.find(
      (o) => o.id !== exceptId && (o.name ?? "").trim().toLowerCase() === wanted);
    return clash.length > 0;
  }

  async createOffering(input: Partial<ServiceOffering> & { name: string }): Promise<ServiceOffering> {
    // Everything wrong with it, said at once. A twelve step wizard that reveals the
    // next problem only after the last is fixed is a wizard somebody abandons.
    assertValidService(input as never);
    const extended = extendedServiceProblems(input);
    if (extended.length) throw new InvalidOfferingError(extended);
    // Checked at the moment of creation, not only in the form, because two admins can
    // reach Create at the same time with the same name in front of each of them.
    if (await this.offeringNameTaken(input.name)) throw new OfferingNameTakenError();
    const offering: ServiceOffering = {
      id: randomUUID(),
      kind: input.kind ?? "vehicle_wash",
      name: input.name,
      description: input.description ?? null,
      pricingBasis: input.pricingBasis ?? (input.unit === "hour" ? "per_hour" : "per_job"),
      unitPricePaise: input.unitPricePaise ?? 0,
      vehicleTypes: input.vehicleTypes ?? [],
      minimumHours: input.minimumHours ?? null,
      // A new service starts as a draft unless it is explicitly published, and
      // isActive is kept in step with the status so a client written against the
      // boolean is never told a half-configured service is on offer.
      isActive: (input.status ?? "draft") === "active",
      ...configurationOf(input),
      status: input.status ?? "draft",
    };
    return this.store.offerings.put(offering);
  }

  async updateOffering(id: string, patch: Partial<ServiceOffering>): Promise<{
    previous: ServiceOffering; current: ServiceOffering; openBookings: number;
  } | null> {
    const previous = await this.store.offerings.get(id);
    if (!previous) return null;
    const current: ServiceOffering = { ...previous, ...patch, id };
    // Whichever of the two was changed carries the other with it, so they cannot
    // drift into saying different things about the same service.
    if (patch.status !== undefined) current.isActive = patch.status === "active";
    else if (patch.isActive !== undefined) current.status = patch.isActive ? "active" : "inactive";
    // An edited service is held to the same rules as a new one.
    assertValidService(current as never);
    const extended = extendedServiceProblems(current);
    if (extended.length) throw new InvalidOfferingError(extended);
    if (patch.name !== undefined && await this.offeringNameTaken(current.name, id)) {
      throw new OfferingNameTakenError();
    }
    await this.store.offerings.put(current);
    // Bookings already made are untouched by a change to the service, but the admin
    // is told how many there are rather than changing it without knowing.
    const openBookings = (await this.store.serviceRequests.find(
      (r) => r.offeringId === id && !["completed", "cancelled"].includes(r.status),
    )).length;
    return { previous, current, openBookings };
  }

  // Copying an existing service is how most new ones actually get made.
  async duplicateOffering(id: string, name?: string): Promise<ServiceOffering | null> {
    const source = await this.store.offerings.get(id);
    if (!source) return null;
    return this.store.offerings.put({
      ...source,
      id: randomUUID(),
      name: name ?? `${source.name} (copy)`,
      // A copy starts as a draft, so duplicating one never quietly puts a
      // half-configured service in front of residents.
      isActive: false,
      status: "draft" as const,
    });
  }

  // The bookings against one service, which is what "View bookings" shows and what
  // makes deactivating rather than deleting the right thing to do.
  async offeringBookings(id: string): Promise<ServiceRequest[]> {
    const requests = await this.store.serviceRequests.find((r) => r.offeringId === id);
    requests.sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1));
    return requests;
  }

  // A service booking as everybody above the operator needs to read it.
  //
  // A booking used to disappear into the operator's queue: an admin could see
  // which services existed and a supervisor could see nothing at all, so "who
  // booked this and who is handling it" had no answer anywhere in the platform.
  // This is the whole of it — who booked, where they live, what they booked, who
  // took it, and every status it has passed through with the person responsible
  // for each.
  async describeForStaff(requests: ServiceRequest[]) {
    const residents = new Map((await this.store.residents.all()).map((r) => [r.id, r]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const blocks = new Map((await this.store.blocks.all()).map((b) => [b.id, b]));

    return requests.map((request) => {
      const resident = residents.get(request.residentId) ?? null;
      const residentUser = resident ? users.get(resident.userId) ?? null : null;
      const assignee = request.assignedToUserId ? users.get(request.assignedToUserId) ?? null : null;
      // Everyone who has ever held it, in order, so a reassignment does not erase
      // the operator who had it before.
      const assignments = request.timeline
        .filter((entry) => entry.status === "assigned")
        .map((entry) => ({
          at: entry.at,
          byUserId: entry.actorUserId,
          byName: entry.actorUserId ? users.get(entry.actorUserId)?.fullName ?? null : null,
          note: entry.note ?? null,
        }));
      const acceptedAt = request.timeline.find((entry) => entry.status === "assigned")?.at ?? null;

      return {
        ...this.describe(request),
        residentName: residentUser?.fullName ?? null,
        residentPhone: residentUser?.phone ?? null,
        unitNumber: resident?.unitNumber ?? null,
        blockName: resident?.blockId ? blocks.get(resident.blockId)?.name ?? null : resident?.towerBlock ?? null,
        societyName: societies.get(request.societyId)?.name ?? null,
        // Who answers for the society this booking is in.
        //
        // An admin looking at a booking that has gone wrong needs a person to ask,
        // and the chain that leads to one runs through the society rather than
        // through the operator: the operator may have been reassigned twice, and an
        // unassigned booking has none at all. A society between supervisors says so
        // rather than reading as a booking nobody owns.
        supervisorName: (() => {
          const supervisorId = societies.get(request.societyId)?.supervisorUserId ?? null;
          return supervisorId ? users.get(supervisorId)?.fullName ?? null : null;
        })(),
        assignedToName: assignee?.fullName ?? null,
        acceptedAt,
        assignments,
        // Named rather than left as ids, because a history nobody can read is a
        // history nobody checks.
        history: request.timeline.map((entry) => ({
          status: entry.status,
          statusLabel: SERVICE_STATUS_LABELS[entry.status],
          at: entry.at,
          actorUserId: entry.actorUserId,
          actorName: entry.actorUserId ? users.get(entry.actorUserId)?.fullName ?? null : null,
          note: entry.note ?? null,
        })),
      };
    });
  }

  // Every booking a staff member is allowed to see, newest first.
  //
  // `societyIds` of null means the whole platform, which is the admin; a set is a
  // supervisor's own society.
  async listForStaff(societyIds: Set<string> | null, filters: {
    status?: string; offeringId?: string; operatorUserId?: string; societyId?: string;
    from?: string; to?: string;
  } = {}) {
    let requests = await this.store.serviceRequests.all();
    if (societyIds) requests = requests.filter((r) => societyIds.has(r.societyId));
    if (filters.societyId) requests = requests.filter((r) => r.societyId === filters.societyId);
    if (filters.status) requests = requests.filter((r) => r.status === filters.status);
    if (filters.offeringId) requests = requests.filter((r) => r.offeringId === filters.offeringId);
    // "unassigned" is a state worth being able to ask for, and the one that most
    // needs somebody to act: those bookings are invisible under every named
    // operator and easy to lose in a long list.
    if (filters.operatorUserId === "unassigned") requests = requests.filter((r) => !r.assignedToUserId);
    else if (filters.operatorUserId) requests = requests.filter((r) => r.assignedToUserId === filters.operatorUserId);
    if (filters.from) requests = requests.filter((r) => r.scheduledFor >= filters.from!);
    if (filters.to) requests = requests.filter((r) => r.scheduledFor <= `${filters.to!}T23:59:59.999Z`);
    requests.sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1));
    return this.describeForStaff(requests);
  }

  async offerings(kind?: ServiceKind): Promise<ServiceOffering[]> {
    // Drafts, suspended services and ones outside their availability window are
    // not on offer, whatever their isActive flag says.
    const all = (await this.store.offerings.find((o) => !kind || o.kind === kind))
      .filter((o) => serviceOnOffer(o).ok);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  // What this booking would cost, before anybody commits to it.
  //
  // The configuration the service wizard sets is applied here: the quantity the
  // service accepts, what the resident's own plan does about it, and the extras that
  // apply to this particular booking. A resident is told all of it before confirming
  // rather than seeing it on a bill.
  async quote(offeringId: string, input: {
    estimatedHours?: number;
    quantity?: number;
    residentId?: string;
    date?: string | null;
    atHome?: boolean;
    emergency?: boolean;
  }) {
    const offering = await this.store.offerings.get(offeringId);
    if (!offering) throw new OfferingNotFoundError();
    const unit = offering.unit ?? (offering.pricingBasis === "per_hour" ? "hour" : "job");
    const hours = offering.pricingBasis === "per_hour" ? roundToHalfHour(input.estimatedHours ?? 0) : null;

    // How much is being asked for, in the service's own unit. An hourly service says
    // it in hours; everything else takes a quantity, and one job is the default.
    const requested = unit === "hour"
      ? (input.quantity ?? input.estimatedHours ?? 0)
      : (input.quantity ?? 1);
    const quantityCheck = checkQuantity(offering as never, requested);

    // The plan this resident is on, and how much of this service they have used.
    const subscription = input.residentId
      ? (await this.store.subscriptions.find((sub) => sub.residentId === input.residentId && sub.status === "active"))[0]
      : undefined;
    const used = subscription?.serviceUsage?.[offering.id] ?? 0;

    const priced = quoteService(offering as never, {
      quantity: quantityCheck.accepted || requested,
      planId: subscription?.planId ?? null,
      usedQuantity: used,
      date: input.date ?? null,
      atHome: input.atHome,
      emergency: input.emergency,
    });

    return {
      offeringId: offering.id,
      offeringName: offering.name,
      kind: offering.kind,
      kindLabel: SERVICE_KIND_LABELS[offering.kind],
      pricingBasis: offering.pricingBasis,
      unitPricePaise: offering.unitPricePaise,
      hours,
      // The old figure, kept under its old name so a client written against it goes
      // on working. For a service the wizard has configured it is the same number.
      quotedPaise: priced.available ? priced.totalPaise : quotePaise(offering, { hours: input.estimatedHours }),
      vehicleTypes: offering.vehicleTypes,
      minimumHours: offering.minimumHours,
      // What the figure is made of, said outright.
      unit,
      quantity: priced.quantity,
      quantityOk: quantityCheck.ok,
      quantityReason: quantityCheck.reason,
      listPaise: priced.listPaise,
      planMode: priced.planMode,
      coveredQuantity: priced.coveredQuantity,
      chargeableQuantity: priced.chargeableQuantity,
      basePaise: priced.basePaise,
      charges: priced.charges,
      chargesPaise: priced.chargesPaise,
      totalPaise: priced.totalPaise,
      available: priced.available && quantityCheck.ok,
      reason: priced.reason ?? quantityCheck.reason,
    };
  }

  // For an hourly service, the start times a booking of this many hours could
  // actually take. Two hours needs two consecutive hours free, not two free hours
  // somewhere in the day — and the resident is told which starts work rather than
  // finding out when the second hour turns out to be taken.
  async availableStarts(offeringId: string, date: string, hours: number, subscriber: boolean) {
    const offering = await this.store.offerings.get(offeringId);
    if (!offering) throw new OfferingNotFoundError();

    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const operating = offering.operatingDays ?? [];
    if (operating.length && !operating.includes(day)) return { date, hours, starts: [], windows: [] };

    // How many of each window are already taken, so capacity means what is left
    // rather than what was configured.
    const booked = await this.store.serviceRequests.find(
      (r) => r.offeringId === offeringId
        && r.scheduledFor.slice(0, 10) === date
        && !["cancelled"].includes(r.status),
    );
    const windows = (offering.timeSlots ?? [])
      .filter((slot) => (subscriber ? slot.subscriberAvailable : slot.nonSubscriberAvailable))
      .map((slot) => {
        const taken = booked.filter((r) => r.scheduledFor.slice(11, 16) === slot.startTime).length;
        return {
          startTime: slot.startTime,
          endTime: slot.endTime,
          capacityRemaining: Math.max(0, slot.capacity - taken),
        };
      });

    return { date, hours, windows, starts: continuousStarts(windows, hours) };
  }

  async create(input: ServiceRequestInput): Promise<ServiceRequest> {
    const offering = await this.store.offerings.get(input.offeringId);
    if (!offering) throw new OfferingNotFoundError();
    // Checked again at the moment of booking, not only when the list was drawn: a
    // service can be withdrawn between the two, and a screen held open overnight
    // is a screen showing yesterday's answer.
    const onOffer = serviceOnOffer(offering);
    if (!onOffer.ok) throw new OfferingInactiveError(offering.name, onOffer.reason);

    // A wash has to say what it is washing; an hour has to say how many.
    //
    // Asked of any service that actually names vehicle types rather than of anything
    // labelled a vehicle wash: a service built in the wizard carries the legacy kind
    // as a default, and a shoe cleaning service should not be asked which car it is
    // for merely because that default happened to be "vehicle_wash".
    if (offering.vehicleTypes.length > 0) {
      const type = input.vehicleType?.trim();
      if (!type || !offering.vehicleTypes.includes(type)) throw new VehicleDetailsRequiredError(offering.vehicleTypes);
    }
    if (offering.pricingBasis === "per_hour") {
      const hours = input.estimatedHours ?? 0;
      if (hours <= 0 || (offering.minimumHours !== null && hours < offering.minimumHours)) {
        throw new HoursRequiredError(offering.minimumHours);
      }
    }

    // The quantity the service will actually accept: at least the minimum, at most
    // the maximum, and on the increment. Ironing sold in whole hours does not take
    // ninety minutes, and saying so after the fact is too late.
    const unit = offering.unit ?? (offering.pricingBasis === "per_hour" ? "hour" : "job");
    const requested = unit === "hour" ? (input.estimatedHours ?? 0) : (input.quantity ?? 1);
    const quantityCheck = checkQuantity(offering as never, requested);
    if (!quantityCheck.ok) throw new ServiceRuleError(quantityCheck.reason ?? "That quantity cannot be booked.");

    // When it may be booked: far enough ahead, not too far ahead, on a day the
    // service operates, and within any per-person limit.
    const existing = (await this.store.serviceRequests.find(
      (r) => r.residentId === input.residentId && r.offeringId === offering.id
        && !["completed", "cancelled"].includes(r.status),
    )).length;
    const ruleCheck = checkBookingRules(offering as never, {
      scheduledFor: input.scheduledFor,
      existingBookings: existing,
    });
    if (!ruleCheck.ok) throw new ServiceRuleError(ruleCheck.reason ?? "That booking is not allowed.");

    // And what the plan says about it, which can refuse it outright.
    const quoted = await this.quote(offering.id, {
      estimatedHours: input.estimatedHours,
      quantity: input.quantity,
      residentId: input.residentId,
      date: input.scheduledFor.slice(0, 10),
      atHome: offering.mode === "at_home" || offering.mode === "at_home_and_pickup",
    });
    if (!quoted.available) throw new ServiceRuleError(quoted.reason ?? "That service is not available to you.");

    // The window, and whether there is still room in it.
    //
    // Everything above this line is a fact about the request. This is a fact about
    // everybody else's, so it is checked here, immediately before the write, rather
    // than trusted from the screen that drew the slot as available. Counting
    // matches `availableStarts` exactly — a cancelled booking is not holding a
    // space — or the number a resident is shown and the number they are held to
    // would drift apart.
    const startTime = input.scheduledFor.slice(11, 16);
    const day = input.scheduledFor.slice(0, 10);
    const windows = offering.timeSlots ?? [];

    return this.oneBookingAtATime(`${offering.id}|${day}|${startTime}`, async () => {
      const taken = (await this.store.serviceRequests.find(
        (r) => r.offeringId === offering.id
          && r.scheduledFor.slice(0, 10) === day
          && r.scheduledFor.slice(11, 16) === startTime
          && r.status !== "cancelled",
      )).length;
      const refusal = slotRefusal(windows, startTime, taken);
      if (refusal) throw new SlotUnavailableError(refusal);

      return this.write(input, offering);
    });
  }

  // One booking at a time for any one window.
  //
  // The count above and the write below are separated by an await, so without this
  // two residents confirming the last space both read "one left" and both wrote.
  // Serialising per window rather than globally keeps every other booking parallel.
  //
  // This holds within one process, which is what the platform runs as. Behind more
  // than one instance the count would need to be settled by the database — the same
  // problem laundry slots solve with an atomic capacity column, which service
  // windows do not have because they are a timetable on the offering rather than a
  // row per date.
  private readonly slotGate = new Map<string, Promise<unknown>>();

  private async oneBookingAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.slotGate.get(key) ?? Promise.resolve();
    // A booking that was refused must not refuse the next one behind it.
    const mine = previous.then(work, work);
    const guard = mine.catch(() => undefined);
    this.slotGate.set(key, guard);
    try {
      return await mine;
    } finally {
      // The last one out turns the light off, so this holds the windows being
      // booked rather than every window ever booked.
      if (this.slotGate.get(key) === guard) this.slotGate.delete(key);
    }
  }

  private async write(input: ServiceRequestInput, offering: ServiceOffering): Promise<ServiceRequest> {
    const now = new Date().toISOString();
    const request: ServiceRequest = {
      id: randomUUID(),
      residentId: input.residentId,
      societyId: input.societyId,
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

    await this.notifications.notifyRoleInSociety(request.societyId, "supervisor", {
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

  // Everything an operator is already committed to on the day of a given moment.
  //
  // Both kinds of work, because an operator does both out of the same day: the
  // services they hold, and the collections they hold, which reach their time
  // through the pickup's slot rather than carrying it themselves.
  async commitmentsFor(staffUserId: string, onIso: string, ignoreRequestId?: string): Promise<Commitment[]> {
    const day = onIso.slice(0, 10);
    const offerings = new Map((await this.store.offerings.all()).map((o) => [o.id, o]));

    const services = (await this.store.serviceRequests.find(
      (r) => r.assignedToUserId === staffUserId
        && r.id !== ignoreRequestId
        && !["completed", "cancelled"].includes(r.status)
        && r.scheduledFor.slice(0, 10) === day,
    )).map((r) => {
      const window = (offerings.get(r.offeringId)?.timeSlots ?? [])
        .find((slot) => slot.startTime === r.scheduledFor.slice(11, 16)) ?? null;
      return {
        kind: "service" as const,
        label: r.offeringName,
        reference: r.id,
        ...serviceSpan(r.scheduledFor, { estimatedHours: r.estimatedHours, window }),
      };
    });

    // A collection is held as an order assigned to the operator; the hours it takes
    // are the pickup slot's.
    const orders = await this.store.orders.find(
      (o) => o.assignedOperatorUserId === staffUserId
        && !["delivered", "cancelled"].includes(o.state),
    );
    const pickups = new Map((await this.store.pickups.all()).map((p) => [p.id, p]));
    const slots = new Map((await this.store.slots.all()).map((sl) => [sl.id, sl]));
    const laundry: Commitment[] = [];
    for (const order of orders) {
      const pickup = order.pickupId ? pickups.get(order.pickupId) ?? null : null;
      const slot = pickup?.slotId ? slots.get(pickup.slotId) ?? null : null;
      if (!slot || slot.date !== day) continue;
      laundry.push({
        kind: "laundry",
        label: `a collection in the ${slot.window.toLowerCase()} window`,
        reference: order.id,
        ...slotSpan(slot.date, slot.startTime, slot.endTime),
      });
    }

    return [...services, ...laundry];
  }

  async assign(id: string, staffUserId: string, actor: { userId: string }): Promise<ServiceRequest> {
    // Not blindly, if the operator is already somewhere else.
    //
    // The alternative is a booking that looks handled and is not: the resident is
    // told somebody is coming, the operator is at another address, and nobody finds
    // out until the hour passes. Refusing leaves it in the queue with a reason,
    // which is where a supervisor can act on it — give it to somebody else, or move
    // the booking.
    const existing = await this.store.serviceRequests.get(id);
    if (existing) {
      // Already somebody else's. Two operators can be looking at the same job in the
      // queue; the check is made here, at the moment Take this job is pressed, not
      // when the queue was drawn, so the second one is turned away rather than
      // silently taking it from the first.
      if (existing.status === "assigned" && existing.assignedToUserId && existing.assignedToUserId !== staffUserId) {
        const held = await this.store.users.get(existing.assignedToUserId);
        throw new AlreadyAssignedError(held?.fullName ?? null);
      }
      const offering = await this.store.offerings.get(existing.offeringId);
      const window = (offering?.timeSlots ?? [])
        .find((slot) => slot.startTime === existing.scheduledFor.slice(11, 16)) ?? null;
      const span = serviceSpan(existing.scheduledFor, { estimatedHours: existing.estimatedHours, window });
      const clashes = clashingCommitments(span, await this.commitmentsFor(staffUserId, existing.scheduledFor, id));
      if (clashes.length) throw new OperatorBusyError(clashes);
    }

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
    // The service's own deadline decides whether a cancellation is still accepted.
    // A service that says it cannot be cancelled within an hour of starting means it,
    // and saying so at the moment somebody tries is the only useful time to say it.
    const toCancel = await this.store.serviceRequests.get(id);
    if (toCancel) {
      const offering = await this.store.offerings.get(toCancel.offeringId);
      if (offering) {
        const allowed = checkCancellation(offering as never, { scheduledFor: toCancel.scheduledFor });
        if (!allowed.ok) throw new ServiceRuleError(allowed.reason ?? "This cannot be cancelled now.");
      }
    }
    return this.moveTo(id, "cancelled", actor, { cancelledReason: reason }, reason);
  }

  // Moving a booking to another time.
  //
  // Not a cancellation followed by a booking: that loses the history, gives up the
  // place in the queue, and would be refused outright by a service that does not
  // allow cancelling. It is the same booking at a different hour, so the timeline
  // keeps every move — where it was, where it went, and who moved it — which is what
  // the round means by the history not being deleted when the booking is changed.
  //
  // The new time is held to the same capacity check as a new booking, because a
  // window that is full is full whether somebody is arriving in it or moving into
  // it. The old place is given back only if the new one is taken, which is why the
  // check happens before anything is written.
  async reschedule(
    id: string,
    actor: { userId: string | null },
    scheduledFor: string,
  ): Promise<ServiceRequest> {
    const request = await this.store.serviceRequests.get(id);
    if (!request) throw new RequestNotFoundError();
    if (["completed", "cancelled"].includes(request.status)) {
      throw new ServiceRuleError("This booking has finished and cannot be moved.");
    }
    const offering = await this.store.offerings.get(request.offeringId);
    if (!offering) throw new OfferingNotFoundError();

    const movesSoFar = request.timeline.filter((entry) => entry.note?.startsWith("Moved from ")).length;
    const allowed = checkRescheduling(offering as never, {
      scheduledFor: request.scheduledFor,
      timesAlreadyMoved: movesSoFar,
    });
    if (!allowed.ok) throw new ServiceRuleError(allowed.reason ?? "This cannot be moved now.");

    // Where it is going has to be a real window with room in it, and it has to obey
    // the service's own rules about how far ahead it may be booked.
    const ruleCheck = checkBookingRules(offering as never, { scheduledFor, existingBookings: 0 });
    if (!ruleCheck.ok) throw new ServiceRuleError(ruleCheck.reason ?? "That time cannot be booked.");

    const day = scheduledFor.slice(0, 10);
    const startTime = scheduledFor.slice(11, 16);
    const was = request.scheduledFor;

    return this.oneBookingAtATime(`${offering.id}|${day}|${startTime}`, async () => {
      const taken = (await this.store.serviceRequests.find(
        (r) => r.offeringId === offering.id
          && r.id !== request.id
          && r.scheduledFor.slice(0, 10) === day
          && r.scheduledFor.slice(11, 16) === startTime
          && r.status !== "cancelled",
      )).length;
      const refusal = slotRefusal(offering.timeSlots ?? [], startTime, taken);
      if (refusal) throw new SlotUnavailableError(refusal);

      const moved = await this.store.serviceRequests.get(id);
      if (!moved) throw new RequestNotFoundError();
      moved.scheduledFor = scheduledFor;
      // The operator who had it may no longer be free at the new hour, and a
      // booking that has moved out from under somebody is worth re-checking rather
      // than silently keeping. It goes back to the queue, where the reason it is
      // there is the move itself.
      const assignee = moved.assignedToUserId;
      let handedBack = false;
      if (assignee) {
        const window = (offering.timeSlots ?? []).find((slot) => slot.startTime === startTime) ?? null;
        const span = serviceSpan(scheduledFor, { estimatedHours: moved.estimatedHours, window });
        const clashes = clashingCommitments(span, await this.commitmentsFor(assignee, scheduledFor, id));
        if (clashes.length) {
          moved.assignedToUserId = null;
          moved.status = "requested";
          handedBack = true;
        }
      }
      moved.timeline = [...moved.timeline, {
        status: moved.status,
        at: new Date().toISOString(),
        actorUserId: actor.userId,
        note: `Moved from ${was} to ${scheduledFor}${handedBack ? ", and returned to the queue because the operator was no longer free" : ""}`,
      }];
      await this.store.serviceRequests.put(moved);

      await this.notifications.notifyResident(moved.residentId, {
        type: "service.rescheduled", orderId: null,
        title: "Your booking has moved",
        body: `${moved.offeringName} is now ${new Date(scheduledFor).toDateString()} at ${startTime}.`,
      });
      return moved;
    });
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
