// Typed client for the Wash N Press backend. It talks to the real API using a bearer
// token kept in local storage, so the web app runs the same flows as the mobile app.
// The base URL defaults to the API port from docker compose and can be overridden with
// NEXT_PUBLIC_API_URL at build time.

export const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) || "http://localhost:8090";

const TOKEN_KEY = "wnp_token";
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null): void {
  if (typeof window === "undefined") return;
  try { t ? window.localStorage.setItem(TOKEN_KEY, t) : window.localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

// Exported so the admin/supervisor/operations API modules (lib/api/*.ts) can talk
// to the same backend with the same token, instead of each hand-rolling fetch.
export async function req<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== false) { const t = getToken(); if (t) headers.authorization = `Bearer ${t}`; }
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError((data && (data.message || data.error)) || `Request failed (${res.status})`, res.status, data);
  return data as T;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: unknown) { super(message); }
}

// Response shapes, limited to the fields the web app uses.
export interface Service { id: string; name: string; unit: string; unitPricePaise: number; subscriberUnitPricePaise?: number; pricingBasis?: string; isActive?: boolean }
export interface BookingOptionService { id: string; name: string; unit: string; pricePaise: number; minimumBillable: number; includedInPlan: boolean }
export interface Slot { id: string; date: string; window: string; startTime: string; endTime: string; capacityRemaining?: number }
export interface Plan { id: string; tier: string; name: string; description: string; garmentCap: number; turnaroundHours: number; pickupsPerCycle: number; services: { serviceName: string; unit: string; includedQuantity: number }[] }
export interface OrderCard { id: string; orderCode?: string; state: string; serviceName?: string; scheduledFor?: string; createdAt?: string }
export interface Dashboard {
  residentName: string; walletBalancePaise: number; unreadNotifications: number;
  subscription: { planName?: string; status?: string } | null;
  currentOrder: OrderCard | null; upcomingPickup: { date?: string; window?: string } | null;
  recentOrders: OrderCard[];
}
export interface Tracking { orderCode?: string; state: string; timeline: { state: string; at: string; note?: string }[]; items?: { category: string; quantity: number }[] }

export const api = {
  sendOtp: (phone: string) => req<{ sent: boolean; otpForTesting?: string }>("/v1/auth/otp/send", { method: "POST", body: { phone }, auth: false }),
  verifyOtp: (phone: string, otp: string) => req<{ token: string; residentId: string | null; societyId: string | null; roles: string[] }>("/v1/auth/otp/verify", { method: "POST", body: { phone, otp }, auth: false }),
  me: () => req<{ residentId: string | null; societyId: string | null; roles: string[]; user: { fullName: string | null; phone: string } }>("/v1/auth/me"),
  dashboard: () => req<Dashboard>("/v1/resident/dashboard"),
  services: () => req<{ services: Service[] }>("/v1/services"),
  bookingOptions: () => req<{ subscriber: boolean; services: BookingOptionService[] }>("/v1/booking/options"),
  slots: (date: string) => req<{ date: string; slots: Slot[] }>(`/v1/slots?date=${encodeURIComponent(date)}`),
  bookPickup: (slotId: string, serviceId: string, quantity: number) => req<{ order: { id: string; orderCode?: string; state: string } }>("/v1/pickups", { method: "POST", body: { slotId, lines: [{ category: "Mixed garments", quantity, serviceId }] } }),
  plans: () => req<{ plans: Plan[] }>("/v1/plans"),
  subscribe: (planId: string) => req<{ subscription: unknown }>("/v1/subscription/subscribe", { method: "POST", body: { planId, cycle: "monthly" } }),
  wallet: () => req<{ balancePaise: number; balanceFormatted: string }>("/v1/wallet"),
  walletTransactions: () => req<{ transactions: { reference: string; direction: string; amountPaise: number; at: string }[] }>("/v1/wallet/transactions"),
  topup: (amountPaise: number) => req<{ paymentOrder?: { providerOrderId: string } }>("/v1/wallet/topup", { method: "POST", body: { amountPaise } }),
  orders: () => req<{ current: OrderCard[]; upcoming: OrderCard[]; previous: OrderCard[]; stateLabels: Record<string, string> }>("/v1/resident/orders"),
  tracking: (orderId: string) => req<Tracking>(`/v1/orders/${orderId}/tracking`),
  logout: () => req<{ loggedOut?: boolean }>("/v1/auth/logout", { method: "POST" }).catch(() => ({})),
};
