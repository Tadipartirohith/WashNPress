import type { OrderState } from "./order-state-machine";
import type { PickupFrequency } from "./recurrence";
import type { ServiceKind, ServicePricingBasis, ServiceRequestStatus } from "./service-requests";
import type { MeasurementUnit, AdditionalUsageBehaviour } from "./measurement";
import type { QcFailureReason, WorkingStep } from "./qc";
import type { QuantityDiscrepancy } from "./discrepancy";
import type {
  ServiceCategory, CustomerEligibility, ServiceMode, AvailabilityScope,
  ServicePlanRule, ServiceTimeSlot, ServiceBookingRules, ServiceAdditionalCharge,
} from "./service-catalogue";

export type Role = "resident" | "operator" | "supervisor" | "admin" | "support";

// Three states rather than a boolean, so a rejection is a decision on the record
// rather than the absence of one, and the person is told which of the two it is.
export type StaffVerificationStatus = "pending" | "approved" | "rejected";

export interface User {
  id: string; phone: string; fullName: string | null; email: string | null; employeeId: string | null;
  // on_leave keeps the account and its history intact while taking the person out
  // of the available pool, so work is reassigned rather than stranded.
  status: "active" | "on_leave" | "blocked" | "deleted"; roles: Role[]; lastLoginAt: string | null;
  // Scope. A supervisor owns exactly one area; an operator works a set of societies
  // inside one area. Residents and admins leave both empty (admin is system wide).
  areaId: string | null; societyIds: string[];
  // Whether this account has been vouched for by somebody with the authority to do
  // it. A supervisor is approved by an admin, an operator by their supervisor.
  // Signing in successfully is not the same as being allowed through the door, and
  // the two used to be the same thing: a staff account worked the moment it existed.
  verificationStatus?: StaffVerificationStatus;
  // When this account's area or society assignment last changed.
  assignmentUpdatedAt?: string | null;
  verifiedByUserId?: string | null;
  verifiedAt?: string | null;
  verificationNote?: string | null;
  // Deliberate area-wide cover for an operator, granted by an admin. Without it an
  // operator with no societies assigned can reach nothing, which is what an empty
  // assignment ought to mean.
  areaWideAccess?: boolean;
  // Which blocks of a society an operator actually works. A society is a large
  // thing — three towers and a hundred and twenty flats — and giving one operator
  // the whole of it was never how the work is really divided. An operator with
  // blocks assigned reaches those blocks and nothing else; an operator with none
  // still reaches their whole society, which is what every existing assignment
  // meant before blocks existed.
  blockIds?: string[];
  createdAt: string;
}

export interface Area {
  id: string; name: string; code: string; description: string | null; region: string | null;
  status: "active" | "inactive"; supervisorUserId: string | null; createdAt: string;
}

export interface Resident {
  id: string; userId: string; societyId: string; unitNumber: string; towerBlock: string | null;
  // The block record this resident belongs to. towerBlock is what they typed;
  // this is what it resolved to, and it is what decides who collects from them.
  blockId?: string | null;
  preferredWindows: string[]; address: string | null; pickupAddress: string | null;
  onboardingCompleted: boolean; onboardedAt: string | null;
}

export interface Society {
  id: string; name: string; code: string; areaId: string | null; address: string | null;
  city: string; state: string; status: "active" | "coming_soon" | "inactive";
  // Who runs this society. Supervision used to be recorded one level up, on the
  // area, which meant a supervisor answered for every society in it — five
  // societies and several hundred flats — and no society could say who was
  // responsible for it. It is a property of the society, and exactly one person
  // holds it at a time.
  supervisorUserId?: string | null;
  createdAt: string;
}

// A tower, wing or phase inside a society, and the flats in it.
//
// Residents have always recorded which block they live in, as free text on their
// own record, but the platform had no such thing as a block: work was assigned by
// society, so an operator given one society was given all of it. A block is the
// unit the work is actually divided by, so it is a record with an identity rather
// than a string on somebody's address.
export interface Block {
  id: string; societyId: string; name: string;
  // How many flats the block has. Operational planning, not a derived count of
  // residents: a block of forty flats with two residents signed up is still a
  // block of forty flats.
  flatCount: number;
  // The operators who cover it. More than one is normal — a morning and an
  // evening round are two people on the same block.
  operatorUserIds: string[];
  status: "active" | "inactive";
  createdAt: string;
}

