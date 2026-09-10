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

// What to do when the backend says the session is no longer good. Registered by the
// app shell; there is deliberately only one, because expiry is an application-wide
// event and two screens racing to react to it would double-handle it.
//
// Without this a 401 in the middle of a session was just another thrown error: the
// screen showed "Request failed (401)", the app went on rendering as though signed
// in, and every subsequent call failed the same way until the person thought to
// reload. Tokens do expire, and an admin can revoke one, so this is a state the app
// reaches in normal use rather than an edge case.
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;
export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  onSessionExpired = handler;
}

// Exported so the admin/supervisor/operations API modules (lib/api/*.ts) can talk
// to the same backend with the same token, instead of each hand-rolling fetch.
export async function req<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  let sentToken = false;
  if (opts.auth !== false) { const t = getToken(); if (t) { headers.authorization = `Bearer ${t}`; sentToken = true; } }
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // Only when a token was actually presented and rejected. A 401 from the OTP
    // endpoints means the code was wrong, not that a session died, and clearing
    // storage there would log out a second tab for no reason.
    if (res.status === 401 && sentToken) { setToken(null); onSessionExpired?.(); }
    throw new ApiError((data && (data.message || data.error)) || `Request failed (${res.status})`, res.status, data);
  }
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
export interface ServiceOfferingItem {
  id: string; name: string; category?: string; categoryLabel?: string; unit?: string;
  nonSubscriberPricePaise: number; subscriberPricePaise?: number | null;
  includedInPlans?: string[]; isActive?: boolean; [key: string]: unknown;
}
export interface ServiceDateSlot {
  id: string; window: "Morning" | "Afternoon" | "Evening"; startTime: string; endTime: string;
  capacityRemaining: number; capacityTotal: number; full: boolean;
}

// An additional-service booking as the resident sees it in My Orders. Loosely typed:
// the backend's describe() returns the whole request plus a few labels.
export interface ServiceRequestCard {
  id: string; code?: string; orderCode?: string; status: string; statusLabel?: string;
  kind?: string; kindLabel?: string; offeringName?: string; serviceName?: string;
  date?: string; scheduledFor?: string; slot?: string; window?: string;
  payablePaise?: number; quotedPaise?: number;
  [key: string]: unknown;
}
export interface ResidentProfile {
  fullName: string | null; phone: string | null; email: string | null;
  societyId: string | null; societyName: string | null;
  unitNumber: string | null; towerBlock: string | null;
  address: string | null; pickupAddress: string | null;
  preferredWindows?: string[]; accountStatus?: string | null; onboardingCompleted?: boolean;
}
export interface OnboardingBlock {
  id: string; name: string; floorCount: number; flatCount: number;
  flats: { floor: number; number: string }[];
}
export interface OnboardingSociety {
  id: string; name: string; address: string; city: string;
  blocks: OnboardingBlock[];
}
export interface OnboardingOptions {
  completed: boolean;
  requiredFields: string[];
  resident: { fullName?: string | null; societyId?: string | null; blockId?: string | null; unitNumber?: string | null } | null;
  societies: OnboardingSociety[];
}
export interface NotificationItem {
  id: string; type: string; title: string; body: string;
  orderId: string | null; read: boolean; createdAt: string;
}

export interface DashboardOrder {
  id: string; orderCode?: string; state: string;
  acceptedCount?: number | null; expectedCompletionAt?: string | null;
  estimatedDeliveryAt?: string | null; scheduledPickupAt?: string | null; createdAt?: string;
}
export interface DashboardPickup {
  pickupId?: string; orderId?: string | null; orderCode?: string | null;
  date?: string; startTime?: string | null; endTime?: string | null; window?: string | null; status?: string;
}
export interface Dashboard {
  residentName: string | null;
  currentOrder: DashboardOrder | null;
  upcomingOrders: DashboardOrder[];
  recentOrders: DashboardOrder[];
  upcomingPickup: DashboardPickup | null;
  subscription: SubscriptionUsage | null;
  walletBalancePaise: number;
  unreadNotifications: number;
  notifications: NotificationItem[];
}
export interface Tracking { orderCode?: string; state: string; timeline: { state: string; at: string; note?: string }[]; items?: { category: string; quantity: number }[] }
export interface BookingPreview { estimatedChargeablePaise: number; hasSubscription: boolean; canBook: boolean; note?: string }
// The fields TrackView needs beyond what the timeline endpoint returns — reuses
// the same richer resident order-detail endpoint the mobile app already relies on
// for cancel/reschedule, rather than extending the tracking response.
export interface OrderLineDetail { id?: string; category: string; quantity: number; serviceName?: string; measuredQuantity?: number | null; unit?: string }
export interface OrderDetail {
  id: string; state: string; createdAt: string; pickupId: string | null; scheduledPickupAt: string | null; orderCode?: string;
  // What the operator recorded at collection. Absent until the pickup is collected.
  acceptedCount?: number | null; deliveryCount?: number | null; lines?: OrderLineDetail[];
}
export interface CancelOrRescheduleResult { pickup: { id: string; status: string }; feeChargedPaise: number; feePending: boolean }

