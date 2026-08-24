import type { OrderState } from "./order-state-machine";

export type Role = "resident" | "operator" | "supervisor" | "admin" | "support";

export interface User {
  id: string; phone: string; fullName: string | null; email: string | null; employeeId: string | null;
  // on_leave keeps the account and its history intact while taking the person out
  // of the available pool, so work is reassigned rather than stranded.
  status: "active" | "on_leave" | "blocked" | "deleted"; roles: Role[]; lastLoginAt: string | null;
  // Scope. A supervisor owns exactly one area; an operator works a set of societies
  // inside one area. Residents and admins leave both empty (admin is system wide).
  areaId: string | null; societyIds: string[];
  // Deliberate area-wide cover for an operator, granted by an admin. Without it an
  // operator with no societies assigned can reach nothing, which is what an empty
  // assignment ought to mean.
  areaWideAccess?: boolean;
  createdAt: string;
}

export interface Area {
  id: string; name: string; code: string; description: string | null; region: string | null;
  status: "active" | "inactive"; supervisorUserId: string | null; createdAt: string;
}

export interface Resident {
  id: string; userId: string; societyId: string; unitNumber: string; towerBlock: string | null;
  preferredWindows: string[]; address: string | null; pickupAddress: string | null;
  onboardingCompleted: boolean; onboardedAt: string | null;
}

export interface Society {
  id: string; name: string; code: string; areaId: string | null; address: string | null;
  city: string; state: string; status: "active" | "coming_soon" | "inactive"; createdAt: string;
}

export interface Unit { id: string; societyId: string; name: string; operatorUserIds: string[]; waterRecyclingEnabled: boolean; baseDrawPaise: number; revenueSharePercent: number; status: "active" | "inactive"; }

export interface Plan {
  id: string; tier: string; garmentCap: number; turnaroundHours: number;
  monthlyPaise: number; annualDiscountPercent: number; isActive: boolean;
  // The services this plan includes at no extra charge. A garment sent for a
  // service outside this list is priced per garment even while allowance remains,
  // which is how "wash and iron included, dry cleaning extra" is expressed.
  coveredServiceIds: string[];
}
export type BillingCycle = "monthly" | "annual";
export interface Subscription {
  id: string; residentId: string; planId: string; status: "active" | "paused" | "cancelled" | "expired";
  cycle: BillingCycle; cycleStart: string; cycleEnd: string; garmentsUsed: number; autoRenew: boolean;
  pendingPlanId: string | null; pauseUntil: string | null; cancelReason: string | null;
}

export interface Slot { id: string; societyId: string; date: string; window: string; startTime: string; endTime: string; capacityTotal: number; capacityRemaining: number; isActive: boolean; }
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
export type BatchStatus = "pending" | "in_progress" | "awaiting_qc" | "qc_failed" | "completed";

export interface BatchHistoryEntry {
  step: BatchStep;
  at: string;
  actorUserId: string | null;
  note?: string | null;
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
}
export interface TimelineEntry { state: OrderState; at: string; note?: string; actorUserId?: string | null; }

export interface Order {
  id: string; orderCode: string; pickupId: string | null; residentId: string; societyId: string;
  areaId: string | null; subscriptionId: string | null;
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
  assignedOperatorUserId: string | null; deliveredByUserId: string | null;
  expectedCompletionAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  rating: number | null; ratingComment: string | null; timeline: TimelineEntry[]; createdAt: string;
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

export interface GarmentService {
  id: string;
  name: string;
  // The fallback price per garment, charged on top of anything the subscription
  // covers. The base service is priced at zero so a plan covers an ordinary wash.
  unitPricePaise: number;
  // Price per garment category, because pressing a saree is not pressing a shirt.
  // A category absent from this map falls back to unitPricePaise.
  pricesPaise: Record<string, number>;
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
