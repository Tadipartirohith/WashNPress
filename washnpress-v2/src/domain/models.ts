import type { OrderState } from "./order-state-machine";

export type Role = "resident" | "operator" | "supervisor" | "admin" | "support";

export interface User {
  id: string; phone: string; fullName: string | null; email: string | null; employeeId: string | null;
  status: "active" | "blocked" | "deleted"; roles: Role[]; lastLoginAt: string | null;
  // Scope. A supervisor owns exactly one area; an operator works a set of societies
  // inside one area. Residents and admins leave both empty (admin is system wide).
  areaId: string | null; societyIds: string[]; createdAt: string;
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

export interface Plan { id: string; tier: string; garmentCap: number; turnaroundHours: number; monthlyPaise: number; annualDiscountPercent: number; isActive: boolean; }
export type BillingCycle = "monthly" | "annual";
export interface Subscription {
  id: string; residentId: string; planId: string; status: "active" | "paused" | "cancelled" | "expired";
  cycle: BillingCycle; cycleStart: string; cycleEnd: string; garmentsUsed: number; autoRenew: boolean;
  pendingPlanId: string | null; pauseUntil: string | null; cancelReason: string | null;
}

export interface Slot { id: string; societyId: string; date: string; window: string; startTime: string; endTime: string; capacityTotal: number; capacityRemaining: number; isActive: boolean; }
export interface Pickup { id: string; residentId: string; societyId: string; slotId: string; scheduledFor: string; status: "scheduled" | "rescheduled" | "cancelled" | "completed" | "failed"; recurring: boolean; recurringDays: number[]; specialInstructions: string | null; }

export interface GarmentItem { category: string; quantity: number; }
export interface TimelineEntry { state: OrderState; at: string; note?: string; actorUserId?: string | null; }

export interface Order {
  id: string; orderCode: string; pickupId: string | null; residentId: string; societyId: string;
  areaId: string | null; subscriptionId: string | null;
  state: OrderState; qrBatchCode: string | null; items: GarmentItem[]; addonIds: string[];
  // Quantities. estimatedCount is what the resident expected at booking time,
  // acceptedCount is what the operator physically received. Everything downstream
  // (subscription usage, additional charge) is derived from acceptedCount.
  estimatedCount: number | null; pickupCount: number | null; acceptedCount: number | null;
  subscriptionCoveredCount: number | null; additionalCount: number | null;
  additionalRatePaise: number | null; additionalChargePaise: number | null;
  additionalChargeStatus: "none" | "pending" | "paid" | "failed" | "refunded";
  deliveryCount: number | null;
  qcPassed: boolean | null; qcReason: string | null; qcAttempts: number;
  pickupFailureReason: string | null; discrepancyReason: string | null;
  assignedOperatorUserId: string | null; deliveredByUserId: string | null;
  expectedCompletionAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  rating: number | null; ratingComment: string | null; timeline: TimelineEntry[]; createdAt: string;
}

export interface Addon { id: string; name: string; pricePaise: number; isActive: boolean; }

export type IssueStatus = "open" | "under_review" | "resolved";
export interface SupportTicket {
  id: string; residentId: string | null; orderId: string | null; societyId: string | null; areaId: string | null;
  category: string; description: string; status: IssueStatus; priority: "low" | "normal" | "high";
  reportedByUserId: string | null; reportedByRole: Role | "system" | null;
  assignedToUserId: string | null; resolution: string | null; resolvedAt: string | null;
  escalatedToAdmin: boolean;
  messages: { author: string; body: string; at: string }[]; createdAt: string;
}

export interface Notification {
  id: string; userId: string; type: string; title: string; body: string;
  orderId: string | null; read: boolean; createdAt: string;
}

export interface WaterLog { id: string; unitId: string; orderId: string | null; litersUsed: number; litersSaved: number; createdAt: string; }
export interface Session { token: string; userId: string; roles: Role[]; residentId: string | null; societyId: string | null; areaId: string | null; societyIds: string[]; expiresAt: string; }
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
export interface SystemConfig {
  id: string;
  additionalGarmentRatePaise: number;
  garmentCategories: string[];
  defaultSlotCapacity: number;
  defaultTurnaroundHours: number;
  delayGraceHours: number;
  qcRequired: boolean;
  notificationsEnabled: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
}
