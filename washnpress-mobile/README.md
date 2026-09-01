# Wash N Press apps

Two applications, one Expo and React Native codebase, one backend.

The four portals used to be one app: you signed in and the role on your session
decided whether you got the resident's booking screen or the admin's console. That
is right for the code and wrong for a store listing. A resident app is a consumer
product anybody may install; a staff app is an internal tool that is useless without
an account somebody at Wash N Press created, and the two are reviewed against
different expectations.

So the source stays single and the identity forks:

| | Wash N Press | Wash N Press Staff |
| --- | --- | --- |
| Serves | Resident | Operations, Supervisor, Admin |
| iOS | `com.washnpress.app` | `com.washnpress.staff` |
| Android | `com.washnpress.app` | `com.washnpress.staff` |
| Camera | Not requested | Garment batch QR codes |

Which one is being built is `APP_VARIANT`, read by `app.config.ts`; the same value
is passed into the bundle through `extra`, so the running app knows which of itself
it is. Signing into the wrong one is not an error — the credentials are right and
the account is fine — so the app says so and names the one to install instead.

The split is presentation, not security. The backend enforces every role boundary
independently and did so before either app existed.

The session is persisted, so refreshing the browser or reopening the app keeps you
signed in. The stored token is re-validated on start: an expired session or a
deactivated account still lands on the login screen, while a brief network failure
does not sign anybody out.

Screens that show work in progress refresh themselves while the app is in the
foreground, so an order an operator just advanced appears without a manual reload.
Polling stops when the app is backgrounded.

## The portals

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
  colleague covering the same tower can take it, carrying on from where it was left.
- Support tickets worked rather than only read: take one, answer the resident on the
  record, move it through its lifecycle and close it, filtered by status, type, date
  and whether you took it. Replies reach the resident's own support screen.
- Report an issue against an order, which reaches the supervisor.
- An offline queue: an action that fails for lack of connectivity is stored locally
  and replayed in order when the connection returns.

### Supervisor

Ten sections, and no more. Search duplicated the filters on every list that has
them; QC Monitoring was a read-only copy of a screen the operations staff work in;
Processing was five sub-tabs of the same. None was a decision a supervisor makes.

- Dashboard for the one assigned society, and nothing outside it.
- My society: its towers as a grid of cards, each with its floors, flats, residents,
  active orders and the operators covering it. Add a tower as Tower / Floors /
  Flats. Opening a card shows the tower and everybody who lives in it, with their
  flat, phone, plan and open orders — the management actions stay on the card but
  are no longer the only reason it exists.
- Slot management as a compact creation panel and a grid: create, adjust capacity,
  and cancel a slot, which cancels its bookings and notifies the affected residents.
  Days that have already gone are left out, and a slot cannot be created on one.
- Operations staff, searchable by name or phone and filterable by availability, with
  workload and staff as three-across grids so one operator can be compared with
  another. Blocks are handed out and taken back a tower at a time.
- Availability and handover: put an operator on leave, see everything they are still
  holding, and either hand it to a named colleague or release it to the shared
  queue. The account is never deleted and the orders keep their state.
- Orders as a table — order id, resident, flat, society, garments, amount, status,
  payment, operator — filtered by order id, operator or stage.
- Pickup monitoring with a calendar, and delayed orders as a grid.
- Customer support: the ticket with everything behind it — who raised it, as a
  resident with a flat or a member of staff with an employee id, and the order with
  its garments, money and collection — and one action, which is the reply.
- Society level reports.

### Admin

- System wide dashboard where every count opens the matching list with the right
  filter already applied, including delayed orders and charges still to collect.
- Societies with no active supervisor shown first, because admin covers those.
- Society management: the address in the parts an address is made of, its towers,
  and the one supervisor who runs it.
- Supervisor, operator and user management across the platform, created through a
  compact step flow rather than a page-length form. No verification codes: an
  account is created, and its owner proves their own number at first sign-in.
