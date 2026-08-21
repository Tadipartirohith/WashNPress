export type Role = "resident" | "operator" | "supervisor" | "admin" | "support";
export type Portal = "resident" | "operations" | "supervisor" | "admin";

export interface Plan {
  coveredServiceIds?: string[]; id: string; tier: string; garmentCap: number; turnaroundHours: number; monthlyPaise: number; annualDiscountPercent: number; isActive?: boolean; isCurrent?: boolean }
export interface PlanUsage extends Plan {
  coveredServiceIds?: string[]; subscribers: number; activeSubscribers: number; garmentsUsed: number; allowance: number; revenuePaise: number }

export interface Slot {
  id: string; societyId?: string; societyName?: string | null; date: string; window: string;
  startTime: string; endTime: string; capacityTotal?: number; capacityRemaining: number;
  bookedCount?: number; full?: boolean; isActive?: boolean;
}

export interface GarmentItem { category: string; quantity: number }

export type CleanStage = "wash" | "dry_clean" | "premium";

export interface GarmentPrice {
  category: string;
  payAsYouGoPaise: number;
}

export interface ServicePricing {
  id: string;
  name: string;
  isBase: boolean;
  requiresClean: boolean;
  cleanStage: CleanStage;
  requiresPress: boolean;
  coveredBySubscription: boolean;
  perGarment: GarmentPrice[];
}

export interface PriceList {
  garments: GarmentPrice[];
  services: ServicePricing[];
  subscription: {
    planTier: string;
    allowance: number;
    used: number;
    remaining: number;
    coveredServiceIds: string[];
    additionalRatePaise: number;
  } | null;
  hasSubscription: boolean;
  nonSubscriberGarmentRatePaise: number;
  additionalGarmentRatePaise: number;
}

export type SlotStatus = "open" | "full" | "cancelled" | "closed";
export type SlotBookingStatus = "available" | "partially_booked" | "fully_booked";

export interface MonitoredSlot extends Slot {
  societyName: string | null;
  areaId: string | null;
  areaName: string | null;
  supervisorUserId: string | null;
  supervisorName: string | null;
  operatorUserId: string | null;
  operatorName: string | null;
  operatorCount: number;
  shift: string;
  bookedCount: number;
  availableCount: number;
  utilisationPercent: number;
  status: SlotStatus;
  bookingStatus: SlotBookingStatus;
  readOnly: boolean;
}

export interface SlotSummary {
  totalSlots: number;
  openSlots: number;
  fullSlots: number;
  closedSlots: number;
  cancelledSlots: number;
  totalCapacity: number;
  totalBookings: number;
  totalAvailable: number;
  utilisationPercent: number;
}

export interface RevenueBucket {
  id: string | null;
  name: string;
  orders: number;
  completedOrders: number;
  cancelledOrders: number;
  garmentChargePaise: number;
  servicesPaise: number;
  revenuePaise: number;
  activeSubscribers?: number;
}

export interface ChargedOrderRow {
  id: string;
  orderCode: string;
  createdAt: string;
  state: string;
  residentName: string | null;
  unitNumber: string | null;
  societyName: string | null;
  areaName: string | null;
  supervisorName: string | null;
  operatorName: string | null;
  acceptedCount: number | null;
  servicesPaise: number;
  additionalChargePaise: number;
  totalPaise: number;
  paymentStatus: string;
}

export interface RevenueReport {
  range: { from?: string; to?: string; preset: string; label: string };
  summary: {
    totalRevenuePaise: number;
    subscriptionRevenuePaise: number;
    orderRevenuePaise: number;
    pendingPaise: number;
    refundedPaise: number;
    netRevenuePaise: number;
    orders: number;
    chargedOrders: number;
    narrowed: boolean;
  };
  byArea: RevenueBucket[];
  bySociety: RevenueBucket[];
  bySupervisor: RevenueBucket[];
  byOperator: RevenueBucket[];
  byPlan: RevenueBucket[];
  chargedOrders: ChargedOrderRow[];
  pendingCharges: ChargedOrderRow[];
  paymentStatuses: string[];
  presets: { value: string; label: string }[];
  filters: {
    areas: { id: string; name: string }[];
    societies: { id: string; name: string; areaId: string | null }[];
    supervisors: { id: string; name: string | null; areaId: string | null }[];
    operators: { id: string; name: string | null; areaId: string | null; societyIds: string[] }[];
    plans: { id: string; name: string }[];
  };
}

export interface ProcessingRequirement {
  requiresClean: boolean;
  cleanStage: CleanStage;
  requiresPress: boolean;
}

