# Wash N Press app

One Expo and React Native codebase running on iOS, Android and the web, serving all
four Wash N Press portals. The portal that opens is decided by the role on the session
returned at sign in, and the backend independently enforces the same boundary, so the
app only decides what is worth showing.

The session is persisted, so refreshing the browser or reopening the app keeps you
signed in. The stored token is re-validated on start: an expired session or a
deactivated account still lands on the login screen, while a brief network failure
does not sign anybody out.

Screens that show work in progress refresh themselves while the app is in the
foreground, so an order an operator just advanced appears without a manual reload.
Polling stops when the app is backgrounded.

## The four portals

### Resident

- Onboarding for a newly registered resident: name, society, flat, address. The
  backend records that it is complete, so it is never asked for twice.
- Dashboard with the current order, the next pickup, the plan and how much of the
  allowance is left, the wallet balance, pending charges and recent alerts.
- Book a pickup: choose what you are sending and the service for each part of it,
  pick a date from a calendar that will not offer a day already gone, see the price of
  every garment category before confirming, see the slots for your own society with live availability, then a
  confirmation screen showing the price before the booking is committed. Four shirts
  can go for dry cleaning and six for an ordinary wash in the same order.
- Orders split into current, upcoming and previous, with a tracking timeline showing
  completed, current and pending stages.
- Order detail with the full quantity breakdown: total, subscription covered,
  additional, the rate, the charge and its payment status.
- Subscription page separating the current plan from the plans available to move to.
  A plan is optional: without one the dashboard says so and offers the plans, and
  booking still works at the per garment price. A scheduled plan change is shown in
  full — which plan, what it costs, when it starts, whether it is an upgrade — and can
  be called off.
- Wallet with balance, transactions and top up.
- Help and support: raise a question, complaint or dispute, mark it urgent, follow
  the conversation with the supervisor, and close the ticket when satisfied.
- A notification feed for every lifecycle and support event.

### Operations

- Dashboard by stage: what needs picking up, what needs processing, what is waiting
  for QC and what needs delivery.
- The pending pickup queue: everything still waiting to be collected, oldest first,
  with anything missed on an earlier day badged as overdue rather than hidden behind a
  date filter. Narrowing to one date is still a keystroke away.
- Garment entry by category, with the categories coming from system configuration.
  The operator enters only the actual accepted quantity; a confirmation step shows
  the split and the charge that the backend calculated before the pickup is committed.
- Pickup exceptions, recorded with a reason rather than dropping the order.
- The processing pipeline as explicit actions, and only the ones this order needs.
  An Iron Only order offers Start Ironing, not Start Wash; a dry cleaning order reads
  Start Dry Clean. A per garment checklist shows what each part of the batch needs,
  so four shirts being dry cleaned and six being ironed are both visible. Then pass or
  fail QC with a reason, reprocess a failed batch, out for delivery, and delivery with
  count reconciliation.
- Active orders, order history and search, so an order never becomes unreachable.
- An unassigned queue: when a colleague goes on leave their work lands here and any
  operator in the area can take it, carrying on from where it was left.
- Support tickets worked rather than only read: take one, answer the resident on the
  record, move it through its lifecycle and close it, filtered by status, type, date
  and whether you took it. Replies reach the resident's own support screen.
- Report an issue against an order, which reaches the supervisor.
- An offline queue: an action that fails for lack of connectivity is stored locally
  and replayed in order when the connection returns.

### Supervisor

- Dashboard for the one assigned area, and nothing outside it.
- Society management and a society detail page with overview, residents, operations
  staff, slots, orders and issues.
- Slot management: create, adjust capacity, and cancel a slot, which cancels its
  bookings and notifies the affected residents. Days that have already gone are left
  out of the schedule, and a slot cannot be created on one.
- Operations staff management, searchable by name or phone and filterable by
  availability, with the count in each state on the filter. A workload view surfaces
  overloaded operators and operators with nothing assigned.
- Availability and handover: put an operator on leave, see everything they are still
  holding, and either hand it to a named colleague or release it to the shared queue.
  The account is never deleted and the orders keep their state.
- Order, pickup, processing and QC monitoring, plus a delayed orders view.
- Pickup monitoring with a calendar and a society filter, showing only the societies
  in the supervisor's own area.
- Customer support as the first line for the area: read the ticket with its resident
  and order context, reply to the resident, set priority, resolve with a note, or
  escalate to admin. Emergencies sort to the top.
- Area level reports and a search that still respects the area boundary.

### Admin

- System wide dashboard where every count opens the matching list with the right
  filter already applied, including delayed orders and charges still to collect.
- Areas with no active supervisor shown first, because admin covers those.
- Area management, including assigning and changing the one supervisor per area.
- Supervisor, society and user management across the platform.
- Order management with area, society, status, date and resident filters.
- Subscription plan management with per plan usage and revenue.
- Slot monitoring and reports.
- A support console with volumes, average resolution time, the oldest tickets still
  waiting, and breakdowns by area, supervisor and category.
