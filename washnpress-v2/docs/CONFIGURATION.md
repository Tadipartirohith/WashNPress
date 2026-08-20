# Configuration

No environment specific value or secret is hard coded. Everything is read from
configuration, and there are three layers. Each layer overrides the one before it.

1. `config/default.json` is the committed baseline. It documents every value.
2. `config/local.json` is optional and is ignored by git. Copy `config/local.example.json`
   to `config/local.json` and edit it for your machine.
3. Environment variables override everything. This is how production and Docker
   should supply secrets.

## Environment variable rules

Any value can be set with the prefix `WNP_` and a double underscore for each level
of nesting. The names follow the JSON keys.

```
WNP_APP__PORT=8080
WNP_STORAGE__DRIVER=postgres
WNP_STORAGE__POSTGRES__URL=postgresql://user:pass@host:5432/db
WNP_CACHE__DRIVER=redis
WNP_CACHE__REDIS__URL=redis://host:6379
WNP_PAYMENTS__WEBHOOKSECRET=your-secret
WNP_APP__CORSORIGINS=https://app.example.com,https://admin.example.com
```

A list value can be given as a comma separated string, which is how `corsOrigins`
is normally supplied from the environment.

A few common values also have short aliases: `PORT`, `DATABASE_URL`, `REDIS_URL`,
and `RAZORPAY_WEBHOOK_SECRET`.

The configuration is validated at startup. If a value is missing or the wrong type,
the process refuses to start and prints exactly which value is wrong.

## What each section controls

- `app` environment name, host, port, log level, and the browser origins allowed to
  call the API. `corsOrigins` defaults to `["*"]` so the local web build works out of
  the box. A wildcard response is never credentialed, so the app authenticates with a
  bearer token rather than the session cookie. In production list the exact origins.
- `storage` chooses `memory` or `postgres`, and the Postgres connection and pool size.
- `cache` chooses `memory` or `redis`, and the Redis connection.
- `auth` OTP length, expiry, attempt limit, resend cooldown, lockout, and session length.
- `payments` provider, currency, webhook signature header, webhook secret, and keys.
- `scheduling` slot windows, default slot capacity, and the booking cutoff.
- `rateLimit` limits for OTP sending and for the general API.
- `notifications` toggles for SMS, WhatsApp, and push.

## Integration references

Every external service is described in configuration so that the platform runs before
any live account exists. When a value is empty, the platform uses a mock that logs
what it would have done, and the tests continue to pass. When you fill in a value, the
matching real provider is used with no code change.

Payments. The payments section holds the provider name, the base URL of the gateway,
the currency, the webhook secret, and the key id and key secret. The base URL lets you
point at a sandbox during verification. When the key id and key secret are empty, a
mock payment provider is used, which is what the local and test runs use.

Messaging. The notifications section has three channels, which are sms, whatsapp, and
push. Each channel has an enabled flag, a provider name, and connection references. The
sms and whatsapp channels take a base URL, an api key, and a sender. The push channel
takes a base URL and a server key for Firebase Cloud Messaging. A channel whose values
are empty falls back to the mock provider, so notifications are recorded rather than
sent until you connect the real gateway.

## Background jobs

The jobs section controls the background workers. The enabled flag turns all jobs on or
off. The outbox interval controls how often queued notifications are delivered. The
reconciliation interval controls how often the payment reconciliation runs, which is the
safety net that credits a wallet when a webhook was missed. The recurring generation
interval controls how often the next occurrence of recurring pickups is created, and the
recurring horizon in days controls how far ahead it looks.

## Rate limiting

The rate limit section has an enabled flag for one time password sending and an enabled
flag for the general API. Each has a limit and a window in seconds. When the cache
driver is set to redis, the limits are shared across all instances. When the cache
driver is memory, the limits apply per instance, which is correct for a single instance
and for tests.

## Sessions and cache

The cache section chooses memory or redis. When redis is chosen, sessions and rate
limits are stored in redis so they are shared across instances and survive a restart of
an individual instance. When memory is chosen, both are held in process, which keeps the
platform runnable with no external services.

## Observability

The observability section has a metrics enabled flag, a tracing enabled flag, and an
otlp endpoint. When metrics are enabled, the service exposes a metrics endpoint in the
Prometheus text format at the path /metrics. Tracing is exported only when tracing is
enabled and the otlp endpoint is set, so the reference lives in configuration and the
export is switched on later without any code change.