export interface ProcessingLine {
  id: string;
  category: string;
  quantity: number;
  serviceName: string;
  coveredByPlan: boolean;
  stages: { key: string; label: string }[];
}

export interface OrderProcessing extends ProcessingRequirement {
  cleanLabel: string;
  lines: ProcessingLine[];
}

export interface NextAction {
  to: string;
  label: string;
}

export interface PendingPlanChange {
  planId: string;
  tier: string;
  monthlyPaise: number;
  allowance: number;
  turnaroundHours: number;
  effectiveFrom: string;
  direction: "upgrade" | "downgrade" | "sidegrade";
  canCancel: boolean;
}

export interface GarmentService {
  id: string; name: string; unitPricePaise: number; isBase: boolean; isActive: boolean;
  // Price per garment category. A category left out falls back to unitPricePaise.
  pricesPaise?: Record<string, number>;
  // What physically has to happen to a garment sent for this service, which is what
  // decides the stages an order carrying it goes through.
  requiresClean?: boolean;
  cleanStage?: CleanStage;
  requiresPress?: boolean;
}

// One garment category can be split across several services in the same order.
export interface OrderLine {
  coveredByPlan?: boolean;
  requiresClean?: boolean;
  cleanStage?: CleanStage;
  requiresPress?: boolean;
  id: string; category: string; quantity: number;
  serviceId: string; serviceName: string; addonIds: string[];
  serviceUnitPricePaise: number; addonsPaise: number; linePricePaise: number;
  notes: string | null;
}

export interface LineRequest {
  category: string; quantity: number; serviceId: string;
  addonIds?: string[]; notes?: string;
}
export interface TimelineEntry { state: string; at: string; note?: string; actorUserId?: string | null }
export interface Stage { state: string; label: string; status: "completed" | "current" | "pending" }

export interface OrderSummary {
  processing?: ProcessingRequirement;
  nextActions?: NextAction[];
  id: string; orderCode: string; state: string; createdAt: string;
  residentId: string; residentName: string | null; residentPhone: string | null; unitNumber: string | null;
  societyId: string; societyName: string | null; areaId: string | null;
  acceptedCount: number | null; subscriptionCoveredCount: number | null;
  additionalCount: number | null; additionalChargePaise: number | null; additionalChargeStatus: string;
  assignedOperatorUserId: string | null; operatorName: string | null;
  qcPassed: boolean | null; qcReason: string | null; pickupFailureReason: string | null;
  expectedCompletionAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  ironingStarted?: boolean; delayed: boolean; delayMinutes: number;
  payPerOrder?: boolean; servicesPaise?: number;
  qcStatus?: string;
}

export interface OrderDetail extends OrderSummary {
  processing?: OrderProcessing;
  nextActions?: NextAction[];
  items: GarmentItem[]; timeline: TimelineEntry[]; stages: Stage[];
  qrBatchCode: string | null; estimatedCount: number | null; deliveryCount: number | null;
  additionalRatePaise: number | null; discrepancyReason: string | null;
  pickupAddress: string | null; areaName: string | null; planTier: string | null;
  remainingAllowance: number; turnaroundHours: number;
  hasSubscription: boolean; lines: OrderLine[]; servicesPaise: number;
  slot: { id: string; date: string; window: string; startTime: string; endTime: string } | null;
  issues: Issue[];
}

export interface GarmentSummary {
  acceptedCount: number; subscriptionCoveredCount: number; additionalCount: number;
  additionalRatePaise: number; additionalChargePaise: number;
  planTier: string | null; remainingAllowance: number;
}

export interface Subscription { id: string; planId: string; status: string; cycle: string; garmentsUsed: number; pendingPlanId: string | null }
export interface SubscriptionUsage {
  pendingPlan?: PendingPlanChange | null;
  coveredServiceIds?: string[];
  subscriptionId: string; planId: string; planTier: string; monthlyPaise: number; turnaroundHours: number;
  allowance: number; used: number; remaining: number; usedPercent: number;
  cycle: string; cycleStart: string; renewalDate: string; expiryDate: string; status: string;
  pendingPlanId: string | null; autoRenew: boolean;
}

export interface WalletTransaction { reference: string; direction: string; amountPaise: number; at: string }
export interface PaymentOrder { providerOrderId: string; amountPaise: number; currency: string }

export type IssueStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";
export type IssuePriority = "low" | "normal" | "high" | "emergency";

export interface IssueMessage {
  author: string; authorRole: string | null; authorName?: string | null; body: string; at: string;
}

