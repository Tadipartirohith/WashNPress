# Bringing the app live locally

There are two supported ways to run it. Both have been tested end to end. Pick one.

## Option A: native Node (no Docker), fastest

Requirements: Node 20 or newer.

```bash
cd washnpress-v2
npm ci              # clean install, about one to two seconds
npm start           # app live on http://localhost:8080
```

In another terminal, confirm it is live and exercise the whole platform:

```bash
curl localhost:8080/health
./scripts/smoke-test.sh          # runs a full end-to-end scenario, expects all PASS
```

Or use the shortcuts:

```bash
make run            # same as npm start
make smoke          # runs the smoke test against localhost:8080
```

## Option B: Docker

Requirements: Docker Desktop (macOS or Windows) or Docker Engine (Linux). If Docker is
not installed, install Docker Desktop from docker.com first, then:

```bash
cd washnpress-v2
docker compose up -d --build app       # app only, in-memory storage, runs in background
# or the full stack with a real database and cache:
docker compose --profile full up -d --build
```

Run in the background with `-d` so your shell is free. Then:

```bash
curl localhost:8080/health
BASE_URL=http://localhost:8080 ./scripts/smoke-test.sh
```

The two app services publish the same host port, so each sits behind its own profile
and they never start together. Naming a service explicitly, as in `up -d app`, enables
its profile automatically.

Stop it with `docker compose --profile lite --profile full down`. View logs with
`docker compose logs -f app` (or `app-full` for the database backed stack).

## Running the app against it

The app is one Expo codebase that opens the portal matching the role that signs in.
The browser build is the quickest way to see all four:

```bash
cd ../washnpress-mobile
npm install
EXPO_PUBLIC_API_URL=http://localhost:8080 npm run web
```

The backend allows browser origins listed in `app.corsOrigins`, which defaults to `*`
for local development. In production set it to the exact origins that serve the app:

```bash
WNP_APP__CORSORIGINS="https://app.example.com,https://admin.example.com"
```

Sign in with any of the seeded demo accounts, which the login screen also offers as
buttons:

| Role | Phone | Opens |
| --- | --- | --- |
| Resident | 9876543210 | Resident portal |
| Operations | 9876500002 | Operations portal, Madhapur societies |
| Supervisor | 9876500011 | Supervisor portal, Madhapur area |
| Admin | 9876500001 | Admin portal, system wide |

The seed also creates a second area, Gachibowli, with its own supervisor (9876500012)
and operator (9876500003), so the area boundary is visible: sign in as the Madhapur
supervisor and the Gachibowli society is neither listed nor reachable by id.

### If port 8080 is already in use

Docker will say `Bind for 0.0.0.0:8080 failed: port is already allocated`. Either free
the port or run on a different one. The host port is configurable:

```bash
# See what is holding port 8080 (macOS/Linux):
lsof -i :8080

# Option 1: stop that process, then retry.
# Option 2: run the app on a different host port and point the smoke test at it:
HOST_PORT=8081 docker compose up -d --build app
BASE_URL=http://localhost:8081 ./scripts/smoke-test.sh
```

Do not run `docker compose up` (foreground) and the smoke test on the same line. In the
foreground `up` blocks the terminal, so the test would run before the app is ready. Use
`-d` as shown, or start the app in one terminal and run the test in another.

## What the smoke test proves

Running `scripts/smoke-test.sh` against a live instance checks the real HTTP surface
end to end: health, resident login by OTP, funding the wallet with a correctly signed
payment webhook, rejecting a forged webhook, subscribing (which debits the wallet),
booking a pickup, the full operator pipeline from pickup through wash, iron, quality
check, out for delivery and delivered, and that a resident is refused admin access.
A clean run prints "RESULT: 9 passed, 0 failed" and exits zero.

## Default logins in the seeded demo

The app seeds a demo society, a unit, plans, add-ons, and three accounts. In local
mode the OTP is returned in the send response as `otpForTesting`, so you never need a
real SMS gateway to log in.

- Resident: phone 9876543210
- Operator: phone 9876500002
- Admin:    phone 9876500001

## A note on this environment versus your machine

The assistant validated the live deployment and the smoke test inside a Linux sandbox
using the native Node path, because that sandbox has no Docker daemon and no root
access. The Docker files are written and corrected, but building an image requires
Docker to be installed on your machine, which is where you would run Option B.


## Full stack with Postgres and Redis (persistent)

```bash
HOST_PORT=8081 docker compose --profile full up -d --build
BASE_URL=http://localhost:8081 ./scripts/smoke-test.sh
```

This runs the app in Postgres storage mode with a real database and Redis. Data now
persists across restarts. The database is initialised from db/init.sql, and the app
also applies the same schema on boot, so either path leaves the tables ready.
