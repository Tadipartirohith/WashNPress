# API reference

All endpoints are JSON. Authenticated endpoints accept the session either as the
`wnp_session` cookie set at login, or as an `Authorization: Bearer <token>` header.

## Auth
- `POST /v1/auth/otp/send` send a one time password to a mobile number
- `POST /v1/auth/otp/verify` verify the code, receive a session, cookie is set
- `POST /v1/auth/onboarding` complete a resident profile (name, society, unit)
- `GET  /v1/auth/me` current identity and roles
- `POST /v1/auth/logout` end the session

## Catalog
- `GET /v1/plans` active subscription plans
- `GET /v1/addons` active add on services
- `GET /v1/societies`, `GET /v1/societies/nearby`

## Subscription (resident)
- `GET  /v1/subscription` current active subscription
- `POST /v1/subscription/subscribe` subscribe, charged from the wallet
- `POST /v1/subscription/change` upgrade or downgrade, effective next cycle, returns proration
- `POST /v1/subscription/pause`, `POST /v1/subscription/cancel`

## Scheduling and orders (resident)
- `GET  /v1/slots?date=YYYY-MM-DD` available slots for the resident's society
- `POST /v1/pickups` book a pickup, one time or recurring, with optional add ons
- `POST /v1/pickups/reschedule`, `POST /v1/pickups/cancel` subject to the cutoff
- `GET  /v1/orders/:id`, `GET /v1/orders/:id/tracking`
- `POST /v1/orders/:id/rate`, `POST /v1/orders/:id/dispute`

## Operations (operator)
- `GET  /v1/operations/bookings` today's scheduled orders
- `POST /v1/operations/orders/:id/picked-up` log garments, generates the QR batch code
- `POST /v1/operations/orders/:id/advance` move through wash, iron, quality check
- `POST /v1/operations/orders/:id/qc` pass or fail, a fail opens a ticket automatically
- `POST /v1/operations/orders/:id/out-for-delivery`
- `POST /v1/operations/orders/:id/deliver` reconciles counts, deducts the garment cap
- `GET  /v1/operations/units/:unitId/earnings`

## Wallet (resident)
- `GET  /v1/wallet`, `GET /v1/wallet/transactions`
- `POST /v1/wallet/topup` starts a payment order for a top up

## Payments
- `POST /v1/payments/webhook` signature verified, idempotent, credits the wallet

## Support
- `POST /v1/support/tickets`, `GET /v1/support/tickets`, `POST /v1/support/tickets/:id/reply`

## Sustainability (resident)
- `GET /v1/sustainability/impact` litres of water saved by the society unit

## Admin (admin role)
- `GET  /v1/admin/reports/subscriptions | revenue | operations | sustainability | garment-risk`
- `POST /v1/admin/slots` create a pickup slot