- Order management with society, block, status, date and resident filters.
- Subscription plan management with per plan usage and revenue.
- Slot monitoring with capacity, bookings and utilisation per slot, the society and
  supervisor behind it, and filters for all of those plus shift, slot status,
  booking status and utilisation band. A day that has passed is read only.
- A support console with volumes, average resolution time, the oldest tickets still
  waiting, and breakdowns by society, supervisor and category. Resolving and closing
  a ticket lives here.
- Revenue as a report rather than a total: a date preset or a custom range, filters
  by society, block, supervisor, operator and payment status, KPI cards, breakdowns
  by each of those and by plan, every charged order with the people behind it, and
  the charges still outstanding.
- An audit log showing who changed what, with the previous and the new value.
- System configuration: the subscriber and non subscriber garment rates, the garment
  service catalogue, garment categories, slot and turnaround defaults, and the
  operational toggles. A service can be added, edited and retired on its own, priced
  per garment category, and told what processing it requires.

## Prerequisites

- Node 18 or newer
- The Wash N Press backend running and reachable (see ../washnpress-v2)
- The Expo Go app on your phone, or an iOS or Android simulator, for device testing
  (push notifications need a development build instead — see below)
- Python with Pillow, only if you want to regenerate the icons

## Run it

There is no bare `npm start`: it would run one of the two applications without
saying which.

```bash
npm install
npm run resident        # then scan the QR with Expo Go, or press i / a
```

```bash
npm run staff
```

The scripts run through `cross-env`, so `APP_VARIANT` is set the same way on
Windows as on macOS and Linux. Without it npm hands `APP_VARIANT=staff expo start`
to `cmd.exe`, which has no idea what to do with a leading assignment and reports
`'APP_VARIANT' is not recognized`.

Point the app at a backend your phone can actually reach — its own `localhost` is
the handset, not your machine — by setting `EXPO_PUBLIC_API_URL` to your LAN
address before starting:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.20:8091"; npm run staff
```

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8091 npm run staff
```

### Push notifications need a development build, not Expo Go

Expo Go stopped delivering remote push notifications with SDK 53. Everything else
in both apps works in Expo Go; push does not, and no amount of configuration will
make it. The app detects this and says so on its Alerts screen rather than
appearing to be broken, and it no longer loads the notifications module where it
cannot work — which is what used to print two warnings on every start.

To test push, build the development client once per platform and install that
instead of Expo Go:

```bash
npx eas build --profile development --platform android
```

```bash
npx eas build --profile development-staff --platform android
```

Then run the dev server as usual and open the build rather than Expo Go. The same
two profiles exist for iOS.

Add `:android`, `:ios` or `:web` to go straight to one platform — `npm run
staff:android`.

## Pointing the app at your backend

By default the app calls http://localhost:8080, which works in the web build and the
iOS simulator. On a physical phone, localhost means the phone itself, so set your
computer's LAN IP instead:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8091 npm run resident
```

Find your IP with `ipconfig getifaddr en0` on macOS or `ipconfig` on Windows.

`EXPO_PUBLIC_API_URL` is the only thing that sets this. It is read in
`src/config.ts` as a plain property access, because that is the shape
`babel-preset-expo` inlines: written as an optional chain it is silently ignored
and every build falls back to localhost while looking configured. `npm run
verify:env` runs the real Babel transform over the file and fails if that stops
being true.

For a store build, set it on the EAS profile rather than in a shell:

```json
"production-resident": { "env": { "APP_VARIANT": "resident", "EXPO_PUBLIC_API_URL": "https://api.example.com" } }
```

The web build is a different origin from the API, so the backend has to allow it.
That is the `app.corsOrigins` setting, which defaults to `*` for local development.
Native builds are not subject to CORS at all.

**A store build needs HTTPS.** iOS App Transport Security and Android's cleartext
default both refuse plain `http://`, so the backend has to be behind TLS on a real
domain before either app can be submitted. Development over LAN HTTP still works.

## Push notifications

