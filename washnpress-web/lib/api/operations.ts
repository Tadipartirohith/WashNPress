// Typed client for the operations portal. Mirrors lib/api-client.ts's style: thin
// functions over `req`, grouped by feature, typed against the exact shapes
// washnpress-v2/src/app/routes/operations.ts and routes/services.ts return. The
// backend owns the state machine, the quantity split and the QC/discrepancy rules —
// these functions only carry requests and responses, they never compute any of it.

import { req } from "@/lib/api-client";

function qs(params: Record<string, string | number | boolean | undefined> = {}): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

// ------------------------------------------------------------------- primitives

export type BatchStep = "wash" | "dry_clean" | "premium" | "iron" | "qc";
export type BatchStatus = "pending" | "in_progress" | "awaiting_qc" | "qc_failed" | "held" | "completed";
export type CleanStage = "wash" | "dry_clean" | "premium";
export type MeasurementUnit = "kg" | "piece" | "hour" | "job" | "vehicle" | "room" | "sqft" | "pair" | "item";

export type QcFailureReason =
  | "stain_not_removed" | "improper_washing" | "poor_ironing" | "folding_issue"
  | "garment_damage" | "missing_garment" | "wrong_garment" | "packaging_issue" | "other";

export type DiscrepancyReason =
  | "not_handed_over" | "resident_unavailable" | "item_missing"
  | "incorrect_quantity_declared" | "extra_items_handed_over" | "other";

export interface ProcessingRequirement { requiresClean: boolean; cleanStage: CleanStage; requiresPress: boolean }
export interface NextAction { to: string; label: string }

export interface ProcessingLine {
  id: string; category: string; quantity: number;
  acceptedQuantity: number | null;
  unit?: MeasurementUnit; measuredQuantity?: number | null; acceptedMeasuredQuantity?: number | null;
  serviceName: string; coveredByPlan: boolean;
  stages: { key: string; label: string }[];
}
export interface OrderProcessing extends ProcessingRequirement { cleanLabel: string; lines: ProcessingLine[] }

export interface QcFailureRecord {
  attempt: number; reason: string; reasonLabel: string; remarks: string;
  evidenceUrl: string | null; correctiveStep: string | null; correctiveLabel: string;
  serious: boolean; at: string; actorUserId: string | null;
}

// A processing batch: one Garment + Service combination, its own sequence, its own
// progress and its own quality check. Never merge these by garment type alone.
export interface ProcessingBatch {
  id: string; lineId: string; category: string; serviceId: string; serviceName: string;
  quantity: number; sequence: BatchStep[]; completedSteps: BatchStep[];
  status: BatchStatus; statusLabel: string;
  currentStep: BatchStep | null; currentStepLabel: string | null;
  steps: { step: BatchStep; label: string; done: boolean; current: boolean }[];
  qcPassed: boolean | null; qcReason: string | null; qcAttempts: number;
  history: { step: BatchStep; at: string; actorUserId: string | null; note?: string | null }[];
  qcFailures?: QcFailureRecord[];
  heldFor?: "supervisor" | "investigation" | null;
}

export interface QuantityDiscrepancy {
  requested: number; received: number; difference: number; direction: "short" | "excess";
  reason: string; reasonLabel: string; remarks: string; at: string; actorUserId: string | null;
  acknowledgement: "pending" | "acknowledged" | "disputed"; acknowledgedAt: string | null; disputeNote: string | null;
}

export interface OrderSummary {
  id: string; orderCode: string; state: string; createdAt: string;
  residentId: string; residentName: string | null; residentPhone: string | null; unitNumber: string | null;
  societyId: string; societyName: string | null;
  blockId?: string | null; blockName?: string | null;
  acceptedCount: number | null; subscriptionCoveredCount: number | null;
  additionalCount: number | null; additionalChargePaise: number | null; additionalChargeStatus: string;
  assignedOperatorUserId: string | null; operatorName: string | null;
  qcPassed: boolean | null; qcReason: string | null; pickupFailureReason: string | null;
  expectedCompletionAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  ironingStarted?: boolean; delayed: boolean; delayMinutes: number;
  payPerOrder?: boolean; servicesPaise?: number;
  batchCount?: number; batchesCompleted?: number;
  requestedCount?: number | null; quantityDiscrepancy?: QuantityDiscrepancy | null;
  scheduledPickupAt?: string | null; earlyPickup?: boolean;
  processing?: ProcessingRequirement; nextActions?: NextAction[];
}

