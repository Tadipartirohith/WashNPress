# API reference

All endpoints are JSON. Authenticated endpoints accept the session either as the
`wnp_session` cookie set at login, or as an `Authorization: Bearer <token>` header.

Every endpoint below is scoped by the role on the session. The scope is taken from
the session, never from a query parameter, so asking for another area's society or
order returns the same failure as asking for one that does not exist. See
[RBAC.md](RBAC.md) for the full matrix.

## Auth
- `POST /v1/auth/otp/send` send a one time password to a mobile number
- `POST /v1/auth/otp/verify` verify the code, receive a session and the portal to open
- `POST /v1/auth/onboarding` complete a resident profile, reissues the session
- `GET  /v1/auth/me` current identity, roles, area and onboarding status
- `POST /v1/auth/logout` end the session

## Catalog
- `GET /v1/plans` active subscription plans
- `GET /v1/addons` active add on services
- `GET /v1/societies`, `GET /v1/societies/nearby`

## Resident
- `GET  /v1/resident/onboarding` onboarding status, required fields, selectable societies
- `GET  /v1/resident/dashboard` current order, upcoming pickup, plan usage, wallet, alerts
- `GET  /v1/resident/orders` current, upcoming and previous orders, filterable
- `GET  /v1/resident/orders/:id` full order detail with the tracking timeline
- `POST /v1/resident/orders/:id/pay-additional` settle an additional garment charge
- `GET  /v1/resident/subscription` current plan with usage, plus the available plans
- `GET  /v1/resident/profile`, `PATCH /v1/resident/profile` contact details only
- `GET  /v1/resident/notifications`, `POST /v1/resident/notifications/:id/read`,
  `POST /v1/resident/notifications/read-all`

## Subscription (resident)
- `GET  /v1/subscription` current subscription and its usage
- `GET  /v1/subscription/usage` allowance, used, remaining, renewal and expiry
- `POST /v1/subscription/subscribe` subscribe, charged from the wallet
- `POST /v1/subscription/change` upgrade or downgrade, effective next cycle, returns proration
- `POST /v1/subscription/pause`, `POST /v1/subscription/cancel`

## Scheduling (resident)
- `GET  /v1/slots?date=YYYY-MM-DD` available slots for the resident's own society
- `GET  /v1/pickups/preview?slotId=...` the confirmation screen before booking
- `POST /v1/pickups` book a pickup, one time or recurring, with an optional estimate
- `GET  /v1/pickups` the resident's own pickups
- `POST /v1/pickups/reschedule`, `POST /v1/pickups/cancel` subject to the cutoff
- `GET  /v1/orders/:id`, `GET /v1/orders/:id/tracking`
- `POST /v1/orders/:id/rate`, `POST /v1/orders/:id/dispute`

## Operations (operator)
Scoped to the operator's assigned societies.

- `GET  /v1/operations/dashboard` today's work, by stage
- `GET  /v1/operations/config` garment categories, additional rate, issue types
- `GET  /v1/operations/pickups?date=` today's pickup queue with the resident details
- `GET  /v1/operations/bookings` today's scheduled orders (kept for older clients)
- `GET  /v1/operations/orders/:id` full order detail
- `POST /v1/operations/orders/:id/garments/preview` the calculated quantity split,
  shown for confirmation before the pickup is committed
- `POST /v1/operations/orders/:id/picked-up` record the actual accepted quantity
- `POST /v1/operations/orders/:id/pickup-failed` record a failed pickup with a reason
- `POST /v1/operations/orders/:id/wash/start`, `.../wash/complete`
- `POST /v1/operations/orders/:id/ironing/start`, `.../ironing/complete`
- `POST /v1/operations/orders/:id/advance` the generic stage move the offline queue replays
- `POST /v1/operations/orders/:id/qc` pass or fail; a fail needs a reason and opens an issue
- `POST /v1/operations/orders/:id/reprocess` send a held batch back to washing or ironing
- `POST /v1/operations/orders/:id/out-for-delivery`
- `POST /v1/operations/orders/:id/deliver` reconciles counts against the accepted quantity
- `GET  /v1/operations/active` work in progress grouped by stage
- `GET  /v1/operations/history`, `GET /v1/operations/search`
- `GET  /v1/operations/issues`, `POST /v1/operations/issues`
- `GET  /v1/operations/profile`, `PATCH /v1/operations/profile`
- `GET  /v1/operations/units/:unitId/earnings`

