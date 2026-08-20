export type Role = "resident" | "operator" | "supervisor" | "admin" | "support";
export type Portal = "resident" | "operations" | "supervisor" | "admin";

export interface Plan { id: string; tier: string; garmentCap: number; turnaroundHours: number; monthlyPaise: number; annualDiscountPercent: number; isActive?: boolean; isCurrent?: boolean }
export interface PlanUsage extends Plan { subscribers: number; activeSubscribers: number; garmentsUsed: number; allowance: number; revenuePaise: number }

export interface Slot {
  id: string; societyId?: string; societyName?: string | null; date: string; window: string;
  startTime: string; endTime: string; capacityTotal?: number; capacityRemaining: number;
  bookedCount?: number; full?: boolean; isActive?: boolean;
}

export interface GarmentItem { category: string; quantity: number }
export interface TimelineEntry { state: string; at: string; note?: string; actorUserId?: string | null }
export interface Stage { state: string; label: string; status: "completed" | "current" | "pending" }

export interface OrderSummary {
  id: string; orderCode: string; state: string; createdAt: string;
  residentId: string; residentName: string | null; residentPhone: string | null; unitNumber: string | null;
  societyId: string; societyName: string | null; areaId: string | null;
  acceptedCount: number | null; subscriptionCoveredCount: number | null;
  additionalCount: number | null; additionalChargePaise: number | null; additionalChargeStatus: string;
  assignedOperatorUserId: string | null; operatorName: string | null;
  qcPassed: boolean | null; qcReason: string | null; pickupFailureReason: string | null;
  expectedCompletionAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  ironingStarted?: boolean; delayed: boolean; delayMinutes: number;
  qcStatus?: string;
}

export interface OrderDetail extends OrderSummary {
  items: GarmentItem[]; timeline: TimelineEntry[]; stages: Stage[];
  qrBatchCode: string | null; estimatedCount: number | null; deliveryCount: number | null;
  additionalRatePaise: number | null; discrepancyReason: string | null;
  pickupAddress: string | null; areaName: string | null; planTier: string | null;
  remainingAllowance: number; turnaroundHours: number;
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
  subscriptionId: string; planId: string; planTier: string; monthlyPaise: number; turnaroundHours: number;
  allowance: number; used: number; remaining: number; usedPercent: number;
  cycle: string; cycleStart: string; renewalDate: string; expiryDate: string; status: string;
  pendingPlanId: string | null; autoRenew: boolean;
}

export interface WalletTransaction { reference: string; direction: string; amountPaise: number; at: string }
export interface PaymentOrder { providerOrderId: string; amountPaise: number; currency: string }

export interface Issue {
  id: string; residentId: string | null; orderId: string | null; societyId: string | null; areaId: string | null;
  category: string; description: string; status: "open" | "under_review" | "resolved"; priority: string;
  reportedByUserId: string | null; reportedByRole: string | null; assignedToUserId: string | null;
  resolution: string | null; resolvedAt: string | null; escalatedToAdmin: boolean;
  messages: { author: string; body: string; at: string }[]; createdAt: string;
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
  issues: { total: number; open: number; underReview: number; resolved: number; escalated: number };
}

export interface SupervisorDashboard {
  area: { id: string; name: string; code: string } | null;
  societies: { total: number; active: number };
  residents: { total: number };
  operationsStaff: { total: number; active: number };
  pickups: { today: number; pending: number; failed: number };
  orders: OrderCounts;
  issues: { open: number; underReview: number; resolved: number };
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
  id: string; additionalGarmentRatePaise: number; garmentCategories: string[];
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
  issues: { total: number; open: number; underReview: number; resolved: number; byType: { type: string; count: number }[] };
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

export interface SupportTicket { id: string; category: string; description: string; status: string; createdAt: string }
