export interface Plan { id: string; tier: string; garmentCap: number; turnaroundHours: number; monthlyPaise: number; annualDiscountPercent: number; }
export interface Slot { id: string; date: string; window: string; startTime: string; endTime: string; capacityRemaining: number; }
export interface OrderSummary { id: string; orderCode: string; state: string; }
export interface TimelineEntry { state: string; at: string; note?: string }
export interface Tracking { orderCode: string; state: string; timeline: TimelineEntry[]; items: { category: string; quantity: number }[] }
export interface VerifyResult { token: string; user: { id: string; phone: string; roles: string[] }; needsOnboarding: boolean }

export interface GarmentItem { category: string; quantity: number }
export interface OperatorOrder {
  id: string; orderCode: string; state: string; qrBatchCode: string | null;
  items: GarmentItem[]; pickupCount: number | null;
}

export interface Subscription { id: string; planId: string; status: string; cycle: string; garmentsUsed: number; pendingPlanId: string | null }
export interface WalletTransaction { reference: string; direction: string; amountPaise: number; at: string }
export interface SupportTicket { id: string; category: string; description: string; status: string; createdAt: string }
export interface PaymentOrder { providerOrderId: string; amountPaise: number; currency: string }
