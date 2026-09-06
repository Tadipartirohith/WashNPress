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
export interface Plan { id: string; tier: string; name: string; description: string; garmentCap: number; turnaroundHours: number; pickupsPerCycle: number; monthlyPaise: number; services: { serviceName: string; unit: string; includedQuantity: number }[] }
export interface OrderCard { id: string; orderCode?: string; state: string; serviceName?: string; scheduledFor?: string; createdAt?: string }
export interface Dashboard {
  residentName: string; walletBalancePaise: number; unreadNotifications: number;
  subscription: { planName?: string; status?: string } | null;
  currentOrder: OrderCard | null; upcomingPickup: { date?: string; window?: string } | null;
  recentOrders: OrderCard[];
}
export interface Tracking { orderCode?: string; state: string; timeline: { state: string; at: string; note?: string }[]; items?: { category: string; quantity: number }[] }
export interface BookingPreview { estimatedChargeablePaise: number; hasSubscription: boolean; canBook: boolean; note?: string }
// The fields TrackView needs beyond what the timeline endpoint returns — reuses
// the same richer resident order-detail endpoint the mobile app already relies on
// for cancel/reschedule, rather than extending the tracking response.
export interface OrderDetail { id: string; state: string; createdAt: string; pickupId: string | null; scheduledPickupAt: string | null; orderCode?: string }
export interface CancelOrRescheduleResult { pickup: { id: string; status: string }; feeChargedPaise: number; feePending: boolean }

// Subscription management — only the fields the resident web app renders.
export interface ServiceAllowance { serviceId: string; serviceName: string; unit: string; included: number; used: number; remaining: number; remainingLabel?: string }
export interface PendingPlanChange { planId: string; tier: string; monthlyPaise: number; allowance: number; turnaroundHours: number; effectiveFrom: string; direction: "upgrade" | "downgrade" | "sidegrade"; canCancel: boolean }
export interface SubscriptionUsage {
  subscriptionId: string; planId: string; planTier: string; monthlyPaise: number; turnaroundHours: number;
  allowance: number; used: number; remaining: number; usedPercent: number; services?: ServiceAllowance[];
  cycle: string; cycleStart: string; renewalDate?: string; expiryDate?: string; status: string;
  pendingPlanId: string | null; autoRenew: boolean; pendingPlan?: PendingPlanChange | null;
}
export interface PlanChangeQuote {
  currentPlanId: string; currentPlanTier: string; currentCyclePaise: number;
  newPlanId: string; newPlanTier: string; newCyclePaise: number; cycle: string;
  kind: "upgrade" | "downgrade" | "same_price"; prorationPaise: number; amountDuePaise: number;
  effectiveFrom: string; immediate: boolean; daysRemaining: number;
}
export interface AvailablePlan extends Plan { isCurrent: boolean }