export interface Issue {
  id: string; residentId: string | null; orderId: string | null; societyId: string | null; areaId: string | null;
  category: string; description: string; status: IssueStatus; priority: IssuePriority;
  reportedByUserId: string | null; reportedByRole: string | null; assignedToUserId: string | null;
  resolution: string | null; resolvedAt: string | null; closedAt: string | null; escalatedToAdmin: boolean;
  messages: IssueMessage[]; createdAt: string;
  // Present on the decorated view every support screen renders.
  residentName?: string | null; residentPhone?: string | null; unitNumber?: string | null;
  societyName?: string | null; areaName?: string | null; assignedToName?: string | null;
  order?: { id: string; orderCode: string; state: string; acceptedCount: number | null; operatorName: string | null } | null;
  ageHours?: number; resolutionMinutes?: number | null;
}

export interface IssueCountRow { key: string; label: string; total: number; open: number; resolved: number }

export interface IssueAnalytics {
  total: number; open: number; assigned: number; inProgress: number; resolved: number; closed: number;
  pending: number; emergency: number; escalated: number; orderRelated: number;
  averageResolutionMinutes: number | null;
  byArea: IssueCountRow[]; bySociety: IssueCountRow[]; bySupervisor: IssueCountRow[];
  byCategory: IssueCountRow[]; byPriority: IssueCountRow[];
  ageing: { id: string; category: string; priority: string; status: string; createdAt: string; ageHours: number }[];
}

export interface Notification { id: string; type: string; title: string; body: string; orderId: string | null; read: boolean; createdAt: string }

export interface Area {
  id: string; name: string; code: string; description: string | null; region: string | null;
  status: string; supervisorUserId: string | null; supervisorName?: string | null;
  societyCount?: number; residentCount?: number; operationsStaffCount?: number; orderCount?: number;
}

export interface Society {
  id: string; name: string; code: string; areaId: string | null; areaName?: string | null;
  address: string | null; city: string; state: string; status: string;
  supervisorName?: string | null; residentCount?: number; operationsStaffCount?: number;
  orderCount?: number; activeOrderCount?: number; availableSlots?: number;
}

export interface StaffUser {
  supervisorUserId?: string | null;
  supervisorName?: string | null;
  id: string; fullName: string | null; phone: string; email: string | null; employeeId: string | null;
  status: string; roles: Role[]; areaId: string | null; areaName: string | null;
  societyIds: string[]; societyNames: string[]; societyCount: number; operationsUserCount?: number;
  lastLoginAt: string | null; createdAt: string;
  residentSocietyName?: string | null; unitNumber?: string | null; onboardingCompleted?: boolean | null;
}

export interface Workload {
  userId: string; name: string | null; employeeId: string | null; status: string; societyNames: string[];
  pending: number; processing: number; completed: number; qcFailures: number; failedPickups: number;
}

export interface PickupQueueItem {
  overdue?: boolean;
  scheduledDate?: string;
  pickupId: string; orderId: string | null; orderCode: string | null;
  residentName: string | null; residentPhone: string | null;
  societyId: string; societyName: string | null; unitNumber: string | null; pickupAddress: string | null;
  pickupDate: string; slot: string | null; slotWindow: string | null;
  estimatedCount: number | null; specialInstructions: string | null;
  assignedOperatorUserId: string | null; operatorName: string | null;
  status: string; pickupFailureReason: string | null;
}

export interface OrderCounts {
  total: number; today: number; pending: number; scheduled: number; pickedUp: number;
  washingPending: number; washing: number; ironingPending: number; ironing: number;
  qcPending: number; qcFailed: number; readyForDelivery: number; outForDelivery: number;
  delivered: number; cancelled: number; failedPickups: number; delayed: number; disputed: number;
}

export interface AdminDashboard {
  areas: { total: number; active: number; inactive: number };
  supervisors: { total: number; active: number; inactive: number; unassigned: number };
  societies: { total: number; active: number; inactive: number };
  residents: { total: number; onboarded: number };
  operationsStaff: { total: number; active: number };
  orders: OrderCounts;
  subscriptions: { total: number; active: number; paused: number; cancelled: number };
  revenue: { subscriptionRevenuePaise: number; additionalGarmentRevenuePaise: number; pendingAdditionalChargesPaise: number; totalRevenuePaise: number };
  issues: { total: number; open: number; assigned: number; inProgress: number; resolved: number; closed: number; pending: number; emergency: number; escalated: number };
}

