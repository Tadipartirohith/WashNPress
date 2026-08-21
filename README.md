# Wash N Press

[![Backend CI](https://github.com/Tadipartirohith/WashNPress/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/Tadipartirohith/WashNPress/actions/workflows/backend-ci.yml)
[![Mobile CI](https://github.com/Tadipartirohith/WashNPress/actions/workflows/mobile-ci.yml/badge.svg)](https://github.com/Tadipartirohith/WashNPress/actions/workflows/mobile-ci.yml)

This repository contains the Wash N Press platform. It is a subscription based
community laundry service for residential societies. The platform has a backend
service and a cross platform app.

## Roles

The platform has four roles, each with its own portal:

- **Admin** runs the whole platform. Areas, supervisors, societies, users, plans,
  global configuration, system wide reports and the audit log.
- **Supervisor** is created by an admin and made responsible for exactly one
  operational area. They manage that area's societies, pickup slots, operations staff
  and issues, and see nothing outside it.
- **Operations** staff physically process orders in the societies they are assigned
  to: pickup, garment entry, washing, ironing, quality check and delivery.
- **Resident** is the customer: onboarding, plan, slot booking, order tracking,
  wallet, payments and support.

The area boundary is enforced by the backend, not by the app. A valid session asking
for another area's data gets the same answer as one asking for something that does
not exist. See [washnpress-v2/docs/RBAC.md](washnpress-v2/docs/RBAC.md).

## Structure

The folder `washnpress-v2` is the backend service. It is written in TypeScript and
built on Fastify. It uses a double entry ledger for all money, an explicit order state
machine for the garment lifecycle, atomic slot booking that cannot oversell capacity,
verified idempotent payment webhooks, and role and area scoping applied in one place.
It runs with in memory storage by default, and with PostgreSQL when the storage driver
is set to postgres.

The folder `washnpress-mobile` is the app. It is built with Expo and React Native and
runs on iOS, Android and the web from one codebase. It opens the portal that matches
the role of whoever signs in.

## Five business rules worth knowing

1. **The operator enters only the actual accepted garment quantity.** The split
   between what the subscription covers and what is billed as additional, and the
   resulting charge, are computed by the backend and by nothing else. Neither the
   operator nor the resident can supply those numbers.
2. **Subscription usage is finalised at pickup from the accepted quantity**, never
   from the estimate the resident gave when booking.
3. **Nobody is a single point of failure.** Staff are taken off duty rather than
   deleted, an area survives its supervisor being unavailable, and an operator going
   on leave hands their work over or releases it to a queue any colleague can claim
   from. See [CONTINUITY.md](washnpress-v2/docs/CONTINUITY.md).
4. **A subscription is optional.** A resident without a plan books normally and pays
   a per garment price, and one garment category can be split across different
   services within a single order. Services are priced per garment category, and a
   plan names the ones it covers. See [PRICING.md](washnpress-v2/docs/PRICING.md).
5. **Every garment is processed according to the service it was sent for.** An order
   only offers the stages its own garments need, so an Iron Only order never shows
   Start Wash and never waits at a washing step. See
   [PROCESSING.md](washnpress-v2/docs/PROCESSING.md).

## Getting started

To run the backend, open `washnpress-v2` and read its README. In short, run
`npm install` and then `npm start`, and the service listens on port 8080. To run the
app, open `washnpress-mobile` and read its README. In short, run `npm install` and
then `npm run web`, and point it at the backend.

The seed data creates two areas so the boundary is visible straight away. The login
screen offers the demo accounts as buttons:

| Role | Phone | Opens |
| --- | --- | --- |
| Resident | 9876543210 | Resident portal |
| Operations | 9876500002 | Operations portal |
| Supervisor | 9876500011 | Supervisor portal, Madhapur |
| Admin | 9876500001 | Admin portal, system wide |

## API documentation

A running backend serves Swagger UI at `/docs` and the OpenAPI document at
`/openapi.json`. Both are generated from the routes the server actually registers, so
they cannot drift from the implementation, and a test fails if a route is undocumented.
Sign in through `/v1/auth/otp/verify`, paste the token into Authorize, and the
endpoints are callable from the page.

## Default port

The service listens on port 8080. When running in Docker, the host port is set with
the `HOST_PORT` environment variable and also defaults to 8080.

## Continuous integration

The workflows in `.github/workflows` run type checks, tests, a production build, a
Docker image build, and a smoke test on every push and every pull request. On the main
branch the backend image is published to the GitHub Container Registry.

## Testing

The backend has a full unit and functional test suite that runs with `npm test`. There
is also a Python script at `washnpress-v2/scripts/smoke_test.py` that tests a running
instance end to end, and a paramiko based script for testing a remote host over SSH.