export interface Unit { id: string; societyId: string; name: string; operatorUserIds: string[]; waterRecyclingEnabled: boolean; baseDrawPaise: number; revenueSharePercent: number; status: "active" | "inactive"; }

// What one service is worth inside a plan. A plan used to carry a single garment
// allowance shared by everything, which could not say "40 kg of washing and 30
// pieces of ironing" — and let ironing eat the allowance meant for washing.
export interface PlanServiceRule {
  serviceId: string;
  // Snapshotted so renaming a service later does not rewrite what a plan promised.
  serviceName: string;
  unit: MeasurementUnit;
  // What the plan includes per cycle, in that service's own unit.
  includedQuantity: number;
  // How often it may be used, and on which days where the frequency needs them.
  frequency: PickupFrequency;
  frequencyDays: number[];
  // Ceilings, where the business wants them.
  maxPerFrequency?: number | null;
  maxPerCycle?: number | null;
  // Whether what is left over survives into the next cycle.
  carryForward: boolean;
  // What happens when somebody asks for more than the plan includes.
  additionalUsage: AdditionalUsageBehaviour;
  // What the extra costs, per unit of this service. Never one rate for everything.
  additionalRatePaise: number;
}

export interface Plan {
  id: string; tier: string; turnaroundHours: number;
  // What the plan is called and what it says about itself.
  name?: string;
  description?: string | null;
  // The services this plan includes, each measured and allowanced in its own terms.
  services?: PlanServiceRule[];
  // The old single garment allowance. Kept so a plan written before per-service
  // allowances existed still reads, and so a migration can see what it was.
  garmentCap: number;
  // How many collections the plan entitles a resident to in a cycle. Configuration
  // rather than a number in the client, so an admin can change what Basic includes
  // without an application change.
  pickupsPerCycle?: number;
  monthlyPaise: number; annualDiscountPercent: number; isActive: boolean;
  // How long one cycle of the plan runs for. Monthly unless it says otherwise.
  validity?: BillingCycle;
  // Tax and discount, applied to the plan price when it is quoted. Configuration
  // rather than arithmetic in the client, so the figure an admin reviews and the
  // figure a resident is charged are worked out by the same code.
  taxPercent?: number;
  discountPercent?: number;
  // The services this plan includes at no extra charge. A garment sent for a
  // service outside this list is priced per garment even while allowance remains,
  // which is how "wash and iron included, dry cleaning extra" is expressed.
  coveredServiceIds: string[];
}
export type BillingCycle = "monthly" | "annual";

// One deduction from a plan's allowance, and which order caused it.
//
// The subscription used to carry a single running total and nothing else, so a
// resident looking at "used 30 of 80" had no way to see which collections made it
// 30, and nobody answering a query about it could either.
export interface SubscriptionUsageEntry {
  orderId: string;
  orderCode: string;
  // In garments, which is what the overall allowance is counted in.
  quantity: number;
  usedBefore: number;
  usedAfter: number;
  at: string;
  // Set when the entry gives allowance back rather than spending it.
  reversed?: boolean;
}
export interface Subscription {
  id: string; residentId: string; planId: string; status: "active" | "paused" | "cancelled" | "expired";
  cycle: BillingCycle; cycleStart: string; cycleEnd: string; garmentsUsed: number; autoRenew: boolean;
  // Collections used this cycle, counted the same way garments are.
  pickupsUsed?: number;
  // What has been used of each service this cycle, keyed by service id and measured
  // in that service's own unit. Usage of one service never reduces another's.
  serviceUsage?: Record<string, number>;
  // Every deduction this cycle, and the order that caused it. The running total
  // above is the sum of these; keeping both means the total can be explained.
  usageHistory?: SubscriptionUsageEntry[];
  // What carried over from the previous cycle, for the services that allow it.
  carriedForward?: Record<string, number>;
  // The windows this resident would rather be collected in, in order of preference.
  // A preference, not a booking: it is checked against what is actually available.
  preferredWindows?: string[];
  pendingPlanId: string | null; pauseUntil: string | null; cancelReason: string | null;
}

