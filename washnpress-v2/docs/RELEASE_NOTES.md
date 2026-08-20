# Release notes

## This release: continuity, customer support and optional subscriptions

The second round of requirements, raised after the first was tested. It covers staff
availability, a real customer support workflow, optional subscriptions with per
garment services, dashboard drill-down, API documentation, and three reported bugs.

### Nobody is a single point of failure

Staff accounts gain an `on_leave` status and are never deleted. Taking an operator off
duty finds everything they still hold and either hands it to a named colleague or
returns it to a shared queue that any operator in the area can claim from. The order
keeps its state and history: a batch that was mid wash is still mid wash, and only the
name against it changes. Every move is audited with the previous and the new holder.

An area survives its supervisor. Deactivating one leaves the societies, residents,
slots, orders and subscriptions untouched, and the admin covers the area in the
meantime with the supervisor level actions they need: slots, societies, operations
staff, order assignment and the area's tickets. `GET /v1/admin/coverage` lists the
areas in that position and the admin dashboard shows them first. A replacement
supervisor inherits the area immediately.

### Customer support

Support tickets became a real workflow rather than a status field. A resident raises a
question, complaint or dispute, optionally against an order and optionally as an
emergency, follows the conversation, and closes the ticket when satisfied. The
supervisor for that area is the first line: they reply on the record, set priority,
resolve with a note, or escalate to admin. An operator can read a ticket for their
society to supply the facts, but cannot resolve it, so a dispute is never settled by
the person it is about.

The lifecycle is `Open → Assigned → In Progress → Resolved → Closed`, enforced by a
transition table. Two moves are deliberate: replying to a resolved ticket reopens it,
because the person who raised it decides whether it is fixed, and closed is final.

Admin gets system wide visibility with the analytics the specification asks for:
volumes by status, emergencies, escalations, average resolution time, the oldest
tickets still waiting, and breakdowns by area, society, supervisor and category.

### Subscriptions are optional, and services are per garment

A resident with no plan can book and pay an ordinary per garment price, which is its
own configurable rate rather than an overage rate. Their dashboard says so plainly and
offers the plans instead of hiding the feature.

A garment category can now be split across services in one order: four shirts for dry
cleaning and six for an ordinary wash. Each split is an order line with its own
service, add-ons and price. The base service is priced at zero so a plan covers an
ordinary wash and iron; anything premium is charged per garment on top. The catalogue
is admin configuration and is published at `GET /v1/services`, so no client hard codes
a price, and Operations sees the requested split on the order.

### API documentation

`/docs` serves Swagger UI and `/openapi.json` the document, generated from the routes
Fastify actually registers. A test asserts that every registered route is documented,
so an endpoint cannot be added without appearing. Each operation states the roles
allowed, and Try it out works with a bearer token from `/v1/auth/otp/verify`.

### Dashboards drill down

Every metric on the admin dashboard navigates to the matching list with the filter
already applied, including delayed orders, orders with a charge still to collect,
unassigned supervisors and each support status. Revenue opens a breakdown by plan and
by charged order rather than showing only a total. The other three dashboards were
checked the same way.

### Fixes

- **Session lost on refresh.** The session is now persisted and restored on start, so
  reloading the page or reopening the app keeps the user signed in. The stored token
  is re-validated, so an expired session or a deactivated account still lands on the
  login screen, and a network failure does not sign anybody out.
- **Order tracking did not update.** Tracking carries a revision and the resident app
  polls while it is in the foreground, so an order marked delivered appears without a
  manual refresh.
- **Supervisor onboarding.** Verified that an admin created supervisor signs straight
  in to their dashboard with no onboarding step, and added a regression test.

### Testing

132 unit and functional tests, up from 99. New suites cover pricing, the ticket
lifecycle, staff leave and handover, the support workflow end to end, optional
subscriptions, per garment services, and the generated API document. Both smoke tests
were extended to match and pass against a running container on the in memory and the
Postgres storage drivers.

## Previous release: role based portals and area scoping

This release adds the Admin and Supervisor portals, reworks the Resident and
Operations portals, and moves the garment quantity and subscription arithmetic into
the backend where the specification requires it.

### Roles and the area boundary

The platform now has four roles rather than two. An operational **Area** sits between
the admin and the societies: an admin creates areas and makes exactly one supervisor
responsible for each, a supervisor manages the societies, slots, operations staff and
issues inside their own area, and an operations user works the societies they are
assigned to.

The boundary is enforced in the backend, in one place. `domain/access.ts` turns a
session into a scope and `services/access-service.ts` resolves it, so list endpoints
and direct lookups by id behave identically: a valid session asking for another area's
society or order gets the same answer as one asking for something that does not exist.
Scope always comes from the session, so supplying a different `areaId` in a request
body does not widen it. Deactivating an account now ends its live sessions at once.

### Garment quantities and charges

The operator enters only the actual accepted quantity. The backend derives the
subscription covered quantity, the additional quantity and the additional charge from
it, and finalises subscription usage at pickup rather than from the booking estimate.
The operations screen shows the calculated split for confirmation before the pickup is
committed, and the resident sees the same breakdown with its payment status.

### Order lifecycle

The state machine gains a `pickup_failed` state, so a failed pickup is preserved with
its reason instead of vanishing from the queue, and a held batch now returns to washing
or ironing and must pass QC again before it can ever be marked ready for delivery. A
QC failure records a reason, opens an issue for the supervisor, and notifies the
resident. Orders that pass their expected completion time are reported as delayed.

### Issues, notifications, audit and configuration

Support tickets and operational issues are one record, worked from open through under
review to resolved, with escalation to admin. Notifications are persisted per user so
every portal has an in app feed as well as the outbound channel. The audit log now
records the actor, their role, the resource and the previous and new value of every
administrative and operational change. Global settings, including the additional
garment rate and the garment categories, live in an admin only configuration document.

### Fixes

- `docker compose --profile full up` failed because the two app services published the
  same host port and both started. Each now sits behind its own profile.
- The browser build of the app could not call the API because no CORS headers were
  sent. Allowed origins are now configuration, defaulting to `*` for local development.
- The web dependencies that the documented `npm run web` needs were never declared.
- A rejected quality check no longer counts towards the QC attempt total.

### Testing

99 unit and functional tests pass, including a suite that drives the real API with a
valid session for the wrong area and asserts the refusal. The shell and Python smoke
tests were extended to cover the portals, the area boundary and the additional garment
charge, and both pass against a running container on the in memory and the Postgres
storage drivers.

## Previous release: platform completion

The service listens on port 8080. It uses a double entry ledger for money, an order
state machine for the garment lifecycle, atomic slot booking that cannot oversell, and
verified idempotent payment webhooks. Background jobs run on intervals from the config
and cover notification delivery, payment reconciliation, and recurring pickup
generation. Rate limiting and sessions use Redis when configured and an in process
store otherwise. The service exposes a metrics endpoint in the Prometheus text format,
and it initialises tracing only when an OTLP endpoint is set.

Payments, SMS, WhatsApp and push all have real adapters selected by configuration. Any
value that is not yet available is left as a reference in the config file, and the
platform uses a mock that records what it would have sent until the value is provided.
There is no code change needed to switch to a real provider.
