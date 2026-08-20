# Wash N Press app

One Expo and React Native codebase running on iOS, Android and the web, serving all
four Wash N Press portals. The portal that opens is decided by the role on the session
returned at sign in, and the backend independently enforces the same boundary, so the
app only decides what is worth showing.

## The four portals

### Resident

- Onboarding for a newly registered resident: name, society, flat, address. The
  backend records that it is complete, so it is never asked for twice.
- Dashboard with the current order, the next pickup, the plan and how much of the
  allowance is left, the wallet balance, pending charges and recent alerts.
- Book a pickup: pick a date, see the slots for your own society with live
  availability, then a confirmation screen before the booking is committed.
- Orders split into current, upcoming and previous, with a tracking timeline showing
  completed, current and pending stages.
- Order detail with the full quantity breakdown: total, subscription covered,
  additional, the rate, the charge and its payment status.
- Subscription page separating the current plan from the plans available to move to.
- Wallet with balance, transactions and top up.
- Support for raising and tracking issues, and a notification feed.

### Operations

- Dashboard by stage: what needs picking up, what needs processing, what is waiting
  for QC and what needs delivery.
- Today's pickup queue with the resident, society, flat, slot and pickup address.
- Garment entry by category, with the categories coming from system configuration.
  The operator enters only the actual accepted quantity; a confirmation step shows
  the split and the charge that the backend calculated before the pickup is committed.
- Pickup exceptions, recorded with a reason rather than dropping the order.
- The processing pipeline as explicit actions: start and complete wash, start and
  complete ironing, pass or fail QC with a reason, reprocess a failed batch, out for
  delivery, and delivery with count reconciliation.
- Active orders, order history and search, so an order never becomes unreachable.
- Report an issue against an order, which reaches the supervisor.
- An offline queue: an action that fails for lack of connectivity is stored locally
  and replayed in order when the connection returns.

### Supervisor

- Dashboard for the one assigned area, and nothing outside it.
- Society management and a society detail page with overview, residents, operations
  staff, slots, orders and issues.
- Slot management: create, adjust capacity, and cancel a slot, which cancels its
  bookings and notifies the affected residents.
- Operations staff management and a workload view that surfaces overloaded operators
  and operators with nothing assigned.
- Order, pickup, processing and QC monitoring, plus a delayed orders view.
- Issues worked from open through under review to resolved, with escalation to admin.
- Area level reports and a search that still respects the area boundary.

### Admin

- System wide dashboard where every count opens the matching list.
- Area management, including assigning and changing the one supervisor per area.
- Supervisor, society and user management across the platform.
- Order management with area, society, status, date and resident filters.
- Subscription plan management with per plan usage and revenue.
- Slot monitoring, reports, issue escalations.
- An audit log showing who changed what, with the previous and the new value.
- System configuration: additional garment rate, garment categories, slot and
  turnaround defaults, and the operational toggles.

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
src/portals/               ResidentPortal, OperationsPortal, SupervisorPortal, AdminPortal
src/screens/               Login, Onboarding, QR scanner
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
