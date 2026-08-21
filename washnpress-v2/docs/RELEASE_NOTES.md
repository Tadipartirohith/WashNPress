# Release notes

## This release: saying what went wrong, and reporting that can be acted on

The fourth round. Three issues were reported again as `500` errors on society
creation and the resident user filter. **None of them reproduces on this build**, and
every failure path on those endpoints was checked, including the data shapes the seed
never produces: a supervisor with no assigned area, an un-onboarded resident with no
society. The reports name `localhost:8080` and the `toLowerCase` crash that the
previous release traced to the JSON parser answering 500 instead of 400, so they were
almost certainly raised against a build from before that fix. The contract has been
hardened regardless, so those endpoints now cannot answer 500 for anything a caller
could have avoided.

### Creating a society says what actually went wrong

The requirements set out a contract, and the implementation did not match it. It does
now:

| What happened | Answer |
| --- | --- |
| Created | `201`, active, in the selected area |
| Name, code, address or area missing or malformed | `400` |
| The area does not exist | `404` |
| The code is already taken | `409` |
| The name is already taken **in that area** | `409` |
| The area exists but is not active | `422` |
| Anything else | never a bare `500` |

Address is now required. The same name in a *different* area is allowed, because they
are different places.

A supervisor with no area assigned is told so in a sentence they can act on rather
than a bare status code, and every other screen in their portal keeps working instead
of failing for want of an area.

### Onboarding belongs to residents alone

A supervisor, operator or admin asking for the onboarding flow was handed a live form.
They are now refused it. Staff accounts are created by an admin who already knows
everything onboarding would ask, so there is nothing for them to complete.

### An operator works a ticket rather than only reading it

Operations could see tickets and raise them, but not act on them. An operator now
takes a ticket, answers the resident on the record, moves it through its lifecycle and
closes it, with the whole history kept. Tickets filter by status, type, society, order
and date, and the counts are taken before the filter so they hold still as it narrows.
A reply reaches the resident's own support screen and notifies them.

Ownership is accepted rather than handed out: an operator takes a ticket for
themselves and cannot assign one to a colleague. A ticket for a society outside their
own is refused, as everything else in that portal already is.

### Slot monitoring worth the name

Every slot now reports its capacity, what is booked, what is left and its utilisation,
together with the area, society and supervisor responsible for it and whether anybody
is covering it at all. Filters compose across area, society, supervisor, operator, a
date or a date range, shift, slot status, booking status and utilisation band, and the
totals are for whatever the filters selected. An admin can create a slot, change its
capacity and cancel it; cancelling cancels the bookings inside it and tells those
residents.

A day that has passed is **closed and read only**. It cannot be edited or cancelled,
and it is left out of the schedule unless it is asked for.

### Revenue that can be interrogated

The revenue page was a total and a list. It is now a report: a period given as a
preset or as two dates, narrowed by area, society, supervisor, operator, plan or
payment status, with headline figures, breakdowns by each of those, every charged
order with the resident, society, area, supervisor and operator behind it, and the
charges still outstanding.

One thing it deliberately does not do: a month's subscription fee was not earned by
one operator or one area, so narrowing to either excludes subscription revenue rather
than attributing it to somebody. The response says that it did.

### Pricing per garment, and the two models kept apart

A garment is priced by its category for a resident paying as they go, so a saree is no
longer billed at the price of a shirt, and the resident sees the price of each garment
type **before** confirming a booking rather than one rate that matches nothing.

Subscription pricing and pay as you go pricing are maintained separately, and the
admin screen says so: changing what a garment costs a walk-up customer never alters a
plan's allowance or the services it covers, and editing a plan never moves a garment
price. `GET /v1/pricing` publishes the whole list, and tells a signed in resident what
their own plan covers against it.

### Operator management for the admin

The endpoints existed; nothing in the admin portal reached them. There is now an
Operator Management section: create an operator with their area and societies, edit
them, move them between areas, change which societies they cover, and block or
reactivate them.

An operator does **not** need a supervisor to exist first. Supervision follows the
area, so an operator created in an area nobody runs yet works perfectly well and picks
up a supervisor the moment one is assigned. The screen says which of those is the case
rather than leaving it blank.

### Calendars instead of a date format to memorise

Supervisor pickup monitoring, supervisor reports, operations pending pickups and the
resident booking screen all had a text box wanting `YYYY-MM-DD`. They now open a
calendar, show the chosen date as `Aug 21, 2026`, and hand the backend the format it
wants. The booking calendar will not offer a day that has already gone, and pickup
monitoring gained the society filter alongside it.

### Found while verifying: the day ended in the wrong place

"Today" was computed in UTC. For an operation in India that meant the service day
ended at half past five in the morning: between midnight and 05:30 the backend still
thought it was yesterday, so yesterday's pickup slots stayed bookable and a report run
early in the morning quietly meant the day before. The service day is now the
operation's own, configurable as `scheduling.serviceDayOffsetMinutes` and defaulting
to `+330` for India. Everything that turns a timestamp into a date goes through one
helper, so no two parts of the system can disagree about what day it is.

### The seeded areas

The seed now carries the five areas the requirements name — Madhapur, Gachibowli,
Kondapur, KPHB and Manikonda — three of them with no supervisor, so admin coverage and
creating staff before a supervisor exists both have something real to work with.

---