// A standing arrangement to be collected. Kept as its own record so a resident can
// look at it, change it or stop it — none of which was possible when a recurrence
// was a boolean on whichever pickup happened to start it.
export interface RecurringSchedule {
  id: string;
  residentId: string;
  societyId: string;
  frequency: PickupFrequency;
  // Which days of the week, for the frequencies that need them.
  days: number[];
  // The window the resident would rather be collected in.
  window: string;
  startDate: string;
  status: "active" | "paused" | "cancelled";
  // The furthest date already booked from this schedule, so generating again does
  // not double book what it has already made.
  generatedThrough: string | null;
  createdAt: string;
  cancelledAt: string | null;
}

export interface Slot {
  id: string; societyId: string; date: string; window: string;
  startTime: string; endTime: string;
  capacityTotal: number; capacityRemaining: number; isActive: boolean;
  // Reserved for residents on a plan. A non-subscriber is never shown it and cannot
  // book it, so capacity held back for subscribers is actually held back rather than
  // taken by whoever asked first.
  subscribersOnly?: boolean;
}
export interface Pickup { id: string; residentId: string; societyId: string; slotId: string; scheduledFor: string; status: "scheduled" | "rescheduled" | "cancelled" | "completed" | "failed"; recurring: boolean; recurringDays: number[]; specialInstructions: string | null; }

export interface GarmentItem { category: string; quantity: number; }

// One garment category can be split across several services within a single order,
// so a resident can send four shirts for dry cleaning and six for a normal wash.
// Each split is its own line with its own service, add-ons and price.
export interface OrderLine {
  id: string;
  category: string;
  quantity: number;
  serviceId: string;
  serviceName: string;
  addonIds: string[];
  // Priced by the backend from the service catalogue, never supplied by a client.
  serviceUnitPricePaise: number;
  addonsPaise: number;
  linePricePaise: number;
  // Snapshotted from the service at booking time, so changing the catalogue later
  // never rewrites what an order in flight was supposed to do or cost.
  requiresClean: boolean;
  cleanStage: CleanStage;
  requiresPress: boolean;
  coveredByPlan: boolean;
  // What this line was priced by, snapshotted like everything else on the line so a
  // later change to the service does not rewrite an order in flight.
  pricingBasis?: PricingBasis;
  // The unit this line is measured in, and the quantity in that unit. For a weighed
  // service `measuredQuantity` is kilograms; for a counted one it equals `quantity`.
  unit?: MeasurementUnit;
  measuredQuantity?: number | null;
  // The smallest quantity this line bills for, snapshotted with everything else so a
  // later catalogue change never reprices an order in flight.
  minimumBillable?: number | null;
  // What the operator actually weighed or counted, once they have.
  acceptedMeasuredQuantity?: number | null;
  // How this line was split against the plan: what the allowance absorbed and what
  // fell outside it, both in the line's own unit. Said per line, because a plan
  // covers services separately and one order can touch several.
  coveredQuantity?: number | null;
  additionalQuantity?: number | null;
  // The rate the part outside the allowance was billed at. This service's own
  // overage rate, never one flat rate for everything.
  additionalRatePaise?: number | null;
  // What the line would have cost with no plan, so the saving can be shown.
  listUnitPricePaise?: number | null;
  // How heavy the bag was, for a line priced by weight. Null for everything else.
  weightKg?: number | null;
  notes: string | null;
  // What the operator physically received for this Garment + Service combination.
  // `quantity` above is what the resident asked for and is never overwritten, so
  // the two can be compared and the difference explained. Null until the operator
  // has confirmed the batch at pickup.
  acceptedQuantity?: number | null;
}

// One Garment + Service combination, processed on its own. Two shirts for washing
// and two for dry cleaning are two batches: they go through different machines and
// cost different amounts, and merging them because the garment type matched is how
// a dry-clean garment ended up in a wash.
export type BatchStep = "wash" | "dry_clean" | "premium" | "iron" | "qc";
// "held" is waiting on a person rather than on a machine: a missing garment is not
// going to be produced by another wash, so the batch waits rather than pretending to
// be back in one.
export type BatchStatus = "pending" | "in_progress" | "awaiting_qc" | "qc_failed" | "held" | "completed";

export interface BatchHistoryEntry {
  step: BatchStep;
  at: string;
  actorUserId: string | null;
  note?: string | null;
}

// One failed quality check, in full: what went wrong, what was said about it, what
// was photographed, and where the work was sent back to.
export interface QcFailureRecord {
  attempt: number;
  reason: QcFailureReason;
  reasonLabel: string;
  remarks: string;
  evidenceUrl: string | null;
  correctiveStep: WorkingStep | null;
  correctiveLabel: string;
  serious: boolean;
  at: string;
  actorUserId: string | null;
}

