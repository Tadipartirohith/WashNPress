import type { OrderState } from "./order-state-machine";

export type Role = "resident" | "operator" | "admin" | "support";

export interface User { id: string; phone: string; fullName: string | null; status: "active" | "blocked" | "deleted"; roles: Role[]; lastLoginAt: string | null; }
export interface Resident { id: string; userId: string; societyId: string; unitNumber: string; towerBlock: string | null; preferredWindows: string[]; }
export interface Society { id: string; name: string; city: string; state: string; status: "active" | "coming_soon" | "inactive"; }
export interface Unit { id: string; societyId: string; name: string; operatorUserIds: string[]; waterRecyclingEnabled: boolean; baseDrawPaise: number; revenueSharePercent: number; status: "active" | "inactive"; }

export interface Plan { id: string; tier: string; garmentCap: number; turnaroundHours: number; monthlyPaise: number; annualDiscountPercent: number; isActive: boolean; }
export type BillingCycle = "monthly" | "annual";
export interface Subscription {
  id: string; residentId: string; planId: string; status: "active" | "paused" | "cancelled" | "expired";
  cycle: BillingCycle; cycleStart: string; cycleEnd: string; garmentsUsed: number; autoRenew: boolean;
  pendingPlanId: string | null; pauseUntil: string | null; cancelReason: string | null;
}

export interface Slot { id: string; societyId: string; date: string; window: string; startTime: string; endTime: string; capacityTotal: number; capacityRemaining: number; isActive: boolean; }
export interface Pickup { id: string; residentId: string; societyId: string; slotId: string; scheduledFor: string; status: "scheduled" | "rescheduled" | "cancelled" | "completed"; recurring: boolean; recurringDays: number[]; specialInstructions: string | null; }

export interface GarmentItem { category: string; quantity: number; }
export interface TimelineEntry { state: OrderState; at: string; note?: string; }
export interface Order {
  id: string; orderCode: string; pickupId: string | null; residentId: string; societyId: string; subscriptionId: string | null;
  state: OrderState; qrBatchCode: string | null; items: GarmentItem[]; addonIds: string[];
  pickupCount: number | null; deliveryCount: number | null; qcPassed: boolean | null; qcReason: string | null;
  discrepancyReason: string | null; rating: number | null; ratingComment: string | null; timeline: TimelineEntry[]; createdAt: string;
}

export interface Addon { id: string; name: string; pricePaise: number; isActive: boolean; }
export interface SupportTicket { id: string; residentId: string | null; orderId: string | null; category: string; description: string; status: "open" | "in_progress" | "resolved"; priority: "low" | "normal" | "high"; messages: { author: string; body: string; at: string }[]; createdAt: string; }
export interface WaterLog { id: string; unitId: string; orderId: string | null; litersUsed: number; litersSaved: number; createdAt: string; }
export interface Session { token: string; userId: string; roles: Role[]; residentId: string | null; societyId: string | null; expiresAt: string; }
export interface OutboxEvent { id: string; type: string; payload: Record<string, unknown>; status: "pending" | "sent" | "failed"; attempts: number; createdAt: string; }
export interface AuditLog { id: string; actor: string; action: string; entity: string; at: string; }