## Previous release: per garment processing, per garment pricing, and thirteen reported issues

The third round, raised after the second was tested. Ten of the thirteen reported
issues reproduced as described. Of the remaining three, all reported as `500` errors,
none reproduced on the endpoints named — but a real fault with exactly that signature
was found and fixed, and it is very likely what was hit. One further defect was found
while verifying, and is fixed here too.

### A malformed request body is the client's mistake, not the server's

Three issues reported a `500 Internal Server Error` from admin and supervisor
endpoints, followed by the app crashing on `Cannot read properties of undefined
(reading 'toLowerCase')`. Those endpoints answered correctly on every well formed
request. What did fail was any request whose **body was not valid JSON**: the custom
content type parser, added so payment webhooks can verify a signature over the raw
bytes, passed the parse error to Fastify without a status code, and Fastify defaulted
to `500`. The client then got an error shape it did not expect and crashed reading it.

The parser now marks a parse failure `400`, which is what Fastify's own parser does, so
a bad body is reported as a bad request and the app can render it.

### Every garment is processed according to its own service

The order state machine forced every order through washing, so an Iron Only order was
still shown "Start Wash". Services now declare what physically has to happen to a
garment — whether it needs cleaning, how it is cleaned, whether it needs ironing — and
an order's requirement is the union of what its own lines need.

An Iron Only order goes straight from Picked Up to ironing. A Wash Only order goes from
washing straight to QC with no empty ironing stage to sit in. An order carrying both
does both, in order. An order mixing dry cleaning and plain ironing reads as **Dry
Cleaning** throughout, because that is what dictates how the batch is handled.

**QC cannot be reached until every stage the garments need is done.** The operations
portal renders the actions the backend says are legal, and the backend enforces the
same rule, so an Iron Only order sent to the washing endpoint by any other client is
refused. The resident's tracking timeline lists only the stages their own order goes
through, so no washing step sits at "pending" forever. See
[PROCESSING.md](PROCESSING.md).

The order lifecycle itself is unchanged: Scheduled, Picked Up, processing, QC, Ready,
Out for Delivery, Delivered.

### Pricing per garment, and what a plan actually covers

A service had one price for every garment, which made pressing a saree cost the same as
pressing a shirt. Each service now carries a price per garment category, with its own
price as the fallback for anything not listed.

Plans now name the services they include. A garment sent for a covered service costs
nothing extra and spends allowance; one sent for a service the plan does not cover is
billed at its own price and leaves the allowance alone, because it was never part of
what the resident bought. Every plan field is editable, coverage included, and coverage
is recorded on the order line at booking so a later catalogue change never rewrites an
order in flight. See [PRICING.md](PRICING.md).

A plan stored before coverage existed is read as covering the ordinary wash and iron,
so nothing that used to be included starts being charged for.

### Adding a garment service

The service catalogue could only be edited, never extended. There are now endpoints to
add, edit and retire a single service, so introducing *Starch and Press* cannot drop an
existing service by omission. A new service is bookable immediately, at its per garment
prices, routed through the stages it says it needs. A service is retired rather than
deleted because orders in flight reference it, and the base service cannot be retired.

### Pickups that were missed

The operator's queue filtered on an exact date and defaulted to today, so a pickup that
was not collected yesterday simply vanished from the screen. With no date asked for,
the queue now returns everything still waiting up to and including today, oldest first,
each overdue row badged and counted. Asking for a specific date still gives exactly
that date.

### Slots in the past

Past dated slots were listed to supervisors and, worse, a resident could book one: the
API accepted it and created a real order against a day that had already gone. A slot on
a past day can no longer be created, is not offered, and cannot be booked — and a
refused booking gives its capacity straight back rather than quietly consuming a place.
The supervisor's schedule hides days that have gone unless `includePast=true` is asked
for.

### A scheduled plan change, spelled out

The subscription page said only that a change was pending. It now shows which plan,
what it costs, the new allowance and turnaround, when it takes effect, whether it is an
upgrade or a downgrade, and that the resident stays on their current plan until then.
A scheduled change can be called off.

### Editing what already exists

Areas, supervisors, societies and plans could be created, assigned and deactivated but
not edited, so a typo meant deactivating and starting again. Each now has an edit form
covering every field that is safe to change. A supervisor's phone number stays
read only because it is their sign in identity: changing it would lock them out.

### Finding people and places

Operations staff can be filtered by availability and searched by name or phone, with
the count in each state shown on the filter and taken before the filter is applied so
it does not move as the list narrows.

Society search fired a request on every keystroke with nothing to order the replies, so
a slow earlier response could land after a newer one and the list stopped matching what
had been typed until another control forced a clean reload — which is why it appeared to
work only after picking an area. Typing is now held still briefly and a stale reply is
discarded. The search itself was correct on the backend and is unchanged.

### Found while verifying: duplicate subscriptions

Subscribing while already subscribed created a **second** active subscription rather
than being refused. With more than one active row for a resident, each read picked
whichever came back first, so a plan change could be written to one row and read back
from another and appear not to have happened at all. Subscribing again is now refused
with `409 already_subscribed`, and should a database already hold several, the most
recently started one wins so every read agrees.

### Not reproducible

Society search is correct on the backend: `apar`, `APAR` and `Apar` all match, with and
without an area filter. The fix for that report is in the app, described above.

---

## Previous release: continuity, customer support and optional subscriptions

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
