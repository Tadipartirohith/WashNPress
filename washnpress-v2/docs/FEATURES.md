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

## 7. Testing round: follow up requirements

Raised after the first round was tested. Each item is a numbered requirement or a
reported bug from the follow up document.

| Requirement | Status | Where |
|---|---|---|
| 1. Supervisor leave: deactivate rather than delete | Done | staffing-service, `on_leave` account status |
| 1. Area, societies, residents, slots, orders survive a supervisor change | Done | area is the unit of organisation; nothing cascades |
| 1. Admin can create and manage slots for the affected area | Done | `POST/PATCH /v1/admin/slots`, `.../cancel` |
| 1. Admin can perform other supervisor level actions during the absence | Done | admin society, operator, order assignment and issue routes |
| 1. Areas needing admin cover are visible | Done | `GET /v1/admin/coverage`, surfaced on the admin dashboard |
| 1. A new supervisor automatically gains the area | Done | scope derives from the area on the account |
| 1. Historical records keep the original supervisor | Done | audit entries are never rewritten |
| 2. Operator marked on leave rather than deleted | Done | `POST /v1/supervisor/operators/:id/availability` |
| 2. Their active orders remain in the system | Done | staffing-service never touches order state |
| 2. Admin and supervisor can see the operator's pending work | Done | `GET /v1/supervisor/operators/:id/handover`, workload |
| 2. Orders reassigned to another available operator | Done | handover to a named replacement |
| 2. Reassignment does not change or delete order history | Done | state preserved, timeline gains a handover entry |
| 2. Audit trail of previous and new operator | Done | `order.operator_reassigned` audit entries |
| 2. Orders continue from their current processing stage | Done | proven in `staffing.dft.test.ts` |
| 2. Unassigned work stays visible in the operations queue | Done | `GET /v1/operations/queue`, `POST .../claim` |
| Bug: session lost after a page refresh | Fixed | `../washnpress-mobile/src/session.ts`, restore in `App.tsx` |
| Customer support: resident raises, categorises, marks urgent | Done | `POST /v1/support/tickets` with priority |
| Customer support: view tickets, status, responses, full conversation | Done | `GET /v1/support/tickets/:id`, shared ticket UI |
| Customer support: add information to an existing ticket | Done | `POST /v1/support/tickets/:id/reply` |
| Customer support: resident closes the ticket | Done | `POST /v1/support/tickets/:id/close` |
| Supervisor is first line, with resident and order context | Done | `GET /v1/supervisor/issues/:id` |
| Supervisor: communicate, assign, prioritise, resolve, escalate | Done | supervisor issue routes |
| Ticket status Open → Assigned → In Progress → Resolved → Closed | Done | `ISSUE_TRANSITIONS`, docs/SUPPORT.md |
| Emergency tickets clearly highlighted | Done | priority ordering, dashboards, notifications |
| Resident does not resolve disputes with the operator directly | Done | operators may read, never resolve |
| Admin: system wide support visibility and analytics | Done | `GET /v1/admin/issues/analytics` |
| Admin: average resolution time, ageing, per supervisor performance | Done | issue-service analytics |
| Admin: open any ticket and read the complete history | Done | `GET /v1/admin/issues/:id` |
| Bug: resident order tracking does not update immediately | Fixed | tracking `revision`, app polling in `src/hooks.ts` |
| 3. Every admin dashboard metric is clickable | Done | each tile navigates with its filter applied |
| 3. Clicking a metric applies the matching filter | Done | `DrillFilter` threaded into every admin list |
| 3. Revenue shows a breakdown, not just a total | Done | `GET /v1/admin/revenue`, Revenue screen |
| 3. Issue counts open the filtered issue list | Done | support tiles drill into the console |
| 4. Dashboard clicks work across all four portals | Done | resident, operations, supervisor and admin dashboards |
| 5. Live delivery tracking | Future | documented below |
| 5.1 Admin has broad management access, audited | Done | docs/RBAC.md, audit-service |
| 6. Swagger / OpenAPI documentation with Try it out | Done | `/docs`, `/openapi.json`, generated from the routes |
| 7. Subscription is optional; pay per order without one | Done | `priceOrder`, docs/PRICING.md |
| 7. Non subscriber pricing, add-ons charged separately | Done | `nonSubscriberGarmentRatePaise`, service catalogue |
| 7. Dashboard shows "No active subscription" and a way to subscribe | Done | resident dashboard |
| 8. Partial add-ons: different services per quantity in one order | Done | order lines, docs/PRICING.md |
| 8. Order summary shows quantity and service for each selection | Done | booking confirmation and order detail |
| 8. Pricing calculated per selection | Done | `buildLines`, `priceLine` |
| 8. Selections visible to Operations | Done | requested services on the operations order screen |
| 9. External delivery agent integration | Future | documented below |
| Razorpay payment integration | Adapter built, mock until keys set | adapters/payments |
| Bug: supervisor onboarding should not be required | Verified fixed | staff accounts are provisioned; regression test added |