export interface ProcessingBatch {
  id: string;
  lineId: string;
  category: string;
  serviceId: string;
  serviceName: string;
  // The confirmed quantity, not the requested one: processing works on what is
  // actually in the building.
  quantity: number;
  // What this batch has to go through, in order. Steps are sequential inside a
  // batch; batches run alongside each other.
  sequence: BatchStep[];
  completedSteps: BatchStep[];
  status: BatchStatus;
  qcPassed: boolean | null;
  qcReason: string | null;
  qcAttempts: number;
  history: BatchHistoryEntry[];
  // Every quality check that failed, kept rather than overwritten. "Failed twice" is
  // a different fact from "failed", and the second one is the one a supervisor needs.
  qcFailures?: QcFailureRecord[];
  // Where a failed batch is being held, when it is not simply being reworked. A
  // missing garment is not fixed by another wash.
  heldFor?: "supervisor" | "investigation" | null;
}
export interface TimelineEntry { state: OrderState; at: string; note?: string; actorUserId?: string | null; }

export interface Order {
  id: string; orderCode: string; pickupId: string | null; residentId: string; societyId: string;
  areaId: string | null; subscriptionId: string | null;
  // Which block of the society this order was raised in, copied from the resident
  // when it was booked. Kept on the order rather than looked up through the
  // resident every time, so an order stays in the block it was collected from
  // even if the resident later moves.
  blockId?: string | null;
  state: OrderState; qrBatchCode: string | null; items: GarmentItem[]; addonIds: string[];
  // What the resident asked for, per split. Operations processes each line to its
  // own service, and the line prices are charged on top of the subscription.
  lines: OrderLine[];
  servicesPaise: number;
  // Quantities. estimatedCount is what the resident expected at booking time,
  // acceptedCount is what the operator physically received. Everything downstream
  // (subscription usage, additional charge) is derived from acceptedCount.
  estimatedCount: number | null; pickupCount: number | null; acceptedCount: number | null;
  subscriptionCoveredCount: number | null; additionalCount: number | null;
  additionalRatePaise: number | null; additionalChargePaise: number | null;
  // True when the order was placed without an active subscription, in which case
  // every garment is priced at the pay per garment rate instead of the plan rate.
  payPerOrder: boolean;
  additionalChargeStatus: "none" | "pending" | "paid" | "failed" | "refunded";
  deliveryCount: number | null;
  // One per Garment + Service combination actually received. Created when the
  // operator confirms quantities at pickup, and processed in parallel from there.
  batches: ProcessingBatch[];
  qcPassed: boolean | null; qcReason: string | null; qcAttempts: number;
  pickupFailureReason: string | null; discrepancyReason: string | null;
  // What the resident declared when they booked, kept beside what the operator
  // actually counted. Both are real and they are not the same kind of fact: one is
  // what was expected, the other is what was verified. Overwriting the first is how a
  // resident who sent six shirts lost the record that they ever said six.
  requestedCount?: number | null;
  quantityDiscrepancy?: QuantityDiscrepancy | null;
  assignedOperatorUserId: string | null; deliveredByUserId: string | null;
  expectedCompletionAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  // What the resident was told at booking, kept so a later change can be compared
  // against it rather than quietly replacing it.
  estimatedDeliveryAt?: string | null;
  // What was agreed, kept beside what happened. An early collection preserves the
  // original scheduled time rather than overwriting it, so the two can be compared.
  scheduledPickupAt?: string | null;
  earlyPickup?: boolean;
  earlyPickupReason?: string | null;
  // What was attempted against this order's charge, and what came of it. A charge
  // that fails posts nothing to the ledger, so without this the only record of a
  // failed attempt was a status field that the next attempt overwrote.
  paymentEvents?: OrderPaymentEvent[];
  // Who has held this order, and when it changed hands. The current holder is a
  // single field, which cannot answer "who had it yesterday".
  assignmentHistory?: OrderAssignmentEntry[];
  rating: number | null; ratingComment: string | null; timeline: TimelineEntry[]; createdAt: string;
}

// One attempt to settle what an order owes.
export interface OrderPaymentEvent {
  at: string;
  // What the charge was for: the additional garments on this order, or a later
  // attempt by the resident to clear what was left outstanding.
  kind: "charge" | "retry";
  amountPaise: number;
  status: "paid" | "pending" | "failed";
  // Why it did not go through, where that is known.
  note?: string | null;
  // The ledger reference, so the money can be found from here.
  reference?: string | null;
}

