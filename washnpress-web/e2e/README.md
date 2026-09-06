# Web E2E tests (Playwright)

Prerequisites, run once before `npm run e2e`:

1. The backend, in-memory storage, with a generous OTP rate limit so a full run
   doesn't trip the normal 5-per-15-minutes send limit:
   ```bash
   cd ../../washnpress-v2
   WNP_APP__ENV=development WNP_STORAGE__DRIVER=memory WNP_APP__PORT=8090 \
     WNP_RATELIMIT__OTPSEND__LIMIT=100000 WNP_RATELIMIT__OTPSEND__WINDOWSECONDS=60 \
     npm run dev
   ```
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
against a shared or persistent deployment.