## 8. Deliberately future

These are recorded as future enhancements in the requirements and are not built:

- **Live delivery tracking** with a map, delivery person location and an estimated
  arrival time, for orders that are out for delivery. The order lifecycle already
  records who is delivering and when it left the facility, which is what a live
  tracking feature would attach to.
- **External delivery agent integration** for the case where the operational centre
  is outside the community, including transport requests, agent assignment, transport
  status and separately recorded delivery charges.
- **Razorpay online payments** end to end. The provider adapter, the verified
  idempotent webhook and the reconciliation job are already built and tested against
  a fake provider; switching to live is configuration, not code.

## Honest status

The server side is complete and covered by 132 passing tests, and the four portals run
in one Expo codebase verified in the browser against the live backend on both storage
drivers. Two things are still environment work rather than design work: producing
signed native builds, and a live cloud deployment. The APIs, the data model, the
infrastructure template and the schema they depend on are all here.

The notification channels are wired end to end through the outbox, but SMS, WhatsApp
and push stay in mock mode until provider keys are configured. Online payments run
against a fake provider for the same reason.

The three items in section 8 are marked future in the requirements themselves and are
not built.

## Testing round three

Each reported issue and where it is addressed.

| # | Reported | Verified | Where |
| --- | --- | --- | --- |
| 1 | Service based processing not applied per garment | Reproduced | `domain/processing.ts`, order service, operations portal |
| 2 | A scheduled plan change is not displayed | Reproduced | `subscription-service.usage`, resident subscription screen |
| 3 | Admin create society returns 500 | Not on that endpoint | Root cause fixed in `app/build-app.ts` |
| 4 | Admin users API returns 500 | Not on that endpoint | Root cause fixed in `app/build-app.ts` |
| 5 | Supervisor create society returns 500 | Not on that endpoint | Root cause fixed in `app/build-app.ts` |
| 6 | No way to add a garment service | Reproduced | `POST /v1/admin/config/services`, admin config screen |
| 7 | Pricing is per service, not per garment; no plan editing or coverage | Reproduced | `domain/pricing.ts`, admin plans screen |
| 8 | No edit option on areas, supervisors, societies, plans | Reproduced | Admin portal edit forms |
| 9 | Society search only works after choosing an area | Backend correct | Debounce and stale reply guard in the admin portal |
| 10 | Previous days' slots are listed | Reproduced | `scheduling-service.listSlots` |
| 11 | A resident can book a previous day's slot | Reproduced | `scheduling-service.book` |
| 12 | No filtering on operations staff | Reproduced | `GET /v1/supervisor/operators`, supervisor portal |
| 13 | Pending pickups hidden behind the date filter | Reproduced | `scheduling-service.pickupQueue`, operations portal |
| — | Found while verifying: subscribing twice creates a duplicate | Reproduced | `subscription-service.subscribe` |

Covered by `test/unit/processing.test.ts`, `test/unit/pricing.test.ts` and
`test/functional/testing-round-3.dft.test.ts`.

## Testing round four

| Reported | Verified | Where |
| --- | --- | --- |
| Admin create society returns 500 | Not reproducible; contract hardened | `services/society-service.ts`, `app/routes/admin.ts` |
| Admin users resident filter returns 500 | Not reproducible on any filter combination | — |
| Supervisor create society returns 500 | Not reproducible; message added for the no-area case | `app/routes/supervisor.ts` |
| Admin slot management | Built | `app/routes/admin.ts`, admin Slots screen |
| Admin operator management, no supervisor required | Built | Admin Operators screen |
| Onboarding only for residents | Reproduced | `app/routes/resident.ts`, `app/routes/auth.ts` |
| Operations issue access and permissions | Reproduced | `app/routes/operations.ts`, operations Tickets screen |
| Admin revenue filters, KPIs and breakdowns | Built | `services/revenue-service.ts`, admin Revenue screen |
| Admin slot monitoring and advanced filtering | Built | `scheduling-service.monitorSlots` |
| Service pricing: subscription against pay as you go | Built | `domain/pricing.ts`, admin Config screen |
| Supervisor pickup monitoring: calendar and society filter | Built | `components/calendar.tsx`, supervisor Pickups screen |
| Supervisor reports date filter | Built | Supervisor Reports screen |
| Operations pending pickups date selection | Built | Operations Pickups screen |
| Resident garment-wise pricing | Built | `GET /v1/pricing`, resident booking screen |
| Found while verifying: the service day was computed in UTC | Reproduced | `scheduling-service.serviceDay` |

