# Testing

There are two kinds of automated tests, and both run with a single command.

```bash
npm test            # everything
npm run test:unit   # unit tests only
npm run test:dft    # detailed functional tests only
npm run test:watch  # re-run on change while developing
```

## Unit tests (UT)

Location: `test/unit`. These test the pure business rules in isolation, with no
framework and no database, so they are fast and deterministic.

- `money.test.ts` paise conversion and guards.
- `ledger.test.ts` balanced transactions and derived balances.
- `order-state-machine.test.ts` legal transitions and the QC and discrepancy rules.
- `slots.test.ts` capacity reservation rules.
- `otp.test.ts` OTP generation, expiry, attempt limits, and mobile validation.
- `payments-signature.test.ts` webhook signature verification.
- `rate-limit.test.ts` the fixed window limiter.
- `garments.test.ts` the quantity split: covered, additional, and the charge, including
  the worked example from the specification.
- `access.test.ts` the role and area scope rules in isolation.

## Detailed functional tests (DFT)

Location: `test/functional`. These start the real application in memory and exercise
it the way a client would, using Fastify inject so no network port is needed.

- `booking.dft.test.ts` books a pickup, rejects a full slot, and proves two
  residents booking the last slot at the same time cannot both succeed.
- `payments.dft.test.ts` rejects a bad signature, credits the wallet on a valid
  webhook, and ignores a replayed event so the wallet is never double credited.
- `api.dft.test.ts` health, the OTP send and verify pair, and pickup booking over HTTP.
- `rbac.dft.test.ts` drives the real API with a valid session for the wrong area and
  asserts the refusal, including direct lookup by id, search, and cross area staff
  management. It also proves that deactivating an account ends its live sessions.
- `portals.dft.test.ts` walks each portal: the admin dashboard and area and supervisor
  provisioning with its audit trail, the supervisor area scope and slot rules, the
  operator garment split and QC reason requirement, and the resident onboarding,
  order grouping and subscription usage.
- `order-lifecycle.dft.test.ts` the full pipeline, the QC failure and reprocess loop,
  the delivery count guard, and a preserved failed pickup.
- `cors.dft.test.ts` the preflight and the response headers the browser build needs.

## What is covered and what is next

Coverage is collected for the domain and service layers, which is where correctness
matters most. The Postgres adapter is exercised through pg-mem, and the smoke tests
run the same scenarios against a real container on both storage drivers.

## Interpretation note

DFT here means detailed functional test, a test that drives the running system
through a real scenario rather than a single function. If your team uses DFT to mean
something more specific, tell me and I will rename and reshape these accordingly.

## Script based end to end tests

Two Python scripts are provided in addition to the shell smoke test. They use only the
standard library, apart from paramiko for the remote runner.

Run a local test against a running instance on port 8080:

```bash
BASE_URL=http://localhost:8080 python3 scripts/smoke_test.py
```

Run the same test against a remote host over SSH:

```bash
pip install paramiko
SSH_HOST=your.host SSH_USER=you SSH_KEY=~/.ssh/id_rsa \
REMOTE_BASE_URL=http://localhost:8080 python3 scripts/remote_smoke_test.py
```

Both scripts wait for the app to become ready, exercise the full flow, and exit with a
non zero code if any check fails, which makes them suitable for use in a pipeline.
