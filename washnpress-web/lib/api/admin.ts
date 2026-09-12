// Typed client for the admin portal, calling the real backend routes registered in
// washnpress-v2/src/app/routes/admin.ts. One function per endpoint, grouped the way
// the route file itself is grouped. Response shapes are trimmed to the fields the
// admin UI actually renders — see that file for the full shape of anything omitted
// here. Nothing here computes money or quantities; every figure comes straight off
// the response the backend sent.

import { req } from "@/lib/api-client";
import type { ServiceBookingRow } from "@/components/portal/service-bookings";

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export interface Page {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------- shared bits

export interface UserSummary {
  id: string;
  phone: string;
  fullName: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  roles: string[];
  status: "active" | "blocked" | "deleted" | "on_leave" | string;
  verificationStatus?: "pending" | "approved" | "rejected" | string;
  employeeId?: string | null;
  societyId?: string | null;
  societyName?: string | null;
  societyNames?: string[];
  societyCount?: number;
  supervisorUserId?: string | null;
  supervisorName?: string | null;
  blockIds?: string[];
  blockNames?: string[];
  blockCount?: number;
  flatsCovered?: number;
  residentSocietyId?: string | null;
  residentSocietyName?: string | null;
  societyLabel?: string | null;
  blockName?: string | null;
  unitNumber?: string | null;
  onboardingCompleted?: boolean | null;
  createdAt?: string;
}

export interface AuditEntry {
  id?: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  actor: string;
  actorName?: string | null;
  role?: string | null;
  at: string;
  previousValue?: unknown;
  newValue?: unknown;
}

// -------------------------------------------------------------------- dashboard

export interface AdminDashboard {
  supervisors: { total: number; active: number; inactive: number; unassigned: number };
  societies: { total: number; active: number; inactive: number };
  residents: { total: number; onboarded: number };
  operationsStaff: { total: number; active: number; unassigned: number };
  orders: {
    total: number; today: number; pending: number; active: number; completed: number;
    washing: number; ironing: number; qcPending: number; qcFailed: number;
    readyForDelivery: number; outForDelivery: number; delivered: number; deliveredToday: number;
    [key: string]: number;
  };
  operations: {
    pickups: { today: number; pending: number; completed: number; failed: number };
    processing: { stages: { key: string; label: string; count: number }[]; ironing: number; qcPending: number; qcFailed: number };
  };
  subscriptions: { total: number; active: number; paused: number; cancelled: number; expired: number };
  revenue: {
    subscriptionRevenuePaise: number; additionalGarmentRevenuePaise: number;
    pendingAdditionalChargesPaise: number; totalRevenuePaise: number;
  };
  issues: {
    total: number; open: number; inProgress: number; waitingResident: number; waitingOperator: number;
    assigned: number; escalatedSupervisor: number; escalatedAdmin: number; resolved: number; closed: number;
    pending: number; emergency: number; escalated: number;
  };
  societyPerformance: Array<{
    societyId: string; name: string; supervisorName: string | null;
    residents: number; operators: number; totalOrders: number; pendingOrders: number;
    deliveredOrders: number; delayedOrders: number; openIssues: number;
  }>;
  recentActivity: Array<{ id?: string; action: string; actor: string; role: string | null; resource: string; resourceId?: string | null; at: string }>;
  alerts: Array<{ kind: string; label: string; count: number; severity: "critical" | "warning" | "notice" }>;
}

export interface CoverageRow {
  societyId: string;
  societyName: string;
  supervisorUserId: string | null;
  supervisorName: string | null;
  supervisorStatus: string | null;
  covered: boolean;
  needsAdminCover: boolean;
}

// -------------------------------------------------------------------- societies

export interface Address {
  house?: string; street?: string; locality?: string; city?: string; state?: string; pincode?: string;
}
// The society naming convention — one set of styles that names every tower, floor
// and flat, chosen once and stored on the society as the single source of truth.
export interface NamingConvention { tower: string; floor: string; flat: string }
export interface NamingStyleOption { value: string; label: string; example: string }
export interface NamingStyles { tower: NamingStyleOption[]; floor: NamingStyleOption[]; flat: NamingStyleOption[] }
export type NamingPreview = { tower: string; floors: { floor: string; flats: string[] }[] }[];
export interface Block {
  id: string; name: string; societyId?: string; flatCount?: number; floorCount?: number;
  status?: string; operators?: Array<{ id: string; fullName: string | null }>;
}
export interface SocietySummary {
  id: string; name: string; status: string; addressLine?: string; address?: Address;
  naming?: Record<string, string>;
  supervisorUserId: string | null; supervisorName: string | null;
  blocks: Block[];
  residentCount?: number; operatorCount?: number; orderCount?: number; slotCount?: number;
  [key: string]: unknown;
}

// ----------------------------------------------------------------------- orders

// One resident of a society, as GET /v1/admin/societies/:id returns them: the whole
// resident record plus the four fields resolved from their user and their block.
// Typed because the Society drawer's resident list reads them by name (I-110).
export interface SocietyResidentRow {
  id: string; userId: string; unitNumber: string;
  towerBlock: string | null; blockName?: string | null; blockId?: string | null;
  fullName: string | null; phone: string | null; status: string | null;
  onboardingCompleted: boolean; onboardedAt: string | null;
  [key: string]: unknown;
}

export interface OrderSummary {
  id: string; orderCode: string; state: string; createdAt: string;
  residentId: string; residentName: string | null; residentPhone: string | null; unitNumber: string | null;
  societyId: string; societyName: string | null; blockId: string | null; blockName: string | null;
  acceptedCount: number | null; subscriptionCoveredCount: number | null; additionalCount: number | null;
  additionalChargePaise: number | null; additionalChargeStatus: string | null; payPerOrder: boolean;
  // What was asked for, named once each. Optional so an older payload still reads.
  serviceNames?: string[];
  servicesPaise: number; assignedOperatorUserId: string | null; operatorName: string | null;
  qcPassed: boolean | null; qcReason: string | null; delayed?: boolean;
  [key: string]: unknown;
}

export interface OrderDetail extends OrderSummary {
  nextActions: Array<{ to: string; label: string }>;
  issues: unknown[];
  timeline: Array<{ state: string; at: string; note?: string }>;
  [key: string]: unknown;
}

export interface SubscriptionSummary {
  id: string; residentId: string; planId: string; status: string;
  planTier: string | null; monthlyPaise: number | null; allowance: number | null; remaining: number | null;
  residentName: string | null; residentPhone: string | null; societyName: string | null;
  garmentsUsed: number; cycleStart: string; cycleEnd: string;
  [key: string]: unknown;
}

// -------------------------------------------------------------------- catalogue

export interface Plan {
  id: string; tier: string; name: string; description: string | null;
  garmentCap: number; turnaroundHours: number; monthlyPaise: number; annualDiscountPercent: number;
  isActive: boolean; coveredServiceIds?: string[]; services?: unknown[];
  subscribers?: number; activeSubscribers?: number; garmentsUsed?: number; revenuePaise?: number;
  [key: string]: unknown;
}

// Field names here match GET /v1/admin/services' describeOffering() output, which
// differs from the offeringSchema write body (unitPricePaise / subscriberUnitPricePaise)
// — the backend computes/renames these for the list view rather than echoing storage.
export interface ServiceOffering {
  id: string; name: string; category: string; unit: string; nonSubscriberPricePaise: number;
  subscriberPricePaise?: number | null; isActive?: boolean; status?: string;
  [key: string]: unknown;
}

export type ChargingType = "per_order" | "per_kg" | "per_piece";
export interface AdditionalCharge {
  id: string; name: string; chargingType: ChargingType; amountPaise: number;
  isActive: boolean; createdAt: string; updatedAt: string;
}
export interface WorkingHoursDay { enabled: boolean; start: string; end: string }
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WorkingHours = Record<Weekday, WorkingHoursDay>;

export interface CategoryGarment { name: string; pricePaise: number }
export interface GarmentGroup {
  id: string; name: string; description?: string;
  status: "active" | "inactive";
  items: CategoryGarment[];
}

export interface SystemConfig {
  id: string;
  additionalGarmentRatePaise: number;
  nonSubscriberGarmentRatePaise: number;
  garmentPricesPaise?: Record<string, number>;
  garmentServices: Array<{
    id: string; name: string; unitPricePaise: number; isBase?: boolean; isActive?: boolean;
    unit?: string; requiresClean?: boolean; requiresPress?: boolean; cleanStage?: string;
    pricesPaise?: Record<string, number>; subscriberPricesPaise?: Record<string, number>;
    minimumBillable?: number | null;
  }>;
  garmentCategories: string[];
  garmentCategoryStatus?: Record<string, boolean>;
  garmentGroups?: GarmentGroup[];
  defaultSlotCapacity: number;
  defaultTurnaroundHours: number;
  delayGraceHours: number;
  slotDurationMinutes?: number;
  workingHours?: WorkingHours;
  advanceBookingDays?: number;
  cancellationWindowHours?: number;
  autoClosePastSlots?: boolean;
  additionalCharges?: AdditionalCharge[];
  qcRequired: boolean;
  notificationsEnabled: boolean;
  gstEnabled: boolean;
  gstRatePercent: number;
  [key: string]: unknown;
}

// ------------------------------------------------------------------------ slots

export interface ServiceSlot {
  id: string; societyId: string; date: string; offeringId: string; offeringName: string;
  window: "Morning" | "Afternoon" | "Evening"; capacityTotal: number; capacityRemaining: number; isActive: boolean;
}

export interface Slot {
  id: string; societyId: string; date: string; window: string; startTime: string; endTime: string;
  capacityTotal: number; capacityRemaining: number; isActive: boolean; subscribersOnly?: boolean;
  status?: string; societyName?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------- issues

export interface Issue {
  id: string; type?: string; category?: string; description: string; status: string; priority: string;
  residentId?: string | null; orderId?: string | null; societyId?: string | null;
  assignedToUserId?: string | null; assignedToName?: string | null;
  createdAt?: string; escalated?: boolean;
  [key: string]: unknown;
}

// ----------------------------------------------------------------- integrations

export interface IntegrationChannel { name: string; provider: string; enabled: boolean; live: boolean; missing: string[] }
export interface Integrations {
  notifications: IntegrationChannel[];
  payments: { provider: string; currency: string; gatewayConfigured: boolean; methods: Array<{ method: string; enabled: boolean; offered: boolean; blockedBy: string | null }> };
  support: { phone: boolean; whatsapp: boolean; email: boolean; hours: boolean };
}

// =====================================================================================

// The shared report filter: a from/to date range and an optional society, applied to
// every report tab from one filter bar.
export type ReportFilter = { from?: string; to?: string; societyId?: string };

// The Reports tabs. Each was two or four numbers, which says how many of a thing
// exist and nothing an admin opens Reports to ask.

export interface SubscriptionsReport {
  total: number; active: number; paused: number; cancelled: number; expired: number;
  // Subscriptions whose next cycle is already booked to a different plan.
  changing: number;
  subscriptionRevenuePaise: number;
  // Only plans somebody is on or has paid for. A distribution padded with zeroes is
  // a list of the catalogue, not a report.
  byPlan: Array<{ planId: string; planName: string; subscribers: number; active: number; revenuePaise: number }>;
}

export interface RevenueReportTotals {
  subscriptionRevenuePaise: number;
  addonRevenuePaise: number;
  cancellationFeePaise: number;
  reschedulingFeePaise: number;
  refundedPaise: number;
  // Held on behalf of the tax authority, and reported apart from revenue so a total
  // cannot be mistaken for earnings.
  taxCollectedPaise: number;
  grossPaise: number;
  netPaise: number;
}

export interface OperationsReport {
  totalOrders: number;
  byState: Record<string, number>;
  completed: number; cancelled: number; delayed: number; inProgress: number;
  // Null rather than 0 when the period has no orders: "0% completed" reads as a
  // failure, and an empty period is not one.
  completionRate: number | null; delayRate: number | null; cancellationRate: number | null;
  // Only the days there is something to draw.
  trend: Array<{ day: string; completed: number; delayed: number; cancelled: number; total: number }>;
}


export const adminApi = {
  dashboard: () => req<AdminDashboard>("/v1/admin/dashboard"),
  coverage: () => req<{ coverage: CoverageRow[]; needingCover: CoverageRow[] }>("/v1/admin/coverage"),

  setAvailability: (userId: string, body: { status: "active" | "on_leave" | "blocked"; reassignToUserId?: string | null; reason?: string }) =>
    req<{ user: UserSummary; reassigned: boolean; returnedToQueue?: unknown }>(`/v1/admin/users/${userId}/availability`, { method: "POST", body }),

  users: {
    list: (query: Record<string, string | undefined> = {}) =>
      req<{ page: Page; societies: { id: string; name: string }[]; users: UserSummary[] }>(`/v1/admin/users${qs(query)}`),
    get: (id: string) =>
      req<{
        user: UserSummary;
        resident: { id: string; unitNumber: string | null; societyId: string; blockId?: string | null; blockName?: string | null; floor?: number | null } | null;
        orders: OrderSummary[];
        subscription: (Record<string, unknown> & { planName?: string | null; planTier?: string; monthlyPaise?: number; allowance?: number; used?: number; remaining?: number; renewalDate?: string; status?: string }) | null;
        previousSubscriptions: { id: string; planId: string; status: string; cycleStart: string; cycleEnd: string }[];
      }>(`/v1/admin/users/${id}`),
    setStatus: (id: string, status: "active" | "blocked" | "deleted") =>
      req<{ user: UserSummary }>(`/v1/admin/users/${id}/status`, { method: "PATCH", body: { status } }),
  },

  staff: {
    pending: (query: { status?: string; role?: string } = {}) =>
      req<{ staff: UserSummary[]; status: string }>(`/v1/admin/staff/pending${qs(query)}`),
    verify: (id: string, body: { status: "approved" | "rejected"; note?: string }) =>
      req<{ user: UserSummary }>(`/v1/admin/staff/${id}/verification`, { method: "POST", body }),
  },

  supervisors: {
    list: (query: { status?: string; assigned?: string; q?: string } = {}) =>
      req<{ supervisors: UserSummary[]; societies: { id: string; name: string; supervisorUserId: string | null }[] }>(`/v1/admin/supervisors${qs(query)}`),
    get: (id: string) =>
      req<{ supervisor: UserSummary; societies: SocietySummary[]; blocks: Block[]; operators: UserSummary[]; orders: OrderSummary[] }>(`/v1/admin/supervisors/${id}`),
    create: (body: { firstName: string; lastName: string; phone: string; email?: string; societyId: string }) =>
      req<{ supervisor: UserSummary }>("/v1/admin/supervisors", { method: "POST", body }),
    update: (id: string, body: Record<string, unknown>) =>
      req<{ supervisor: UserSummary }>(`/v1/admin/supervisors/${id}`, { method: "PATCH", body }),
  },

  operators: {
    list: (query: { q?: string; societyId?: string; blockId?: string; availability?: string; supervisorUserId?: string } = {}) =>
      req<{ operators: UserSummary[]; societies: { id: string; name: string }[]; blocks: { id: string; name: string; societyId: string }[]; supervisors: { id: string; fullName: string | null }[] }>(`/v1/admin/operators${qs(query)}`),
    create: (body: { firstName: string; lastName: string; phone: string; email: string; societyId: string; blockIds?: string[] }) =>
      req<{ operator: UserSummary }>("/v1/admin/operators", { method: "POST", body }),
    update: (id: string, body: Record<string, unknown>) =>
      req<{ operator: UserSummary }>(`/v1/admin/operators/${id}`, { method: "PATCH", body }),
  },

  societies: {
    list: (query: { supervisorUserId?: string; q?: string; status?: string } = {}) =>
      req<{ societies: SocietySummary[]; supportedStates: string[] }>(`/v1/admin/societies${qs(query)}`),
    get: (id: string) =>
      req<{ society: SocietySummary; residents: SocietyResidentRow[]; operators: UserSummary[]; slots: Slot[]; orders: OrderSummary[] }>(`/v1/admin/societies/${id}`),
    create: (body: { name: string; address: Address; blocks?: { name: string; floorCount?: number; flatCount?: number }[]; naming?: NamingConvention }) =>
      req<{ society: SocietySummary }>("/v1/admin/societies", { method: "POST", body }),
    // The naming styles on offer, and a live preview of what a given convention
    // produces — the single source of truth the whole society is named from.
    naming: (q: { tower?: string; floor?: string; flat?: string; towers?: number; floors?: number; flatsPerFloor?: number } = {}) =>
      req<{ styles: NamingStyles; convention: NamingConvention; preview: NamingPreview }>(`/v1/admin/naming${qs(q)}`),
    update: (id: string, body: Record<string, unknown>) =>
      req<{ society: SocietySummary }>(`/v1/admin/societies/${id}`, { method: "PATCH", body }),
    assignments: (id: string) =>
      req<{
        society?: SocietySummary; supervisorUserId?: string | null;
        supervisorOptions: Array<{ id: string; fullName: string | null; phone: string; employeeId?: string | null; heldSocietyName: string | null }>;
        operatorOptions: Array<{ id: string; fullName: string | null; phone: string; status: string }>;
        blocks?: Block[];
        [key: string]: unknown;
      }>(`/v1/admin/societies/${id}/assignments`),
    setSupervisor: (id: string, supervisorUserId: string | null) =>
      req<{ society: SocietySummary }>(`/v1/admin/societies/${id}/supervisor`, { method: "PUT", body: { supervisorUserId } }),
    addBlock: (societyId: string, body: { name: string; floorCount?: number; flatCount?: number }) =>
      req<{ block: Block }>(`/v1/admin/societies/${societyId}/blocks`, { method: "POST", body }),
    updateBlock: (blockId: string, body: Record<string, unknown>) =>
      req<{ block: Block }>(`/v1/admin/blocks/${blockId}`, { method: "PATCH", body }),
    setBlockOperators: (blockId: string, operatorUserIds: string[]) =>
      req<{ block: Block }>(`/v1/admin/blocks/${blockId}/operators`, { method: "PUT", body: { operatorUserIds } }),
  },

  orders: {
    list: (query: Record<string, string | undefined> = {}) =>
      req<{ orders: OrderSummary[]; page: Page; stateLabels: Record<string, string> }>(`/v1/admin/orders${qs(query)}`),
    get: (id: string) => req<{ order: OrderDetail }>(`/v1/admin/orders/${id}`),
    assign: (id: string, body: { operatorUserId?: string | null; reason?: string }) =>
      req<{ order: OrderDetail; reassigned: boolean }>(`/v1/admin/orders/${id}/assign`, { method: "POST", body }),
  },

  subscriptions: {
    list: (query: Record<string, string | undefined> = {}) =>
      req<{ subscriptions: SubscriptionSummary[]; page: Page }>(`/v1/admin/subscriptions${qs(query)}`),
    get: (id: string) =>
      req<{
        subscription: SubscriptionSummary & { usagePercent: number | null };
        resident: Record<string, unknown> | null;
        services: unknown[];
        previousSubscriptions: Array<Record<string, unknown>>;
        payments: Array<Record<string, unknown>>;
        activity: Array<{ action: string; at: string; actor: string; role: string | null; previousValue: unknown; newValue: unknown }>;
      }>(`/v1/admin/subscriptions/${id}`),
  },

  revenue: {
    report: (query: Record<string, string | undefined> = {}) =>
      req<{
        range: { from: string; to: string; label: string };
        summary: Record<string, number>;
        filters: {
          societies: { id: string; name: string }[]; blocks: { id: string; name: string; societyId: string }[];
          supervisors: { id: string; name: string | null }[]; operators: { id: string; name: string | null }[];
          plans: { id: string; name: string }[];
        };
        [key: string]: unknown;
      }>(`/v1/admin/revenue${qs(query)}`),
    transactions: (query: Record<string, string | undefined> = {}) =>
      req<{
        transactions: Array<Record<string, unknown>>; page: Page; tally: Record<string, number>;
        range: { from: string; to: string }; types: { key: string; label: string }[]; statuses: { key: string; label: string }[];
      }>(`/v1/admin/revenue/transactions${qs(query)}`),
  },

  plans: {
    list: () => req<{ plans: Plan[] }>("/v1/admin/plans"),
    create: (body: Record<string, unknown>) => req<{ plan: Plan; pricing: unknown }>("/v1/admin/plans", { method: "POST", body }),
    update: (id: string, body: Record<string, unknown>) =>
      req<{ plan: Plan; pricing: unknown; activeSubscriptions: number }>(`/v1/admin/plans/${id}`, { method: "PATCH", body }),
    remove: (id: string) => req<{ deleted: boolean }>(`/v1/admin/plans/${id}`, { method: "DELETE" }),
  },

  services: {
    list: (query: { q?: string; category?: string; eligibility?: string; status?: string; unit?: string } = {}) =>
      req<{ services: ServiceOffering[]; filters: { categories: { key: string; label: string }[]; eligibilities: string[]; units: string[]; statuses: string[] } }>(`/v1/admin/services${qs(query)}`),
    get: (id: string) => req<{ service: Record<string, unknown>; bookings: number }>(`/v1/admin/services/${id}`),
    create: (body: Record<string, unknown>) => req<{ service: ServiceOffering }>("/v1/admin/services", { method: "POST", body }),
    update: (id: string, body: Record<string, unknown>) =>
      req<{ service: ServiceOffering; openBookings: number }>(`/v1/admin/services/${id}`, { method: "PATCH", body }),
    bookings: (id: string) => req<{ bookings: unknown[] }>(`/v1/admin/services/${id}/bookings`),
  },

  // Every additional-service booking a resident made, across all societies (I-82).
  serviceRequests: (query: { status?: string; offeringId?: string; societyId?: string; from?: string; to?: string } = {}) =>
    req<{ requests: ServiceBookingRow[]; offerings: { id: string; name: string }[]; societies: { id: string; name: string }[] }>(`/v1/admin/service-requests${qs(query)}`),

  serviceSlots: {
    list: (query: { societyId?: string; date?: string; offeringId?: string } = {}) =>
      req<{ slots: ServiceSlot[] }>(`/v1/admin/service-slots${qs(query)}`),
    create: (body: { societyId: string; date: string; offeringId: string; window: "Morning" | "Afternoon" | "Evening"; capacity: number }) =>
      req<{ slot: ServiceSlot }>("/v1/admin/service-slots", { method: "POST", body }),
  },

  slots: {
    list: (query: Record<string, string | undefined> = {}) =>
      req<{
        slots: Slot[]; shifts: string[]; slotWindows: Record<string, unknown>;
        statuses: string[]; bookingStatuses: string[]; utilisationBands: string[];
        [key: string]: unknown;
      }>(`/v1/admin/slots${qs(query)}`),
    create: (body: { societyId: string; date: string; window: string; capacityTotal: number; subscribersOnly?: boolean }) =>
      req<{ slot: Slot }>("/v1/admin/slots", { method: "POST", body }),
    update: (id: string, body: Record<string, unknown>) =>
      req<{ slot: Slot }>(`/v1/admin/slots/${id}`, { method: "PATCH", body }),
    cancel: (id: string) => req<{ slot: Slot }>(`/v1/admin/slots/${id}/cancel`, { method: "POST" }),
    bookings: (id: string) =>
      req<{ slot: Record<string, unknown>; bookings: Array<Record<string, unknown>> }>(`/v1/admin/slots/${id}/bookings`),
  },

  reports: {
    overview: (query: { from?: string; to?: string; societyId?: string; blockId?: string; supervisorUserId?: string; state?: string } = {}) =>
      req<{
        byBlock: Array<{ blockId: string; blockName: string; unassigned: boolean; [k: string]: unknown }>;
        bySociety: Array<{ societyId: string; societyName: string; residents: number; [k: string]: unknown }>;
        bySupervisor: Array<{ societyId: string; societyName: string; supervisorName: string | null; unassigned: boolean; [k: string]: unknown }>;
        byOperator: Array<{ operatorUserId: string; operatorName: string; unassigned: boolean; [k: string]: unknown }>;
        residents: { residents: number; onboarded: number; pendingOnboarding: number; withActiveSubscription: number };
        subscriptions: { byPlan: Array<{ planId: string; tier: string; subscribers: number; activeSubscribers: number; garmentsUsed: number; allowance: number; [k: string]: unknown }>; [k: string]: unknown };
        issues: { total: number; open: number; escalated: number; inProgress: number; resolved: number; closed: number; emergency: number; byType: { type: string; count: number }[] };
        revenue: { subscriptionRevenuePaise: number; additionalGarmentRevenuePaise: number; pendingAdditionalChargesPaise: number; totalRevenuePaise: number; addonRevenuePaise: number };
      }>(`/v1/admin/reports${qs(query)}`),
    subscriptions: (query: ReportFilter = {}) => req<SubscriptionsReport>(`/v1/admin/reports/subscriptions${qs(query)}`),
    revenue: (query: ReportFilter = {}) => req<RevenueReportTotals>(`/v1/admin/reports/revenue${qs(query)}`),
    operations: (query: ReportFilter = {}) => req<OperationsReport>(`/v1/admin/reports/operations${qs(query)}`),
    sustainability: (query: ReportFilter = {}) => req<{ litersUsed: number; litersSaved: number }>(`/v1/admin/reports/sustainability${qs(query)}`),
    garmentRisk: (query: ReportFilter = {}) => req<{ incidents: number; ordersProcessed: number }>(`/v1/admin/reports/garment-risk${qs(query)}`),
  },

  issues: {
    list: (query: Record<string, string | undefined> = {}) =>
      req<{ issues: Issue[]; page: Page; issueTypes: string[]; priorities: string[]; assignees: { id: string; name: string; role: string | null }[] }>(`/v1/admin/issues${qs(query)}`),
    analytics: (query: Record<string, string | undefined> = {}) =>
      req<{ analytics: Record<string, unknown>; filtered: boolean }>(`/v1/admin/issues/analytics${qs(query)}`),
    get: (id: string) => req<{ issue: Issue & { thread?: unknown[] } }>(`/v1/admin/issues/${id}`),
    reply: (id: string, body: string) => req<{ issue: Issue }>(`/v1/admin/issues/${id}/reply`, { method: "POST", body: { body } }),
    setStatus: (id: string, status: string, resolution?: string) =>
      req<{ issue: Issue }>(`/v1/admin/issues/${id}/status`, { method: "PATCH", body: { status, resolution } }),
    setPriority: (id: string, priority: string) =>
      req<{ issue: Issue }>(`/v1/admin/issues/${id}/priority`, { method: "PATCH", body: { priority } }),
    assign: (id: string, userId: string | null) =>
      req<{ issue: Issue }>(`/v1/admin/issues/${id}/assign`, { method: "POST", body: { userId } }),
    close: (id: string, resolution?: string) =>
      req<{ issue: Issue }>(`/v1/admin/issues/${id}/close`, { method: "POST", body: { resolution } }),
    reopen: (id: string, reason: string) =>
      req<{ issue: Issue }>(`/v1/admin/issues/${id}/reopen`, { method: "POST", body: { reason } }),
  },

  audit: {
    list: (query: Record<string, string | undefined> = {}) =>
      req<{ entries: AuditEntry[]; page: Page }>(`/v1/admin/audit${qs(query)}`),
  },

  config: {
    get: () => req<{ config: SystemConfig; defaultGarmentCategories: string[]; defaultGarmentServices: unknown[] }>("/v1/admin/config"),
    update: (body: Record<string, unknown>) => req<{ config: SystemConfig }>("/v1/admin/config", { method: "PATCH", body }),
    addService: (body: Record<string, unknown>) =>
      req<{ service: unknown; config: SystemConfig }>("/v1/admin/config/services", { method: "POST", body }),
    updateService: (id: string, body: Record<string, unknown>) =>
      req<{ service: unknown; config: SystemConfig }>(`/v1/admin/config/services/${id}`, { method: "PATCH", body }),
    retireService: (id: string) =>
      req<{ config: SystemConfig }>(`/v1/admin/config/services/${id}`, { method: "DELETE" }),
  },

  charges: {
    create: (body: { name: string; chargingType: ChargingType; amountPaise: number; isActive?: boolean }) =>
      req<{ charge: AdditionalCharge; config: SystemConfig }>("/v1/admin/charges", { method: "POST", body }),
    update: (id: string, body: Partial<{ name: string; chargingType: ChargingType; amountPaise: number; isActive: boolean }>) =>
      req<{ charge: AdditionalCharge; config: SystemConfig }>(`/v1/admin/charges/${id}`, { method: "PATCH", body }),
  },

  // I-71: two-level garment categories.
  garmentCategories: {
    create: (body: { name: string; description?: string; status: "active" | "inactive"; items: CategoryGarment[] }) =>
      req<{ category: GarmentGroup }>("/v1/admin/garment-categories", { method: "POST", body }),
    update: (id: string, body: { name: string; description?: string; status: "active" | "inactive"; items: CategoryGarment[] }) =>
      req<{ category: GarmentGroup }>(`/v1/admin/garment-categories/${id}`, { method: "PATCH", body }),
    remove: (id: string) => req<{ deleted: boolean }>(`/v1/admin/garment-categories/${id}`, { method: "DELETE" }),
  },

  integrations: {
    get: () => req<Integrations>("/v1/admin/integrations"),
  },
};