export interface OrderAssignmentEntry {
  at: string;
  fromUserId: string | null;
  toUserId: string | null;
  byUserId: string | null;
  note?: string | null;
}

// Something the platform offers that is not laundry, and what it costs. Configuration
// rather than code, so a new service line is added by an admin rather than a release.
export interface ServiceOffering {
  id: string;
  kind: ServiceKind;
  name: string;
  description: string | null;
  pricingBasis: ServicePricingBasis;
  unitPricePaise: number;
  // For a vehicle wash: which vehicles this offering is for.
  vehicleTypes: string[];
  // For an hourly service: the smallest booking that makes sense.
  minimumHours: number | null;
  isActive: boolean;

  // Everything the service wizard configures. All optional, so an offering written
  // before the wizard existed still reads — it simply has nothing configured and
  // behaves as it always did.

  // What it is and how it is shown.
  category?: ServiceCategory;
  icon?: string | null;
  // What it is measured in, and the quantities it will accept. A car wash is per
  // vehicle; ironing at home is sold in whole hours between one and four.
  unit?: MeasurementUnit;
  minimumQuantity?: number | null;
  maximumQuantity?: number | null;
  quantityIncrement?: number | null;
  // What a subscriber pays where no plan rule says otherwise.
  subscriberUnitPricePaise?: number | null;
  // What each plan does about this service: included, cheaper, or not offered.
  planRules?: ServicePlanRule[];
  // How often it may be booked, where that is restricted.
  frequency?: PickupFrequency | null;
  frequencyDays?: number[];
  // Who it is sold to, and which plans are eligible where it is for subscribers.
  eligibility?: CustomerEligibility;
  eligiblePlanIds?: string[];
  // Where it is offered and how the work is done.
  availabilityScope?: AvailabilityScope;
  societyIds?: string[];
  areaIds?: string[];
  mode?: ServiceMode;
  // The days it operates on, and the windows within them.
  operatingDays?: number[];
  timeSlots?: ServiceTimeSlot[];
  // When a booking may be made, changed and cancelled.
  bookingRules?: ServiceBookingRules;
  // The extras: a home visit, a weekend, an urgent job.
  additionalCharges?: ServiceAdditionalCharge[];
}

