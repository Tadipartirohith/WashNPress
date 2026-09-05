// Typed client for the Supervisor portal. Every function here calls one route in
// washnpress-v2/src/app/routes/supervisor.ts — read that file, not this comment,
// for exact request/response shapes; the types below are trimmed to what the web
// screens actually render.
//
// The area/society boundary is entirely server-derived from the session. Nothing
// here accepts a "which society" parameter for the supervisor's own scope — where
// the backend route signature happens to take a societyId (e.g. slots, pickups) it
// is an optional narrowing filter over the one area the supervisor already runs,
// never a way to switch to someone else's.

import { req } from "@/lib/api-client";

// ------------------------------------------------------------------ shared types

export interface OrderCounts {
  total: number; today: number; pending: number; scheduled: number; active: number;
  completed: number; pickedUp: number; washingPending: number; washing: number;
  ironingPending: number; ironing: number; qcPending: number; qcFailed: number;
  readyForDelivery: number; outForDelivery: number; delivered: number; deliveredToday: number;
  cancelled: number; failedPickups: number; delayed: number; disputed: number;
}

export interface ProcessingBreakdown {
  stages: { key: string; label: string; count: number }[];
  ironing: number; qcPending: number; qcFailed: number;
}

export interface IssueCounts {
  total: number; open: number; inProgress: number; waitingResident: number; waitingOperator: number;
  assigned: number; escalatedSupervisor: number; escalatedAdmin: number; resolved: number; closed: number;
  pending: number; emergency: number; escalated: number;
}

export interface SupervisorDashboard {
  society: { id: string; name: string; addressLine: string } | null;
  blocks: { id: string; name: string; flatCount: number; status: string }[];
  societies: { total: number; active: number };
  residents: { total: number };
  operationsStaff: { total: number; active: number };
  pickups: { today: number; pending: number; completed: number; failed: number };
  orders: OrderCounts;
  processing: ProcessingBreakdown;
  issues: IssueCounts;
}

export interface BlockOperatorRef { id: string; fullName: string | null; phone?: string | null; status?: string }

export interface BlockSummary {
  id: string; name: string; flatCount: number; floorCount: number; status: string;
  operators: BlockOperatorRef[];
}

export interface SocietySummary {
  id: string; name: string; addressLine: string; status: string;
  supervisorUserId: string | null; supervisorName: string | null;
  naming?: unknown;
  blocks: BlockSummary[];
  residentCount: number; operationsStaffCount: number; orderCount: number;
  activeOrderCount: number; availableSlots: number;
}

export interface MySocietyResponse {
  society: SocietySummary | null;
  supervisor: { id: string; fullName: string | null; phone: string; status: string } | null;
  blocks: {
    blockId: string; blockName: string; societyId: string; societyName: string;
    flatCount: number; floorCount: number; operators: BlockOperatorRef[];
    residentCount: number; activeOrderCount: number; status: string;
  }[];
  unassignedResidentCount: number;
  canChangeSociety: false;
  operatorOptions: { id: string; fullName: string | null; phone: string; status: string }[];
}

export interface BlockDetailResident {
  id: string; fullName: string | null; phone: string | null; unitNumber: string;
  planName: string | null; activeOrderCount: number; orderState: string | null;
}

export interface BlockDetail {
  block: {
    id: string; name: string; status: string; societyId: string; societyName: string;
    flatCount: number; floorCount: number; residentCount: number; activeOrderCount: number;
    operators: BlockOperatorRef[];
  };
  residents: BlockDetailResident[];
}

export interface SocietyResidentRow {
  id: string; fullName: string | null; phone: string | null; unitNumber: string;
  blockId: string | null; towerBlock: string | null; status: string | null;
  onboardingCompleted: boolean; subscriptionId: string | null; planId: string | null;
}

export interface SocietyDetail {
  society: SocietySummary;
  residents: SocietyResidentRow[];
  operators: OperatorSummary[];
  slots: SlotView[];
  orders: OrderSummary[];
  issues: unknown[];
}

