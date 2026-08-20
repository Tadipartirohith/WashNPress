# Release notes

## This release: role based portals and area scoping

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