export interface TimelineEntry { state: string; at: string; note?: string; actorUserId?: string | null }
export interface Stage { state: string; label: string; status: "completed" | "current" | "pending" }

export interface OrderLine {
  id: string; category: string; quantity: number;
  serviceId: string; serviceName: string; addonIds: string[];
  serviceUnitPricePaise: number; addonsPaise: number; linePricePaise: number;
  unit?: MeasurementUnit; measuredQuantity?: number | null; acceptedMeasuredQuantity?: number | null;
  coveredQuantity?: number | null; additionalQuantity?: number | null; additionalRatePaise?: number | null;
  notes: string | null;
  requiresClean?: boolean; cleanStage?: CleanStage; requiresPress?: boolean; coveredByPlan?: boolean;
}

export interface OrderQuantityHistory {
  residentEstimate: number | null; operatorReceived: number | null; difference: number | null;
  recordedAt: string | null; recordedByUserId: string | null; recordedByName: string | null;
  discrepancy: QuantityDiscrepancy | null; deliveredCount: number | null;
}
export interface OrderCharges {
  subscriptionCoveredCount: number | null; additionalCount: number | null; additionalRatePaise: number | null;
  additionalChargePaise: number; servicesPaise: number; taxPaise: number; cgstPaise: number; sgstPaise: number;
  totalPaise: number; payPerOrder: boolean; status: string;
}
export interface OrderPaymentEvent { at: string; kind: "charge" | "retry"; amountPaise: number; status: "paid" | "pending" | "failed"; note?: string | null; reference?: string | null }
export interface OrderAssignmentEntry { at: string; fromUserId: string | null; toUserId: string | null; byUserId: string | null; fromName: string | null; toName: string | null; byName: string | null; note?: string | null }

export interface IssueMessage { author: string; authorRole: string | null; authorName?: string | null; body: string; at: string }
export interface Issue {
  id: string; residentId: string | null; orderId: string | null; societyId: string | null;
  category: string; description: string; status: string; priority: string;
  reportedByUserId: string | null; reportedByRole: string | null; assignedToUserId: string | null;
  resolution: string | null; resolvedAt: string | null; closedAt: string | null; escalatedToAdmin: boolean;
  responsibleRole?: string | null; escalatedToSupervisor?: boolean;
  messages: IssueMessage[]; createdAt: string;
  residentName?: string | null; residentPhone?: string | null; unitNumber?: string | null;
  societyName?: string | null; assignedToName?: string | null;
  order?: {
    id: string; orderCode: string; state: string; stateLabel?: string;
    residentName?: string | null; unitNumber?: string | null; societyName?: string | null;
    createdAt?: string; garments?: number | null; acceptedCount: number | null; operatorName: string | null;
  } | null;
}

export interface OrderDetail extends OrderSummary {
  processing?: OrderProcessing;
  items?: { category: string; quantity: number }[];
  timeline: TimelineEntry[]; stages: Stage[];
  estimatedCount: number | null; deliveryCount: number | null;
  additionalRatePaise: number | null; discrepancyReason: string | null;
  pickupAddress: string | null; planTier: string | null;
  remainingAllowance: number; turnaroundHours: number;
  hasSubscription: boolean; lines: OrderLine[]; servicesPaise: number;
  slot: { id: string; date: string; window: string; startTime: string; endTime: string } | null;
  pickupId?: string | null;
  issues: Issue[];
  batches: ProcessingBatch[];
  quantityHistory?: OrderQuantityHistory;
  charges?: OrderCharges;
  paymentHistory?: OrderPaymentEvent[];
  assignmentHistory?: OrderAssignmentEntry[];
  statusHistory?: (TimelineEntry & { actorName: string | null; label?: string })[];
}

// -------------------------------------------------------------------- dashboard