## Supervisor
Every route is bound to the supervisor's one assigned area.

- `GET  /v1/supervisor/dashboard` the area's operational status
- `GET  /v1/supervisor/societies`, `POST /v1/supervisor/societies`,
  `GET /v1/supervisor/societies/:id`, `PATCH /v1/supervisor/societies/:id`
- `GET  /v1/supervisor/slots`, `POST /v1/supervisor/slots`,
  `PATCH /v1/supervisor/slots/:id`, `POST /v1/supervisor/slots/:id/cancel`
- `GET  /v1/supervisor/operators`, `POST /v1/supervisor/operators`,
  `PATCH /v1/supervisor/operators/:id`
- `GET  /v1/supervisor/workload` per operator pending, processing and completed counts
- `GET  /v1/supervisor/orders`, `GET /v1/supervisor/orders/:id`,
  `POST /v1/supervisor/orders/:id/assign`
- `GET  /v1/supervisor/pickups?date=` pickup monitoring
- `GET  /v1/supervisor/processing` orders grouped by processing stage
- `GET  /v1/supervisor/qc` quality check outcomes
- `GET  /v1/supervisor/delayed` orders past their expected completion
- `GET  /v1/supervisor/issues`, `PATCH /v1/supervisor/issues/:id/status`,
  `POST /v1/supervisor/issues/:id/escalate`
- `GET  /v1/supervisor/reports` area level reporting
- `GET  /v1/supervisor/search?q=` search within the permitted scope
- `GET  /v1/supervisor/profile`, `PATCH /v1/supervisor/profile`

## Admin
System wide. Never restricted to an area.

- `GET  /v1/admin/dashboard` the whole platform on one screen
- `GET  /v1/admin/areas`, `POST /v1/admin/areas`, `GET /v1/admin/areas/:id`,
  `PATCH /v1/admin/areas/:id`, `POST /v1/admin/areas/:id/supervisor`
- `GET  /v1/admin/supervisors`, `POST /v1/admin/supervisors`,
  `GET /v1/admin/supervisors/:id`, `PATCH /v1/admin/supervisors/:id`
- `GET  /v1/admin/societies`, `POST /v1/admin/societies`,
  `GET /v1/admin/societies/:id`, `PATCH /v1/admin/societies/:id`
- `GET  /v1/admin/users`, `PATCH /v1/admin/users/:id/status`
- `GET  /v1/admin/orders`, `GET /v1/admin/orders/:id`
- `GET  /v1/admin/plans`, `POST /v1/admin/plans`, `PATCH /v1/admin/plans/:id`
- `GET  /v1/admin/slots`, `POST /v1/admin/slots`
- `GET  /v1/admin/reports` area, society, supervisor and operator reporting
- `GET  /v1/admin/reports/subscriptions|revenue|operations|sustainability|garment-risk`
- `GET  /v1/admin/issues`, `PATCH /v1/admin/issues/:id/status`
- `GET  /v1/admin/audit` who changed what, with the previous and new value
- `GET  /v1/admin/config`, `PATCH /v1/admin/config` global configuration

## Wallet (resident)
- `GET  /v1/wallet`, `GET /v1/wallet/transactions`
- `POST /v1/wallet/topup` starts a payment order for a top up

## Payments
- `POST /v1/payments/webhook` signature verified, idempotent, credits the wallet

## Support
- `GET  /v1/support/issue-types` the issue categories the system recognises
- `POST /v1/support/tickets`, `GET /v1/support/tickets`, `POST /v1/support/tickets/:id/reply`

## Sustainability (resident)
- `GET /v1/sustainability/impact` water used and saved for the resident's society

## Operational
- `GET /health` liveness and the active storage driver
- `GET /metrics` Prometheus format, when metrics are enabled

## Error shape

Failures return a JSON body with an `error` code and, where it helps, a `message`.
The codes a client needs to branch on:

| Code | Status | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | No valid session, or the account was deactivated |
| `forbidden` | 403 | The role is not allowed on this endpoint |
| `forbidden_scope` | 403 | The resource belongs to another area, society or resident |
| `slot_unavailable` | 409 | The slot filled up before the booking was confirmed |
| `cutoff_passed` | 409 | Too late to change or cancel this pickup |
| `illegal_transition` | 409 | The order cannot move to that state from where it is |
| `qc_reason_required` | 400 | A quality check failure has to record why |
| `quantity_required` | 400 | A pickup cannot be confirmed with no garments entered |
| `slot_in_use` | 409 | Capacity cannot be lowered below what is already booked |
| `insufficient_balance` | 402 | Top up the wallet and retry |
| `onboarding_incomplete` | 409 | The resident has not finished onboarding yet |

