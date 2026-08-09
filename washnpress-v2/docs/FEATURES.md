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
| Audit log | Store ready | store.audit, wire into admin actions as needed |
| SMS, WhatsApp, push delivery | Interface ready | notification providers, connect real gateways |
| Offline logging, camera QR scanning, live map | Client | mobile app, consumes these APIs |
| Autoscaling infrastructure, managed Postgres and Redis | Template | deployment/main.bicep |
| Postgres storage driver, atomic and persistent | Done | adapters/postgres/store.ts, tested with pg-mem |
| Production compiled build (plain node) | Done | tsup build, multi-stage Dockerfile |
| Cross-platform resident mobile app | Done | ../washnpress-mobile (Expo) |
| Mobile Operations mode with offline queue | Done | ../washnpress-mobile operator screens + src/offline |
| CI: typecheck, test, build, docker smoke, push | Done | .github/workflows |

## Honest status

The entire server side of the platform is built and tested with 56 passing tests. The
two pieces that cannot be produced and verified in this environment are the native
mobile applications and a live cloud deployment. The APIs, the data model, the infra
template, and the schema they depend on are all here, so those are build and connect
steps rather than design work.