export interface PickupCounts { today: number; pending: number; completed: number; failed: number }
export interface OrderCounts {
  total: number; today: number; pending: number; scheduled: number; active: number; completed: number;
  pickedUp: number; washingPending: number; washing: number; ironingPending: number; ironing: number;
  qcPending: number; qcFailed: number; readyForDelivery: number; outForDelivery: number;
  delivered: number; deliveredToday: number; cancelled: number; failedPickups: number;
  delayed: number; disputed: number;
}
export interface ProcessingBreakdown { stages: { key: string; label: string; count: number }[]; ironing: number; qcPending: number; qcFailed: number }
export interface IssueCounts {
  total: number; open: number; inProgress: number; waitingResident: number; waitingOperator: number;
  assigned: number; escalatedSupervisor: number; escalatedAdmin: number;
  resolved: number; closed: number; pending: number; emergency: number; escalated: number;
}
export interface ActionRequiredItem { kind: string; label: string; action: string; orderId: string; orderCode: string; residentName: string | null; society: string | null; unit: string | null; items: number }
export interface UpcomingPickup { pickupId: string; orderId: string | null; orderCode: string | null; scheduledFor: string; residentName: string | null; society: string | null; unit: string | null; items: number; status: string }

export interface OperationsDashboard {
  societies: { id: string; name: string }[];
  blocks: { id: string; name: string; societyId: string }[];
  todaysPickups: number;
  pickups: PickupCounts;
  orders: OrderCounts;
  processing: ProcessingBreakdown;
  actionRequired: ActionRequiredItem[];
  upcomingPickups: UpcomingPickup[];
  issues: IssueCounts;
  openIssues: number;
}

export interface GarmentService {
  id: string; name: string; unitPricePaise: number; isBase: boolean; isActive: boolean;
  unit?: MeasurementUnit; minimumBillable?: number | null; pricesPaise?: Record<string, number>;
  requiresClean?: boolean; cleanStage?: CleanStage; requiresPress?: boolean;
}
export interface OperationsConfig {
  garmentCategories: string[]; garmentServices: GarmentService[];
  additionalGarmentRatePaise: number; nonSubscriberGarmentRatePaise: number; issueTypes: string[];
}

// ----------------------------------------------------------------------- pickups

export interface PickupQueueItem {
  overdue: boolean; due: boolean; pickupStatus: string; pickupStatusLabel: string;
  dueNow: boolean; availableFrom: string; minutesUntilDue: number; scheduledDate: string;
  pickupId: string; orderId: string | null; orderCode: string | null;
  residentName: string | null; residentPhone: string | null;
  societyId: string; societyName: string | null; unitNumber: string | null; pickupAddress: string | null;
  pickupDate: string; slot: string | null; slotWindow: string | null;
  estimatedCount: number | null; specialInstructions: string | null;
  assignedOperatorUserId: string | null; operatorName: string | null;
  status: string; pickupFailureReason: string | null;
}

export interface GarmentSummary {
  acceptedCount: number; subscriptionCoveredCount: number; additionalCount: number;
  additionalRatePaise: number; additionalChargePaise: number; planTier: string | null; remainingAllowance: number;
}

export interface LineReconciliation {
  lineId: string; category: string; serviceId: string; serviceName: string;
  requested: number; actual: number; difference: number; status: "matched" | "short" | "additional";
  unitPricePaise: number; additionalPaise: number;
  unit: MeasurementUnit; requestedMeasured: number; actualMeasured: number; measuredDifference: number;
}
export interface Reconciliation { lines: LineReconciliation[]; requestedTotal: number; actualTotal: number; additionalPaise: number; confirmed: boolean }

export interface PickedUpBody {
  items?: { category: string; quantity: number }[];
  lines?: { lineId: string; acceptedQuantity: number; acceptedMeasuredQuantity?: number }[];
  early?: boolean; earlyReason?: string;
  discrepancyReason?: DiscrepancyReason;
  discrepancyRemarks?: string;
}

export interface DiscrepancyReasonOption { key: string; label: string }
export interface QcReasonOption { key: string; label: string; evidenceRequired: boolean; serious: boolean }
export interface AssignableOperator { userId: string; fullName: string | null; phone: string; employeeId: string | null; societyIds: string[]; blockIds: string[] }

export interface BatchQcFailure {
  reason: QcFailureReason; remarks: string; evidenceUrl?: string;
  evidencePhoto?: { filename?: string; contentType: string; data: string };
}

