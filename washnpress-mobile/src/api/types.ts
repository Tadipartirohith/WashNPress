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