// Support tickets — mirrors the mobile app's Issue/SupportTicket model, limited to
// what the web resident conversation view needs.
export type IssueStatus = "open" | "in_progress" | "waiting_resident" | "waiting_operator" | "escalated_supervisor" | "escalated_admin" | "resolved" | "closed";
export type IssuePriority = "low" | "normal" | "high" | "emergency";
export interface SupportTicket {
  id: string; category: string; description: string; priority: IssuePriority; status: IssueStatus;
  orderId: string | null; createdAt: string; resolvedAt?: string | null; closedAt?: string | null;
  order?: { id: string; orderCode: string } | null;
  conversation?: { preview: string; lastMessageAt: string | null; unreadCount: number };
}
export interface AttachmentSummary { id: string; ticketId: string; filename: string; contentType: string; sizeBytes: number; createdAt: string }
export interface ConversationMessage { author: string; authorRole: string | null; authorName: string | null; body: string; at: string; side: "mine" | "theirs" | "system"; system: boolean; unread: boolean }
export interface ConversationView { messages: ConversationMessage[]; canReply: boolean; readOnlyReason: string | null; replyLabel: string; unreadCount: number }

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
  // Subscription management: current plan + usage, the browse list, and the
  // read-quote-then-confirm change flow (never changes the plan on the quote step).
  residentSubscription: () => req<{ current: SubscriptionUsage | null; availablePlans: AvailablePlan[] }>("/v1/resident/subscription"),
  quotePlanChange: (planId: string) => req<{ quote: PlanChangeQuote }>(`/v1/subscription/change/quote?planId=${encodeURIComponent(planId)}`),
  changePlan: (planId: string) => req<{ status: "applied" | "scheduled"; subscription: unknown; usage: SubscriptionUsage | null; quote: PlanChangeQuote; note: string }>("/v1/subscription/change", { method: "POST", body: { planId } }),
  cancelPlanChange: () => req<{ subscription: SubscriptionUsage | null }>("/v1/subscription/change", { method: "DELETE" }),
  cancelSubscription: (reason: string) => req<{ subscription: unknown; refundPaise: number }>("/v1/subscription/cancel", { method: "POST", body: { reason } }),
  wallet: () => req<{ balancePaise: number; balanceFormatted: string }>("/v1/wallet"),
  walletTransactions: () => req<{ transactions: { reference: string; direction: string; amountPaise: number; at: string }[] }>("/v1/wallet/transactions"),
  topup: (amountPaise: number) => req<{ paymentOrder?: { providerOrderId: string } }>("/v1/wallet/topup", { method: "POST", body: { amountPaise } }),
  orders: () => req<{ current: OrderCard[]; upcoming: OrderCard[]; previous: OrderCard[]; stateLabels: Record<string, string> }>("/v1/resident/orders"),
  tracking: (orderId: string) => req<Tracking>(`/v1/orders/${orderId}/tracking`),
  orderDetail: (orderId: string) => req<{ order: OrderDetail }>(`/v1/resident/orders/${orderId}`),
  // A quote for what a booking will actually cost, computed backend-side so the
  // figure shown before confirming can never drift from what booking will charge.
  pickupsPreview: (slotId: string, serviceId: string, quantity: number) =>
    req<BookingPreview>(`/v1/pickups/preview?slotId=${encodeURIComponent(slotId)}&estimatedCount=${quantity}&lines=${encodeURIComponent(JSON.stringify([{ category: "Mixed garments", quantity, serviceId }]))}`),
  cancelPickup: (pickupId: string) => req<CancelOrRescheduleResult>("/v1/pickups/cancel", { method: "POST", body: { pickupId } }),
  reschedulePickup: (pickupId: string, slotId: string) => req<CancelOrRescheduleResult>("/v1/pickups/reschedule", { method: "POST", body: { pickupId, slotId } }),
  // Support tickets. Available with or without a subscription — creating one has
  // no plan requirement on the backend, so this never checks subscription status.
  supportIssueTypes: () => req<{ issueTypes: string[]; priorities: string[] }>("/v1/support/issue-types", { auth: false }),
  listTickets: () => req<{ tickets: SupportTicket[] }>("/v1/support/tickets"),
  getTicket: (id: string) => req<{ ticket: SupportTicket }>(`/v1/support/tickets/${id}`),
  createTicket: (body: { category: string; description: string; priority?: IssuePriority; orderId?: string }) =>
    req<{ ticket: SupportTicket }>("/v1/support/tickets", { method: "POST", body }),
  ticketConversation: (id: string) => req<{ conversation: ConversationView }>(`/v1/support/tickets/${id}/conversation`),
  replyToTicket: (id: string, body: string) => req<{ ticket: SupportTicket }>(`/v1/support/tickets/${id}/reply`, { method: "POST", body: { body } }),
  closeTicket: (id: string) => req<{ ticket: SupportTicket }>(`/v1/support/tickets/${id}/close`, { method: "POST" }),
  ticketAttachments: (id: string) => req<{ attachments: AttachmentSummary[] }>(`/v1/support/tickets/${id}/attachments`),
  attachToTicket: (id: string, attachment: { filename: string; contentType: string; data: string }) =>
    req<{ attachment: AttachmentSummary }>(`/v1/support/tickets/${id}/attachments`, { method: "POST", body: attachment }),
  removeAttachment: (attachmentId: string) => req<void>(`/v1/support/attachments/${attachmentId}`, { method: "DELETE" }),
  // The bytes of a private attachment, as something an <img> can render. The
  // serving route asks who is looking, which rules out putting the URL straight
  // into an image source — a bearer token in a URL ends up in logs and history.
  // Fetched with the header instead and handed back as a data URI, mirroring the
  // same pattern the mobile app uses for the same reason.
  fetchAttachmentAsDataUri: async (attachmentId: string): Promise<string> => {
    const t = getToken();
    const res = await fetch(`${API_BASE}/v1/support/attachments/${attachmentId}`, {
      headers: t ? { authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) throw new ApiError(`Could not load the attachment (${res.status})`, res.status, {});
    const type = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = await res.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return `data:${type};base64,${btoa(binary)}`;
  },
  logout: () => req<{ loggedOut?: boolean }>("/v1/auth/logout", { method: "POST" }).catch(() => ({})),
};