// ------------------------------------------------------------------------ active

export interface ActiveGroups {
  pickedUp: OrderSummary[]; washing: OrderSummary[]; ironingPending: OrderSummary[]; ironing: OrderSummary[];
  qc: OrderSummary[]; qcFailed: OrderSummary[]; readyForDelivery: OrderSummary[]; outForDelivery: OrderSummary[];
  stateLabels: Record<string, string>;
}

// ---------------------------------------------------------------------- services

export interface ServiceRequestView {
  id: string; kind: string; kindLabel: string; offeringId: string; offeringName: string;
  vehicleType: string | null; vehicleNumber: string | null;
  estimatedHours: number | null; actualHours: number | null;
  scheduledFor: string; address: string | null;
  status: string; statusLabel: string; assignedToUserId: string | null;
  quotedPaise: number; finalPaise: number | null; payablePaise: number;
  chargeStatus: string; notes: string | null; cancelledReason: string | null;
  timeline: { status: string; at: string; actorUserId: string | null; note?: string | null }[];
  createdAt: string; completedAt: string | null;
}
export interface PageInfo { total: number; limit: number; offset: number; hasMore: boolean }

// ----------------------------------------------------------------------- profile

export interface StaffProfile {
  id: string; fullName: string | null; phone: string; email: string | null; employeeId: string | null;
  status: string; roles: string[];
  societyId: string | null; societyName: string | null; societyNames: string[];
  supervisorUserId?: string | null; supervisorName?: string | null;
  blockIds?: string[]; blockNames?: string[]; flatsCovered?: number;
  lastLoginAt: string | null; createdAt: string;
  verificationStatus?: "pending" | "approved" | "rejected";
}

// ------------------------------------------------------------------------- api

