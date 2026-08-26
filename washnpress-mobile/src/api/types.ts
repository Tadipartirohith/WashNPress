export type Role = "resident" | "operator" | "supervisor" | "admin" | "support";
export type Portal = "resident" | "operations" | "supervisor" | "admin";

// One service inside a plan: what it is measured in, how much the plan includes,
// how often it may be used, and what happens when somebody wants more.
export interface PlanServiceRule {
  serviceId: string;
  serviceName: string;
  unit: MeasurementUnit;
  includedQuantity: number;
  frequency: PickupFrequency;
  frequencyDays: number[];
  maxPerFrequency?: number | null;
  maxPerCycle?: number | null;
  carryForward: boolean;
  additionalUsage: AdditionalUsageBehaviour;
  additionalRatePaise: number;
}

export type PickupFrequency = "one_time" | "daily" | "alternate_days" | "twice_weekly" | "weekly" | "custom";

// What a plan costs once its discount and tax are applied. Worked out by the
// backend so the admin reviewing a plan and the resident being charged for it see
// the same number.
export interface PlanPricing {
  basePaise: number;
  discountPercent: number; discountPaise: number;
  taxPercent: number; taxPaise: number;
  payablePaise: number;
}

export interface Plan {
  coveredServiceIds?: string[]; id: string; tier: string; garmentCap: number; turnaroundHours: number; monthlyPaise: number; annualDiscountPercent: number; isActive?: boolean; isCurrent?: boolean;
  name?: string; description?: string | null;
  services?: PlanServiceRule[];
  validity?: "monthly" | "annual";
  taxPercent?: number; discountPercent?: number;
}
export interface PlanUsage extends Plan {
  coveredServiceIds?: string[]; subscribers: number; activeSubscribers: number; garmentsUsed: number; allowance: number; revenuePaise: number }