Covered by `test/functional/testing-round-4.dft.test.ts` and the service day tests in
`test/unit/slots.test.ts`.

## Round 13

Six reported items, and what each turned out to be.

| Reported | What it was | Where |
| --- | --- | --- |
| Society Deactivate does nothing | An update re-validated the whole stored address on a status-only patch, so a society without a pincode could never be switched off. Every seeded society has a complete address, which is why the suite passed over it | `services/society-service.ts`, `test/functional/round-13-society-status.dft.test.ts` |
| Society management needs status filters | Built: All societies, Active, Inactive, applied by the server alongside the search. The dashboard tile that drills in now seeds the dropdown, so a narrowed list says it is narrowed | `portals/AdminPortal.tsx`, `portals/society-filter-rules.ts` |
| Booking page gap before Standing arrangement | Not a fixed height. A section heading pays 24 above and 8 below; collapse its content and the 8 buys nothing, and margins do not collapse here as they do in a browser. Measured at 32 before, 24 after | `components/ui.tsx` |
| Admin cannot see service booking lifecycle | Mostly built already — the Bookings tab, the detail, the assignment history and the timeline. The real gaps were the supervisor answering for the society, and the operator and date filters | `service-request-service.describeForStaff`, `portals/service-bookings.tsx` |
| Service slot management and booking workflow | The largest item, and two genuine bugs inside it. See below | `domain/service-requests.ts`, `domain/operator-workload.ts` |
| Society creation asks for unnecessary address fields | House and street are optional now. A society is a complex, not a front door, and "Aparna Apartments" under "House: Aparna Apartments" says the same thing twice | `domain/society.ts`, `portals/society-wizard.tsx` |

The service workflow, in the order the problems were found.

| Found | Where |
| --- | --- |
| Slot capacity was computed for display and never checked at the write, so two residents confirming the last space both got it and a time nobody was offered could be posted directly | `service-request-service.create`, `domain/service-requests.slotRefusal` |
| The resident booking form posted a hardcoded `09:00`, so making capacity real would have refused every booking from that screen | `portals/resident-extras.tsx` |
| The wizard never drew a control for time slots, so a timetable could only be set by writing to the database | `portals/admin-service-wizard.tsx`, `service-wizard-rules.timeSlotProblems` |
| An operator could be given a service and a laundry collection at the same hour, which is a promise to a resident that nobody can keep | `domain/operator-workload.ts` |
| A resident who could not make the day had one move, and it was to throw the booking away | `service-request-service.reschedule` |

Covered by `round-13-society-status`, `round-13-service-capacity`,
`round-13-service-workflow` and `round-13-integrations` in `test/functional`, and by
`operator-workload`, `payment-methods` and `notification-routing` in `test/unit`.

## Integrations

Scaffolding for the outside world, all switched off until it is configured. See
`docs/CONFIGURATION.md` and `config/local.example.json`.

| Item | Status | Where |
| --- | --- | --- |
| SMS, with a DLT template id | Seam and generic gateway | `adapters/notifications/providers.ts` |
| WhatsApp, Meta Cloud API and a generic fallback | Seam and both clients | `WhatsAppCloudProvider` |
| Email | Fixed, not scaffolded. It was already a channel messages could be addressed to, and the router sent it to the push provider | `adapters/notifications/composite.ts` |
| Payment methods: card, UPI, netbanking, cash | Modelled, with cash deliberately outside the gateway | `domain/payments/methods.ts` |
| Customer support contact | Built. The ticketing already existed; this is the route for somebody who cannot sign in to use it | `GET /v1/support/contact` |
| Seeing which of them are actually live | Built | `GET /v1/admin/integrations` |