## Testing round three

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| `POST` | `/v1/admin/config/services` | Admin | Add one garment service without resending the catalogue |
| `PATCH` | `/v1/admin/config/services/:id` | Admin | Edit its name, its per garment prices and the processing it needs |
| `DELETE` | `/v1/admin/config/services/:id` | Admin | Retire it. Orders already using it are unaffected, and the base service cannot be retired |
| `DELETE` | `/v1/subscription/change` | Resident | Call off a scheduled plan change |

Behaviour that changed on existing endpoints:

| Endpoint | Change |
| --- | --- |
| Any endpoint | A body that is not valid JSON answers `400`, not `500` |
| `GET /v1/slots?date=` | A date that has already passed returns no slots |
| `POST /v1/pickups` | A slot on a past day is refused with `409 slot_in_past`, and its capacity is given back |
| `POST /v1/supervisor/slots` | A slot cannot be created on a past day: `400 slot_in_past` |
| `GET /v1/supervisor/slots` | Past days are left out unless `includePast=true` |
| `GET /v1/operations/pickups` | With no `date`, returns everything still pending up to today, oldest first, with `overdue` per row and `overdueCount` on the response |
| `GET /v1/supervisor/operators` | Accepts `status` and `q`, and returns `counts` per availability state |
| `GET /v1/operations/orders/:id` | Carries `processing` (what the batch needs, per line) and `nextActions` (the stages that are legal now) |
| `GET /v1/subscription/usage` | Carries `pendingPlan` with the tier, price, allowance, effective date and direction |
| `POST /v1/subscription/subscribe` | Refuses a second subscription with `409 already_subscribed` |
| `POST`/`PATCH` `/v1/admin/plans` | Accept `coveredServiceIds` |
| `PATCH /v1/admin/areas/:id` | Accepts `code` |
| `PATCH /v1/admin/societies/:id` | Accepts `code` |

## Testing round four

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| `GET` | `/v1/pricing` | Anyone | The price list per garment category and per service. With a session it also carries the resident's own plan |
| `GET` | `/v1/operations/issues/:id` | Operator | Ticket detail with its full history |
| `POST` | `/v1/operations/issues/:id/take` | Operator | Take a ticket. Ownership is accepted, not handed out |
| `POST` | `/v1/operations/issues/:id/reply` | Operator | Answer the resident on the record |
| `PATCH` | `/v1/operations/issues/:id/status` | Operator | Move a ticket through its lifecycle |

Behaviour that changed on existing endpoints:

| Endpoint | Change |
| --- | --- |
| `POST /v1/admin/societies`, `POST /v1/supervisor/societies` | `404` area not found, `409` duplicate code or duplicate name in that area, `422` area not active, `400` invalid request. Address required. Never `500` |
| `GET /v1/resident/onboarding`, `POST /v1/auth/onboarding` | `403 onboarding_not_applicable` for anybody who is not a resident |
| `GET /v1/operations/issues` | Filters by `status`, `type`, `societyId`, `orderId`, `from`, `to`, `mine`, and returns `counts` and `statuses` |
| `GET /v1/admin/slots` | Slot monitoring: utilisation, status, booking status, area, society and supervisor per slot; filters for all of those plus shift and utilisation band; `summary` totals; `includePast` |
| `PATCH /v1/admin/slots/:id`, `POST /v1/admin/slots/:id/cancel` | `409 slot_in_past` — a day that has gone is read only |
| `GET /v1/admin/revenue` | Presets and explicit ranges, filters by area, society, supervisor, operator, plan and payment status, breakdowns by each, `chargedOrders`, `pendingCharges`, and the filter options |
| `GET /v1/supervisor/pickups` | Accepts `societyId` and returns the societies that filter may offer |
| `PATCH /v1/admin/config` | Accepts `garmentPricesPaise`, the pay as you go price per garment category |
| `GET /v1/admin/operators` | Each operator carries `supervisorUserId` and `supervisorName`, derived from their area |
