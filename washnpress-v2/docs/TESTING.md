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

## Detailed functional tests (DFT)

Location: `test/functional`. These start the real application in memory and exercise
it the way a client would, using Fastify inject so no network port is needed.

- `booking.dft.test.ts` books a pickup, rejects a full slot, and proves two
  residents booking the last slot at the same time cannot both succeed.
- `payments.dft.test.ts` rejects a bad signature, credits the wallet on a valid
  webhook, and ignores a replayed event so the wallet is never double credited.
- `api.dft.test.ts` health, the OTP send and verify pair, and pickup booking over HTTP.

## What is covered and what is next

Coverage is collected for the domain and service layers, which is where correctness
matters most. The natural next steps are to add functional tests against the Postgres
adapter in a container, and to add end-to-end tests once the mobile clients exist.

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
