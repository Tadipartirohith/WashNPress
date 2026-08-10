# Requirements to implementation map

This maps the functional requirements from the specification to where they are built
in the backend. Anything marked client is a mobile or web client concern that consumes
these APIs.

| Requirement | Status | Where |
|---|---|---|
| OTP login, attempt limits, resend cooldown, lockout | Done | domain/otp, services/otp-service, auth-service |
| Sessions and role based access | Done | services/auth-service, app/guards |
| Society selection and onboarding | Done | routes/catalog, routes/auth |
| Plan comparison and subscription | Done | routes/subscription, subscription-service |
| Upgrade, downgrade with proration, pause, cancel | Done | subscription-service (computeProrationPaise) |
| Garment cap tracking and deduction | Done | subscription-service.deductGarments, order-service.deliver |
| Pickup scheduling, recurring, reschedule, cancel with cutoff | Done | scheduling-service |
| Atomic slot capacity, no oversell | Done | store slots.reserveCapacity, scheduling-service |
| Order lifecycle and tracking timeline | Done | domain/order-state-machine, order-service |
| Garment logging and QR batch codes | Done | order-service.markPickedUp, domain/codes |
| QC pass and fail, auto ticket and notification | Done | order-service.submitQc, support-service |
| Delivery count reconciliation and discrepancy handling | Done | order-service.deliver, state machine guard |
| Ratings and disputes | Done | order-service.rate, raiseDispute |
| Wallet, balance, transactions, top up | Done | wallet-service |
| Double entry ledger for all money | Done | domain/ledger, domain/accounts |
| Payments, verified and idempotent webhooks | Done | payment-service, domain/payments/signature |
| Payment provider order creation (Razorpay) | Done | adapters/payments (fake and razorpay providers) |
| Notifications via outbox and worker | Done | services/notification-service, adapters/notifications |
| Support tickets | Done | support-service, routes/support |
| Sustainability water tracking and resident widget | Done | sustainability-service |
| Operator earnings and performance | Done | earnings-service |
| Admin reports and slot configuration | Done | reports-service, routes/admin |
| Audit log wired into admin actions | Done | routes/admin, GET /v1/admin/audit |
| SMS, WhatsApp, push delivery | Providers built, mock until keys set | adapters/notifications, config references |
| Offline logging, camera QR scanning, live map | Client | mobile app, consumes these APIs |
| Autoscaling infrastructure, managed Postgres and Redis | Template | deployment/main.bicep |
| Postgres storage driver, atomic and persistent | Done | adapters/postgres/store.ts, tested with pg-mem |
| Production compiled build (plain node) | Done | tsup build, multi-stage Dockerfile |
| Cross-platform resident mobile app | Done | ../washnpress-mobile (Expo) |
| Mobile Operations mode with offline queue | Done | ../washnpress-mobile operator screens + src/offline |
| CI: typecheck, test, build, docker smoke, push | Done | .github/workflows |

| Background jobs on a timer (reconciliation, recurring) | Done | jobs/job-runner, reconciliation-service, recurring-service |
| Payment reconciliation safety net | Done | reconciliation-service, tested |
| Redis backed rate limiting and sessions | Done | adapters/cache, memory default, redis when configured |
| Metrics endpoint and tracing reference | Done | observability/metrics, observability/tracing, /metrics |
| Resident subscription, wallet, support screens | Done | washnpress-mobile screens |
| Camera QR scanning and persistent offline queue | Done | washnpress-mobile QrScannerScreen, offline/async-storage |
| Expo EAS build configuration | Done | washnpress-mobile/eas.json |

## Honest status

The entire server side of the platform is built and tested with 61 passing tests. The
two pieces that cannot be produced and verified in this environment are the native
mobile applications and a live cloud deployment. The APIs, the data model, the infra
template, and the schema they depend on are all here, so those are build and connect
steps rather than design work.
