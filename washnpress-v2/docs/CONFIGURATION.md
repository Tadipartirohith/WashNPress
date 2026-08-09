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
```

A few common values also have short aliases: `PORT`, `DATABASE_URL`, `REDIS_URL`,
and `RAZORPAY_WEBHOOK_SECRET`.

The configuration is validated at startup. If a value is missing or the wrong type,
the process refuses to start and prints exactly which value is wrong.

## What each section controls

- `app` environment name, host, port, and log level.
- `storage` chooses `memory` or `postgres`, and the Postgres connection and pool size.
- `cache` chooses `memory` or `redis`, and the Redis connection.
- `auth` OTP length, expiry, attempt limit, resend cooldown, lockout, and session length.
- `payments` provider, currency, webhook signature header, webhook secret, and keys.
- `scheduling` slot windows, default slot capacity, and the booking cutoff.
- `rateLimit` limits for OTP sending and for the general API.
- `notifications` toggles for SMS, WhatsApp, and push.