// Subscription management — only the fields the resident web app renders.
export interface ServiceAllowance { serviceId: string; serviceName: string; unit: string; included: number; used: number; remaining: number; remainingLabel?: string }
export interface PendingPlanChange { planId: string; tier: string; name?: string | null; monthlyPaise: number; allowance: number; turnaroundHours: number; effectiveFrom: string; direction: "upgrade" | "downgrade" | "sidegrade"; canCancel: boolean }
export interface SubscriptionUsage {
  subscriptionId: string; planId: string; planTier: string;
  // What the admin called the plan, and what it says about itself. The tier is a
  // slug, so a page showing it announced "premium_care".
  planName?: string | null; planDescription?: string | null;
  monthlyPaise: number; turnaroundHours: number;
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
// `direction` and `canChange` are decided by the backend from the configured tier
// hierarchy, so the app labels Upgrade / Downgrade / Current without comparing prices.
export interface AvailablePlan extends Plan {
  isCurrent: boolean;
  direction: "current" | "upgrade" | "downgrade" | "same" | "none";
  canChange: boolean;
}

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
// The support channels the operator has chosen to publish. Channels that are not
// configured are absent rather than empty, so the screen renders what exists.
export interface SupportContact {
  channels: { channel: "phone" | "whatsapp" | "email"; value: string }[];
  hours: string | null;
}
export interface AttachmentSummary { id: string; ticketId: string; filename: string; contentType: string; sizeBytes: number; createdAt: string }
export interface ConversationMessage { author: string; authorRole: string | null; authorName: string | null; body: string; at: string; side: "mine" | "theirs" | "system"; system: boolean; unread: boolean }
export interface ConversationView { messages: ConversationMessage[]; canReply: boolean; readOnlyReason: string | null; replyLabel: string; unreadCount: number }

export const api = {
  sendOtp: (phone: string) => req<{ sent: boolean; otpForTesting?: string }>("/v1/auth/otp/send", { method: "POST", body: { phone }, auth: false }),
  verifyOtp: (phone: string, otp: string) => req<{
    token: string; firstLogin: boolean;
    user: { id: string; phone: string; fullName: string | null; roles: string[]; societyIds: string[] };
    portal: "admin" | "supervisor" | "operations" | "resident";
    needsOnboarding: boolean;
  }>("/v1/auth/otp/verify", { method: "POST", body: { phone, otp }, auth: false }),

  // Resident registration (I-75): the societies and their towers, each tower carrying
  // its available Floor → Flat structure (I-74) so the sign-up form offers real,
  // free flats as dependent Society → Tower → Floor → Flat dropdowns.
  getOnboarding: () => req<OnboardingOptions>("/v1/resident/onboarding"),
  submitOnboarding: (body: { fullName: string; societyId: string; blockId: string; unitNumber: string; email?: string }) =>
    req<{ resident: unknown; token: string | null; onboardingCompleted: boolean }>("/v1/auth/onboarding", { method: "POST", body }),
  me: () => req<{ residentId: string | null; societyId: string | null; roles: string[]; user: { fullName: string | null; phone: string } }>("/v1/auth/me"),
  dashboard: () => req<Dashboard>("/v1/resident/dashboard"),
  services: () => req<{ services: Service[] }>("/v1/services"),
  bookingOptions: () => req<{ subscriber: boolean; services: BookingOptionService[] }>("/v1/booking/options"),
  slots: (date: string) => req<{ date: string; slots: Slot[] }>(`/v1/slots?date=${encodeURIComponent(date)}`),
  // I-36: a resident books only a slot. Garments, services and quantities are entered
  // by the operator at collection, so the booking body carries just the slot.
  bookPickup: (slotId: string) => req<{ order: { id: string; orderCode?: string; state: string } }>("/v1/pickups", { method: "POST", body: { slotId } }),
  plans: () => req<{ plans: Plan[] }>("/v1/plans"),
  subscribe: (planId: string) => req<{ subscription: unknown }>("/v1/subscription/subscribe", { method: "POST", body: { planId, cycle: "monthly" } }),
  // Subscription management: current plan + usage, the browse list, and the
  // read-quote-then-confirm change flow (never changes the plan on the quote step).
  residentSubscription: () => req<{ current: SubscriptionUsage | null; availablePlans: AvailablePlan[] }>("/v1/resident/subscription"),
  quotePlanChange: (planId: string) => req<{ quote: PlanChangeQuote }>(`/v1/subscription/change/quote?planId=${encodeURIComponent(planId)}`),
  changePlan: (planId: string) => req<{ status: "applied" | "scheduled"; subscription: unknown; usage: SubscriptionUsage | null; quote: PlanChangeQuote; note: string }>("/v1/subscription/change", { method: "POST", body: { planId } }),
  cancelPlanChange: () => req<{ subscription: SubscriptionUsage | null }>("/v1/subscription/change", { method: "DELETE" }),
  cancelSubscription: (reason: string) => req<{ subscription: unknown; refundPaise: number }>("/v1/subscription/cancel", { method: "POST", body: { reason } }),
  // Profile: the resident's own details. Society, block, floor and flat come back
  // read-only — moving a resident is an admin action, so PATCH only carries the
  // handful of self-service fields.
  getProfile: () => req<{ profile: ResidentProfile }>("/v1/resident/profile"),
  updateProfile: (body: { fullName?: string; email?: string; address?: string }) =>
    req<{ profile: Partial<ResidentProfile> }>("/v1/resident/profile", { method: "PATCH", body }),
  // Notifications for the bell in the header.
  notifications: (unreadOnly = false) =>
    req<{ notifications: NotificationItem[] }>(`/v1/resident/notifications${unreadOnly ? "?unread=true" : ""}`),
  markNotificationRead: (id: string) => req<{ notification: NotificationItem }>(`/v1/resident/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () => req<{ marked: number }>("/v1/resident/notifications/read-all", { method: "POST" }),
  wallet: () => req<{ balancePaise: number; balanceFormatted: string }>("/v1/wallet"),
  walletTransactions: () => req<{ transactions: { reference: string; direction: string; amountPaise: number; at: string }[] }>("/v1/wallet/transactions"),
  topup: (amountPaise: number) => req<{ paymentOrder?: { providerOrderId: string } }>("/v1/wallet/topup", { method: "POST", body: { amountPaise } }),
  orders: () => req<{ current: OrderCard[]; upcoming: OrderCard[]; previous: OrderCard[]; stateLabels: Record<string, string> }>("/v1/resident/orders"),
  // Additional-service bookings (car wash, ironing, …) — a separate list from
  // laundry orders, merged into "My Orders" under the Additional Services filter.
  serviceRequests: () => req<{ requests: ServiceRequestCard[] }>("/v1/services/requests"),
  // Additional Services booking: the active offerings, the admin-created per-date
  // slots for one on a day, a plan-aware quote, and booking against a slot.
  serviceOfferings: () => req<{ offerings: ServiceOfferingItem[] }>("/v1/services/offerings"),
  serviceDateSlots: (offeringId: string, date: string) =>
    req<{ slots: ServiceDateSlot[] }>(`/v1/services/date-slots?offeringId=${encodeURIComponent(offeringId)}&date=${encodeURIComponent(date)}`),
  serviceQuote: (offeringId: string, date: string) =>
    req<{ quote: Record<string, unknown> }>(`/v1/services/quote?offeringId=${encodeURIComponent(offeringId)}&date=${encodeURIComponent(date)}`),
  bookServiceSlot: (body: { serviceSlotId: string; quantity?: number; vehicleType?: string; vehicleNumber?: string; notes?: string }) =>
    req<{ request: ServiceRequestCard }>("/v1/services/slot-requests", { method: "POST", body }),
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
  // How to reach a person, for a resident who cannot or does not want to raise a
  // ticket. Deliberately unauthenticated on the backend and unauthenticated here:
  // somebody locked out of their account still needs the phone number.
  supportContact: () => req<SupportContact>("/v1/support/contact", { auth: false }),
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
  // Closing the account for good. Apple 5.1.1(v) requires this to start inside the
  // app for any app that creates accounts, and Google Play requires the same plus a
  // public web page describing it (/account/delete).
  //
  // The route does not exist on the backend yet — see deleteAccount() below for what
  // the app does about that. Kept RESTful and named for the resource so that when
  // the backend lands, this line needs no change.
  deleteAccountEndpoint: () => req<{ deleted: boolean }>("/v1/resident/account", { method: "DELETE" }),
  logout: () => req<{ loggedOut?: boolean }>("/v1/auth/logout", { method: "POST" }).catch(() => ({})),
};

// How the account deletion actually resolved, so the screen can say the true thing
// rather than one hopeful sentence covering both cases.
export type DeletionResult = "deleted" | "requested";

// Delete the account, or — while the backend route is still missing — file the
// request as a support ticket so it is recorded, assigned and answerable rather than
// silently dropped.
//
// The fallback is not a stand-in for the feature; it is what has to happen when a
// person has asked to be erased and the system cannot yet do it itself. Losing that
// request would be worse than the delay. When the backend ships DELETE
// /v1/resident/account, the 404/405/501 branch simply stops being reached and can be
// deleted with it.
export async function deleteAccount(reason: string): Promise<DeletionResult> {
  try {
    await api.deleteAccountEndpoint();
    return "deleted";
  } catch (e) {
    const missing = e instanceof ApiError && [404, 405, 501].includes(e.status);
    if (!missing) throw e;
    await api.createTicket({
      category: "general_query",
      priority: "high",
      description:
        `ACCOUNT DELETION REQUEST — the resident has asked for their account and personal data to be deleted from inside the app.\n\nReason given: ${reason || "not given"}`,
    });
    return "requested";
  }
}