export interface AreaCoverage {
  areaId: string; areaName: string; supervisorUserId: string | null; supervisorName: string | null;
  supervisorStatus: string | null; covered: boolean; needsAdminCover: boolean;
}

export interface HandoverPreview {
  operator: { id: string; fullName: string | null; status: string; areaId: string | null; societyIds: string[] };
  openOrders: OrderSummary[];
  openCount: number;
  availableOperators: { id: string; fullName: string | null; societyIds: string[] }[];
}

export interface SupervisorDashboard {
  area: { id: string; name: string; code: string } | null;
  societies: { total: number; active: number };
  residents: { total: number };
  operationsStaff: { total: number; active: number };
  pickups: { today: number; pending: number; failed: number };
  orders: OrderCounts;
  issues: { open: number; assigned: number; inProgress: number; resolved: number; closed: number; pending: number; emergency: number };
}

export interface OperationsDashboard {
  area: { id: string; name: string } | null;
  societies: { id: string; name: string }[];
  todaysPickups: number;
  orders: OrderCounts;
  openIssues: number;
}

export interface AuditEntry {
  id: string; actor: string; actorName: string | null; role: string | null;
  action: string; resource: string | null; resourceId: string | null;
  previousValue: unknown; newValue: unknown; at: string;
}

export interface SystemConfig {
  garmentPricesPaise?: Record<string, number>;
  id: string; additionalGarmentRatePaise: number;
  nonSubscriberGarmentRatePaise: number;
  garmentServices: GarmentService[];
  garmentCategories: string[];
  defaultSlotCapacity: number; defaultTurnaroundHours: number; delayGraceHours: number;
  qcRequired: boolean; notificationsEnabled: boolean; updatedAt: string; updatedByUserId: string | null;
}

export interface ReportRow {
  areaId?: string; areaName?: string; societyId?: string; societyName?: string;
  supervisorUserId?: string | null; supervisorName?: string | null;
  operatorUserId?: string; operatorName?: string; residents?: number;
  orders: number; delivered: number; cancelled: number; failedPickups: number;
  qcFailures: number; delayed: number; garments: number; subscriptionCovered: number;
  additionalQuantity: number; additionalRevenuePaise: number; pendingAdditionalChargesPaise: number;
}

export interface ReportsResponse {
  byArea?: ReportRow[];
  bySociety: ReportRow[];
  bySupervisor?: ReportRow[];
  byOperator: ReportRow[];
  residents: { residents: number; onboarded: number; pendingOnboarding: number; withActiveSubscription: number };
  subscriptions: { total: number; active: number; paused: number; cancelled: number; byPlan: PlanUsage[] };
  issues: { total: number; open: number; assigned: number; inProgress: number; resolved: number; closed: number; emergency: number; byType: { type: string; count: number }[] };
  revenue: { subscriptionRevenuePaise: number; additionalGarmentRevenuePaise: number; pendingAdditionalChargesPaise: number; totalRevenuePaise: number; addonRevenuePaise?: number };
}

export interface ResidentDashboard {
  residentName: string | null;
  currentOrder: OrderSummary | null;
  upcomingOrders: OrderSummary[];
  recentOrders: OrderSummary[];
  upcomingPickup: {
    pickupId: string; orderId: string | null; orderCode: string | null; societyName: string | null;
    date: string; startTime: string | null; endTime: string | null; window: string | null; status: string;
  } | null;
  subscription: SubscriptionUsage | null;
  walletBalancePaise: number;
  pendingAdditionalChargesPaise: number;
  notifications: Notification[];
  unreadNotifications: number;
}

export interface ResidentProfile {
  fullName: string | null; phone: string | null; email: string | null;
  societyId: string | null; societyName: string | null; unitNumber: string | null; towerBlock: string | null;
  address: string | null; pickupAddress: string | null; preferredWindows: string[];
  accountStatus: string | null; onboardingCompleted: boolean;
}

export interface VerifyResult {
  token: string;
  user: { id: string; phone: string; fullName: string | null; roles: Role[]; areaId: string | null; societyIds: string[] };
  portal: Portal;
  needsOnboarding: boolean;
}

export interface OnboardingStatus {
  completed: boolean;
  requiredFields: string[];
  resident: unknown;
  societies: { id: string; name: string; code: string; address: string | null; city: string }[];
}

// Retained for the operator screens that predate the richer order shape.
export interface OperatorOrder {
  id: string; orderCode: string; state: string; qrBatchCode?: string | null;
  items?: GarmentItem[]; pickupCount?: number | null;
}

export type SupportTicket = Issue;
