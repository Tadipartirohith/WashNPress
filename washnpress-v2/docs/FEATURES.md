# Requirements to implementation map

This maps the functional requirements from the specification to where they are built.
The four portal sections cover the Admin, Supervisor, Resident and Operations
requirement documents; the platform section covers the underlying engine.

## 1. Admin portal

| Requirement | Status | Where |
|---|---|---|
| Admin portal exists as a distinct role based portal | Done | routes/admin, mobile AdminPortal |
| System wide dashboard, every count, each one clickable | Done | dashboard-service.admin, AdminPortal home |
| Area management: create, view, edit, activate, deactivate | Done | area-service, routes/admin areas |
| Assign and change the one responsible supervisor per area | Done | area-service.assignSupervisor |
| Area detail: societies, operators, orders under the area | Done | GET /v1/admin/areas/:id |
| Society management across all areas, with filters | Done | society-service, routes/admin societies |
| Central user management, all four roles, activate and deactivate | Done | user-service, PATCH /v1/admin/users/:id/status |
| Order management, system wide, every filter and search | Done | GET /v1/admin/orders |
| Subscription plan management, price, allowance, turnaround | Done | subscription-service plan methods, routes/admin plans |
| Plan usage and revenue per plan | Done | subscription-service.planUsage |
| Slot monitoring across all areas and societies | Done | scheduling-service.listSlots, GET /v1/admin/slots |
| Reports: area, society, supervisor, operations, resident, revenue | Done | reports-service, GET /v1/admin/reports |
| Issue and complaint visibility, including escalations | Done | issue-service, GET /v1/admin/issues |
| Audit log with user, role, action, resource, previous and new value | Done | audit-service, GET /v1/admin/audit |
| System configuration, admin only | Done | system-config-service, /v1/admin/config |

## 2. Supervisor portal

| Requirement | Status | Where |
|---|---|---|
| Supervisor is a separate role based portal | Done | routes/supervisor, mobile SupervisorPortal |
| Area level access only, enforced by the backend | Done | domain/access, access-service, docs/RBAC.md |
| Dashboard showing only the assigned area | Done | dashboard-service.supervisor |
| Society management within the area, create and edit | Done | routes/supervisor societies |
| Society detail with overview, residents, operations, slots, orders, issues | Done | GET /v1/supervisor/societies/:id |
| Slot management: create, edit, activate, deactivate, cancel | Done | scheduling-service slot methods |
| Capacity cannot drop below what is already booked | Done | scheduling-service.updateSlot (SlotInUseError) |
| Cancelling a slot cancels its bookings and tells the residents | Done | scheduling-service.cancelSlot |
| Operations staff management inside the area | Done | routes/supervisor operators |
| Operator workload, overloaded and idle operators | Done | user-service.operatorWorkload |
| Order monitoring with filters, and operator assignment | Done | GET /v1/supervisor/orders, POST .../assign |
| Pickup monitoring including failed pickups | Done | scheduling-service.pickupQueue |
| Garment quantity monitoring, view only | Done | order-service.detail, supervisor order screen |
| Processing monitoring by stage | Done | GET /v1/supervisor/processing |
| QC monitoring with failure reasons | Done | GET /v1/supervisor/qc |
| Issues: open, under review, resolved, escalate to admin | Done | issue-service, routes/supervisor issues |
| Delayed orders view | Done | order-service.isDelayed, GET /v1/supervisor/delayed |
| Notifications relevant to the area | Done | notification-service.notifyRoleInArea |
| Area level reports with filters | Done | reports-service scoped by session |
| Global search that still respects the area boundary | Done | GET /v1/supervisor/search |
| Profile, with the area staying admin controlled | Done | routes/supervisor profile |

## 3. Resident portal

| Requirement | Status | Where |
|---|---|---|
| Onboarding flow with status check and no repeat prompts | Done | auth-service.onboardingStatus, OnboardingScreen |
| Dashboard: current order, upcoming pickup, plan, usage, charges, alerts | Done | GET /v1/resident/dashboard |
| Schedule a pickup, slots loaded for the resident's society only | Done | GET /v1/slots, scheduling-service |
| Booking confirmation screen before committing | Done | GET /v1/pickups/preview |
| Booking fails gracefully when the slot fills up first | Done | slots.reserveCapacity, 409 slot_unavailable |
| Orders split into current, upcoming and previous | Done | GET /v1/resident/orders |
| Order tracking timeline with completed, current and pending stages | Done | order-state-machine.timelineStages |
| Order details with the full quantity and charge breakdown | Done | order-service.detail |
| Garment quantity and subscription usage, calculated by the backend | Done | domain/garments, order-service.markPickedUp |
| Additional garment charges with quantity, rate, total and status | Done | order-service.settleAdditionalCharge |
| Previous orders remain available after delivery | Done | resident orders grouping |
| Subscription page separating current plan from available plans | Done | GET /v1/resident/subscription |
| Subscription usage panel with allowance, used and remaining | Done | subscription-service.usage |
| Wallet with balance, credits, debits and transactions | Done | wallet-service, wallet screens |
| Payments with id, amount, type, date and status | Done | payment-service, order payment status |
| Notifications for every lifecycle event | Done | notification-service, order-service |
| Support: raise an issue, track ticket status | Done | issue-service, routes/support |
| Profile with society and unit controlled by staff workflow | Done | auth-service.updateResidentProfile |
| Search and filter own order history | Done | GET /v1/resident/orders filters |