export interface OperatorSummary {
  id: string; phone: string; fullName: string | null; email: string | null;
  employeeId: string | null; status: "active" | "on_leave" | "blocked";
  roles: string[]; verificationStatus: "pending" | "approved" | "rejected" | null;
  verificationNote?: string | null;
  societyIds: string[]; blockIds: string[];
  firstName: string | null; lastName: string | null;
  societyNames: string[]; societyName: string | null;
  supervisorUserId?: string | null; supervisorName?: string | null;
  blockNames?: string[]; blockCount?: number; flatsCovered?: number;
  createdAt: string;
}

export interface OperatorListResponse {
  operators: OperatorSummary[];
  blocks: { id: string; name: string; flatCount: number; floorCount: number; status: string }[];
  counts: { all: number; active: number; on_leave: number; blocked: number };
}

export interface HandoverPreview {
  operator: { id: string; fullName: string | null; status: string; societyIds: string[]; blockIds: string[] };
  openOrders: OrderSummary[];
  openCount: number;
  availableOperators: { id: string; fullName: string | null; societyIds: string[]; blockIds: string[] }[];
}

export interface AvailabilityResult {
  operator: OperatorSummary;
  reassigned: { orderId: string; orderCode: string; toUserId: string | null }[];
  returnedToQueue: number;
}

export interface WorkloadRow {
  userId: string; name: string | null; employeeId: string | null; status: string;
  societyNames: string[]; pending: number; processing: number; completed: number;
  qcFailures: number; failedPickups: number;
}

export interface OrderProcessing { requiresClean: boolean; cleanStage: string; requiresPress: boolean }
export interface OrderNextAction { to: string; label: string }

export interface OrderSummary {
  id: string; orderCode: string; state: string; createdAt: string;
  residentId: string; residentName: string | null; residentPhone: string | null; unitNumber: string | null;
  societyId: string; societyName: string | null; blockId: string | null; blockName: string | null;
  acceptedCount: number | null; subscriptionCoveredCount: number | null;
  additionalCount: number | null; additionalChargePaise: number | null; additionalChargeStatus: string;
  payPerOrder: boolean; servicesPaise: number;
  assignedOperatorUserId: string | null; operatorName: string | null;
  qcPassed: boolean | null; qcReason: string | null;
  batchCount: number; batchesCompleted: number;
  pickupFailureReason: string | null; expectedCompletionAt: string | null;
  estimatedDeliveryAt: string | null; scheduledPickupAt: string | null; earlyPickup: boolean;
  pickedUpAt: string | null; deliveredAt: string | null; ironingStarted: boolean;
  processing: OrderProcessing; nextActions: OrderNextAction[];
  delayed: boolean; delayMinutes: number;
  // Present on the /qc listing only.
  qcStatus?: "pending" | "passed" | "recheck" | "failed";
  qcCheckedAt?: string;
}

export interface OrderDetail extends OrderSummary {
  pickupAddress?: string | null;
  planTier?: string | null;
  hasSubscription?: boolean;
  remainingAllowance?: number;
  lines?: { id: string; category: string; quantity: number; acceptedQuantity: number | null }[];
  turnaroundHours?: number;
  slot?: { id: string; date: string; window: string; startTime: string; endTime: string } | null;
  stages?: { key: string; label: string; done: boolean }[];
  taxPaise?: number;
}

export interface OrdersListResponse {
  orders: OrderSummary[];
  stateLabels: Record<string, string>;
  filters: {
    blocks: { id: string; name: string }[];
    operators: { id: string; fullName: string | null }[];
    residents: { id: string; fullName: string | null; unitNumber: string }[];
  };
}

export interface SlotView {
  id: string; societyId: string; societyName?: string | null;
  date: string; window: string; startTime: string; endTime: string;
  capacityTotal: number; capacityRemaining: number; isActive: boolean;
  bookedCount: number; full: boolean; subscribersOnly?: boolean;
}

export interface SlotsResponse {
  slotWindows: Record<string, { startTime: string; endTime: string }>;
  slots: SlotView[];
}

