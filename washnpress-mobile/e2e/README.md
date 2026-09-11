# Mobile E2E tests (Playwright, via the web export)

There's no Xcode/Android tooling assumed here, so these specs drive the app's
own web export (`npm run staff:web` / `resident:web`) in a real browser —
an officially-supported way to run this app, not a workaround.

Prerequisites, run once before `npm run e2e`:

1. The backend, in-memory storage, with a generous OTP rate limit so a full
   run doesn't trip the normal 5-per-15-minutes send limit:
   ```bash
   cd ../../washnpress-v2
   WNP_APP__ENV=development WNP_STORAGE__DRIVER=memory WNP_APP__PORT=8090 \
     WNP_RATELIMIT__OTPSEND__LIMIT=100000 WNP_RATELIMIT__OTPSEND__WINDOWSECONDS=60 \
     WNP_RATELIMIT__API__LIMIT=1000000 WNP_RATELIMIT__API__WINDOWSECONDS=60 \
     WNP_AUTH__RESENDCOOLDOWNSECONDS=0 \
     npm run dev
   ```
2. Both app variants, each on their own port (matching `playwright.config.ts`'s
   two projects — `staff` on 8081, `resident` on 8082). `.env.local` already
   points `EXPO_PUBLIC_API_URL` at the backend above; override it inline if
   you're running against a different port.
   ```bash
   npm run staff:web -- --port 8081 --clear
   npm run resident:web -- --port 8082 --clear
   ```

`WNP_RATELIMIT__API__LIMIT` is the general per-IP limit, separate from the OTP
one: every request in a run arrives from one address, so without raising it the
run starts collecting 429s partway through and specs fail together on sends that
were perfectly valid. `WNP_AUTH__RESENDCOOLDOWNSECONDS` matters for the same
reason — the resend cooldown is now genuinely enforced, and a suite that signs in
as the same demo accounts repeatedly trips it constantly.

The two variants share a Metro transform cache. Start each on its own `TMPDIR`
(or `TEMP` on Windows), or the second to boot can be served the first's bundle —
the resident app comes up wearing the staff app's variant and every resident spec
fails on a screen that looks nothing like what it expects.

Then `npm run e2e` (or `npx playwright test --project=staff` /
`--project=resident` for just one variant).

These tests use the seeded demo accounts (`e2e/helpers.ts`) and mutate real
state (bookings, wallet top-ups, societies, towers) against whatever backend
they're pointed at — always run them against a disposable in-memory instance,
never against a shared or persistent deployment. A few tests (pickup
reconciliation, "book today") depend on there being live pickups or open
slots for "today" in the seeded data; they skip themselves with a clear
reason rather than fail when the current time of day has already closed them
out.
