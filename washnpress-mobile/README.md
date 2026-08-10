# Wash N Press mobile app

A cross-platform Resident app built with Expo and React Native, running on iOS,
Android, and the web from one codebase. It talks to the Wash N Press backend through
a small typed API client.

## Screens included

Resident:

- Login by mobile number and OTP. In local mode the backend returns the OTP in the
  response, so no SMS gateway is needed to sign in.
- Home with the wallet balance and the plan comparison.
- Book a pickup by choosing an available slot for today.
- Order tracking with the live status and full timeline.

Operator (Operations mode, loaded automatically when an operator logs in):

- Today's bookings, with pull to refresh.
- Order actions for the full pipeline: log garments, mark picked up (which shows the
  QR batch code), advance through wash, iron and quality check, mark out for delivery,
  and confirm delivery with count reconciliation.
- An offline queue: if an action fails because there is no connectivity, it is stored
  locally and a pending count is shown. Tapping Sync replays queued actions in order
  when the connection returns. The in-memory store can be swapped for AsyncStorage for
  persistence across app restarts, and the manual flow pairs with camera QR scanning
  via expo-camera as a drop-in for the batch code field.

## Prerequisites

- Node 18 or newer
- The Wash N Press backend running and reachable (see ../washnpress-v2)
- The Expo Go app on your phone, or an iOS or Android simulator, for device testing

## Run it

```bash
cd washnpress-mobile
npm install
npm run web        # opens in a browser, easiest for a first look
# or
npm start          # then scan the QR code with Expo Go, or press i / a for a simulator
```

## Pointing the app at your backend

By default the app calls http://localhost:8080, which works in the web build and iOS
simulator. On a physical phone, localhost means the phone itself, so set your
computer's LAN IP instead:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8080 npm start
```

Find your IP with `ipconfig getifaddr en0` on macOS. You can also edit
`app.json` under `expo.extra.apiBaseUrl`.

## Try the full loop

1. Start the backend: in ../washnpress-v2 run `npm start` (or `docker compose up -d app`).
2. Start this app with `npm run web`.
3. Log in with the seeded resident number 9876543210, or the operator number 9876500002 to load Operations mode. The dev OTP is shown on screen.
4. Tap Schedule a pickup, choose a slot, and watch it move to the tracking screen.
5. To advance the order through the pipeline, act as the operator against the backend,
   for example with `../washnpress-v2/scripts/smoke-test.sh`, then pull to refresh
   the tracking screen.

## Structure

```
App.tsx                 screen switching and session state
src/config.ts           the API base URL, overridable by env
src/api/client.ts       typed API client (framework agnostic, unit-checkable)
src/api/types.ts        response types shared across screens
src/screens/            Login, Home, Book pickup, Tracking
```

## Status and next steps

This is a working scaffold of the resident flows against the live API, verified by
type-checking the API client. The natural next steps are an Operations mode for
operators with offline logging and camera QR scanning, push notifications, and the
subscription and wallet top-up screens. The operator endpoints already exist on the
backend, so those screens are additive.

## Additional resident screens

The home screen now links to three more screens. The subscription screen shows the
current plan and lets the resident subscribe, switch plan for the next cycle, pause, or
cancel. The wallet screen shows the balance and the transaction history and starts a top
up, which returns a payment order that the gateway completes. The support screen lists
the resident tickets and raises a new one.

## Camera QR scanning

The operator flow can scan a garment batch QR code with the device camera using expo
camera. If the camera permission is not granted, the operator can type the batch code by
hand, which matches the manual fallback in the specification. Install the camera package
with npx expo install expo-camera before running on a device.

## Offline persistence

The offline queue can persist on the device so that queued operator actions survive an
app restart. Install the storage package with npx expo install
@react-native-async-storage/async-storage, then use AsyncStorageQueue from
src/offline/async-storage in place of MemoryQueueStorage.

## Building with EAS

The file eas.json defines development, preview, and production build profiles. Install
the tool with npm install -g eas-cli, sign in with eas login, and run eas build to
produce installable builds for iOS and Android.