The app registers this handset with the backend on every sign-in and every start —
not once on install, because the operating system rotates push tokens and an app
that registered once would go quietly unreachable some weeks later. Signing out
stands the handset down, which is what matters on a shared device.

It needs an Expo project id, which `eas init` writes; without one the app skips push
and everything else works. Notifications also arrive in the in-app feed regardless,
so push is the convenience rather than the mechanism.

On the backend, set `notifications.push.enabled` and leave `provider` as `expo`.
Firebase alone would only cover Android — reaching an iPhone through FCM means
holding APNs credentials as well — so Expo's service fronts both and needs no server
key.

## Icons and splash screens

Both sets are generated from one script rather than committed as artwork nobody can
edit:

```bash
npm run icons
```

Same mark, inverted palette: the resident app is a light droplet on deep teal, the
staff app a deep teal droplet on aqua, so somebody carrying both can tell at a
glance which one they just opened.

## Building with EAS

`eas.json` carries a profile per application, and each sets `APP_VARIANT` itself so
neither can be built as the wrong one by forgetting a shell variable.

```bash
npm install -g eas-cli
eas login
eas init                                            # writes the project id

eas build --profile preview-resident --platform android    # an installable APK
eas build --profile production-staff --platform all        # store builds
eas submit --profile production-resident --platform ios
```

Versions live in one place: `app.config.ts` holds the marketing version, and EAS
holds the build number and Android version code (`appVersionSource: remote`), so
there is nothing to bump by hand.

Expo SDK 53 targets Android API 35, which is what Play requires of anything
submitted now; SDK 51 targeted 34 and could not be accepted. It also turns React
Native's new architecture on by default. Every dependency here supports it, but a
first run on a real device is the place that would show otherwise, so do that before
a store build rather than after.

## Type checking

```bash
npx tsc --noEmit                    # the whole app
npx tsc -p tsconfig.check.json      # the API client and offline queue, what CI runs
npx vitest run                      # the pure rules: layout, wizards, variants
```

## Structure

```
app.config.ts              the two application identities, keyed on APP_VARIANT
App.tsx                    session state, the portal router and the wrong-app gate
src/variant.ts             which application this build is
src/variant-rules.ts       which portals each application serves (pure, tested)
src/push.ts                registering this handset for notifications
src/config.ts              the API base URL, overridable by env
scripts/make_icons.py      draws both icon sets
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

## Camera QR scanning

The operator flow can scan a garment batch QR code with the device camera using expo
camera. If the camera permission is not granted, the operator can type the batch code
by hand, which matches the manual fallback in the specification.

## Offline persistence

The offline queue can persist on the device so queued operator actions survive an app
restart. Use `AsyncStorageQueue` from `src/offline/async-storage` in place of
`MemoryQueueStorage`.

## Try the full loop

1. Start the backend: in ../washnpress-v2 run `npm start`, or
   `MSYS_NO_PATHCONV=1 HOST_PORT=8091 docker compose --profile full up -d`.
2. `npm run resident`. The login screen offers the seeded resident account and shows
   the development OTP, so no SMS gateway is needed. Book a pickup and confirm it.
3. `npm run staff` in another terminal, on another device or simulator. Sign in as
   Operations, open the booking — it already names you as the assigned operator,
   because the tower it came from is yours — enter the garments, check the
   calculated summary, and confirm the pickup. Then run it through washing, ironing
   and QC. Fail QC once to see the issue raised and the reprocess path.
4. Still in the staff app, sign in as the Supervisor to watch the same order move,
   open its tower from My society to see who lives there, and answer the issue.
5. Sign in as Admin to see it counted system wide and recorded in the audit log.
6. Raise a support ticket as the resident, reply as the supervisor, resolve it from
   the admin console, then close it back on the resident side.
7. Sign in as the resident in the staff app to see the wrong-app screen, which is
   what somebody who installed the wrong one is told.

The API itself is documented at `/docs` on a running backend, with Try it out
enabled.