// A booking for one of those. Not an order: nothing is collected and nothing comes
// back, so it has its own small lifecycle rather than borrowing the order's.
export interface ServiceRequest {
  id: string;
  residentId: string;
  societyId: string;
  areaId: string | null;
  kind: ServiceKind;
  offeringId: string;
  offeringName: string;
  // Vehicle washing.
  vehicleType: string | null;
  vehicleNumber: string | null;
  // At-home ironing, where the price follows the time it actually takes.
  estimatedHours: number | null;
  actualHours: number | null;
  scheduledFor: string;
  address: string | null;
  status: ServiceRequestStatus;
  assignedToUserId: string | null;
  // What the resident was told before confirming, and what it came to in the end.
  quotedPaise: number;
  finalPaise: number | null;
  chargeStatus: "none" | "pending" | "paid" | "failed";
  notes: string | null;
  timeline: { status: ServiceRequestStatus; at: string; actorUserId: string | null; note?: string | null }[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
}

export interface Addon { id: string; name: string; pricePaise: number; isActive: boolean; }

// The eight stages a ticket moves through. Two of them say who is being waited on,
// and two say how far up the hierarchy it has gone, because "in progress" alone does
// not tell a resident whether anybody is waiting on them.
export type IssueStatus =
  | "open"
  | "in_progress"
  | "waiting_resident"
  | "waiting_operator"
  | "escalated_supervisor"
  | "escalated_admin"
  | "resolved"
  | "closed";
export type IssuePriority = "low" | "normal" | "high" | "emergency";
export interface SupportTicket {
  id: string; residentId: string | null; orderId: string | null; societyId: string | null; areaId: string | null;
  category: string; description: string; status: IssueStatus; priority: IssuePriority;
  reportedByUserId: string | null; reportedByRole: Role | "system" | null;
  assignedToUserId: string | null; resolution: string | null; resolvedAt: string | null;
  closedAt: string | null; escalatedToAdmin: boolean;
  // Which role is expected to act next. A ticket a resident raised is the operator's
  // to answer first; one an operator raised is the supervisor's. Escalation moves it
  // up the hierarchy, and only up.
  responsibleRole: Role | null;
  escalatedToSupervisor: boolean;
  // The conversation between the resident and the supervisor. The role is kept so a
  // reader can tell who said what without resolving every author id.
  messages: IssueMessage[]; createdAt: string;
  // When each person last looked at the conversation, keyed by user id. "Read" is a
  // fact about a person rather than about the issue, so it cannot be one flag.
  readBy?: Record<string, string>;
}

export interface IssueMessage {
  author: string;
  authorRole: Role | "system" | null;
  body: string;
  at: string;
}

export interface Notification {
  id: string; userId: string; type: string; title: string; body: string;
  orderId: string | null; read: boolean; createdAt: string;
}

export interface WaterLog { id: string; unitId: string; orderId: string | null; litersUsed: number; litersSaved: number; createdAt: string; }
export interface Session {
  token: string; userId: string; roles: Role[]; residentId: string | null;
  societyId: string | null; areaId: string | null; societyIds: string[];
  areaWideAccess?: boolean;
  // The blocks this account covers, for an operator who has been given some.
  blockIds?: string[];
  expiresAt: string;
}
export interface OutboxEvent { id: string; type: string; payload: Record<string, unknown>; status: "pending" | "sent" | "failed"; attempts: number; createdAt: string; }

export interface AuditLog {
  id: string; actor: string; actorName: string | null; role: Role | "system" | null;
  action: string; entity: string; resource: string | null; resourceId: string | null;
  previousValue: unknown; newValue: unknown; at: string;
}

export interface PaymentIntent {
  id: string; providerOrderId: string; residentId: string; amountPaise: number;
  status: "pending" | "reconciled" | "failed"; createdAt: string;
}

// Global, admin-only application settings. Stored as a single document so the whole
// configuration can be read in one call and versioned in the audit log as one change.
// What physically has to happen to a garment sent for this service. An order
// only offers the operator the stages its own garments actually need, so an
// Iron Only order never shows Start Wash.
export type CleanStage = "wash" | "dry_clean" | "premium";

// How a service is measured. Most laundry is counted; some of it is weighed, and a
// vehicle wash is neither — it is one job. What a service is priced by is
// configuration rather than an assumption baked into the pricing code.
export type PricingBasis = "per_garment" | "per_kg" | "per_job";

export interface GarmentService {
  id: string;
  name: string;
  // The fallback price per unit, charged on top of anything the subscription
  // covers. The base service is priced at zero so a plan covers an ordinary wash.
  unitPricePaise: number;
  // Price per garment category, because pressing a saree is not pressing a shirt.
  // A category absent from this map falls back to unitPricePaise.
  pricesPaise: Record<string, number>;
  // What this service is measured in. Absent means pieces, which is what every
  // service written before units existed was.
  unit?: MeasurementUnit;
  // The smallest quantity this service will bill for, where there is one: half a
  // kilo of washing still occupies a machine.
  minimumBillable?: number | null;
  // What the price is per. Kept for the services written before `unit` existed.
  pricingBasis?: PricingBasis;
  // What a resident on a plan pays for this service, where that differs from the
  // ordinary price. A subscription is supposed to be worth having; charging a
  // subscriber the same as a passer-by is what made it not.
  subscriberPricesPaise?: Record<string, number>;
  subscriberUnitPricePaise?: number;
  // The processing this service requires.
  requiresClean: boolean;
  cleanStage: CleanStage;
  requiresPress: boolean;
  isBase: boolean;
  isActive: boolean;
}

export interface SystemConfig {
  id: string;
  additionalGarmentRatePaise: number;
  // What a resident without an active subscription pays per garment. Subscription
  // is optional, so this is the ordinary price rather than an overage rate. It is
  // the fallback for any category the table below does not price.
  nonSubscriberGarmentRatePaise: number;
  // Price per garment category for a resident paying as they go, because a saree
  // is not a shirt. Subscription pricing is a separate matter entirely: it is the
  // plan's allowance and the services the plan covers, and changing one of these
  // must never change the other.
  garmentPricesPaise: Record<string, number>;
  garmentServices: GarmentService[];
  garmentCategories: string[];
  defaultSlotCapacity: number;
  defaultTurnaroundHours: number;
  delayGraceHours: number;
  qcRequired: boolean;
  notificationsEnabled: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
}
