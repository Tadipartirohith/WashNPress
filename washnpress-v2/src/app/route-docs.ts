import { doc } from "./openapi";

// Documentation for every endpoint, kept in one table rather than scattered through
// the route files. Anything the server serves but this table does not mention shows
// up in the generated document as "not yet documented", so a gap is visible.

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const int = (description?: string) => ({ type: "integer", ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items: unknown, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) });

const SCOPE_403 = "The resource is outside your permitted scope";
const NOT_FOUND = "Not found";

export function registerRouteDocs(): void {
  // ------------------------------------------------------------------- auth
  doc("POST", "/v1/auth/otp/send", {
    summary: "Send a one time password",
    description: "In local mode the response includes `otpForTesting` so no SMS gateway is needed.",
    tags: ["Auth"],
    body: obj({ phone: str("Ten digit mobile number") }, ["phone"]),
    responses: { "200": "OTP sent", "400": "Rate limited or invalid number" },
  });
  doc("POST", "/v1/auth/otp/verify", {
    summary: "Verify the code and start a session",
    description: "Returns the bearer token, the portal to open, and whether onboarding is still needed. Staff accounts are provisioned by an admin or supervisor and are never asked to onboard.",
    tags: ["Auth"],
    body: obj({ phone: str(), otp: str() }, ["phone", "otp"]),
    responses: { "200": "Session created", "401": "Invalid or expired code, or the account is not active" },
  });
  doc("POST", "/v1/auth/onboarding", {
    summary: "Complete a resident profile",
    description: "Residents only. Reissues the session with the resident scope; use the returned token afterwards.",
    tags: ["Auth"], roles: ["resident"],
    body: obj({
      fullName: str(), societyId: str(), unitNumber: str(), email: str(),
      blockId: str("The block, chosen from the society's own list"),
      towerBlock: str("The block written out, matched against the society's blocks by name"),
      address: str(), pickupAddress: str(), preferredWindows: arr(str()),
    }, ["fullName", "societyId", "unitNumber"]),
    responses: { "201": "Onboarding complete", "400": "Missing or invalid details" },
  });
  doc("GET", "/v1/auth/me", { summary: "Current identity, roles, society, blocks and onboarding status", tags: ["Auth"], roles: ["any"] });
  doc("POST", "/v1/auth/devices", {
    summary: "Register this handset for push notifications",
    description: "Idempotent, and meant to be called on every app start rather than once on install: an operating system rotates a push token, and an app that registered once would quietly stop being reachable weeks later. The token is the record's identity, so the same handset overwrites its own row and a handset passed to a colleague changes hands.",
    tags: ["Auth"], roles: ["any"],
    body: obj({
      token: str("The push token from the device"),
      platform: str("ios, android or web"),
      app: str("resident or staff — the two applications are different store listings"),
    }, ["token", "platform", "app"]),
  });
  doc("DELETE", "/v1/auth/devices", {
    summary: "Stop sending push to this handset",
    description: "Only this account's own handset; another account's token answers 404, so knowing a token is not enough to silence somebody else's phone.",
    tags: ["Auth"], roles: ["any"],
    body: obj({ token: str() }, ["token"]),
  });
  doc("POST", "/v1/auth/logout", {
    summary: "End the session",
    description: "Pass deviceToken to stand this handset down at the same time, which is what matters on a shared device: the next person to sign in must not be handed the last person's notifications.",
    tags: ["Auth"], roles: ["any"],
    body: obj({ deviceToken: str("Optional") }),
  });

  // ---------------------------------------------------------------- catalog
  doc("GET", "/v1/plans", { summary: "Active subscription plans", tags: ["Catalog"] });
  doc("GET", "/v1/addons", { summary: "Active add-on services", tags: ["Catalog"] });
  doc("GET", "/v1/services", { summary: "Garment processing services and their per garment price", tags: ["Catalog"] });
  doc("GET", "/v1/pricing", {
    summary: "The price list, per garment category and per service",
    description: "Pay as you go prices for every garment category, what each service adds on top of them, and — for a signed in resident — their plan's allowance and which services it covers. Subscription pricing and pay as you go pricing are maintained separately: changing one never changes the other.",
    tags: ["Catalog"],
  });
  doc("GET", "/v1/societies", { summary: "Societies available for onboarding", tags: ["Catalog"] });
  doc("GET", "/v1/societies/nearby", { summary: "Active societies", tags: ["Catalog"] });

  // --------------------------------------------------------------- resident
  doc("GET", "/v1/resident/onboarding", { summary: "Onboarding status and the societies to choose from", tags: ["Resident"], roles: ["resident"] });
  doc("GET", "/v1/resident/dashboard", {
    summary: "Everything the resident dashboard shows",
    description: "Current order, next pickup, plan and usage, wallet, pending charges and recent alerts. A resident with no plan gets `subscription: null` and is never blocked from ordering.",
    tags: ["Resident"], roles: ["resident"],
    responses: { "409": "Onboarding is not complete yet" },
  });
  doc("GET", "/v1/resident/orders", {
    summary: "Own orders, grouped",
    tags: ["Resident"], roles: ["resident"],
    query: { status: "active | upcoming | completed | cancelled", from: "ISO date", to: "ISO date", orderCode: "Partial order code" },
  });
  doc("GET", "/v1/resident/orders/:id", { summary: "Own order detail", tags: ["Resident"], roles: ["resident"], params: { id: "Order id" }, responses: { "403": SCOPE_403 } });
  doc("POST", "/v1/resident/orders/:id/pay-additional", {
    summary: "Settle an outstanding order charge from the wallet",
    tags: ["Resident"], roles: ["resident"], params: { id: "Order id" },
    responses: { "402": "Wallet balance is too low", "403": SCOPE_403 },
  });
  doc("GET", "/v1/resident/subscription", { summary: "Current plan with usage, plus the plans available", tags: ["Resident"], roles: ["resident"] });
  doc("GET", "/v1/resident/profile", { summary: "Own profile", tags: ["Resident"], roles: ["resident"] });
  doc("PATCH", "/v1/resident/profile", {
    summary: "Update own contact details",
    description: "Society and unit are not accepted here: moving a resident between societies is an admin or supervisor action.",
    tags: ["Resident"], roles: ["resident"],
    body: obj({ fullName: str(), email: str(), address: str(), pickupAddress: str(), preferredWindows: arr(str()) }),
  });
  doc("GET", "/v1/resident/notifications", { summary: "In app notification feed", tags: ["Resident"], roles: ["any"], query: { unread: "true to return only unread" } });
  doc("POST", "/v1/resident/notifications/:id/read", { summary: "Mark one notification read", tags: ["Resident"], roles: ["any"], params: { id: "Notification id" } });
  doc("POST", "/v1/resident/notifications/read-all", { summary: "Mark every notification read", tags: ["Resident"], roles: ["any"] });

  // ------------------------------------------------------------ subscription
  doc("GET", "/v1/subscription", { summary: "Current subscription and its usage", tags: ["Subscription"], roles: ["resident"] });
  doc("GET", "/v1/subscription/usage", { summary: "Allowance, used, remaining, renewal and expiry", tags: ["Subscription"], roles: ["resident"] });
  doc("POST", "/v1/subscription/subscribe", {
    summary: "Subscribe to a plan, charged from the wallet",
    description: "Subscribing is optional. A resident without a plan can still book and pays the per garment rate.",
    tags: ["Subscription"], roles: ["resident"],
    body: obj({ planId: str(), cycle: str("monthly or annual") }, ["planId"]),
    responses: { "201": "Subscribed", "402": "Wallet balance is too low" },
  });
  doc("GET", "/v1/subscription/change/quote", {
    summary: "What changing to a plan would cost, and when it would happen",
    description: "Writes nothing. Clicking Upgrade used to change the subscription there and then, quote a proration figure back, and charge nothing, so the resident could not tell whether what they were shown was a bill, a receipt, or a plan that had already changed.",
    tags: ["Subscription"], roles: ["resident"],
    query: { planId: "The plan being considered" },
    responses: { "422": "That change cannot be made, with the reason" },
  });
  doc("POST", "/v1/subscription/change", { summary: "Upgrade or downgrade, effective next cycle", tags: ["Subscription"], roles: ["resident"], body: obj({ planId: str() }, ["planId"]) });
  doc("DELETE", "/v1/subscription/change", { summary: "Call off a scheduled plan change", description: "The resident stays on the plan they are already on and the pending change disappears.", tags: ["Subscription"], roles: ["resident"] });
  doc("POST", "/v1/subscription/pause", { summary: "Pause the subscription", tags: ["Subscription"], roles: ["resident"], body: obj({ until: str("ISO date") }, ["until"]) });
  doc("POST", "/v1/subscription/cancel", { summary: "Cancel the subscription", tags: ["Subscription"], roles: ["resident"], body: obj({ reason: str() }, ["reason"]) });

  // --------------------------------------------------------------- scheduling
  doc("GET", "/v1/booking/options", {
    summary: "Everything one Booking screen needs for this resident",
    description: "Says whether the resident is on a plan and what therefore applies: which services they may choose, in which unit, at what price, what their plan has left of each, and which days each may be collected on. There is one booking module rather than a separate Book and Regular, so the client renders this rather than deciding it.",
    tags: ["Scheduling"], roles: ["resident"],
  });
  doc("GET", "/v1/slots", { summary: "Available slots for the resident's own society", description: "Slots held for subscribers are not offered to a resident without a plan.", tags: ["Scheduling"], roles: ["resident"], query: { date: "YYYY-MM-DD" } });
  doc("GET", "/v1/pickups/preview", {
    summary: "The booking confirmation screen",
    description: "Prices the chosen services and shows the plan position before anything is committed.",
    tags: ["Scheduling"], roles: ["resident"],
    query: { slotId: "Slot to book", estimatedCount: "Resident's own estimate", lines: "JSON encoded service splits" },
  });
  doc("POST", "/v1/pickups", {
    summary: "Book a pickup",
    description: "Capacity is taken atomically, so a slot that filled up first fails with `slot_unavailable` rather than overselling. `lines` lets one garment category be split across different services.",
    tags: ["Scheduling"], roles: ["resident"],
    body: obj({
      slotId: str(), estimatedCount: int(), specialInstructions: str(),
      recurring: bool(), recurringDays: arr(int()), addonIds: arr(str()),
      lines: arr(obj({ category: str(), quantity: int(), serviceId: str(), addonIds: arr(str()), notes: str() }, ["category", "quantity", "serviceId"])),
    }, ["slotId"]),
    responses: { "201": "Booked", "409": "The slot just filled up", "400": "Unknown service" },
  });
  doc("GET", "/v1/pickups", { summary: "Own pickups", tags: ["Scheduling"], roles: ["resident"] });
  doc("POST", "/v1/pickups/reschedule", { summary: "Move a pickup to another slot", tags: ["Scheduling"], roles: ["resident"], body: obj({ pickupId: str(), slotId: str() }, ["pickupId", "slotId"]), responses: { "409": "Past the change cutoff, or the slot is full" } });
  doc("POST", "/v1/pickups/cancel", { summary: "Cancel a pickup", tags: ["Scheduling"], roles: ["resident"], body: obj({ pickupId: str() }, ["pickupId"]), responses: { "409": "Past the change cutoff" } });
  doc("GET", "/v1/orders/:id", { summary: "Own order", tags: ["Scheduling"], roles: ["resident"], params: { id: "Order id" } });
  doc("GET", "/v1/orders/:id/tracking", {
    summary: "Tracking timeline for one order",
    description: "Includes `revision` and `updatedAt`, which the app polls to detect a genuine change without diffing the whole order.",
    tags: ["Scheduling"], roles: ["resident"], params: { id: "Order id" },
  });
  doc("POST", "/v1/orders/:id/rate", { summary: "Rate a delivered order", tags: ["Scheduling"], roles: ["resident"], params: { id: "Order id" }, body: obj({ rating: int("1 to 5"), comment: str() }, ["rating"]) });
  doc("POST", "/v1/orders/:id/dispute", { summary: "Raise a dispute against an order", tags: ["Scheduling"], roles: ["resident"], params: { id: "Order id" }, body: obj({ description: str() }, ["description"]) });

  // ------------------------------------------------------------------ wallet
  doc("GET", "/v1/wallet", { summary: "Wallet balance", tags: ["Wallet"], roles: ["resident"] });
  doc("GET", "/v1/wallet/transactions", { summary: "Wallet transactions", tags: ["Wallet"], roles: ["resident"] });
  doc("POST", "/v1/wallet/topup", { summary: "Start a wallet top up", tags: ["Wallet"], roles: ["resident"], body: obj({ amountPaise: int() }, ["amountPaise"]) });
  doc("GET", "/v1/wallet/:residentId/balance", { summary: "Balance by resident id, used by the payment tests", tags: ["Wallet"], params: { residentId: "Resident id" } });

  // ----------------------------------------------------------------- support
  doc("GET", "/v1/support/issue-types", { summary: "Issue categories and priorities", tags: ["Support"] });
  doc("POST", "/v1/support/tickets", {
    summary: "Raise a support ticket",
    description: "A resident raises questions, complaints and disputes here rather than resolving them with an operator directly. Mark `priority: emergency` for something urgent.",
    tags: ["Support"], roles: ["resident"],
    body: obj({ category: str(), description: str(), orderId: str(), priority: str("low | normal | high | emergency") }, ["category", "description"]),
    responses: { "201": "Ticket raised", "403": SCOPE_403 },
  });
  doc("GET", "/v1/support/tickets", { summary: "Own tickets", tags: ["Support"], roles: ["resident"] });
  doc("GET", "/v1/support/tickets/:id", { summary: "One ticket with its full conversation", tags: ["Support"], roles: ["resident", "operator", "supervisor", "admin"], params: { id: "Ticket id" }, responses: { "403": SCOPE_403 } });
  doc("GET", "/v1/support/tickets/:id/conversation", {
    summary: "An issue as a conversation",
    description: "Every message in the order it happened, whether this viewer may still add to it and why not, and who a reply is actually addressed to. One route rather than one per portal: an issue is a single conversation between a resident, an operator, a supervisor and the system. Reading it marks it read, which is what makes an unread count mean anything.",
    tags: ["Support"], roles: ["resident", "operator", "supervisor", "admin"],
    params: { id: "Issue id" },
  });
  doc("POST", "/v1/support/tickets/:id/reply", {
    summary: "Add a message to a ticket",
    description: "A reply from the resident on a resolved ticket puts it back into progress, because the person who raised it decides whether it is fixed.",
    tags: ["Support"], roles: ["resident", "operator", "supervisor", "admin"], params: { id: "Ticket id" },
    body: obj({ body: str() }, ["body"]),
  });
  doc("POST", "/v1/support/tickets/:id/close", {
    summary: "Close a resolved ticket",
    description: "The resident closes their own ticket once they are satisfied. Closing is final.",
    tags: ["Support"], roles: ["resident"], params: { id: "Ticket id" },
  });

  // -------------------------------------------------------------- operations
  doc("GET", "/v1/operations/dashboard", { summary: "Today's work by stage", tags: ["Operations"], roles: ["operator"] });
  doc("GET", "/v1/operations/config", { summary: "Garment categories, services, rates and issue types", tags: ["Operations"], roles: ["operator"] });
  doc("GET", "/v1/operations/pickups", { summary: "Today's pickup queue", tags: ["Operations"], roles: ["operator"], query: { date: "YYYY-MM-DD" } });
  doc("GET", "/v1/operations/bookings", { summary: "Scheduled orders, kept for older clients", tags: ["Operations"], roles: ["operator"] });
  doc("GET", "/v1/operations/orders/:id", { summary: "Order detail", tags: ["Operations"], roles: ["operator"], params: { id: "Order id" }, responses: { "403": SCOPE_403 } });
  doc("POST", "/v1/operations/orders/:id/garments/preview", {
    summary: "The calculated quantity split, before committing",
    description: "The operator supplies only the accepted quantity. The covered quantity, the additional quantity and the charge come back from the backend.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Order id" },
    body: obj({ items: arr(obj({ category: str(), quantity: int() }, ["category", "quantity"])) }, ["items"]),
  });
  doc("POST", "/v1/operations/orders/:id/picked-up", {
    summary: "Record the actual accepted quantity and collect the order",
    description: "Finalises subscription usage from the accepted quantity, not the resident's estimate.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Order id" },
    body: obj({ items: arr(obj({ category: str(), quantity: int() }, ["category", "quantity"])) }, ["items"]),
    responses: { "400": "No garment quantity entered", "409": "Illegal transition" },
  });
  doc("POST", "/v1/operations/orders/:id/pickup-failed", {
    summary: "Record a failed pickup with its reason",
    description: "The order is preserved and stays visible in history rather than disappearing from the queue.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Order id" },
    body: obj({ reason: str() }, ["reason"]),
  });
  for (const [path, summary] of [
    ["wash/start", "Start washing"], ["wash/complete", "Complete washing"],
    ["ironing/start", "Start ironing"], ["ironing/complete", "Complete ironing"],
    ["out-for-delivery", "Send out for delivery"],
  ] as const) {
    doc("POST", `/v1/operations/orders/:id/${path}`, { summary, tags: ["Operations"], roles: ["operator"], params: { id: "Order id" }, responses: { "409": "Illegal transition" } });
  }
  doc("POST", "/v1/operations/orders/:id/advance", { summary: "Generic stage move, replayed by the offline queue", tags: ["Operations"], roles: ["operator"], params: { id: "Order id" }, body: obj({ to: str("in_wash | ironing | qc") }, ["to"]) });
  doc("POST", "/v1/operations/orders/:id/qc", {
    summary: "Record a quality check result",
    description: "A failure must carry a reason. It opens an issue for the supervisor and sends the batch back for reprocessing; it can never go straight to ready for delivery.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Order id" },
    body: obj({ pass: bool(), reason: str("Required when pass is false") }, ["pass"]),
    responses: { "400": "A failure needs a reason" },
  });
  doc("POST", "/v1/operations/orders/:id/reprocess", { summary: "Send a held batch back to washing or ironing", tags: ["Operations"], roles: ["operator"], params: { id: "Order id" }, body: obj({ to: str("in_wash | ironing") }, ["to"]) });
  doc("POST", "/v1/operations/orders/:id/deliver", {
    summary: "Complete the delivery",
    description: "A delivered count that differs from the accepted count needs a documented reason.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Order id" },
    body: obj({ deliveryCount: int(), discrepancyReason: str() }, ["deliveryCount"]),
    responses: { "409": "Count mismatch without a reason" },
  });
  doc("GET", "/v1/operations/active", { summary: "Work in progress grouped by stage", tags: ["Operations"], roles: ["operator"] });
  doc("GET", "/v1/operations/queue", { summary: "Unassigned work anyone covering the block may pick up", tags: ["Operations"], roles: ["operator"] });
  doc("POST", "/v1/operations/orders/:id/claim", { summary: "Take an unassigned order", tags: ["Operations"], roles: ["operator"], params: { id: "Order id" } });
  doc("GET", "/v1/operations/history", { summary: "Completed, cancelled and failed orders", tags: ["Operations"], roles: ["operator"], query: { state: "Order state", from: "ISO date", to: "ISO date" } });
  doc("GET", "/v1/operations/search", { summary: "Search within the operator's scope", tags: ["Operations"], roles: ["operator"], query: { q: "Order code, resident name or phone", societyId: "", state: "", from: "", to: "" } });
  doc("GET", "/v1/operations/blocks", {
    summary: "The blocks this operator covers",
    description: "With flats, residents and active orders for each. An operator given no blocks covers the whole of every society assigned to them, which is what every assignment made before blocks existed meant.",
    tags: ["Operations"], roles: ["operator"],
  });
  doc("GET", "/v1/operations/issues", { summary: "Issues in the operator's societies", tags: ["Operations"], roles: ["operator"], query: { status: "Ticket status" } });
  doc("GET", "/v1/operations/issues/:id", { summary: "Ticket detail with its full history", tags: ["Operations"], roles: ["operator"], params: { id: "Ticket id" } });
  doc("POST", "/v1/operations/issues/:id/take", {
    summary: "Take a ticket",
    description: "The operator assigns the ticket to themselves. Ownership is accepted rather than handed out, so an operator cannot assign work to a colleague.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Ticket id" },
    responses: { "409": "The ticket is already closed" },
  });
  doc("POST", "/v1/operations/issues/:id/reply", {
    summary: "Reply to the resident on a ticket",
    description: "The reply appears in the resident's own support screen and notifies them.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Ticket id" },
    body: obj({ body: str() }, ["body"]),
  });
  doc("PATCH", "/v1/operations/issues/:id/status", {
    summary: "Move a ticket through its lifecycle",
    description: "Open, under review, in progress, resolved, closed. Resolving notifies the resident with the resolution note.",
    tags: ["Operations"], roles: ["operator"], params: { id: "Ticket id" },
    body: obj({ status: str("open | assigned | in_progress | resolved | closed"), resolution: str() }, ["status"]),
    responses: { "409": "That move is not legal from the ticket's current status" },
  });
  doc("POST", "/v1/admin/issues/:id/close", { summary: "Close an issue", tags: ["Admin"], roles: ["admin"], params: { id: "Issue id" }, body: obj({ resolution: str() }) });
  doc("POST", "/v1/admin/issues/:id/reopen", { summary: "Reopen a closed issue", tags: ["Admin"], roles: ["admin"], params: { id: "Issue id" }, body: obj({ reason: str() }, ["reason"]) });
  doc("GET", "/v1/services/offerings", { summary: "Services that are not laundry", tags: ["Catalogue"], query: { kind: "vehicle_wash | home_ironing" } });
  doc("GET", "/v1/services/quote", { summary: "What a service booking would cost", tags: ["Resident"], roles: ["resident"], query: { offeringId: "Offering id", estimatedHours: "For an hourly service" } });
  doc("GET", "/v1/services/slots", {
    summary: "Which start times an hourly service could actually take",
    description: "A booking of two hours needs two consecutive hours free, not two free hours somewhere in the day. Told before the resident chooses rather than when the second hour turns out to be taken.",
    tags: ["Services"], roles: ["resident"],
    query: { offeringId: "Service id", date: "YYYY-MM-DD", hours: "How many hours" },
  });
  doc("POST", "/v1/services/requests", { summary: "Book a vehicle wash or at-home ironing", tags: ["Resident"], roles: ["resident"], body: obj({ offeringId: str(), scheduledFor: str(), vehicleType: str(), vehicleNumber: str(), estimatedHours: str(), address: str(), notes: str() }, ["offeringId", "scheduledFor"]) });
  doc("GET", "/v1/services/requests", { summary: "My service bookings", tags: ["Resident"], roles: ["resident"] });
  doc("POST", "/v1/services/requests/:id/cancel", { summary: "Cancel a service booking", tags: ["Resident"], roles: ["resident"], params: { id: "Request id" }, body: obj({ reason: str() }, ["reason"]) });
  doc("GET", "/v1/operations/services", { summary: "Service jobs in my societies", tags: ["Operations"], roles: ["operator"], query: { status: "Status", kind: "Service kind", mine: "true to see only mine" } });
  doc("POST", "/v1/operations/services/:id/assign", { summary: "Take or hand over a service job", tags: ["Operations"], roles: ["operator"], params: { id: "Request id" }, body: obj({ staffUserId: str() }) });
  doc("POST", "/v1/operations/services/:id/start", { summary: "Start a service job", tags: ["Operations"], roles: ["operator"], params: { id: "Request id" } });
  doc("POST", "/v1/operations/services/:id/complete", { summary: "Complete a service job and record the time it took", tags: ["Operations"], roles: ["operator"], params: { id: "Request id" }, body: obj({ actualHours: str(), note: str() }) });
  doc("GET", "/v1/admin/service-requests", {
    summary: "All service bookings",
    description: "The bookings made against the extra services. This used to be /v1/admin/services, which is the path the catalogue needs and never described a list of bookings.",
    tags: ["Admin"], roles: ["admin"],
    query: { status: "Status", kind: "Service kind", societyId: "Society id" },
  });
  doc("GET", "/v1/admin/services", {
    summary: "The services catalogue",
    description: "One list of every extra service, narrowed by search and filters. No dashboard and no statistics: the page is the services and what can be done to them.",
    tags: ["Admin"], roles: ["admin"],
    query: { q: "Search by name, category or unit", category: "Category", eligibility: "Who it is sold to", status: "active or inactive", unit: "Measurement unit" },
  });
  doc("GET", "/v1/admin/services/export", {
    summary: "The services catalogue as a CSV",
    description: "Exported from the same query as the page, so what is exported is what was on screen rather than everything regardless of the filters.",
    tags: ["Admin"], roles: ["admin"],
    query: { q: "Search", category: "Category", eligibility: "Who it is sold to", status: "active or inactive", unit: "Measurement unit" },
  });
  doc("GET", "/v1/admin/services/:id", { summary: "One service, fully configured", description: "Everything the wizard set, because Edit opens the same wizard pre-filled.", tags: ["Admin"], roles: ["admin"], params: { id: "Service id" } });
  doc("POST", "/v1/admin/services", {
    summary: "Create a service",
    description: "The twelve steps of the service wizard as one body: measurement and quantity, pricing, plan-based pricing, plan allowance, frequency, availability, time slots, eligibility, booking rules and additional charges. Refusing names every problem at once rather than one at a time.",
    tags: ["Admin"], roles: ["admin"],
    body: obj({ name: str(), category: str(), unit: str(), unitPricePaise: str() }, ["name", "category", "unit", "unitPricePaise"]),
  });
  doc("PATCH", "/v1/admin/services/:id", { summary: "Change a service", description: "Held to the same rules as creating one, and says how many open bookings the service already has.", tags: ["Admin"], roles: ["admin"], params: { id: "Service id" }, body: obj({ name: str(), unitPricePaise: str(), isActive: str() }) });
  doc("POST", "/v1/admin/services/:id/duplicate", { summary: "Copy a service", description: "The copy is created inactive, so duplicating one never puts a half-configured service in front of residents.", tags: ["Admin"], roles: ["admin"], params: { id: "Service id" }, body: obj({ name: str() }) });
  doc("GET", "/v1/admin/services/:id/bookings", { summary: "What is booked against a service", description: "Why deactivating is the right action rather than deleting: the bookings outlive the offering.", tags: ["Admin"], roles: ["admin"], params: { id: "Service id" } });
  doc("GET", "/v1/resident/schedules", { summary: "My standing pickup arrangements", tags: ["Resident"], roles: ["resident"] });
  doc("POST", "/v1/resident/schedules", { summary: "Set up a recurring pickup", tags: ["Resident"], roles: ["resident"], body: obj({ frequency: str(), days: str(), window: str(), startDate: str() }, ["frequency", "window"]) });
  doc("PATCH", "/v1/resident/schedules/:id", { summary: "Change or pause a recurring pickup", tags: ["Resident"], roles: ["resident"], params: { id: "Schedule id" }, body: obj({ frequency: str(), days: str(), window: str(), status: str() }) });
  doc("DELETE", "/v1/resident/schedules/:id", { summary: "Stop a recurring pickup", tags: ["Resident"], roles: ["resident"], params: { id: "Schedule id" } });
  doc("GET", "/v1/resident/preferences", { summary: "My preferred pickup windows", tags: ["Resident"], roles: ["resident"] });
  doc("PUT", "/v1/resident/preferences", { summary: "Choose my preferred pickup windows", tags: ["Resident"], roles: ["resident"], body: obj({ preferredWindows: str() }, ["preferredWindows"]) });
  doc("GET", "/v1/admin/staff/pending", { summary: "Staff accounts awaiting a decision", tags: ["Admin"], roles: ["admin"], query: { status: "pending | approved | rejected", role: "supervisor | operator" } });
  doc("POST", "/v1/admin/staff/:id/verification", { summary: "Approve or reject a staff account", tags: ["Admin"], roles: ["admin"], params: { id: "User id" }, body: obj({ status: str(), note: str() }, ["status"]) });
  doc("GET", "/v1/supervisor/operators/pending", { summary: "Operators in my society awaiting a decision", tags: ["Supervisor"], roles: ["supervisor"], query: { status: "pending | approved | rejected" } });
  doc("POST", "/v1/supervisor/operators/:id/verification", { summary: "Approve or reject an operator in my society", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "User id" }, body: obj({ status: str(), note: str() }, ["status"]) });
  doc("GET", "/v1/admin/diagnostics", { summary: "Deployment details, for an admin only", tags: ["Admin"], roles: ["admin"] });
  doc("POST", "/v1/operations/orders/:id/reconcile", { summary: "Requested against received, per garment and service", tags: ["Operations"], roles: ["operator"], params: { id: "Order id" }, body: obj({ lines: str() }) });
  doc("GET", "/v1/operations/orders/:id/batches", { summary: "The processing batches for an order", tags: ["Operations"], roles: ["operator"], params: { id: "Order id" } });
  doc("POST", "/v1/operations/orders/:id/batches/:batchId/advance", { summary: "Complete the step a batch is on", tags: ["Operations"], roles: ["operator"], params: { id: "Order id", batchId: "Batch id" }, body: obj({ step: str() }, ["step"]) });
  doc("POST", "/v1/operations/orders/:id/batches/:batchId/qc", { summary: "Quality check one batch", tags: ["Operations"], roles: ["operator"], params: { id: "Order id", batchId: "Batch id" }, body: obj({ passed: str(), reason: str() }, ["passed"]) });
  doc("GET", "/v1/operations/qc-reasons", {
    summary: "Why a quality check can fail, and what each reason means",
    description: "The reason decides where the work goes back to, whether a photograph is required, and whether a supervisor and the resident are told. Sent by the backend so the operator's screen never keeps its own copy of a list that decides where work goes.",
    tags: ["Operations"], roles: ["operator", "supervisor", "admin"],
  });
  doc("GET", "/v1/operations/discrepancy-reasons", {
    summary: "Why a collected quantity can differ from the declared one",
    description: "Sent by the backend so the screen never keeps its own copy of a list somebody has to choose from.",
    tags: ["Operations"], roles: ["operator", "supervisor", "admin"],
  });
  doc("GET", "/v1/operations/assignable-operators", {
    summary: "Who a pickup can be given to",
    description: "The operators who actually cover the societies this person can see. Assigning to somebody who cannot reach the society is how a pickup ends up with a name against it and nobody able to do it.",
    tags: ["Operations"], roles: ["operator", "supervisor", "admin"],
  });
  doc("POST", "/v1/operations/orders/:id/assign", {
    summary: "Give a pickup to an operator",
    description: "Operations could only ever claim an order for themselves, so \"assign this to Ravi\" had nowhere to go and the pickup stayed Unassigned. Returns the order as it now reads, so the field shows the new name immediately rather than after a refresh. Pass null to return it to the shared queue.",
    tags: ["Operations"], roles: ["operator", "supervisor", "admin"],
    params: { id: "Order id" },
    body: obj({ operatorUserId: str("Operator user id, or null to unassign"), reason: str() }, ["operatorUserId"]),
  });
  doc("POST", "/v1/orders/:id/discrepancy", {
    summary: "Acknowledge or dispute a quantity discrepancy",
    description: "The resident's answer to a difference between what they declared and what was collected. Either way it stays on the record: acknowledging one does not erase it, and disputing one does not change the count that was verified.",
    tags: ["Support"], roles: ["resident"],
    params: { id: "Order id" },
    body: obj({ answer: str("acknowledged or disputed"), note: str() }, ["answer"]),
  });
  doc("POST", "/v1/operations/issues/:id/escalate", { summary: "Hand an issue up to the supervisor", tags: ["Operations"], roles: ["operator"], params: { id: "Ticket id" }, body: obj({ note: str() }) });
  doc("POST", "/v1/operations/issues", { summary: "Report an issue to the supervisor", tags: ["Operations"], roles: ["operator"], body: obj({ type: str(), description: str(), orderId: str(), priority: str() }, ["type", "description"]) });
  doc("GET", "/v1/operations/profile", { summary: "Own staff profile", tags: ["Operations"], roles: ["operator"] });
  doc("PATCH", "/v1/operations/profile", { summary: "Update own contact details", description: "Society and block assignment are supervisor controlled and ignored here.", tags: ["Operations"], roles: ["operator"], body: obj({ fullName: str(), email: str() }) });
  doc("GET", "/v1/operations/units/:unitId/earnings", { summary: "Unit earnings", tags: ["Operations"], roles: ["operator"], params: { unitId: "Unit id" } });

  // -------------------------------------------------------------- supervisor
  doc("GET", "/v1/supervisor/dashboard", { summary: "The assigned society's operational status, and its blocks", tags: ["Supervisor"], roles: ["supervisor"] });
  doc("GET", "/v1/supervisor/society", {
    summary: "The society this supervisor runs, and how its blocks are covered",
    description: "A supervisor runs exactly one society and cannot change which; that is an admin's decision. Everything inside it — its blocks and who covers them — is theirs to arrange. A supervisor not yet given a society gets a null society rather than an error.",
    tags: ["Supervisor"], roles: ["supervisor"],
  });
  doc("GET", "/v1/supervisor/services", {
    summary: "Service bookings inside this supervisor's society",
    description: "Car washing, at-home ironing and the rest, with who booked each one, where they live, which operator took it and when, every operator who has held it, and each stage it has passed through. Scoped to the supervisor's own society. Paged, and filterable by status, service, operator and date.",
    tags: ["Supervisor"], roles: ["supervisor"],
  });
  doc("POST", "/v1/supervisor/societies/:id/blocks", {
    summary: "Add a block to their own society",
    tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Society id" },
    body: obj({ name: str("Tower"), floorCount: int("Positive"), flatCount: int("Positive") }, ["name"]),
    responses: { "403": SCOPE_403, "409": "That society already has a block by that name" },
  });
  doc("PATCH", "/v1/supervisor/blocks/:blockId", {
    summary: "Rename a block, correct its floors or flats, or deactivate it",
    tags: ["Supervisor"], roles: ["supervisor"], params: { blockId: "Block id" },
    body: obj({ name: str(), floorCount: int(), flatCount: int(), status: str() }),
    responses: { "403": SCOPE_403 },
  });
  doc("GET", "/v1/supervisor/blocks/:blockId", {
    summary: "One block, and everybody who lives in it",
    description: "A block card is not only a set of management actions. This is the tower — its floors, flats, status and operators — and the residents of that tower and no other, with their flat, phone, plan and open orders.",
    tags: ["Supervisor"], roles: ["supervisor"], params: { blockId: "Block id" },
    responses: { "403": SCOPE_403, "404": "No such block" },
  });
  doc("PUT", "/v1/supervisor/blocks/:blockId/operators", {
    summary: "Set which operators cover a block of their own society",
    tags: ["Supervisor"], roles: ["supervisor"], params: { blockId: "Block id" },
    body: obj({ operatorUserIds: arr(str()) }, ["operatorUserIds"]),
    responses: { "403": SCOPE_403, "409": "One of those operators cannot be assigned" },
  });
  doc("GET", "/v1/supervisor/societies", { summary: "The societies this supervisor runs", tags: ["Supervisor"], roles: ["supervisor"], query: { q: "Name or code", status: "Society status" } });
  // Creating and editing a society is the admin's: a society is what an admin gives
  // a supervisor, so a supervisor who could create one could give themselves work
  // nobody assigned them.
  doc("GET", "/v1/supervisor/societies/:id", { summary: "Society detail with residents, staff, slots, orders and issues", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Society id" }, responses: { "403": SCOPE_403 } });
  doc("PATCH", "/v1/supervisor/societies/:id", { summary: "Edit or deactivate a society", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Society id" }, body: obj({ name: str(), address: str(), status: str() }) });
  doc("GET", "/v1/supervisor/slots", { summary: "Slots for the assigned society", tags: ["Supervisor"], roles: ["supervisor"], query: { societyId: "", from: "", to: "" } });
  doc("POST", "/v1/supervisor/slots", { summary: "Create a pickup slot", tags: ["Supervisor"], roles: ["supervisor"], body: obj({ societyId: str(), date: str(), window: str(), startTime: str(), endTime: str(), capacityTotal: int() }, ["societyId", "date", "window", "startTime", "endTime", "capacityTotal"]) });
  doc("PATCH", "/v1/supervisor/slots/:id", { summary: "Edit a slot", description: "Capacity cannot be lowered below what is already booked.", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Slot id" }, body: obj({ window: str(), startTime: str(), endTime: str(), capacityTotal: int(), isActive: bool() }), responses: { "409": "Capacity is below the booked count" } });
  doc("POST", "/v1/supervisor/slots/:id/cancel", { summary: "Cancel a slot and its bookings", description: "Affected residents are notified.", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Slot id" } });
  doc("GET", "/v1/supervisor/operators", { summary: "Operations staff in the assigned society, with its blocks", tags: ["Supervisor"], roles: ["supervisor"], query: { status: "", q: "Name or phone", blockId: "" } });
  doc("POST", "/v1/supervisor/operators", {
    summary: "Create an operations user in the assigned society",
    description: "The society is taken from the session, so an operator cannot be created into somebody else's. What the supervisor chooses is which of its blocks this person covers \u2014 blocks are the assignment, so an operator with none has no work. No verification codes: the OTP belongs to signing in, not to being created.",
    tags: ["Supervisor"], roles: ["supervisor"],
    body: obj({ firstName: str(), lastName: str(), phone: str(), email: str(), blockIds: arr(str()) },
      ["firstName", "lastName", "phone", "email"]),
    responses: { "403": "One of those blocks is not in your society", "409": "You run no society yet, or that phone number already has an account" },
  });
  doc("PATCH", "/v1/supervisor/operators/:id", { summary: "Edit an operations user or change their blocks", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "User id" }, body: obj({ firstName: str(), lastName: str(), email: str(), status: str(), blockIds: arr(str()) }), responses: { "403": "The operator belongs to another society" } });
  doc("GET", "/v1/supervisor/operators/:id/handover", { summary: "What an operator is still holding, and who could take it", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "User id" } });
  doc("POST", "/v1/supervisor/operators/:id/availability", {
    summary: "Put an operator on leave or bring them back",
    description: "The account is never deleted. Open work is either handed to a named colleague or returned to the shared queue, so nothing is stranded behind one person.",
    tags: ["Supervisor"], roles: ["supervisor"], params: { id: "User id" },
    body: obj({ status: str("active | on_leave | blocked"), reassignToUserId: str(), reason: str() }, ["status"]),
  });
  doc("GET", "/v1/supervisor/workload", { summary: "Per operator pending, processing and completed counts", tags: ["Supervisor"], roles: ["supervisor"] });
  doc("GET", "/v1/supervisor/orders", {
    summary: "Orders in the assigned society, with the options its filters offer",
    description: "Status, block, operator, resident and a date range \u2014 the five things a supervisor actually looks an order up by. Every option offered comes from inside their own society.",
    tags: ["Supervisor"], roles: ["supervisor"],
    query: { societyId: "", blockId: "", state: "", operatorUserId: "", residentId: "", resident: "Name, phone or flat", from: "", to: "", orderCode: "" },
  });
  doc("GET", "/v1/supervisor/orders/:id", { summary: "Order detail", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Order id" }, responses: { "403": SCOPE_403 } });
  doc("POST", "/v1/supervisor/orders/:id/assign", { summary: "Assign or reassign the operator on an order", description: "The order keeps its state and history; it simply changes hands.", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Order id" }, body: obj({ operatorUserId: str("null to return it to the shared queue"), reason: str() }) });
  doc("GET", "/v1/supervisor/pickups", { summary: "Pickup monitoring", tags: ["Supervisor"], roles: ["supervisor"], query: { date: "YYYY-MM-DD" } });
  doc("GET", "/v1/supervisor/processing", { summary: "Orders grouped by processing stage", tags: ["Supervisor"], roles: ["supervisor"] });
  doc("GET", "/v1/supervisor/qc", {
    summary: "Quality checks in the supervisor's society",
    description: "Narrowable by order, resident, status, society, operator and day, and paged. A busy society produces more checks in a week than anybody wants to scroll through to find one. The response carries the societies and operators actually present in the list, so a screen can build its filters without a second call.",
    tags: ["Supervisor"], roles: ["supervisor"],
    query: {
      q: "Order code, resident or society", status: "pending, passed, recheck or failed",
      societyId: "Society id", operatorUserId: "Operator user id", date: "YYYY-MM-DD",
      limit: "Page size", offset: "Page offset",
    },
  });
  doc("GET", "/v1/supervisor/delayed", { summary: "Orders past their expected completion", tags: ["Supervisor"], roles: ["supervisor"] });
  doc("GET", "/v1/supervisor/issues", { summary: "Support tickets for the assigned society", tags: ["Supervisor"], roles: ["supervisor"], query: { status: "", type: "", societyId: "", priority: "", emergency: "true for emergencies only" } });
  doc("GET", "/v1/supervisor/issues/:id", { summary: "Ticket detail with the full conversation", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Ticket id" } });
  doc("PATCH", "/v1/supervisor/issues/:id/status", { summary: "Move a ticket through its lifecycle", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Ticket id" }, body: obj({ status: str("assigned | in_progress | resolved | closed"), resolution: str() }, ["status"]), responses: { "409": "Illegal ticket transition" } });
  doc("POST", "/v1/supervisor/issues/:id/reply", { summary: "Reply to the resident on a ticket", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Ticket id" }, body: obj({ body: str() }, ["body"]) });
  doc("PATCH", "/v1/supervisor/issues/:id/priority", { summary: "Change a ticket's priority", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Ticket id" }, body: obj({ priority: str("low | normal | high | emergency") }, ["priority"]) });
  doc("POST", "/v1/supervisor/issues/:id/assign", { summary: "Assign a ticket to a colleague", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Ticket id" }, body: obj({ userId: str() }, ["userId"]) });
  doc("POST", "/v1/supervisor/issues/:id/escalate", { summary: "Hand an issue up to the admin", tags: ["Supervisor"], roles: ["supervisor"], params: { id: "Ticket id" }, body: obj({ note: str() }, ["note"]) });
  doc("GET", "/v1/supervisor/reports", { summary: "Society level reporting", tags: ["Supervisor"], roles: ["supervisor"], query: { from: "", to: "", societyId: "", operatorUserId: "", state: "" } });
  doc("GET", "/v1/supervisor/search", { summary: "Search within the permitted scope", description: "An order id from another society returns nothing, exactly as if it did not exist.", tags: ["Supervisor"], roles: ["supervisor"], query: { q: "Search term" } });
  doc("GET", "/v1/supervisor/profile", { summary: "Own profile", tags: ["Supervisor"], roles: ["supervisor"] });
  doc("PATCH", "/v1/supervisor/profile", { summary: "Update own contact details", description: "The assigned society stays admin controlled.", tags: ["Supervisor"], roles: ["supervisor"], body: obj({ fullName: str(), email: str() }) });

  // ------------------------------------------------------------------- admin
  doc("GET", "/v1/admin/dashboard", { summary: "The whole platform on one screen", description: "Every count is backed by a matching list endpoint, so each dashboard metric can drill down.", tags: ["Admin"], roles: ["admin"] });
  doc("GET", "/v1/admin/coverage", { summary: "Societies with no active supervisor, which the admin is covering", tags: ["Admin"], roles: ["admin"] });
  // Society → Supervisor → Blocks → Operators. The assignment chain, which used to
  // be implied by two fields on a user record and could not be read or set anywhere.
  doc("GET", "/v1/admin/societies/:id/assignments", {
    summary: "A society's supervisor, its blocks, and who covers each",
    description: "Every block with its flats, assigned operators, residents and active orders, plus the supervisors and operators that could be chosen. A supervisor already running another society is listed with the society they hold rather than hidden.",
    tags: ["Admin"], roles: ["admin"], params: { id: "Society id" },
  });
  doc("PUT", "/v1/admin/societies/:id/supervisor", {
    summary: "Assign, change or clear the society's supervisor",
    description: "One supervisor per society and one society per supervisor. Assigning somebody who already runs another society is refused with 409 rather than quietly vacating the society they hold. Send null to clear.",
    tags: ["Admin"], roles: ["admin"], params: { id: "Society id" },
    body: obj({ supervisorUserId: str("User id, or null to clear") }, ["supervisorUserId"]),
    responses: { "409": "That supervisor already runs another society, or is not eligible" },
  });
  doc("POST", "/v1/admin/societies/:id/blocks", {
    summary: "Add a block to a society",
    tags: ["Admin"], roles: ["admin"], params: { id: "Society id" },
    body: obj({ name: str("Block, tower, wing or phase name"), floorCount: int("Positive"), flatCount: int("Positive") }, ["name"]),
    responses: { "409": "The society already has a block by that name" },
  });
  doc("PATCH", "/v1/admin/blocks/:blockId", {
    summary: "Rename a block, correct its floors or flats, or deactivate it",
    tags: ["Admin"], roles: ["admin"], params: { blockId: "Block id" },
    body: obj({ name: str(), floorCount: int(), flatCount: int(), status: str("active or inactive") }),
  });
  doc("PUT", "/v1/admin/blocks/:blockId/operators", {
    summary: "Set which operators cover a block",
    description: "The whole list, not an add or a remove, so the screen sends what it shows. Each operator's own assignment is updated in the same step.",
    tags: ["Admin"], roles: ["admin"], params: { blockId: "Block id" },
    body: obj({ operatorUserIds: arr(str()) }, ["operatorUserIds"]),
    responses: { "409": "One of those operators cannot be assigned" },
  });
  doc("GET", "/v1/admin/supervisors", {
    summary: "Every supervisor, with the societies that could be given to one",
    tags: ["Admin"], roles: ["admin"],
    query: { status: "active | blocked | all", assigned: "true for supervisors running a society, false for those waiting", q: "Name or phone" },
  });
  doc("POST", "/v1/admin/supervisors", {
    summary: "Create a supervisor and give them a society",
    description: "A name in two parts, a number, and exactly one society. The email is optional \u2014 a supervisor is reached on their phone and signs in with it. No verification codes: creating an account and authenticating as that account are two different things, and running them together meant an admin filling in a form had to hold an OTP sent to somebody else's phone before the account could exist. The number is proved by whoever owns it, with the OTP they receive at their first sign-in. The employee id is generated (SUP-001, SUP-002): one that is typed is one that is eventually typed twice, and the collision shows up as two people sharing an id rather than as an error.",
    tags: ["Admin"], roles: ["admin"],
    body: obj({
      firstName: str(), lastName: str(), phone: str(),
      email: str("Optional, for communication"),
      societyId: str("The one society this supervisor runs"),
    }, ["firstName", "lastName", "phone", "societyId"]),
    responses: {
      "409": "That phone number already has an account, or that society already has a supervisor",
      "422": "The details are not usable",
    },
  });
  doc("GET", "/v1/admin/supervisors/:id", { summary: "Supervisor detail", tags: ["Admin"], roles: ["admin"], params: { id: "User id" } });
  doc("PATCH", "/v1/admin/supervisors/:id", {
    summary: "Edit a supervisor, or move them to another society",
    description: "The employee id is deliberately not editable: it is generated once and identifies the person everywhere else.",
    tags: ["Admin"], roles: ["admin"], params: { id: "User id" },
    body: obj({ firstName: str(), lastName: str(), email: str(), status: str(), societyId: str() }),
    responses: { "409": "That society is already run by somebody else" },
  });
  doc("POST", "/v1/admin/users/:id/availability", {
    summary: "Put a staff member on leave, block them, or bring them back",
    description: "Never deletes the account. An operator's open work is handed over or returned to the queue in the same step.",
    tags: ["Admin"], roles: ["admin"], params: { id: "User id" },
    body: obj({ status: str("active | on_leave | blocked"), reassignToUserId: str(), reason: str() }, ["status"]),
  });
  doc("GET", "/v1/admin/societies", { summary: "Every society, with the states its address form offers", tags: ["Admin"], roles: ["admin"], query: { supervisorUserId: "", q: "Name", status: "" } });
  doc("POST", "/v1/admin/societies", {
    summary: "Create a society, with its blocks",
    description: "The address is given in the parts an address is made of rather than as one line, so it can be searched and shown properly. There is no society code: it was a second name for a thing that already had one, kept unique by hand. Blocks are named here because an operator is assigned to blocks, so a society with none is a society whose work cannot be given to anybody.",
    tags: ["Admin"], roles: ["admin"],
    body: obj({
      name: str(),
      address: obj({ house: str(), street: str(), locality: str(), city: str(), state: str(), pincode: str("Six digits") },
        ["house", "street", "locality", "city", "state", "pincode"]),
      blocks: arr(obj({ name: str(), floorCount: int(), flatCount: int() }, ["name"])),
    }, ["name", "address"]),
    responses: {
      "409": "That city already has a society by that name",
      "422": "The address or a block name is not usable; every problem is named at once",
    },
  });
  doc("GET", "/v1/admin/societies/:id", { summary: "Society detail with its blocks, residents, operators, slots and orders", tags: ["Admin"], roles: ["admin"], params: { id: "Society id" } });
  doc("PATCH", "/v1/admin/societies/:id", {
    summary: "Edit or deactivate a society",
    tags: ["Admin"], roles: ["admin"], params: { id: "Society id" },
    body: obj({ name: str(), address: obj({ house: str(), street: str(), locality: str(), city: str(), state: str(), pincode: str() }), status: str() }),
  });
  doc("GET", "/v1/admin/operators", {
    summary: "Operations staff across the platform, with the options its filters offer",
    tags: ["Admin"], roles: ["admin"],
    query: { q: "Name or phone", societyId: "", blockId: "", availability: "active | on_leave | blocked | all", supervisorUserId: "" },
  });
  doc("POST", "/v1/admin/operators", {
    summary: "Create an operations user in any society",
    description: "Admin cover for a society whose supervisor is unavailable. One society and the blocks of it this person covers; a block belonging to another society is refused, because that would be a wider permission rather than a narrower one. No verification codes and no employee id, for the same reasons a supervisor has neither.",
    tags: ["Admin"], roles: ["admin"],
    body: obj({ firstName: str(), lastName: str(), phone: str(), email: str(), societyId: str(), blockIds: arr(str()) },
      ["firstName", "lastName", "phone", "email", "societyId"]),
    responses: {
      "409": "That phone number already has an account",
      "422": "The details are not usable, or a block is not in that society",
    },
  });
  doc("PATCH", "/v1/admin/operators/:id", {
    summary: "Edit an operations user, or change their society and blocks",
    description: "The employee id is deliberately not editable: it is generated once and never changes.",
    tags: ["Admin"], roles: ["admin"], params: { id: "User id" },
    body: obj({ firstName: str(), lastName: str(), email: str(), status: str(), societyId: str(), blockIds: arr(str()) }),
  });
  doc("GET", "/v1/admin/slots", { summary: "Slot utilisation across every society", tags: ["Admin"], roles: ["admin"], query: { societyId: "", from: "", to: "" } });
  doc("POST", "/v1/admin/slots", { summary: "Create a pickup slot for any society", description: "Admin cover, so slot creation is never blocked by a supervisor being unavailable.", tags: ["Admin"], roles: ["admin"], body: obj({ societyId: str(), date: str(), window: str(), startTime: str(), endTime: str(), capacityTotal: int() }, ["societyId", "date", "window", "startTime", "endTime", "capacityTotal"]) });
  doc("PATCH", "/v1/admin/slots/:id", { summary: "Edit any slot", tags: ["Admin"], roles: ["admin"], params: { id: "Slot id" }, body: obj({ window: str(), startTime: str(), endTime: str(), capacityTotal: int(), isActive: bool() }) });
  doc("POST", "/v1/admin/slots/:id/cancel", { summary: "Cancel any slot and its bookings", tags: ["Admin"], roles: ["admin"], params: { id: "Slot id" } });
  doc("GET", "/v1/admin/slots/:id/bookings", {
    summary: "The residents booked into one slot",
    description: "A slot card says how much of its capacity is gone; this says who is in it. That is the question behind moving a slot, changing its capacity or cancelling it — the reason to leave it alone is a list of residents expecting somebody at their door, not a number.",
    tags: ["Admin"], roles: ["admin"],
  });
  doc("GET", "/v1/admin/users", { summary: "Every supervisor, operator and resident, filterable", description: "Admin accounts are deliberately absent: this page manages the people who run the operation, and an admin account is managed through the platform’s own administrative configuration rather than sitting on a list next to a resident.", tags: ["Admin"], roles: ["admin"], query: { role: "supervisor | operator | resident | all", status: "", q: "Name, phone or email", societyId: "", onboarding: "completed | pending" } });
  doc("PATCH", "/v1/admin/users/:id/status", { summary: "Activate or deactivate an account", tags: ["Admin"], roles: ["admin"], params: { id: "User id" }, body: obj({ status: str("active | blocked") }, ["status"]) });
  doc("GET", "/v1/admin/orders", { summary: "Every order, filterable", tags: ["Admin"], roles: ["admin"], query: { societyId: "", blockId: "", state: "", residentId: "", supervisorUserId: "", operatorUserId: "", from: "", to: "", orderCode: "", resident: "", delayed: "true", payment: "pending | paid" } });
  doc("GET", "/v1/admin/orders/:id", { summary: "Order detail", tags: ["Admin"], roles: ["admin"], params: { id: "Order id" } });
  doc("POST", "/v1/admin/orders/:id/assign", { summary: "Assign or reassign the operator on any order", tags: ["Admin"], roles: ["admin"], params: { id: "Order id" }, body: obj({ operatorUserId: str(), reason: str() }) });
  doc("GET", "/v1/admin/subscriptions", { summary: "Subscriptions, filterable by status", tags: ["Admin"], roles: ["admin"], query: { status: "active | paused | cancelled", planId: "" } });
  doc("GET", "/v1/admin/subscriptions/:id", {
    summary: "One resident's subscription, whole",
    description: "The current plan and how much of its allowance is gone, service by service; the resident and where they live; every subscription they have had before this one; their payments; and the activity trail. The history is the audit log and the payments are the ledger — both are read rather than duplicated into a store that could disagree with them. Historical records are read-only.",
    tags: ["Admin"], roles: ["admin"],
  });
  doc("GET", "/v1/admin/revenue", {
    summary: "Revenue over a period, filtered and broken down",
    description: "A date range given either as a preset (today, yesterday, this_week, this_month, last_month, all) or as explicit from and to dates, narrowed by society, block, supervisor, operator, plan or payment status. Returns the headline figures, breakdowns by block, society, supervisor, operator and plan, every charged order, and the charges still outstanding. Subscription revenue is not attributable to an operator or a block, so it is excluded rather than misreported whenever such a filter is applied.",
    tags: ["Admin"], roles: ["admin"],
    query: { preset: "today | yesterday | this_week | this_month | last_month | all", from: "", to: "", societyId: "", blockId: "", supervisorUserId: "", operatorUserId: "", planId: "", paymentStatus: "paid | pending | failed | refunded | none" },
  });
  doc("GET", "/v1/admin/plans", { summary: "Plans with subscriber counts and revenue", tags: ["Admin"], roles: ["admin"] });
  doc("POST", "/v1/admin/plans", { summary: "Create a plan", description: "coveredServiceIds names the garment services the plan includes at no extra charge. A garment sent for a service outside that list is priced per garment even while allowance remains.", tags: ["Admin"], roles: ["admin"], body: obj({ tier: str(), garmentCap: int(), turnaroundHours: int(), monthlyPaise: int(), coveredServiceIds: arr(str()) }, ["tier", "garmentCap", "turnaroundHours", "monthlyPaise"]) });
  doc("PATCH", "/v1/admin/plans/:id", { summary: "Edit or deactivate a plan", description: "Every field of a plan is editable, including which garment services it covers.", tags: ["Admin"], roles: ["admin"], params: { id: "Plan id" }, body: obj({ tier: str(), garmentCap: int(), turnaroundHours: int(), monthlyPaise: int(), isActive: bool(), coveredServiceIds: arr(str()) }) });
  doc("GET", "/v1/admin/reports", { summary: "Block, society, supervisor and operator reporting", tags: ["Admin"], roles: ["admin"], query: { from: "", to: "", blockId: "", societyId: "", supervisorUserId: "", state: "" } });
  for (const [path, summary] of [
    ["subscriptions", "Subscription totals"], ["revenue", "Revenue totals"],
    ["operations", "Orders by state"], ["sustainability", "Water used and saved"],
    ["garment-risk", "Garment incidents against orders processed"],
  ] as const) {
    doc("GET", `/v1/admin/reports/${path}`, { summary, tags: ["Admin"], roles: ["admin"] });
  }
  doc("GET", "/v1/admin/issues", { summary: "Support tickets across the platform", tags: ["Admin"], roles: ["admin"], query: { status: "", type: "", societyId: "", priority: "", escalated: "true", emergency: "true" } });
  doc("GET", "/v1/admin/issues/analytics", { summary: "Support analytics: volumes, ageing, average resolution time and supervisor performance", tags: ["Admin"], roles: ["admin"], query: { from: "", to: "" } });
  doc("GET", "/v1/admin/issues/:id", { summary: "Ticket detail with the complete conversation and the supervisor's actions", tags: ["Admin"], roles: ["admin"], params: { id: "Ticket id" } });
  doc("PATCH", "/v1/admin/issues/:id/status", { summary: "Move any ticket through its lifecycle", tags: ["Admin"], roles: ["admin"], params: { id: "Ticket id" }, body: obj({ status: str(), resolution: str() }, ["status"]) });
  doc("POST", "/v1/admin/issues/:id/reply", { summary: "Reply on any ticket", tags: ["Admin"], roles: ["admin"], params: { id: "Ticket id" }, body: obj({ body: str() }, ["body"]) });
  doc("GET", "/v1/admin/audit", { summary: "Who changed what, with the previous and new value", tags: ["Admin"], roles: ["admin"], query: { resource: "", resourceId: "", actor: "", action: "", from: "", to: "", limit: "" } });
  doc("GET", "/v1/admin/config", { summary: "Global configuration", tags: ["Admin"], roles: ["admin"] });
  doc("POST", "/v1/admin/config/services", {
    summary: "Add a garment service",
    description: "Adds one service to the catalogue without resending it, so a new service cannot drop an existing one by omission. The id is derived from the name when it is not given. A service declares what physically has to happen to the garment, which is what lets an Iron Only order skip washing.",
    tags: ["Admin"], roles: ["admin"],
    body: obj({ name: str(), unitPricePaise: int(), pricesPaise: { type: "object", additionalProperties: { type: "integer" }, description: "Price per garment category; a category left out falls back to unitPricePaise" }, requiresClean: bool(), cleanStage: str("wash | dry_clean | premium"), requiresPress: bool(), isBase: bool(), isActive: bool() }, ["name"]),
    responses: { "409": "A service with that id already exists" },
  });
  doc("PATCH", "/v1/admin/config/services/:id", {
    summary: "Edit a garment service",
    description: "Its name, its per garment prices and the processing it requires.",
    tags: ["Admin"], roles: ["admin"], params: { id: "Service id" },
    body: obj({ name: str(), unitPricePaise: int(), pricesPaise: { type: "object", additionalProperties: { type: "integer" }, description: "Price per garment category; a category left out falls back to unitPricePaise" }, requiresClean: bool(), cleanStage: str("wash | dry_clean | premium"), requiresPress: bool(), isBase: bool(), isActive: bool() }),
  });
  doc("DELETE", "/v1/admin/config/services/:id", {
    summary: "Retire a garment service",
    description: "Retired rather than deleted, because orders already in flight reference it. The base service cannot be retired.",
    tags: ["Admin"], roles: ["admin"], params: { id: "Service id" },
    responses: { "409": "The base service cannot be retired" },
  });
  doc("PATCH", "/v1/admin/config", {
    summary: "Change global configuration",
    description: "The garment rates, the service catalogue, the categories and the operational defaults. Every change is written to the audit log with its previous and new value.",
    tags: ["Admin"], roles: ["admin"],
    body: obj({
      additionalGarmentRatePaise: int(), nonSubscriberGarmentRatePaise: int(),
      garmentPricesPaise: { type: "object", additionalProperties: { type: "integer" }, description: "Pay as you go price per garment category" },
      garmentCategories: arr(str()),
      garmentServices: arr(obj({ id: str(), name: str(), unitPricePaise: int(), pricesPaise: { type: "object", additionalProperties: { type: "integer" } }, requiresClean: bool(), cleanStage: str("wash | dry_clean | premium"), requiresPress: bool(), isBase: bool(), isActive: bool() }, ["id", "name", "unitPricePaise"])),
      defaultSlotCapacity: int(), defaultTurnaroundHours: int(), delayGraceHours: int(),
      qcRequired: bool(), notificationsEnabled: bool(),
    }),
  });

  // -------------------------------------------------------------- operational
  doc("POST", "/v1/payments/webhook", { summary: "Payment provider webhook", description: "Signature verified and idempotent. A replayed event never credits the wallet twice.", tags: ["Payments"], responses: { "401": "Invalid signature" } });
  doc("GET", "/v1/sustainability/impact", { summary: "Water used and saved for the resident's society", tags: ["Resident"], roles: ["resident"] });
  doc("GET", "/health", { summary: "Liveness and the active storage driver", tags: ["Operational"] });
  doc("GET", "/metrics", { summary: "Prometheus metrics", tags: ["Operational"] });
  doc("GET", "/openapi.json", { summary: "This document", tags: ["Operational"] });
  doc("GET", "/docs", { summary: "Swagger UI", tags: ["Operational"] });
}

export { NOT_FOUND };