## 4. Operations portal

| Requirement | Status | Where |
|---|---|---|
| Operations dashboard by stage, only authorised orders | Done | dashboard-service.operations |
| Pickup queue with resident, society, flat, slot and address | Done | scheduling-service.pickupQueue |
| Pickup order details with plan and remaining allowance | Done | GET /v1/operations/orders/:id |
| Garment entry by category, categories from configuration | Done | system-config-service, operations config route |
| Operator enters only the actual accepted quantity | Done | order-service.markPickedUp |
| Backend calculates covered, additional and the charge | Done | domain/garments.splitGarments |
| Quantity confirmation step before the pickup is committed | Done | POST .../garments/preview |
| Mark picked up records timestamp, operator and quantities | Done | order-service.markPickedUp |
| Pickup exceptions preserved with a reason, not deleted | Done | order-service.failPickup |
| A picked up order leaves the queue but stays reachable | Done | operations pickups filter, /operations/active, /search |
| Active orders page grouped by stage | Done | GET /v1/operations/active |
| Washing, ironing, QC as explicit start and complete actions | Done | order-service stage methods |
| QC pass, QC fail with a reason, issue raised automatically | Done | order-service.submitQc |
| A failed QC must be reprocessed and pass again | Done | state machine qc_hold transitions, order-service.reprocess |
| Ready for delivery, out for delivery, delivery completion | Done | order-service outForDelivery, deliver |
| Order timeline with status, time, user and remarks | Done | Order.timeline entries |
| Issues and exceptions reported to the supervisor | Done | POST /v1/operations/issues |
| Garment mismatch handled from the actual accepted quantity | Done | order-service.deliver discrepancy guard |
| Order search and history within the operator's scope | Done | /operations/search, /operations/history |
| Operations profile, area and societies not self editable | Done | routes/operations profile |

## 5. Backend business rules

| Rule | Status | Where |
|---|---|---|
| Rule 1 actual quantity comes from operations | Done | order-service.markPickedUp |
| Rule 2 backend calculates subscription usage | Done | domain/garments.splitGarments |
| Rule 3 backend calculates the additional charge | Done | splitGarments, config rate |
| Rule 4 usage is finalised from the accepted quantity, not the estimate | Done | markPickedUp deducts at pickup |
| Rule 5 order status is controlled by the backend | Done | domain/order-state-machine |
| Rule 6 completed stages cannot be skipped | Done | TRANSITIONS table |
| Rule 7 an order stays traceable after leaving the queue | Done | active orders, history, search |

## 6. Platform

| Requirement | Status | Where |
|---|---|---|
| OTP login, attempt limits, resend cooldown, lockout | Done | domain/otp, otp-service, auth-service |
| Role based access with area scoping | Done | domain/access, access-service, app/guards |
| Deactivating an account ends its live sessions | Done | auth-service.sessionFromToken |
| Cross origin access for the browser build | Done | app/build-app CORS hook, app.corsOrigins |
| Atomic slot capacity, no oversell | Done | slots.reserveCapacity |
| Double entry ledger for all money | Done | domain/ledger, domain/accounts |
| Payments, verified and idempotent webhooks | Done | payment-service, payments/signature |
| Notifications via outbox and worker, plus an in app feed | Done | notification-service |
| Background jobs (reconciliation, recurring) | Done | jobs/job-runner |
| Redis backed rate limiting and sessions | Done | adapters/cache |
| Metrics endpoint and tracing reference | Done | observability/ |
| Postgres storage driver, atomic and persistent | Done | adapters/postgres, tested with pg-mem |
| Production compiled build and multi-stage image | Done | tsup build, Dockerfile |
| Four role based portals in one cross platform app | Done | ../washnpress-mobile/src/portals |
| Operations offline queue | Done | washnpress-mobile/src/offline |
| CI: typecheck, test, build, docker smoke, push | Done | .github/workflows |
| SMS, WhatsApp, push delivery | Providers built, mock until keys set | adapters/notifications |
| Autoscaling infrastructure, managed Postgres and Redis | Template | deployment/main.bicep |

## Honest status

The server side is complete and covered by 99 passing tests, and the four portals run
in one Expo codebase verified in the browser against the live backend. Two things are
still environment work rather than design work: producing signed native builds, and a
live cloud deployment. The APIs, the data model, the infrastructure template and the
schema they depend on are all here.

The notification channels are wired end to end through the outbox, but SMS, WhatsApp
and push stay in mock mode until provider keys are configured.