export const operationsApi = {
  // dashboard & config
  dashboard: () => req<OperationsDashboard>("/v1/operations/dashboard"),
  blocks: () => req<{ blocks: { id: string; name: string; societyId: string }[] }>("/v1/operations/blocks"),
  config: () => req<OperationsConfig>("/v1/operations/config"),

  // pickups
  pickups: (date?: string) =>
    req<{ pickups: PickupQueueItem[]; overdueCount: number; dueNowCount: number; upcomingCount: number; date: string | null }>(
      `/v1/operations/pickups${qs({ date })}`,
    ),
  order: (id: string) => req<{ order: OrderDetail }>(`/v1/operations/orders/${id}`),
  previewGarments: (id: string, items: { category: string; quantity: number }[]) =>
    req<{ summary: GarmentSummary }>(`/v1/operations/orders/${id}/garments/preview`, { method: "POST", body: { items } }),
  reconcile: (id: string, lines: { lineId: string; acceptedQuantity: number; acceptedMeasuredQuantity?: number }[]) =>
    req<{ reconciliation: Reconciliation }>(`/v1/operations/orders/${id}/reconcile`, { method: "POST", body: { lines } }),
  markPickedUp: (id: string, body: PickedUpBody) =>
    req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/picked-up`, { method: "POST", body }),
  pickupFailed: (id: string, reason: string) =>
    req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/pickup-failed`, { method: "POST", body: { reason } }),
  discrepancyReasons: () => req<{ reasons: DiscrepancyReasonOption[] }>("/v1/operations/discrepancy-reasons"),
  assignableOperators: () => req<{ operators: AssignableOperator[] }>("/v1/operations/assignable-operators"),
  assignOrder: (id: string, operatorUserId: string | null, reason?: string) =>
    req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/assign`, { method: "POST", body: { operatorUserId, reason } }),

  // batches — the per Garment + Service pipeline
  batches: (id: string) => req<{ batches: ProcessingBatch[] }>(`/v1/operations/orders/${id}/batches`),
  advanceBatch: (id: string, batchId: string, step: BatchStep) =>
    req<{ order: OrderDetail; batches: ProcessingBatch[] }>(`/v1/operations/orders/${id}/batches/${batchId}/advance`, { method: "POST", body: { step } }),
  qcReasons: () => req<{ reasons: QcReasonOption[] }>("/v1/operations/qc-reasons"),
  batchQc: (id: string, batchId: string, passed: boolean, failure?: BatchQcFailure) =>
    req<{ order: OrderDetail; batches: ProcessingBatch[] }>(`/v1/operations/orders/${id}/batches/${batchId}/qc`, {
      method: "POST", body: { passed, ...(failure ?? {}) },
    }),

  // order-level stage actions, kept for orders with no per-line batches
  startWash: (id: string) => req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/wash/start`, { method: "POST" }),
  completeWash: (id: string) => req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/wash/complete`, { method: "POST" }),
  startIroning: (id: string) => req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/ironing/start`, { method: "POST" }),
  completeIroning: (id: string) => req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/ironing/complete`, { method: "POST" }),
  submitQc: (id: string, pass: boolean, reason?: string) =>
    req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/qc`, { method: "POST", body: { pass, reason } }),
  reprocess: (id: string, to: "in_wash" | "ironing") =>
    req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/reprocess`, { method: "POST", body: { to } }),

  // delivery
  outForDelivery: (id: string) => req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/out-for-delivery`, { method: "POST" }),
  deliver: (id: string, deliveryCount: number, discrepancyReason?: string) =>
    req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/deliver`, { method: "POST", body: { deliveryCount, discrepancyReason } }),

  // work lists
  active: () => req<ActiveGroups>("/v1/operations/active"),
  queue: () => req<{ orders: OrderSummary[] }>("/v1/operations/queue"),
  claim: (id: string) => req<{ order: OrderDetail }>(`/v1/operations/orders/${id}/claim`, { method: "POST" }),
  history: (params: { state?: string; from?: string; to?: string } = {}) =>
    req<{ orders: OrderSummary[] }>(`/v1/operations/history${qs(params)}`),
  search: (params: { q?: string; societyId?: string; state?: string; from?: string; to?: string }) =>
    req<{ orders: OrderSummary[] }>(`/v1/operations/search${qs(params)}`),

  // issues
  issues: (params: { status?: string; type?: string; societyId?: string; orderId?: string; from?: string; to?: string; mine?: boolean } = {}) =>
    req<{ issues: Issue[]; issueTypes: string[]; statuses: string[]; counts: Record<string, number> }>(`/v1/operations/issues${qs(params)}`),
  issue: (id: string) => req<{ issue: Issue }>(`/v1/operations/issues/${id}`),
  takeIssue: (id: string) => req<{ issue: Issue }>(`/v1/operations/issues/${id}/take`, { method: "POST" }),
  replyIssue: (id: string, body: string) => req<{ issue: Issue }>(`/v1/operations/issues/${id}/reply`, { method: "POST", body: { body } }),
  setIssueStatus: (id: string, status: string, resolution?: string) =>
    req<{ issue: Issue }>(`/v1/operations/issues/${id}/status`, { method: "PATCH", body: { status, resolution } }),
  escalateIssue: (id: string, note: string) => req<{ issue: Issue }>(`/v1/operations/issues/${id}/escalate`, { method: "POST", body: { note } }),
  createIssue: (body: { orderId?: string; type: string; description: string; priority?: "low" | "normal" | "high" }) =>
    req<{ issue: Issue }>("/v1/operations/issues", { method: "POST", body }),

  // on-demand services
  services: (params: { status?: string; kind?: string; mine?: boolean; limit?: number; offset?: number } = {}) =>
    req<{ requests: ServiceRequestView[]; page: PageInfo; statuses: string[]; kinds: { key: string; label: string }[] }>(`/v1/operations/services${qs(params)}`),
  assignService: (id: string, staffUserId?: string) =>
    req<{ request: ServiceRequestView }>(`/v1/operations/services/${id}/assign`, { method: "POST", body: staffUserId ? { staffUserId } : {} }),
  startService: (id: string) => req<{ request: ServiceRequestView }>(`/v1/operations/services/${id}/start`, { method: "POST" }),
  completeService: (id: string, body: { actualHours?: number; note?: string } = {}) =>
    req<{ request: ServiceRequestView }>(`/v1/operations/services/${id}/complete`, { method: "POST", body }),

  // profile
  profile: () => req<{ profile: StaffProfile }>("/v1/operations/profile"),
  updateProfile: (body: { fullName?: string; email?: string }) =>
    req<{ profile: StaffProfile }>("/v1/operations/profile", { method: "PATCH", body }),
};
