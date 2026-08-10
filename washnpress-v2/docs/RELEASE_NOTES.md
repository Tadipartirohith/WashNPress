# Release notes

This release completes the backend platform and the mobile app, and it wires the
background jobs, the cache backed rate limiting and sessions, the audit log, and the
metrics endpoint. It also adds the real provider adapters behind configuration with a
mock fallback, so the platform runs before any live account exists.

## Backend

The service listens on port 8080. It uses a double entry ledger for money, an order
state machine for the garment lifecycle, atomic slot booking that cannot oversell, and
verified idempotent payment webhooks. Background jobs run on intervals from the config
and cover notification delivery, payment reconciliation, and recurring pickup
generation. Rate limiting and sessions use Redis when configured and an in process store
otherwise. The service exposes a metrics endpoint in the Prometheus text format, and it
initialises tracing only when an OTLP endpoint is set. Admin actions write audit
entries that can be read from an endpoint.

## Providers and configuration

Payments, SMS, WhatsApp, and push all have real adapters selected by configuration. Any
value that is not yet available is left as a reference in the config file, and the
platform uses a mock that records what it would have sent until the value is provided.
There is no code change needed to switch to a real provider.

## Mobile

The Expo app runs on iOS, Android, and the web. The resident can log in, view plans,
manage a subscription, top up the wallet, book a pickup, track an order, and raise a
support ticket. The operator mode drives the full processing pipeline, scans a garment
batch QR code with the camera, and queues actions offline so they survive an app
restart.

## Testing

The backend passes sixty one unit and functional tests. A shell smoke test and a Python
smoke test exercise a running instance end to end. The continuous integration workflow
builds the Docker image, starts the container, and runs the smoke test against it on
every pull request.
