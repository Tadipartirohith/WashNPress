# Running in Docker

> Note: Docker must be installed first. On macOS or Windows install Docker Desktop; on Linux install Docker Engine. Verify with `docker --version`.

There are two ways to run the backend. The first needs nothing but Docker, because
it uses in-memory storage. The second brings up Postgres and Redis as well.

## Option 1: app only, in-memory storage

```bash
docker compose build app
docker compose up app
```

Then check it:

```bash
curl localhost:8080/health
```

You should see a JSON response with "status":"ok" and "storage":"memory".

## Option 2: full stack with Postgres and Redis

```bash
docker compose --profile full up --build
```

This starts three containers: the app in postgres storage mode, a Postgres instance
seeded from `db/init.sql`, and a Redis instance. The app waits for Postgres to be
healthy before it starts.

## Overriding configuration in the container

Every value can be set as an environment variable in `docker-compose.yml` or on the
command line. For example, to point at a managed database and set the real webhook
secret:

```bash
docker compose run -e WNP_STORAGE__DRIVER=postgres \
  -e WNP_STORAGE__POSTGRES__URL=postgresql://user:pass@managed-host:5432/db \
  -e WNP_PAYMENTS__WEBHOOKSECRET=whsec_live_xxx \
  app
```

## A quick end-to-end check inside Docker

With the app running, send a signed payment webhook and read the wallet balance.
This mirrors the functional test and proves signature verification and the ledger
are working.

```bash
BODY='{"id":"evt_demo","event":"payment.captured","payload":{"residentId":"r1","amountPaise":5000}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "change-me-in-config-local-or-env" | awk '{print $2}')
curl -s -X POST localhost:8080/v1/payments/webhook \
  -H "content-type: application/json" \
  -H "x-razorpay-signature: $SIG" \
  -d "$BODY"

curl -s localhost:8080/v1/wallet/r1/balance
```

## Notes on the image

This scaffold runs TypeScript directly with tsx so it is easy to read and run. For
production you would add a compile step and run plain node on the compiled output,
which reduces image size and startup time further. The Dockerfile already runs as a
non root user and defines a health check.
