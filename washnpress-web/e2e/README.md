# Web E2E tests (Playwright)

Prerequisites, run once before `npm run e2e`:

1. The backend, in-memory storage, with a generous OTP rate limit so a full run
   doesn't trip the normal 5-per-15-minutes send limit, and a short resend
   cooldown:
   ```bash
   cd ../../washnpress-v2
   WNP_APP__ENV=development WNP_STORAGE__DRIVER=memory WNP_APP__PORT=8090 \
     WNP_RATELIMIT__OTPSEND__LIMIT=100000 WNP_RATELIMIT__OTPSEND__WINDOWSECONDS=60 \
     WNP_RATELIMIT__API__LIMIT=1000000 WNP_RATELIMIT__API__WINDOWSECONDS=60 \
     WNP_AUTH__RESENDCOOLDOWNSECONDS=0 \
     npm run dev
   ```

   `WNP_RATELIMIT__API__LIMIT` is the general per-IP request limit, which is
   separate from the OTP one. Every request this suite makes — the browser's and
   the specs' own `request.post` calls — arrives from a single address, so the
   whole run counts as one very busy client and starts collecting 429s partway
   through. The symptom is a cluster of specs failing together on "OTP send
   failed" for numbers that are perfectly valid.

   `WNP_AUTH__RESENDCOOLDOWNSECONDS` is not optional. The real cooldown is 30
   seconds and it is now genuinely enforced — it was configured but read by
   nothing until the OTP delivery rewrite. A suite that signs in as the same four
   demo numbers dozens of times hits it constantly: the second send is refused
   with "A code was already sent, retry in N seconds", the OTP stage never
   appears, and every spec downstream fails for a reason that has nothing to do
   with what it was testing. One second keeps the control live — a double-submit
   in the same tick is still refused — without stalling the run.
2. This app, pointed at that backend:
   ```bash
   NEXT_PUBLIC_API_URL=http://localhost:8090 npm run dev
   ```
   (`playwright.config.ts` defaults `baseURL` to `http://localhost:3100` — pass
   `WEB_BASE_URL` to point at a different port or a running docker-compose
   deployment instead.)

Then `npm run e2e` (or `npx playwright test <file>` for one spec).

These tests use the seeded demo accounts (`e2e/helpers.ts`) and mutate real
state (bookings, wallet top-ups, societies) against whatever backend they're
pointed at — always run them against a disposable in-memory instance, never
against a shared or persistent deployment. `resident-registration-and-deletion`
goes further and **erases accounts**: it registers throwaway numbers of its own
so it never touches the seeded resident, but it is the clearest reason this
suite must never be aimed at anything real.

Point the suite at a **freshly started** backend. Slots have finite capacity in
the seeded data, and a run books a good number of pickups; aim a second full run
at the same instance and the later booking specs start failing because the day
they choose has genuinely sold out. `docker compose up -d --force-recreate` (or
just restarting the API container) is enough — the storage is in memory, so a
restart is a reseed.

Running two Playwright processes against this directory at once makes them
fight over `test-results/`, and a lost trace file fails a test that actually
passed. Give each concurrent run its own `--output=<dir>`.