export interface PickupRow {
  id: string; societyId: string; societyName?: string | null;
  residentId: string; residentName?: string | null; unitNumber?: string | null;
  scheduledFor: string; status: string; pickupStatus: string; pickupStatusLabel: string;
  overdue: boolean; due: boolean; canStart?: boolean;
  operatorName?: string | null; orderId?: string | null;
  [key: string]: unknown;
}

export interface PickupsResponse {
  pickups: PickupRow[];
  societies: { id: string; name: string }[];
}

export interface ProcessingResponse {
  waitingForWashing: OrderSummary[];
  washing: OrderSummary[];
  ironingPending: OrderSummary[];
  ironing: OrderSummary[];
  waitingForQc: OrderSummary[];
  qcFailed: OrderSummary[];
  readyForDelivery: OrderSummary[];
  outForDelivery: OrderSummary[];
}

export interface QcResponse {
  qc: OrderSummary[];
  page: { total: number; limit: number; offset: number; hasMore: boolean };
  filters: {
    statuses: string[];
    societies: { id: string; name: string }[];
    operators: { id: string; name: string }[];
  };
}

// The ticket's own field is `category` (e.g. "garment_quantity_mismatch"), not
// `type` — the query parameter the list route accepts is still named `type` (it
// filters by category server-side), but the field on every returned ticket is
// `category`. See washnpress-v2/src/domain/models.ts's SupportTicket.
export interface IssueMessage { author: string; authorRole: string | null; body: string; at: string }
export interface IssueConversationSummary {
  preview: string | null; lastMessageAt: string | null; lastMessageRole: string | null;
  unreadCount: number; messageCount: number; canReply: boolean;
  reason?: string | null; replyTo?: string | null; replyLabel?: string | null;
}
export interface IssueSummary {
  id: string; category: string; priority: string; status: string;
  societyId: string | null; societyName?: string | null;
  orderId: string | null; residentId?: string | null;
  responsibleRole: string | null; assignedToUserId: string | null; assignedToName?: string | null;
  escalatedToAdmin?: boolean; escalatedToSupervisor?: boolean;
  createdAt: string; description: string; resolution?: string | null;
  conversation?: IssueConversationSummary;
  messages?: IssueMessage[];
  [key: string]: unknown;
}

export interface IssuesResponse {
  issues: IssueSummary[];
  issueTypes: readonly string[];
  priorities: readonly string[];
  assignees: { id: string; name: string | null; role: string | null }[];
}

export type IssueDetail = IssueSummary;

export interface PendingOperatorsResponse { operators: OperatorSummary[]; status: string }

export interface PlanUsage {
  id: string; tier: string; name: string; description: string | null;
  garmentCap: number; turnaroundHours: number; monthlyPaise: number;
  annualDiscountPercent?: number; isActive?: boolean;
  services?: { serviceName: string; unit: string; includedQuantity: number }[];
  subscribers: number; activeSubscribers: number; garmentsUsed: number;
  allowance: number; revenuePaise: number;
}

export interface PlanInput {
  tier: string; name?: string; description?: string | null;
  garmentCap: number; turnaroundHours: number; monthlyPaise: number;
  annualDiscountPercent?: number; coveredServiceIds?: string[];
  validity?: "monthly" | "annual"; taxPercent?: number; discountPercent?: number;
}

export interface SearchResponse {
  orders: OrderSummary[];
  residents: { id: string; fullName: string | null; phone: string | null; unitNumber: string; societyId: string }[];
  societies: { id: string; name: string }[];
  operators: OperatorSummary[];
}

export interface SupervisorProfile {
  id: string; fullName: string | null; phone: string; email: string | null;
  roles: string[]; status: string; societyName?: string | null;
}

export interface ReportsResponse {
  bySociety: unknown; byOperator: unknown; residents: unknown;
  subscriptions: unknown; issues: unknown; revenue: unknown;
}

export interface ServiceRequestsResponse {
  requests: unknown[];
  page: { total: number; limit: number; offset: number; hasMore: boolean };
  offerings: unknown[];
  summary: unknown;
  operators: { id: string; name: string | null }[];
}

