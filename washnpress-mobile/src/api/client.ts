import { getApiBaseUrl } from "../config";
import type {
  Plan, PlanUsage, Slot, OrderSummary, OrderDetail, GarmentItem, GarmentSummary, VerifyResult,
  Subscription, SubscriptionUsage, WalletTransaction, SupportTicket, PaymentOrder, Issue, Notification,
  Area, Society, StaffUser, Workload, PickupQueueItem, AdminDashboard, SupervisorDashboard,
  OperationsDashboard, AuditEntry, SystemConfig, ReportsResponse, ResidentDashboard, ResidentProfile,
  OnboardingStatus, OperatorOrder, GarmentService, LineRequest, OrderLine, IssueAnalytics,
  AreaCoverage, HandoverPreview, Subscription as SubscriptionRecord,
  PriceList, MonitoredSlot, SlotSummary, RevenueReport, SlotWindows,
  PickupQueueItem as PickupRow,
  Reconciliation, ProcessingBatch, ScheduleView, FrequencyOption, PickupPreferences,
  ServiceOffering, ServiceQuote, ServiceRequestView, ServiceSummary, PageInfo,
  BookingOptions, LineEligibility, PlanPricing, PlanServiceRule, AdminServiceRow, ServiceFilterOptions,
} from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();

  // A proxy, a gateway or a misconfigured host answers with HTML, not JSON. Parsing
  // that threw a SyntaxError from inside the client, which surfaced to the user as
  // "Unexpected token <" and told them nothing about what had actually gone wrong.
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ApiError(
        res.ok
          ? "The server sent something this app could not read."
          : `Request failed (${res.status} ${res.statusText || "error"})`,
        res.status,
        "invalid_response",
      );
    }
  }

  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    throw new ApiError(String(message), res.status, data?.error as string | undefined);
  }
  return data as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  // ------------------------------------------------------------------ auth
  // In local mode the backend returns otpForTesting so no SMS gateway is needed.
  sendOtp: (phone: string) => request<{ sent: boolean; otpForTesting?: string }>("/v1/auth/otp/send", { method: "POST", body: { phone } }),
  verifyOtp: (phone: string, otp: string) => request<VerifyResult>("/v1/auth/otp/verify", { method: "POST", body: { phone, otp } }),
  me: (token: string) => request<{
    user: { fullName: string | null; phone: string };
    roles: string[]; portal: string; needsOnboarding: boolean; areaName: string | null;
    // Whether this account has ever finished signing in before, so the greeting can
    // tell a first visit from a return.
    firstLogin: boolean;
  }>("/v1/auth/me", { token }),
  logout: (token: string) => request<{ loggedOut: boolean }>("/v1/auth/logout", { method: "POST", token }),

  // ------------------------------------------------------------- catalogue
  getPlans: () => request<{ plans: Plan[] }>("/v1/plans"),
  getSocieties: () => request<{ societies: Society[] }>("/v1/societies"),
  getServices: () => request<{ services: GarmentService[] }>("/v1/services"),
  // The whole price list. With a token it also carries the resident's own plan.
  getPricing: (token?: string) => request<PriceList>("/v1/pricing", { token }),

  // --------------------------------------------------------------- resident
  onboardingStatus: (token: string) => request<OnboardingStatus>("/v1/resident/onboarding", { token }),
  completeOnboarding: (body: { fullName: string; societyId: string; unitNumber: string; email?: string; towerBlock?: string; address?: string; pickupAddress?: string }, token: string) =>
    request<{ resident: unknown; token: string | null; onboardingCompleted: boolean }>("/v1/auth/onboarding", { method: "POST", body, token }),
  residentDashboard: (token: string) => request<ResidentDashboard>("/v1/resident/dashboard", { token }),
  residentOrders: (token: string, params: { status?: string; from?: string; to?: string; orderCode?: string } = {}) =>
    request<{ current?: OrderSummary[]; upcoming?: OrderSummary[]; previous?: OrderSummary[]; orders?: OrderSummary[] }>(`/v1/resident/orders${qs(params)}`, { token }),
  residentOrder: (id: string, token: string) => request<{ order: OrderDetail }>(`/v1/resident/orders/${id}`, { token }),
  payAdditionalCharge: (id: string, token: string) => request<{ order: OrderDetail }>(`/v1/resident/orders/${id}/pay-additional`, { method: "POST", token }),
  residentSubscription: (token: string) => request<{ current: SubscriptionUsage | null; availablePlans: Plan[] }>("/v1/resident/subscription", { token }),
  residentProfile: (token: string) => request<{ profile: ResidentProfile }>("/v1/resident/profile", { token }),
  updateResidentProfile: (body: Record<string, unknown>, token: string) => request<{ profile: unknown }>("/v1/resident/profile", { method: "PATCH", body, token }),
  notifications: (token: string, unread = false) => request<{ notifications: Notification[] }>(`/v1/resident/notifications${qs({ unread: unread ? "true" : undefined })}`, { token }),
  markNotificationRead: (id: string, token: string) => request<{ notification: Notification }>(`/v1/resident/notifications/${id}/read`, { method: "POST", token }),
  markAllNotificationsRead: (token: string) => request<{ marked: number }>("/v1/resident/notifications/read-all", { method: "POST", token }),

  // ------------------------------------------------------------- scheduling
  getSlots: (date: string, token: string) => request<{ date: string; slots: Slot[] }>(`/v1/slots${qs({ date })}`, { token }),
  // Everything one Booking screen needs, said by the backend rather than worked out
  // from a plan by the client. There is no separate Regular module any more.
  bookingOptions: (token: string) =>
    request<BookingOptions>("/v1/booking/options", { token }),
  bookingPreview: (slotId: string, estimatedCount: number | undefined, lines: LineRequest[] | undefined, token: string) =>
    request<{
      society: { id: string | null; name: string | null }; pickupAddress: string | null;
      slot: Slot & { available: number; full: boolean }; subscription: SubscriptionUsage | null;
      hasSubscription: boolean; lines: OrderLine[]; servicesPaise: number;
      // Whether the plan permits this order, and the first thing standing in the way.
      eligibility: LineEligibility[]; blockedBy: LineEligibility | null; canBook: boolean;
      estimatedCount: number | null; perGarmentRatePaise: number;
      additionalGarmentRatePaise: number; nonSubscriberGarmentRatePaise: number;
      estimatedCoveredCount: number; estimatedChargeablePaise: number; note: string;
    }>(`/v1/pickups/preview${qs({ slotId, estimatedCount, lines: lines?.length ? JSON.stringify(lines) : undefined })}`, { token }),
  bookPickup: (body: { slotId: string; estimatedCount?: number; specialInstructions?: string; lines?: LineRequest[] }, token: string) =>
    request<{ order: { id: string; orderCode: string; state: string; servicesPaise: number; lines: OrderLine[] }; pickup: { id: string; scheduledFor: string } }>("/v1/pickups", { method: "POST", body, token }),
  cancelPickup: (pickupId: string, token: string) => request<{ pickup: unknown }>("/v1/pickups/cancel", { method: "POST", body: { pickupId }, token }),

  // ---------------------------------------------------------- subscription
  getSubscription: (token: string) => request<{ subscription: Subscription | null; usage: SubscriptionUsage | null }>("/v1/subscription", { token }),
  subscriptionUsage: (token: string) => request<{ usage: SubscriptionUsage | null }>("/v1/subscription/usage", { token }),
  subscribe: (planId: string, cycle: "monthly" | "annual", token: string) =>
    request<{ subscription: Subscription }>("/v1/subscription/subscribe", { method: "POST", body: { planId, cycle }, token }),
  changePlan: (planId: string, token: string) =>
    request<{ subscription: Subscription; prorationPaise: number; effectiveFrom: string; planTier: string; note: string }>("/v1/subscription/change", { method: "POST", body: { planId }, token }),
  cancelPlanChange: (token: string) =>
    request<{ subscription: SubscriptionUsage | null }>("/v1/subscription/change", { method: "DELETE", token }),
  cancelSubscription: (reason: string, token: string) =>
    request<{ subscription: Subscription }>("/v1/subscription/cancel", { method: "POST", body: { reason }, token }),

  // ---------------------------------------------------------------- wallet
  getWallet: (token: string) => request<{ balancePaise: number; balanceFormatted: string }>("/v1/wallet", { token }),
  walletTransactions: (token: string) => request<{ transactions: WalletTransaction[] }>("/v1/wallet/transactions", { token }),
  startTopUp: (amountPaise: number, token: string) => request<{ paymentOrder: PaymentOrder }>("/v1/wallet/topup", { method: "POST", body: { amountPaise }, token }),

  // --------------------------------------------------------------- support
  issueTypes: () => request<{ issueTypes: string[]; priorities: string[] }>("/v1/support/issue-types"),
  listTickets: (token: string) => request<{ tickets: SupportTicket[] }>("/v1/support/tickets", { token }),
  getTicket: (id: string, token: string) => request<{ ticket: SupportTicket }>(`/v1/support/tickets/${id}`, { token }),
  createTicket: (body: { category: string; description: string; orderId?: string; priority?: string }, token: string) =>
    request<{ ticket: SupportTicket }>("/v1/support/tickets", { method: "POST", body, token }),
  replyToTicket: (id: string, body: string, token: string) =>
    request<{ ticket: SupportTicket }>(`/v1/support/tickets/${id}/reply`, { method: "POST", body: { body }, token }),
  closeTicket: (id: string, token: string) =>
    request<{ ticket: SupportTicket }>(`/v1/support/tickets/${id}/close`, { method: "POST", token }),

  // ------------------------------------------------------------ operations
  opsDashboard: (token: string) => request<OperationsDashboard>("/v1/operations/dashboard", { token }),
  opsConfig: (token: string) => request<{ garmentCategories: string[]; garmentServices: GarmentService[]; additionalGarmentRatePaise: number; nonSubscriberGarmentRatePaise: number; issueTypes: string[] }>("/v1/operations/config", { token }),
  opsPickups: (token: string, date?: string) => request<{ pickups: PickupQueueItem[]; overdueCount?: number }>(`/v1/operations/pickups${qs({ date })}`, { token }),
  opsOrder: (id: string, token: string) => request<{ order: OrderDetail }>(`/v1/operations/orders/${id}`, { token }),
  opsPreviewGarments: (id: string, items: GarmentItem[], token: string) =>
    request<{ summary: GarmentSummary }>(`/v1/operations/orders/${id}/garments/preview`, { method: "POST", body: { items }, token }),
  opsActive: (token: string) => request<Record<string, OrderSummary[]>>("/v1/operations/active", { token }),
  opsQueue: (token: string) => request<{ orders: OrderSummary[] }>("/v1/operations/queue", { token }),
  claimOrder: (orderId: string, token: string) => request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/claim`, { method: "POST", token }),
  opsHistory: (token: string, params: { state?: string; from?: string; to?: string } = {}) =>
    request<{ orders: OrderSummary[] }>(`/v1/operations/history${qs(params)}`, { token }),
  opsSearch: (token: string, params: { q?: string; societyId?: string; state?: string; from?: string; to?: string }) =>
    request<{ orders: OrderSummary[] }>(`/v1/operations/search${qs(params)}`, { token }),
  opsIssues: (token: string, params: { status?: string; type?: string; societyId?: string; orderId?: string; from?: string; to?: string; mine?: boolean } = {}) =>
    request<{ issues: Issue[]; issueTypes: string[]; statuses: string[]; counts: Record<string, number> }>(`/v1/operations/issues${qs(params)}`, { token }),
  opsIssue: (id: string, token: string) => request<{ issue: Issue }>(`/v1/operations/issues/${id}`, { token }),
  opsTakeIssue: (id: string, token: string) => request<{ issue: Issue }>(`/v1/operations/issues/${id}/take`, { method: "POST", token }),
  opsReplyToIssue: (id: string, body: string, token: string) => request<{ issue: Issue }>(`/v1/operations/issues/${id}/reply`, { method: "POST", body: { body }, token }),
  opsSetIssueStatus: (id: string, status: string, resolution: string | undefined, token: string) =>
    request<{ issue: Issue }>(`/v1/operations/issues/${id}/status`, { method: "PATCH", body: { status, resolution }, token }),
  // Hands the issue up to the supervisor when the operator cannot settle it.
  opsEscalateIssue: (id: string, note: string, token: string) =>
    request<{ issue: Issue }>(`/v1/operations/issues/${id}/escalate`, { method: "POST", body: { note }, token }),
  opsCreateIssue: (body: { orderId?: string; type: string; description: string; priority?: string }, token: string) =>
    request<{ issue: Issue }>("/v1/operations/issues", { method: "POST", body, token }),
  opsProfile: (token: string) => request<{ profile: StaffUser }>("/v1/operations/profile", { token }),

  // Order actions. Each one names an action; the backend owns the state machine.
  markPickedUp: (orderId: string, items: GarmentItem[], token: string) =>
    request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/picked-up`, { method: "POST", body: { items }, token }),
  failPickup: (orderId: string, reason: string, token: string) =>
    request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/pickup-failed`, { method: "POST", body: { reason }, token }),
  startWash: (orderId: string, token: string) => request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/wash/start`, { method: "POST", token }),
  completeWash: (orderId: string, token: string) => request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/wash/complete`, { method: "POST", token }),
  startIroning: (orderId: string, token: string) => request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/ironing/start`, { method: "POST", token }),
  completeIroning: (orderId: string, token: string) => request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/ironing/complete`, { method: "POST", token }),
  advanceStage: (orderId: string, to: "in_wash" | "ironing" | "qc", token: string) =>
    request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/advance`, { method: "POST", body: { to }, token }),
  submitQc: (orderId: string, pass: boolean, reason: string | undefined, token: string) =>
    request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/qc`, { method: "POST", body: { pass, reason }, token }),
  reprocess: (orderId: string, to: "in_wash" | "ironing", token: string) =>
    request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/reprocess`, { method: "POST", body: { to }, token }),
  outForDelivery: (orderId: string, token: string) => request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/out-for-delivery`, { method: "POST", token }),
  deliver: (orderId: string, deliveryCount: number, discrepancyReason: string | undefined, token: string) =>
    request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/deliver`, { method: "POST", body: { deliveryCount, discrepancyReason }, token }),
  getBookings: (token: string) => request<{ orders: OperatorOrder[] }>("/v1/operations/bookings", { token }),

  // ------------------------------------------------------------ supervisor
  supDashboard: (token: string) => request<SupervisorDashboard>("/v1/supervisor/dashboard", { token }),
  supSocieties: (token: string, params: { q?: string; status?: string } = {}) => request<{ societies: Society[] }>(`/v1/supervisor/societies${qs(params)}`, { token }),
  supCreateSociety: (body: { name: string; code: string; address?: string }, token: string) => request<{ society: Society }>("/v1/supervisor/societies", { method: "POST", body, token }),
  supUpdateSociety: (id: string, body: Record<string, unknown>, token: string) => request<{ society: Society }>(`/v1/supervisor/societies/${id}`, { method: "PATCH", body, token }),
  supSociety: (id: string, token: string) => request<{
    society: Society;
    residents: { id: string; fullName: string | null; phone: string | null; unitNumber: string; status: string | null; onboardingCompleted: boolean; planId: string | null }[];
    operators: StaffUser[]; slots: Slot[]; orders: OrderSummary[]; issues: Issue[];
  }>(`/v1/supervisor/societies/${id}`, { token }),
  supSlots: (token: string, params: { societyId?: string; from?: string; to?: string; includePast?: boolean } = {}) =>
    request<{ slots: Slot[]; slotWindows?: SlotWindows }>(`/v1/supervisor/slots${qs(params)}`, { token }),
  // No start or end time: the window decides the hours. See SLOT_WINDOWS.
  supCreateSlot: (body: { societyId: string; date: string; window: string; capacityTotal: number }, token: string) =>
    request<{ slot: Slot }>("/v1/supervisor/slots", { method: "POST", body, token }),
  supUpdateSlot: (id: string, body: Record<string, unknown>, token: string) => request<{ slot: Slot }>(`/v1/supervisor/slots/${id}`, { method: "PATCH", body, token }),
  supCancelSlot: (id: string, token: string) => request<{ slot: Slot; cancelledPickups: number }>(`/v1/supervisor/slots/${id}/cancel`, { method: "POST", token }),
  supOperators: (token: string, params: { status?: string; q?: string } = {}) =>
    request<{ operators: StaffUser[]; counts: { all: number; active: number; on_leave: number; blocked: number } }>(`/v1/supervisor/operators${qs(params)}`, { token }),
  supCreateOperator: (body: { fullName: string; phone: string; email?: string; employeeId?: string; societyIds?: string[] }, token: string) =>
    request<{ operator: StaffUser }>("/v1/supervisor/operators", { method: "POST", body, token }),
  supUpdateOperator: (id: string, body: Record<string, unknown>, token: string) => request<{ operator: StaffUser; reassigned?: unknown[]; returnedToQueue?: number }>(`/v1/supervisor/operators/${id}`, { method: "PATCH", body, token }),
  supHandoverPreview: (id: string, token: string) => request<HandoverPreview>(`/v1/supervisor/operators/${id}/handover`, { token }),
  supSetAvailability: (id: string, body: { status: string; reassignToUserId?: string | null; reason?: string }, token: string) =>
    request<{ operator: StaffUser; reassigned: { orderId: string; orderCode: string }[]; returnedToQueue: number }>(`/v1/supervisor/operators/${id}/availability`, { method: "POST", body, token }),
  supWorkload: (token: string) => request<{ workload: Workload[] }>("/v1/supervisor/workload", { token }),
  supOrders: (token: string, params: Record<string, string | undefined> = {}) => request<{ orders: OrderSummary[] }>(`/v1/supervisor/orders${qs(params)}`, { token }),
  supOrder: (id: string, token: string) => request<{ order: OrderDetail }>(`/v1/supervisor/orders/${id}`, { token }),
  supAssignOperator: (id: string, operatorUserId: string | null, token: string, reason?: string) => request<{ order: OrderDetail }>(`/v1/supervisor/orders/${id}/assign`, { method: "POST", body: { operatorUserId, reason }, token }),
  supPickups: (token: string, params: { date?: string; societyId?: string } = {}) =>
    request<{ pickups: PickupQueueItem[]; societies: { id: string; name: string }[] }>(`/v1/supervisor/pickups${qs(params)}`, { token }),
  supProcessing: (token: string) => request<Record<string, OrderSummary[]>>("/v1/supervisor/processing", { token }),
  supQc: (token: string) => request<{ qc: OrderSummary[] }>("/v1/supervisor/qc", { token }),
  supDelayed: (token: string) => request<{ orders: OrderSummary[] }>("/v1/supervisor/delayed", { token }),
  supIssues: (token: string, params: { status?: string; type?: string; societyId?: string; priority?: string; emergency?: string; open?: string } = {}) =>
    request<{ issues: Issue[]; issueTypes: string[]; priorities: string[] }>(`/v1/supervisor/issues${qs(params)}`, { token }),
  supIssue: (id: string, token: string) => request<{ issue: Issue }>(`/v1/supervisor/issues/${id}`, { token }),
  supReplyToIssue: (id: string, body: string, token: string) => request<{ issue: Issue }>(`/v1/supervisor/issues/${id}/reply`, { method: "POST", body: { body }, token }),
  supSetIssuePriority: (id: string, priority: string, token: string) => request<{ issue: Issue }>(`/v1/supervisor/issues/${id}/priority`, { method: "PATCH", body: { priority }, token }),
  supSetIssueStatus: (id: string, status: string, resolution: string | undefined, token: string) =>
    request<{ issue: Issue }>(`/v1/supervisor/issues/${id}/status`, { method: "PATCH", body: { status, resolution }, token }),
  supEscalateIssue: (id: string, note: string, token: string) => request<{ issue: Issue }>(`/v1/supervisor/issues/${id}/escalate`, { method: "POST", body: { note }, token }),
  supReports: (token: string, params: Record<string, string | undefined> = {}) => request<ReportsResponse>(`/v1/supervisor/reports${qs(params)}`, { token }),
  supSearch: (token: string, q: string) => request<{ orders: OrderSummary[]; residents: { id: string; fullName: string | null; phone: string | null; unitNumber: string }[]; societies: Society[]; operators: StaffUser[] }>(`/v1/supervisor/search${qs({ q })}`, { token }),
  supProfile: (token: string) => request<{ profile: StaffUser }>("/v1/supervisor/profile", { token }),
  supUpdateProfile: (body: Record<string, unknown>, token: string) => request<{ profile: StaffUser }>("/v1/supervisor/profile", { method: "PATCH", body, token }),

  // ----------------------------------------------------------------- admin
  adminDashboard: (token: string) => request<AdminDashboard>("/v1/admin/dashboard", { token }),
  adminAreas: (token: string, params: { status?: string } = {}) => request<{ areas: Area[] }>(`/v1/admin/areas${qs(params)}`, { token }),
  adminCoverage: (token: string) => request<{ coverage: AreaCoverage[]; needingCover: AreaCoverage[] }>("/v1/admin/coverage", { token }),
  adminSetAvailability: (id: string, body: { status: string; reassignToUserId?: string | null; reason?: string }, token: string) =>
    request<{ user: StaffUser; reassigned: { orderId: string; orderCode: string }[]; returnedToQueue: number }>(`/v1/admin/users/${id}/availability`, { method: "POST", body, token }),
  adminOperators: (token: string, params: { areaId?: string; societyId?: string; status?: string } = {}) => request<{ operators: StaffUser[] }>(`/v1/admin/operators${qs(params)}`, { token }),
  adminCreateOperator: (body: { fullName: string; phone: string; areaId: string; societyIds?: string[]; employeeId?: string; email?: string }, token: string) =>
    request<{ operator: StaffUser }>("/v1/admin/operators", { method: "POST", body, token }),
  adminUpdateOperator: (id: string, body: Record<string, unknown>, token: string) => request<{ operator: StaffUser }>(`/v1/admin/operators/${id}`, { method: "PATCH", body, token }),
  adminUpdateSlot: (id: string, body: Record<string, unknown>, token: string) => request<{ slot: Slot }>(`/v1/admin/slots/${id}`, { method: "PATCH", body, token }),
  adminCancelSlot: (id: string, token: string) => request<{ slot: Slot; cancelledPickups: number }>(`/v1/admin/slots/${id}/cancel`, { method: "POST", token }),
  adminAssignOperator: (id: string, operatorUserId: string | null, token: string, reason?: string) =>
    request<{ order: OrderDetail }>(`/v1/admin/orders/${id}/assign`, { method: "POST", body: { operatorUserId, reason }, token }),
  adminSubscriptions: (token: string, params: { status?: string; planId?: string } = {}) =>
    request<{ subscriptions: (SubscriptionRecord & { planTier: string | null; residentName: string | null; societyName: string | null; allowance: number | null; remaining: number | null; monthlyPaise: number | null })[] }>(`/v1/admin/subscriptions${qs(params)}`, { token }),
  adminRevenue: (token: string, params: {
    preset?: string; from?: string; to?: string;
    areaId?: string; societyId?: string; supervisorUserId?: string; operatorUserId?: string;
    planId?: string; paymentStatus?: string;
  } = {}) => request<RevenueReport>(`/v1/admin/revenue${qs(params)}`, { token }),
  adminCreateArea: (body: { name: string; code: string; description?: string; region?: string }, token: string) => request<{ area: Area }>("/v1/admin/areas", { method: "POST", body, token }),
  adminUpdateArea: (id: string, body: Record<string, unknown>, token: string) => request<{ area: Area }>(`/v1/admin/areas/${id}`, { method: "PATCH", body, token }),
  adminArea: (id: string, token: string) => request<{ area: Area; societies: Society[]; operators: StaffUser[]; orders: OrderSummary[] }>(`/v1/admin/areas/${id}`, { token }),
  adminAssignSupervisor: (areaId: string, supervisorUserId: string, token: string) => request<{ area: Area; supervisor: StaffUser }>(`/v1/admin/areas/${areaId}/supervisor`, { method: "POST", body: { supervisorUserId }, token }),
  adminSupervisors: (token: string, params: { status?: string; assigned?: string } = {}) => request<{ supervisors: StaffUser[] }>(`/v1/admin/supervisors${qs(params)}`, { token }),
  adminCreateSupervisor: (body: { fullName: string; phone: string; email?: string; employeeId?: string; areaId?: string }, token: string) => request<{ supervisor: StaffUser }>("/v1/admin/supervisors", { method: "POST", body, token }),
  adminUpdateSupervisor: (id: string, body: Record<string, unknown>, token: string) => request<{ supervisor: StaffUser }>(`/v1/admin/supervisors/${id}`, { method: "PATCH", body, token }),
  adminSupervisor: (id: string, token: string) => request<{ supervisor: StaffUser; societies: Society[]; operators: StaffUser[]; orders: OrderSummary[] }>(`/v1/admin/supervisors/${id}`, { token }),
  adminSocieties: (token: string, params: { areaId?: string; supervisorUserId?: string; q?: string; status?: string } = {}) => request<{ societies: Society[] }>(`/v1/admin/societies${qs(params)}`, { token }),
  adminCreateSociety: (body: { name: string; code: string; areaId: string; address?: string }, token: string) => request<{ society: Society }>("/v1/admin/societies", { method: "POST", body, token }),
  adminUpdateSociety: (id: string, body: Record<string, unknown>, token: string) => request<{ society: Society }>(`/v1/admin/societies/${id}`, { method: "PATCH", body, token }),
  adminSociety: (id: string, token: string) => request<{ society: Society; residents: unknown[]; operators: StaffUser[]; slots: Slot[]; orders: OrderSummary[] }>(`/v1/admin/societies/${id}`, { token }),
  adminUsers: (token: string, params: { role?: string; status?: string; q?: string; areaId?: string; societyId?: string; onboarding?: string } = {}) => request<{ users: StaffUser[] }>(`/v1/admin/users${qs(params)}`, { token }),
  adminSetUserStatus: (id: string, status: "active" | "blocked", token: string) => request<{ user: StaffUser }>(`/v1/admin/users/${id}/status`, { method: "PATCH", body: { status }, token }),
  adminOrders: (token: string, params: Record<string, string | undefined> = {}) => request<{ orders: OrderSummary[] }>(`/v1/admin/orders${qs(params)}`, { token }),
  adminOrder: (id: string, token: string) => request<{ order: OrderDetail }>(`/v1/admin/orders/${id}`, { token }),
  adminPlans: (token: string) => request<{ plans: PlanUsage[] }>("/v1/admin/plans", { token }),
  adminCreatePlan: (body: Record<string, unknown>, token: string) =>
    request<{ plan: Plan; pricing: PlanPricing }>("/v1/admin/plans", { method: "POST", body, token }),
  adminUpdatePlan: (id: string, body: Record<string, unknown>, token: string) =>
    // Says how many residents the change actually reaches, so an edit to a plan a
    // hundred people are on is not made silently.
    request<{ plan: Plan; pricing: PlanPricing; activeSubscriptions: number }>(`/v1/admin/plans/${id}`, { method: "PATCH", body, token }),
  adminSlots: (token: string, params: {
    areaId?: string; societyId?: string; supervisorUserId?: string; operatorUserId?: string;
    from?: string; to?: string; date?: string; shift?: string;
    status?: string; bookingStatus?: string; utilisation?: string; includePast?: boolean;
  } = {}) => request<{
    slots: MonitoredSlot[]; summary: SlotSummary;
    shifts: string[]; statuses: string[]; bookingStatuses: string[]; utilisationBands: string[];
    slotWindows?: SlotWindows;
  }>(`/v1/admin/slots${qs(params)}`, { token }),
  adminCreateSlot: (body: { societyId: string; date: string; window: string; capacityTotal: number }, token: string) => request<{ slot: Slot }>("/v1/admin/slots", { method: "POST", body, token }),
  adminReports: (token: string, params: Record<string, string | undefined> = {}) => request<ReportsResponse>(`/v1/admin/reports${qs(params)}`, { token }),
  adminIssues: (token: string, params: { status?: string; type?: string; areaId?: string; societyId?: string; priority?: string; escalated?: string; emergency?: string; open?: string } = {}) =>
    request<{ issues: Issue[]; issueTypes: string[]; priorities: string[] }>(`/v1/admin/issues${qs(params)}`, { token }),
  adminIssueAnalytics: (token: string, params: { from?: string; to?: string } = {}) => request<{ analytics: IssueAnalytics }>(`/v1/admin/issues/analytics${qs(params)}`, { token }),
  adminIssue: (id: string, token: string) => request<{ issue: Issue }>(`/v1/admin/issues/${id}`, { token }),
  adminReplyToIssue: (id: string, body: string, token: string) => request<{ issue: Issue }>(`/v1/admin/issues/${id}/reply`, { method: "POST", body: { body }, token }),
  adminSetIssueStatus: (id: string, status: string, resolution: string | undefined, token: string) => request<{ issue: Issue }>(`/v1/admin/issues/${id}/status`, { method: "PATCH", body: { status, resolution }, token }),
  adminAudit: (token: string, params: {
    resource?: string; action?: string; actor?: string; role?: string; q?: string;
    from?: string; to?: string; limit?: number; offset?: number;
  } = {}) => request<{ entries: AuditEntry[]; page: PageInfo }>(`/v1/admin/audit${qs(params)}`, { token }),
  adminConfig: (token: string) => request<{ config: SystemConfig; defaultGarmentCategories: string[]; defaultGarmentServices: GarmentService[] }>("/v1/admin/config", { token }),
  adminUpdateConfig: (body: Record<string, unknown>, token: string) => request<{ config: SystemConfig }>("/v1/admin/config", { method: "PATCH", body, token }),
  adminAddService: (body: Partial<GarmentService> & { name: string }, token: string) =>
    request<{ service: GarmentService; config: SystemConfig }>("/v1/admin/config/services", { method: "POST", body, token }),
  adminUpdateService: (id: string, body: Partial<GarmentService>, token: string) =>
    request<{ service: GarmentService; config: SystemConfig }>(`/v1/admin/config/services/${id}`, { method: "PATCH", body, token }),
  adminRetireService: (id: string, token: string) =>
    request<{ config: SystemConfig }>(`/v1/admin/config/services/${id}`, { method: "DELETE", token }),

  // ------------------------------------------------------------- tracking
  getTracking: (orderId: string, token: string) => request<{ orderCode: string; state: string; timeline: { state: string; at: string; note?: string }[]; items: GarmentItem[]; stages: { state: string; label: string; status: string }[]; revision: number; updatedAt: string }>(`/v1/orders/${orderId}/tracking`, { token }),

  // ------------------------------------------------ round 6: batches and pickup

  // Requested against received, per Garment + Service combination.
  opsReconcile: (orderId: string, lines: { lineId: string; acceptedQuantity: number; acceptedMeasuredQuantity?: number }[], token: string) =>
    request<{ reconciliation: Reconciliation }>(`/v1/operations/orders/${orderId}/reconcile`, { method: "POST", body: { lines }, token }),
  opsBatches: (orderId: string, token: string) =>
    request<{ batches: ProcessingBatch[] }>(`/v1/operations/orders/${orderId}/batches`, { token }),
  opsAdvanceBatch: (orderId: string, batchId: string, step: string, token: string) =>
    request<{ order: OrderDetail; batches: ProcessingBatch[] }>(`/v1/operations/orders/${orderId}/batches/${batchId}/advance`, { method: "POST", body: { step }, token }),
  opsBatchQc: (orderId: string, batchId: string, passed: boolean, reason: string | undefined, token: string) =>
    request<{ order: OrderDetail; batches: ProcessingBatch[] }>(`/v1/operations/orders/${orderId}/batches/${batchId}/qc`, { method: "POST", body: { passed, reason }, token }),
  // Confirming quantities per combination, and collecting early when it is agreed.
  opsPickedUpLines: (
    orderId: string,
    body: { lines?: { lineId: string; acceptedQuantity: number; acceptedMeasuredQuantity?: number }[]; items?: GarmentItem[]; early?: boolean; earlyReason?: string },
    token: string,
  ) => request<{ order: OrderDetail }>(`/v1/operations/orders/${orderId}/picked-up`, { method: "POST", body, token }),

  // ------------------------------------------------- round 6: staff verification

  adminPendingStaff: (token: string, params: { status?: string; role?: string } = {}) =>
    request<{ staff: StaffUser[]; status: string }>(`/v1/admin/staff/pending${qs(params)}`, { token }),
  adminSetVerification: (id: string, status: "approved" | "rejected", note: string | undefined, token: string) =>
    request<{ user: StaffUser }>(`/v1/admin/staff/${id}/verification`, { method: "POST", body: { status, note }, token }),
  supPendingOperators: (token: string, params: { status?: string } = {}) =>
    request<{ operators: StaffUser[]; status: string }>(`/v1/supervisor/operators/pending${qs(params)}`, { token }),
  supSetOperatorVerification: (id: string, status: "approved" | "rejected", note: string | undefined, token: string) =>
    request<{ operator: StaffUser }>(`/v1/supervisor/operators/${id}/verification`, { method: "POST", body: { status, note }, token }),

  // -------------------------------------------------- round 6: resident schedules

  residentSchedules: (token: string) =>
    request<{ schedules: ScheduleView[]; frequencies: FrequencyOption[]; windows: string[] }>("/v1/resident/schedules", { token }),
  residentCreateSchedule: (body: { frequency: string; days?: number[]; window: string; startDate?: string }, token: string) =>
    request<{ schedule: ScheduleView }>("/v1/resident/schedules", { method: "POST", body, token }),
  residentUpdateSchedule: (id: string, body: Record<string, unknown>, token: string) =>
    request<{ schedule: ScheduleView }>(`/v1/resident/schedules/${id}`, { method: "PATCH", body, token }),
  residentCancelSchedule: (id: string, token: string) =>
    request<{ schedule: ScheduleView }>(`/v1/resident/schedules/${id}`, { method: "DELETE", token }),
  residentPreferences: (token: string) =>
    request<{ preferences: PickupPreferences }>("/v1/resident/preferences", { token }),
  residentSetPreferences: (preferredWindows: string[], token: string) =>
    request<{ preferences: PickupPreferences }>("/v1/resident/preferences", { method: "PUT", body: { preferredWindows }, token }),

  // -------------------------------------------- round 6: services that are not laundry

  serviceOfferings: (params: { kind?: string } = {}) =>
    request<{ offerings: ServiceOffering[]; kinds: { key: string; label: string }[] }>(`/v1/services/offerings${qs(params)}`),
  serviceQuote: (offeringId: string, estimatedHours: number | undefined, token: string) =>
    request<{ quote: ServiceQuote }>(`/v1/services/quote${qs({ offeringId, estimatedHours })}`, { token }),
  bookService: (body: Record<string, unknown>, token: string) =>
    request<{ request: ServiceRequestView }>("/v1/services/requests", { method: "POST", body, token }),
  myServiceRequests: (token: string) =>
    request<{ requests: ServiceRequestView[] }>("/v1/services/requests", { token }),
  cancelServiceRequest: (id: string, reason: string, token: string) =>
    request<{ request: ServiceRequestView }>(`/v1/services/requests/${id}/cancel`, { method: "POST", body: { reason }, token }),
  opsServices: (token: string, params: Record<string, string | boolean | undefined> = {}) =>
    request<{ requests: ServiceRequestView[]; page: PageInfo; statuses: string[]; kinds: { key: string; label: string }[] }>(`/v1/operations/services${qs(params)}`, { token }),
  opsAssignService: (id: string, staffUserId: string | undefined, token: string) =>
    request<{ request: ServiceRequestView }>(`/v1/operations/services/${id}/assign`, { method: "POST", body: staffUserId ? { staffUserId } : {}, token }),
  opsStartService: (id: string, token: string) =>
    request<{ request: ServiceRequestView }>(`/v1/operations/services/${id}/start`, { method: "POST", token }),
  opsCompleteService: (id: string, body: { actualHours?: number; note?: string }, token: string) =>
    request<{ request: ServiceRequestView }>(`/v1/operations/services/${id}/complete`, { method: "POST", body, token }),
  // The bookings made against the extra services. This used to be /v1/admin/services,
  // which is the path the catalogue needs and never described a list of bookings.
  adminServiceRequests: (token: string, params: Record<string, string | undefined> = {}) =>
    request<{ requests: ServiceRequestView[]; page: PageInfo; summary: ServiceSummary }>(`/v1/admin/service-requests${qs(params)}`, { token }),
  // The Services page: one list of every extra service, narrowed by whatever the
  // admin is looking for. Search and filters are answered by the backend, so the
  // export matches what was on screen rather than everything regardless.
  adminOfferings: (token: string, params: { q?: string; category?: string; eligibility?: string; status?: string; unit?: string } = {}) =>
    request<{ services: AdminServiceRow[]; filters: ServiceFilterOptions }>(`/v1/admin/services${qs(params)}`, { token }),
  adminOffering: (id: string, token: string) =>
    request<{ service: Record<string, unknown>; bookings: number }>(`/v1/admin/services/${id}`, { token }),
  adminCreateOffering: (body: Record<string, unknown>, token: string) =>
    request<{ service: Record<string, unknown> }>("/v1/admin/services", { method: "POST", body, token }),
  adminUpdateOffering: (id: string, body: Record<string, unknown>, token: string) =>
    request<{ service: Record<string, unknown>; openBookings: number }>(`/v1/admin/services/${id}`, { method: "PATCH", body, token }),
  adminDuplicateOffering: (id: string, token: string, name?: string) =>
    request<{ service: Record<string, unknown> }>(`/v1/admin/services/${id}/duplicate`, { method: "POST", body: { name }, token }),
  adminOfferingBookings: (id: string, token: string) =>
    request<{ bookings: ServiceRequestView[] }>(`/v1/admin/services/${id}/bookings`, { token }),

  // ------------------------------------------------------ round 6: issue lifecycle

  adminCloseIssue: (id: string, resolution: string | undefined, token: string) =>
    request<{ issue: Issue }>(`/v1/admin/issues/${id}/close`, { method: "POST", body: { resolution }, token }),
  adminReopenIssue: (id: string, reason: string, token: string) =>
    request<{ issue: Issue }>(`/v1/admin/issues/${id}/reopen`, { method: "POST", body: { reason }, token }),
  adminDiagnostics: (token: string) =>
    request<{ status: string; env: string; storage: string; time: string }>("/v1/admin/diagnostics", { token }),

};