- Revenue broken down by plan and by charged order, not just a total.
- An audit log showing who changed what, with the previous and the new value.
- Full edit forms on areas, supervisors, societies and plans, not just create and
  deactivate.
- Operator management: create operations staff directly, with their area and the
  societies they cover. A supervisor does not have to exist first — supervision
  follows the area, and the screen says whether that area has one yet.
- Slot monitoring with capacity, bookings and utilisation per slot, the area, society
  and supervisor behind it, and filters for all of those plus shift, slot status,
  booking status and utilisation band. Create a slot, change its capacity, cancel it.
  A day that has passed is read only.
- Revenue as a report rather than a total: a date preset or a custom range, filters
  by area, society, supervisor, operator and payment status, KPI cards, breakdowns by
  each of those and by plan, every charged order with the people behind it, and the
  charges still outstanding.
- System configuration: the subscriber and non subscriber garment rates, the garment
  service catalogue, garment categories, slot and turnaround defaults, and the
  operational toggles. A service can be added, edited and retired on its own, priced
  per garment category, and told what processing it requires.
- Plan editing including which garment services each plan covers at no extra charge.

## Prerequisites

- Node 18 or newer
- The Wash N Press backend running and reachable (see ../washnpress-v2)
- The Expo Go app on your phone, or an iOS or Android simulator, for device testing

## Run it

```bash
cd washnpress-mobile
npm install
npm run web        # opens in a browser, easiest for a first look
```

```bash
npm start          # then scan the QR code with Expo Go, or press i / a for a simulator
```

## Pointing the app at your backend

By default the app calls http://localhost:8080, which works in the web build and the
iOS simulator. On a physical phone, localhost means the phone itself, so set your
computer's LAN IP instead:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8080 npm start
```

Find your IP with `ipconfig getifaddr en0` on macOS. You can also edit `app.json`
under `expo.extra.apiBaseUrl`.

The web build is a different origin from the API, so the backend has to allow it. That
is the `app.corsOrigins` setting, which defaults to `*` for local development. Set it
to the exact origins in production.

## Try the full loop

1. Start the backend: in ../washnpress-v2 run `npm start`, or `docker compose up -d app`.
2. Start this app with `npm run web`.
3. The login screen offers the seeded demo accounts as buttons. The development OTP is
   shown on screen, so no SMS gateway is needed.

| Role | Phone | Opens |
| --- | --- | --- |
| Resident | 9876543210 | Resident portal |
| Operations | 9876500002 | Operations portal, Madhapur societies |
| Supervisor | 9876500011 | Supervisor portal, Madhapur area |
| Admin | 9876500001 | Admin portal, system wide |

4. As the resident, book a pickup and confirm it.
5. Sign out, sign in as Operations, open the booking, enter the garments, check the
   calculated summary, and confirm the pickup. Then run it through washing, ironing
   and QC. Fail QC once to see the issue raised and the reprocess path.
6. Sign in as the Supervisor to watch the same order move, and to resolve the issue.
7. Sign in as Admin to see it counted system wide and recorded in the audit log.
8. Raise a support ticket as the resident, reply to it as the supervisor, resolve it,
   then close it back on the resident side.
9. As the supervisor, put an operator on leave from Operations → Availability and
   handover, and watch their work appear in the operator Unassigned tab.

The API itself is documented at `/docs` on a running backend, with Try it out enabled.

The seed also creates a second area, Gachibowli, with its own supervisor (9876500012)
and operator (9876500003). Signing in as the Madhapur supervisor shows that the
Gachibowli society is neither listed nor reachable.

## Structure

```
App.tsx                    session state and the portal router
src/config.ts              the API base URL, overridable by env
src/api/client.ts          typed API client (framework agnostic, unit-checkable)
src/api/types.ts           response types shared across the portals
src/theme.ts               colours, state labels and formatting helpers
src/components/ui.tsx      shared primitives: cards, stats, tabs, chips, timeline
src/components/order.tsx   the order card and the shared order detail body
src/components/support.tsx the ticket card, detail, conversation and reply box
src/portals/               ResidentPortal, OperationsPortal, SupervisorPortal, AdminPortal
src/screens/               Login, Onboarding, QR scanner
src/session.ts             session persistence, so a refresh does not sign you out
src/hooks.ts               shared loading and foreground polling
src/offline/               the offline action queue and its storage adapters
```

## Type checking

```bash
npx tsc --noEmit                    # the whole app
npx tsc -p tsconfig.check.json      # the API client and offline queue, what CI runs
```

## Camera QR scanning

The operator flow can scan a garment batch QR code with the device camera using expo
camera. If the camera permission is not granted, the operator can type the batch code
by hand, which matches the manual fallback in the specification.

## Offline persistence

The offline queue can persist on the device so queued operator actions survive an app
restart. Use `AsyncStorageQueue` from `src/offline/async-storage` in place of
`MemoryQueueStorage`.

## Building with EAS

The file `eas.json` defines development, preview and production build profiles.
Install the tool with `npm install -g eas-cli`, sign in with `eas login`, and run
`eas build` to produce installable builds for iOS and Android.
