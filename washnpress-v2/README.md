# Wash N Press backend, version 2

A redesigned backend for the Wash N Press platform. It is built around four ideas
that make money and garment custody correct and safe:

- A double-entry ledger, so every rupee movement is balanced and auditable.
- An explicit order state machine, so the lifecycle rules live in one place.
- Atomic slot booking, so capacity can never be oversold under concurrency.
- Verified, idempotent payment webhooks, so payments cannot be forged or double counted.
- One place that decides what a session may see, so an area boundary cannot be
  enforced on one endpoint and forgotten on another. See `docs/RBAC.md`.

Everything that a tester or an operator might need to change lives in configuration,
not in code. See `docs/CONFIGURATION.md`.


## What the backend covers

The full server side is implemented and tested. It serves four role based portals:

- **Admin**: areas, supervisors, societies, users, orders, plans, slots, system wide
  reports, issue escalations, the audit log and global configuration.
- **Supervisor**: one assigned area only. Societies, pickup slots, operations staff
  and their workload, order, pickup, processing and QC monitoring, delayed orders,
  issues and area reports.
- **Operations**: the pickup queue, garment entry, the processing pipeline, quality
  check, delivery, order history and issue reporting.
- **Resident**: onboarding, plan and usage, slot booking with confirmation, order
  tracking, wallet, payments, notifications and support.

Underneath: OTP login and sessions, subscription plans with proration, pause and
cancel, pickup scheduling with atomic capacity, the complete order lifecycle, garment
logging with QR batch codes, quality check with automatic issues and a reprocess loop,
delivery reconciliation, wallet and a double entry ledger, verified and idempotent
payments, notifications through an outbox and worker with an in app feed,
sustainability tracking, operator earnings, and reporting.

Two business rules are worth calling out because they shape the data model. The
operator enters only the actual accepted garment quantity, and the backend derives the
subscription covered quantity, the additional quantity and the charge. Subscription
usage is finalised at pickup from that accepted quantity, never from the booking
estimate the resident gave.

See `docs/FEATURES.md` for the requirement map, `docs/API.md` for the endpoint list,
and `docs/RBAC.md` for the access model.

The two pieces that are not in this repository are signed native builds and a live
cloud deployment. The APIs and the autoscaling infrastructure template in
`deployment/` are what those depend on.


## Production build and storage modes

Run compiled (plain node, smaller and faster than tsx):

```bash
npm run build        # bundles to dist/server.js
npm run start:prod   # node dist/server.js
```

Storage is chosen by configuration. The default is in-memory. For a real database:

```bash
WNP_STORAGE__DRIVER=postgres \
WNP_STORAGE__POSTGRES__URL=postgresql://washnpress:washnpress@localhost:5432/washnpress \
npm start
# or bring up the whole stack in Docker:
docker compose --profile full up -d
```

The Postgres adapter applies its schema on boot and uses an atomic conditional update
for slot capacity, so it behaves identically to the in-memory store. A companion
mobile app lives in ../washnpress-mobile.

## Quick start

```bash
npm install
npm test          # runs all unit tests and detailed functional tests
npm start         # starts the API on the configured port, in-memory storage by default
curl localhost:8080/health
```

## Project layout

```
config/                 all tunable values and secrets live here
src/domain/             pure business rules, no framework or database
src/ports/              interfaces the rest of the code depends on
src/adapters/memory/    in-memory storage, used for tests and the default run
src/adapters/postgres/  postgres storage, used when the storage driver is postgres
src/services/           orchestration of the domain rules
src/app/                the Fastify HTTP layer
test/unit/              unit tests for the domain
test/functional/        detailed functional tests over the running API
db/init.sql             minimal schema for postgres mode
docs/                   configuration, docker and testing guides
```

## Documentation

- `docs/CONFIGURATION.md` how to change values without touching code
- `docs/DOCKER.md` how to build, run and test in a container
- `docs/TESTING.md` how the unit tests and functional tests are organised and run

A formal design blueprint that covers the full end-to-end platform is delivered
separately as `WashNPress_Design_Blueprint.docx`.