// A query object is sent as a URLSearchParams string, dropping empty/undefined
// values so a filter left out reads as "all" server-side rather than as "".
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (parts.length === 0) return "";
  return "?" + parts.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

export const supervisorApi = {
  // ---------------------------------------------------------------- dashboard
  dashboard: () => req<SupervisorDashboard>("/v1/supervisor/dashboard"),

  // ----------------------------------------------------------------- society
  mySociety: () => req<MySocietyResponse>("/v1/supervisor/society"),
  societies: () => req<{ societies: SocietySummary[] }>("/v1/supervisor/societies"),
  societyDetail: (id: string) => req<SocietyDetail>(`/v1/supervisor/societies/${id}`),
  createBlock: (societyId: string, body: { name: string; floorCount?: number; flatCount?: number }) =>
    req<{ block: unknown }>(`/v1/supervisor/societies/${societyId}/blocks`, { method: "POST", body }),
  updateBlock: (blockId: string, body: Partial<{ name: string; floorCount: number; flatCount: number; status: "active" | "inactive" }>) =>
    req<{ block: unknown }>(`/v1/supervisor/blocks/${blockId}`, { method: "PATCH", body }),
  blockDetail: (blockId: string) => req<BlockDetail>(`/v1/supervisor/blocks/${blockId}`),
  setBlockOperators: (blockId: string, operatorUserIds: string[]) =>
    req<{ block: unknown }>(`/v1/supervisor/blocks/${blockId}/operators`, { method: "PUT", body: { operatorUserIds } }),

  // ------------------------------------------------------------------ slots
  slots: (query: { societyId?: string; from?: string; to?: string; includePast?: boolean } = {}) =>
    req<SlotsResponse>(`/v1/supervisor/slots${qs({ ...query, includePast: query.includePast ? "true" : undefined })}`),
  createSlot: (body: { societyId: string; date: string; window: "Morning" | "Afternoon" | "Evening"; capacityTotal: number; subscribersOnly?: boolean }) =>
    req<{ slot: SlotView }>("/v1/supervisor/slots", { method: "POST", body }),
  updateSlot: (id: string, body: Partial<{ window: "Morning" | "Afternoon" | "Evening"; capacityTotal: number; isActive: boolean; subscribersOnly: boolean }>) =>
    req<{ slot: SlotView }>(`/v1/supervisor/slots/${id}`, { method: "PATCH", body }),
  cancelSlot: (id: string) => req<{ slot: SlotView }>(`/v1/supervisor/slots/${id}/cancel`, { method: "POST" }),

  // -------------------------------------------------------------- operators
  operators: (query: { status?: string; q?: string; blockId?: string } = {}) =>
    req<OperatorListResponse>(`/v1/supervisor/operators${qs(query)}`),
  createOperator: (body: { firstName: string; lastName: string; phone: string; email: string; blockIds?: string[] }) =>
    req<{ operator: OperatorSummary }>("/v1/supervisor/operators", { method: "POST", body }),
  updateOperator: (id: string, body: Partial<{ firstName: string; lastName: string; fullName: string; email: string; status: "active" | "on_leave" | "blocked"; blockIds: string[] }>) =>
    req<{ operator: OperatorSummary } | AvailabilityResult>(`/v1/supervisor/operators/${id}`, { method: "PATCH", body }),
  handoverPreview: (id: string) => req<HandoverPreview>(`/v1/supervisor/operators/${id}/handover`),
  setAvailability: (id: string, body: { status: "active" | "on_leave" | "blocked"; reassignToUserId?: string | null; reason?: string }) =>
    req<AvailabilityResult>(`/v1/supervisor/operators/${id}/availability`, { method: "POST", body }),
  workload: () => req<{ workload: WorkloadRow[] }>("/v1/supervisor/workload"),
  pendingOperators: (status = "pending") => req<PendingOperatorsResponse>(`/v1/supervisor/operators/pending${qs({ status })}`),
  setVerification: (id: string, body: { status: "approved" | "rejected"; note?: string }) =>
    req<{ operator: OperatorSummary }>(`/v1/supervisor/operators/${id}/verification`, { method: "POST", body }),

  // ----------------------------------------------------------------- orders
  orders: (query: Record<string, string | undefined> = {}) => req<OrdersListResponse>(`/v1/supervisor/orders${qs(query)}`),
  orderDetail: (id: string) => req<{ order: OrderDetail }>(`/v1/supervisor/orders/${id}`),
  assignOrder: (id: string, body: { operatorUserId: string | null; reason?: string }) =>
    req<{ order: OrderDetail; reassigned: unknown }>(`/v1/supervisor/orders/${id}/assign`, { method: "POST", body }),

  // -------------------------------------------------- pickups & processing
  pickups: (query: { date?: string; societyId?: string } = {}) => req<PickupsResponse>(`/v1/supervisor/pickups${qs(query)}`),
  processing: () => req<ProcessingResponse>("/v1/supervisor/processing"),
  qc: (query: { q?: string; status?: string; societyId?: string; operatorUserId?: string; date?: string; limit?: number; offset?: number } = {}) =>
    req<QcResponse>(`/v1/supervisor/qc${qs(query)}`),
  delayed: () => req<{ orders: OrderSummary[] }>("/v1/supervisor/delayed"),

  // ---------------------------------------------------------------- issues
  issues: (query: { status?: string; type?: string; societyId?: string; priority?: string; emergency?: boolean; open?: boolean } = {}) =>
    req<IssuesResponse>(`/v1/supervisor/issues${qs({ ...query, emergency: query.emergency ? "true" : undefined, open: query.open ? "true" : undefined })}`),
  issueDetail: (id: string) => req<{ issue: IssueDetail }>(`/v1/supervisor/issues/${id}`),
  replyIssue: (id: string, body: string) => req<{ issue: IssueDetail }>(`/v1/supervisor/issues/${id}/reply`, { method: "POST", body: { body } }),
  setIssuePriority: (id: string, priority: "low" | "normal" | "high" | "emergency") =>
    req<{ issue: IssueDetail }>(`/v1/supervisor/issues/${id}/priority`, { method: "PATCH", body: { priority } }),
  assignIssue: (id: string, userId: string) => req<{ issue: IssueDetail }>(`/v1/supervisor/issues/${id}/assign`, { method: "POST", body: { userId } }),
  setIssueStatus: (id: string, status: string, resolution?: string) =>
    req<{ issue: IssueDetail }>(`/v1/supervisor/issues/${id}/status`, { method: "PATCH", body: { status, resolution } }),
  escalateIssue: (id: string, note: string) => req<{ issue: IssueDetail }>(`/v1/supervisor/issues/${id}/escalate`, { method: "POST", body: { note } }),

  // ------------------------------------------------------------------ plans
  plans: () => req<{ plans: PlanUsage[] }>("/v1/supervisor/plans"),
  createPlan: (body: PlanInput) => req<{ plan: PlanUsage; pricing: unknown }>("/v1/supervisor/plans", { method: "POST", body }),
  updatePlan: (id: string, body: Partial<PlanInput & { isActive: boolean }>) =>
    req<{ plan: PlanUsage; pricing: unknown; activeSubscriptions: number }>(`/v1/supervisor/plans/${id}`, { method: "PATCH", body }),

  // ---------------------------------------------------------------- reports
  reports: (query: Record<string, string | undefined> = {}) => req<ReportsResponse>(`/v1/supervisor/reports${qs(query)}`),

  // ---------------------------------------------------------------- services
  services: (query: Record<string, string | undefined> = {}) => req<ServiceRequestsResponse>(`/v1/supervisor/services${qs(query)}`),

  // ----------------------------------------------------------------- search
  search: (q: string) => req<SearchResponse>(`/v1/supervisor/search${qs({ q })}`),

  // ---------------------------------------------------------------- profile
  profile: () => req<{ profile: SupervisorProfile }>("/v1/supervisor/profile"),
  updateProfile: (body: { fullName?: string; email?: string }) =>
    req<{ profile: SupervisorProfile }>("/v1/supervisor/profile", { method: "PATCH", body }),
};
