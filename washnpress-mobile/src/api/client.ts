import { getApiBaseUrl } from "../config";
import type { Plan, Slot, OrderSummary, Tracking, VerifyResult, OperatorOrder, GarmentItem } from "./types";

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  // In local mode the backend returns otpForTesting so no SMS gateway is needed.
  sendOtp: (phone: string) => request<{ sent: boolean; otpForTesting?: string }>("/v1/auth/otp/send", { method: "POST", body: { phone } }),
  verifyOtp: (phone: string, otp: string) => request<VerifyResult>("/v1/auth/otp/verify", { method: "POST", body: { phone, otp } }),
  getPlans: () => request<{ plans: Plan[] }>("/v1/plans"),
  getSlots: (date: string, token: string) => request<{ slots: Slot[] }>(`/v1/slots?date=${date}`, { token }),
  bookPickup: (slotId: string, token: string) => request<{ order: OrderSummary }>("/v1/pickups", { method: "POST", body: { slotId }, token }),
  getTracking: (orderId: string, token: string) => request<Tracking>(`/v1/orders/${orderId}/tracking`, { token }),
  getWallet: (token: string) => request<{ balancePaise: number; balanceFormatted: string }>("/v1/wallet", { token }),

  // Operations mode
  getBookings: (token: string) => request<{ orders: OperatorOrder[] }>("/v1/operations/bookings", { token }),
  markPickedUp: (orderId: string, items: GarmentItem[], token: string) =>
    request<{ order: OperatorOrder }>(`/v1/operations/orders/${orderId}/picked-up`, { method: "POST", body: { items }, token }),
  advanceStage: (orderId: string, to: "in_wash" | "ironing" | "qc", token: string) =>
    request<{ order: OperatorOrder }>(`/v1/operations/orders/${orderId}/advance`, { method: "POST", body: { to }, token }),
  submitQc: (orderId: string, pass: boolean, reason: string | undefined, token: string) =>
    request<{ order: OperatorOrder }>(`/v1/operations/orders/${orderId}/qc`, { method: "POST", body: { pass, reason }, token }),
  outForDelivery: (orderId: string, token: string) =>
    request<{ order: OperatorOrder }>(`/v1/operations/orders/${orderId}/out-for-delivery`, { method: "POST", token }),
  deliver: (orderId: string, deliveryCount: number, discrepancyReason: string | undefined, token: string) =>
    request<{ order: OperatorOrder }>(`/v1/operations/orders/${orderId}/deliver`, { method: "POST", body: { deliveryCount, discrepancyReason }, token }),
};