export interface Slot {
  id: string; societyId?: string; societyName?: string | null; date: string; window: string;
  startTime: string; endTime: string; capacityTotal?: number; capacityRemaining: number;
  bookedCount?: number; full?: boolean; isActive?: boolean;
  // Held for residents on a plan. Never offered to anybody else.
  subscribersOnly?: boolean;
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
  // What the resident asked for. Never overwritten by what turned up.
  quantity: number;
  // What the operator confirmed receiving, once they have. Null before that.
  acceptedQuantity: number | null;
  // What this line is measured in, and how much of it there is in that unit. A
  // weighed line is settled by weight, not by the garment count beside it.
  unit?: MeasurementUnit;
  measuredQuantity?: number | null;
  acceptedMeasuredQuantity?: number | null;
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

// What a service is measured in. Washing is weighed, ironing is counted, at-home
// work is charged by the hour — and the unit belongs to the service rather than
// being assumed by whatever screen prices it.
export type MeasurementUnit =
  | "kg" | "piece" | "hour" | "job" | "vehicle" | "room" | "sqft" | "pair" | "item";

export type AdditionalUsageBehaviour = "block" | "pay_per_use" | "admin_approval";

export interface GarmentService {
  id: string; name: string; unitPricePaise: number; isBase: boolean; isActive: boolean;
  unit?: MeasurementUnit;
  // The smallest quantity this service will bill for, where there is one.
  minimumBillable?: number | null;
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
  // How this line is measured and how much of it there is in that unit, alongside
  // how the plan split it: what the allowance absorbed and what it did not.
  unit?: MeasurementUnit;
  measuredQuantity?: number | null;
  acceptedMeasuredQuantity?: number | null;
  coveredQuantity?: number | null;
  additionalQuantity?: number | null;
  additionalRatePaise?: number | null;
  notes: string | null;
}

export interface LineRequest {
  category: string; quantity: number; serviceId: string;
  // How much, in the service's own unit. Kilograms for a weighed service; omitted
  // for a counted one, where the garment count already says it.
  measuredQuantity?: number;
  addonIds?: string[]; notes?: string;
}

// What one service has left inside a plan, in that service's own unit. Held per
// service because usage of one must never reduce another's.
export interface ServiceAllowance {
  serviceId: string; serviceName: string; unit: MeasurementUnit;
  included: number; carriedForward: number; used: number; remaining: number;
  remainingLabel: string;
  additionalUsage: AdditionalUsageBehaviour; additionalRatePaise: number;
  frequency: string; frequencyDays: number[];
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
  // Whether this order is worked as batches, and how far they have got. An order that
  // has batches is a batch-wise order for good: reopening it shows the same
  // processing view it showed the moment it was collected.
  batchCount?: number;
  batchesCompleted?: number;
  // What the resident declared when they booked, kept beside what was counted.
  requestedCount?: number | null;
  quantityDiscrepancy?: QuantityDiscrepancy | null;
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
  // The per-service breakdown. The single figures above are the plan's overall cap,
  // which is what a plan written before per-service allowances had.
  services?: ServiceAllowance[];
  cycle: string; cycleStart: string; renewalDate: string; expiryDate: string; status: string;
  pendingPlanId: string | null; autoRenew: boolean;
}

export interface WalletTransaction { reference: string; direction: string; amountPaise: number; at: string }
export interface PaymentOrder { providerOrderId: string; amountPaise: number; currency: string }

// The eight stages a ticket moves through. Two say who is being waited on and two
// say how far up the hierarchy it has gone. Mirrors IssueStatus on the backend.
export type IssueStatus =
  | "open" | "in_progress" | "waiting_resident" | "waiting_operator"
  | "escalated_supervisor" | "escalated_admin" | "resolved" | "closed";
export type IssueRole = "resident" | "operator" | "supervisor" | "admin" | "support";
export type IssuePriority = "low" | "normal" | "high" | "emergency";

export interface IssueMessage {
  author: string; authorRole: string | null; authorName?: string | null; body: string; at: string;
}

export interface Issue {
  id: string; residentId: string | null; orderId: string | null; societyId: string | null; areaId: string | null;
  category: string; description: string; status: IssueStatus; priority: IssuePriority;
  reportedByUserId: string | null; reportedByRole: string | null; assignedToUserId: string | null;
  resolution: string | null; resolvedAt: string | null; closedAt: string | null; escalatedToAdmin: boolean;
  // Which role is expected to act next, and how far up it has already been.
  responsibleRole?: IssueRole | null; escalatedToSupervisor?: boolean;
  messages: IssueMessage[]; createdAt: string;
  // Present on the decorated view every support screen renders.
  residentName?: string | null; residentPhone?: string | null; unitNumber?: string | null;
  societyName?: string | null; areaName?: string | null; assignedToName?: string | null;
  order?: { id: string; orderCode: string; state: string; acceptedCount: number | null; operatorName: string | null } | null;
  ageHours?: number; resolutionMinutes?: number | null;
  // What a list row shows about the conversation behind it: the last thing said and
  // how much of it this person has not seen.
  conversation?: ConversationSummary;
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
  // What identifies an area is the state it is in and its name. There is no area
  // code: it was a second name for a thing that already had one.
  id: string; name: string; region: string; description: string | null;
  status: string; supervisorUserId: string | null; supervisorName?: string | null;
  societyCount?: number; residentCount?: number; operationsStaffCount?: number; orderCount?: number;
}

export interface Society {
  id: string; name: string; code: string; areaId: string | null; areaName?: string | null;
  address: string | null; city: string; state: string; status: string;
  supervisorUserId?: string | null;
  supervisorName?: string | null; residentCount?: number; operationsStaffCount?: number;
  orderCount?: number; activeOrderCount?: number; availableSlots?: number;
}

// A tower, wing or phase inside a society: the unit the work is actually divided
// by. An operator used to be given a whole society and had no way to see which part
// of it was theirs, because there was no such thing as a part of it.
export interface Block {
  id: string; societyId: string; name: string; flatCount: number;
  operatorUserIds: string[]; status: string; createdAt: string;
}

// One row of an assignment screen: a block, how big it is, who covers it, and how
// much work it is carrying. Deciding who takes a tower means knowing all four.
export interface BlockAllocation {
  blockId: string; blockName: string;
  societyId: string; societyName: string;
  flatCount: number;
  operators: { id: string; fullName: string | null }[];
  residentCount: number; activeOrderCount: number;
  status: string;
}

export interface SocietyAssignment {
  society: Society | null;
  supervisor: { id: string; fullName: string | null; phone: string; status: string } | null;
  blocks: BlockAllocation[];
  // Residents who never recorded which tower they live in. They belong to the
  // society but to no block, so a fully block-based assignment leaves them
  // uncovered until somebody says where they live.
  unassignedResidentCount: number;
  supervisorOptions?: { id: string; fullName: string | null; phone: string; employeeId: string | null; heldSocietyName: string | null }[];
  operatorOptions?: { id: string; fullName: string | null; phone: string; status: string }[];
  // A supervisor cannot change which society is theirs; an admin decides that.
  canChangeSociety?: boolean;
}

// One quality check, as the monitoring screen shows it: which order, whose, where,
// who checked it, how many garments and when. A check without its time is a check
// nobody can place in a day's work.
export interface QcRow extends OrderSummary {
  qcStatus: string;
  qcCheckedAt: string;
}

export interface StaffUser {
  supervisorUserId?: string | null;
  supervisorName?: string | null;
  id: string; fullName: string | null; phone: string; email: string | null; employeeId: string | null;
  status: string; roles: Role[]; areaId: string | null; areaName: string | null;
  societyIds: string[]; societyNames: string[]; societyCount: number; operationsUserCount?: number;
  lastLoginAt: string | null; createdAt: string;
  // Whether this account has been vouched for, and when its assignment last changed.
  verificationStatus?: "pending" | "approved" | "rejected";
  verifiedByUserId?: string | null; verifiedAt?: string | null; verificationNote?: string | null;
  assignmentUpdatedAt?: string | null;
  areaWideAccess?: boolean;
  // For an operator: which towers they cover and how many flats that comes to.
  // No block names means the whole of every society assigned to them, which is
  // what every assignment made before blocks existed meant.
  blockIds?: string[]; blockNames?: string[]; blockCount?: number; flatsCovered?: number;
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
  // Past its window and still waiting. Shown as Due and sorted to the top, rather
  // than left labelled Scheduled in the middle of the list.
  due?: boolean;
  pickupStatus?: string;
  pickupStatusLabel?: string;
}

export interface OrderCounts {
  total: number; today: number; pending: number; scheduled: number; active: number; completed: number;
  pickedUp: number; washingPending: number; washing: number; ironingPending: number; ironing: number;
  qcPending: number; qcFailed: number; readyForDelivery: number; outForDelivery: number;
  delivered: number; deliveredToday: number; cancelled: number; failedPickups: number;
  delayed: number; disputed: number;
}

export interface PickupCounts { today: number; pending: number; completed: number; failed: number }

// Named after what the garments were actually sent for, so a facility handling only
// dry cleaning does not see an empty Washing row and no dry cleaning row at all.
export interface ProcessingBreakdown {
  stages: { key: string; label: string; count: number }[];
  ironing: number; qcPending: number; qcFailed: number;
}

export interface IssueCounts {
  total: number; open: number; inProgress: number; waitingResident: number; waitingOperator: number;
  assigned: number; escalatedSupervisor: number; escalatedAdmin: number;
  resolved: number; closed: number; pending: number; emergency: number; escalated: number;
}

export interface AttentionItem {
  kind: string; label: string; count: number; severity: "critical" | "warning" | "notice";
}

export interface AreaPerformanceRow {
  areaId: string; name: string; societies: number; residents: number; operators: number;
  totalOrders: number; pendingOrders: number; deliveredOrders: number;
  delayedOrders: number; openIssues: number;
}

export interface ActivityEntry {
  id: string; action: string; actor: string; role: string | null;
  resource: string | null; resourceId: string | null; at: string;
}

export interface AdminDashboard {
  areas: { total: number; active: number; inactive: number };
  supervisors: { total: number; active: number; inactive: number; unassigned: number };
  societies: { total: number; active: number; inactive: number };
  residents: { total: number; onboarded: number };
  operationsStaff: { total: number; active: number; unassigned: number };
  orders: OrderCounts;
  operations: { pickups: PickupCounts; processing: ProcessingBreakdown };
  subscriptions: { total: number; active: number; paused: number; cancelled: number; expired: number };
  revenue: { subscriptionRevenuePaise: number; additionalGarmentRevenuePaise: number; pendingAdditionalChargesPaise: number; totalRevenuePaise: number };
  issues: IssueCounts;
  areaPerformance: AreaPerformanceRow[];
  recentActivity: ActivityEntry[];
  alerts: AttentionItem[];
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
  pickups: PickupCounts;
  orders: OrderCounts;
  processing: ProcessingBreakdown;
  issues: IssueCounts;
}

// What is waiting on this operator right now. Anything merely in flight that needs
// nobody is deliberately absent: the dashboard answers "what work do I need to do?".
export interface ActionRequiredItem {
  kind: string; label: string; action: string;
  orderId: string; orderCode: string;
  residentName: string | null; society: string | null; unit: string | null; items: number;
}

export interface UpcomingPickup {
  pickupId: string; orderId: string | null; orderCode: string | null; scheduledFor: string;
  residentName: string | null; society: string | null; unit: string | null;
  items: number; status: string;
}

export interface OperationsDashboard {
  area: { id: string; name: string } | null;
  societies: { id: string; name: string }[];
  todaysPickups: number;
  pickups: PickupCounts;
  orders: OrderCounts;
  processing: ProcessingBreakdown;
  actionRequired: ActionRequiredItem[];
  upcomingPickups: UpcomingPickup[];
  issues: IssueCounts;
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
  // Each society with its own blocks, so somebody signing up picks the tower they
  // live in from the towers that exist. Which block decides who collects from them.
  societies: {
    id: string; name: string; code: string; address: string | null; city: string;
    blocks?: { id: string; name: string }[];
  }[];
}

// Retained for the operator screens that predate the richer order shape.
export interface OperatorOrder {
  id: string; orderCode: string; state: string; qrBatchCode?: string | null;
  items?: GarmentItem[]; pickupCount?: number | null;
}

export type SupportTicket = Issue;

// The fixed pickup windows and the hours they mean. Sent by the backend so the
// client never has its own idea of when "Morning" is.
export type SlotWindows = Record<string, { startTime: string; endTime: string }>;

// --------------------------------------------------------------- round 6 shapes

// Every list that can grow without bound answers this beside its items.
export interface PageInfo { total: number; limit: number; offset: number; hasMore: boolean }

// One Garment + Service combination: what was asked for, what turned up, and what
// the difference costs at that combination's own rate.
export interface LineReconciliation {
  lineId: string; category: string; serviceId: string; serviceName: string;
  requested: number; actual: number; difference: number;
  status: "matched" | "short" | "additional";
  unitPricePaise: number; additionalPaise: number;
  // What the line is measured in, and the measurement either side of the scale. A
  // weighed line is settled by weight rather than by the garment count beside it.
  unit?: MeasurementUnit;
  requestedMeasured?: number;
  actualMeasured?: number;
  measuredDifference?: number;
}

export interface Reconciliation {
  lines: LineReconciliation[];
  requestedTotal: number; actualTotal: number; additionalPaise: number; confirmed: boolean;
}

export type BatchStep = "wash" | "dry_clean" | "premium" | "iron" | "qc";
export type BatchStatus = "pending" | "in_progress" | "awaiting_qc" | "qc_failed" | "completed";

// A processing batch as the operator sees it: one combination, its own sequence,
// its own progress and its own quality check.
export interface ProcessingBatch {
  id: string; lineId: string; category: string; serviceId: string; serviceName: string;
  quantity: number; sequence: BatchStep[]; completedSteps: BatchStep[];
  status: BatchStatus; statusLabel: string;
  currentStep: BatchStep | null; currentStepLabel: string | null;
  steps: { step: BatchStep; label: string; done: boolean; current: boolean }[];
  qcPassed: boolean | null; qcReason: string | null; qcAttempts: number;
  history: { step: BatchStep; at: string; actorUserId: string | null; note?: string | null }[];
  // Every failed check, and where the batch is being held if it is not simply being
  // reworked.
  qcFailures?: QcFailureRecord[];
  heldFor?: "supervisor" | "investigation" | null;
}

// A standing arrangement to be collected.
export interface ScheduleView {
  id: string; frequency: string; days: number[]; window: string;
  startDate: string; status: "active" | "paused" | "cancelled";
  description: string; perMonth: number; allowance: number | null; upcomingCount: number;
}

export interface FrequencyOption { key: string; label: string; daysRequired: number }

export interface PickupPreferences {
  preferredWindows: string[];
  pickupsPerCycle: number | null;
  pickupsUsed: number;
  planTier: string | null;
}

// Services that are not laundry.
export interface ServiceOffering {
  id: string; kind: "vehicle_wash" | "home_ironing"; name: string; description: string | null;
  pricingBasis: "per_job" | "per_hour"; unitPricePaise: number;
  vehicleTypes: string[]; minimumHours: number | null; isActive: boolean;
}

export interface ServiceQuote {
  offeringId: string; offeringName: string; kind: string; kindLabel: string;
  pricingBasis: "per_job" | "per_hour"; unitPricePaise: number;
  hours: number | null; quotedPaise: number;
  vehicleTypes: string[]; minimumHours: number | null;
}

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

export interface ServiceSummary {
  total: number; requested: number; assigned: number; inProgress: number;
  completed: number; cancelled: number;
  byKind: { kind: string; label: string; total: number; open: number }[];
  revenuePaise: number; pendingPaise: number;
}

// What one Booking screen needs, for whoever is looking at it.
//
// Book and Regular used to be two resident features with two sets of rules, and the
// client had to know which applied. The backend answers that now: who the resident
// is, which services they may choose, in what unit, at what price, and — for a
// subscriber — what their plan has left of each and which days it collects them on.
export interface BookingServiceOption {
  id: string;
  name: string;
  unit: MeasurementUnit;
  minimumBillable: number | null;
  // What this resident pays: the ordinary price with no plan, the overage rate
  // beyond an allowance. Never the same number by accident.
  pricePaise: number;
  includedInPlan: boolean;
  allowance: ServiceAllowance | null;
  additionalUsage: AdditionalUsageBehaviour | null;
  additionalRatePaise: number | null;
  // 0 is Sunday through 6 is Saturday. Seven entries means any day.
  allowedDays: number[];
  frequency: string | null;
  frequencyLabel: string | null;
}

export interface BookingOptions {
  audience: "subscriber" | "standard";
  subscriber: boolean;
  plan: {
    id: string; name: string; tier: string; description: string | null;
    turnaroundHours: number; renewalDate: string | null;
  } | null;
  services: BookingServiceOption[];
  preferredWindows: string[];
  windows: string[];
  turnaroundHours: number;
  garmentPricesPaise: Record<string, number>;
  nonSubscriberGarmentRatePaise: number;
}

// Whether the plan permits one line of an order, and why not where it does not.
export interface LineEligibility {
  serviceId: string;
  serviceName: string;
  unit: MeasurementUnit;
  requested: number;
  covered: number;
  additional: number;
  additionalPaise: number;
  inPlan: boolean;
  allowed: boolean;
  needsApproval: boolean;
  reason: string | null;
}

// One row of the admin Services page. The page shows the services and what can be
// done to them; there is no dashboard and no statistics beside it.
export interface AdminServiceRow {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  unit: MeasurementUnit;
  nonSubscriberPricePaise: number;
  // Null where a plan includes the service, because there is no subscriber price to
  // show — it is included, which is a different thing from costing nothing.
  subscriberPricePaise: number | null;
  includedInPlans: string[];
  eligibility: "subscriber" | "non_subscriber" | "both";
  availability: string;
  mode: string;
  isActive: boolean;
}

// The vocabulary the filters are built from, sent by the backend so the client never
// keeps its own copy of a list the backend can change.
export interface ServiceFilterOptions {
  categories: { key: string; label: string }[];
  eligibilities: string[];
  units: MeasurementUnit[];
  statuses: string[];
}

// An issue as a conversation, as one person sees it.
//
// The messages were always there; what the screens had to guess was everything around
// them — who may still speak, who a reply is addressed to, and what has been read.
// The backend answers all of it now, so a screen renders a chat rather than deciding
// who is allowed to use it.
export interface ConversationMessage {
  author: string;
  authorRole: string | null;
  authorName: string | null;
  body: string;
  at: string;
  // Where the bubble sits. A person's own messages on one side, everybody else's on
  // the other, and the system in the middle belonging to nobody.
  side: "mine" | "theirs" | "system";
  system: boolean;
  unread: boolean;
}

export interface ConversationView {
  messages: ConversationMessage[];
  canReply: boolean;
  // Why not, in a sentence the screen shows rather than a bare disabled box.
  readOnlyReason: string | null;
  replyTo: string | null;
  // "Reply to Resident", "Reply to Operator" — never a hardcoded label.
  replyLabel: string;
  unreadCount: number;
  lastMessageAt: string | null;
  preview: string;
}

// What a list row shows about the conversation behind it.
export interface ConversationSummary {
  preview: string;
  lastMessageAt: string | null;
  lastMessageRole: string | null;
  unreadCount: number;
  messageCount: number;
  canReply?: boolean;
  reason?: string | null;
  replyTo?: string | null;
  replyLabel?: string;
}

// Why a quality check can fail, and what that reason means. A failure used to mean
// one thing — redo the last step — which is right for a stain that did not come out
// and wrong for a garment that is not there.
export interface QcReasonOption {
  key: string;
  label: string;
  // Whether a photograph has to be supplied. Required where the failure is a claim
  // about the garment's condition rather than about the quality of the work.
  evidenceRequired: boolean;
  // Whether this needs a person rather than another run through a machine — which is
  // also when a supervisor and the resident are told.
  serious: boolean;
}

// One failed check, kept rather than overwritten.
export interface QcFailureRecord {
  attempt: number;
  reason: string;
  reasonLabel: string;
  remarks: string;
  evidenceUrl: string | null;
  correctiveStep: string | null;
  correctiveLabel: string;
  serious: boolean;
  at: string;
  actorUserId: string | null;
}

// What the resident declared, beside what the operator counted. Both are real and
// they are not the same kind of fact: one is what was expected, the other is what was
// verified. The count that was verified is what gets processed and billed.
export interface QuantityDiscrepancy {
  requested: number;
  received: number;
  difference: number;
  direction: "short" | "excess";
  reason: string;
  reasonLabel: string;
  remarks: string;
  at: string;
  actorUserId: string | null;
  acknowledgement: "pending" | "acknowledged" | "disputed";
  acknowledgedAt: string | null;
  disputeNote: string | null;
}

export interface DiscrepancyReasonOption {
  key: string;
  label: string;
}

// An operator a pickup can be given to.
export interface AssignableOperator {
  userId: string;
  fullName: string | null;
  phone: string;
  employeeId: string | null;
  areaId: string | null;
  societyIds: string[];
}
