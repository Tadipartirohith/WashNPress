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

- `app` environment name, host, port, log level, the version and public URL shown in
  the API documentation, and the browser origins allowed to
  call the API. `corsOrigins` defaults to `["*"]` so the local web build works out of
  the box. A wildcard response is never credentialed, so the app authenticates with a
  bearer token rather than the session cookie. In production list the exact origins.
- `storage` chooses `memory` or `postgres`, and the Postgres connection and pool size.
- `cache` chooses `memory` or `redis`, and the Redis connection.
- `auth` OTP length, expiry, attempt limit, resend cooldown, lockout, and session length.
- `payments` provider, currency, webhook signature header, webhook secret, keys, and
  which ways of paying are offered.
- `scheduling` slot windows, default slot capacity, and the booking cutoff.
- `rateLimit` limits for OTP sending and for the general API.
- `notifications` toggles and credentials for SMS, WhatsApp, email, and push.
- `support` the channels a customer can reach a person on.

## Integration references

Every external service is described in configuration so that the platform runs before
any live account exists. When a value is empty, the platform uses a mock that logs
what it would have done, and the tests continue to pass. When you fill in a value, the
matching real provider is used with no code change.

`config/local.example.json` is the worked copy of everything below, with a note on
each block. Copy it to `config/local.json` and fill it in; `local.json` is gitignored,
the example is not, so no real credential belongs in the example.

An `enabled` flag on its own does nothing. Each channel also needs its credentials, and
one that is switched on without them falls back to the recorder — which is the single
most confusing state to be in, because a delivered message and a message appended to an
array in memory look identical from everywhere else in the system.
`GET /v1/admin/integrations` is the one place that says which of the two is happening.
It reports, per channel, whether it is `enabled`, whether it is `live`, and what is
still `missing`, and it never returns a credential's value.

Payments. The section holds the provider name, the gateway base URL, the currency, the
webhook secret, the key id and key secret, and `methods`. The base URL lets you point at
a sandbox during verification. When the key id and key secret are empty a mock provider
is used, which is what the local and test runs use.

The four methods are not four settings of one thing. `card`, `upi` and `netbanking` are
instructions to the gateway and are withheld until it has keys: switching one on with no
key configured is ignored rather than obeyed, because obeying it would put a resident on
a payment page that cannot load. `cash` is a note handed to an operator at the door, needs
no gateway, and is the only method that still works when there is none. `GET
/v1/payments/methods` is what the applications ask, so a phone never has to decide whether
UPI is available. `webhookSecret` is separate from the keys: it verifies inbound webhooks
rather than outbound calls, and has the shorthand `RAZORPAY_WEBHOOK_SECRET`.

Messaging. The notifications section has four channels: sms, whatsapp, email, and push.
Each has an enabled flag, a provider name, and its connection references.

- **sms** goes live on `baseUrl` and `apiKey`. `sender` is the header or short code.
  `templateId` is the DLT registration an Indian operator checks before carrying a
  transactional message; it is omitted from the payload entirely when blank, so a vendor
  that does not use one is never sent an empty field. `provider` is not read.
- **whatsapp** is not sms with a different transport, and `provider` decides which client
  is used. `"cloud"` is Meta's WhatsApp Cloud API and additionally needs `phoneNumberId` —
  the id Meta issues, not your own number — without which the channel stays on the
  recorder. `baseUrl` is the Graph API root with no path, because the provider appends
  `/{phoneNumberId}/messages`. `templateName` should name an approved template: outside
  the twenty-four hours after the customer last wrote, only a template will be delivered,
  so leaving it blank sends free text that is accepted only inside a live conversation.
  Any other `provider` value uses the generic gateway and reads `sender` instead.
- **email** needs `baseUrl`, `apiKey` and `fromAddress`. The From is required rather than
  optional: a transactional email without one is rejected by the gateway, or accepted and
  dropped by the recipient's filter, which is worse because it looks like it worked. The
  notification's title becomes the subject line.
- **push** defaults to Expo, which needs no server key — the device token is itself the
  authorisation to send to that handset, and both applications register against Expo.
  Set `provider` to `"fcm"` and supply `serverKey` only to go to Firebase directly, which
  covers Android alone without a second set of APNs credentials.

Support. The `support` section is contact details rather than a gateway: a phone number,
a WhatsApp number, an address and the hours they are staffed. It is served by
`GET /v1/support/contact`, which is deliberately open — raising a ticket needs an account,
a society and usually an order, so somebody who cannot sign in or whose flat was never
linked has no route through the ticketing at all. A channel left blank is not published
rather than published empty.

One thing to know about numeric settings. The environment reader turns a value that
parses as a number into one, so `PORT=8080` arrives as `8080` rather than `"8080"`. It
does that only when the number round-trips back to the same text, which is what keeps a
nineteen digit DLT template id, a Meta phone number id and a landline with a leading zero
as the strings they are. Without that rule a template id past 2^53 comes back subtly
altered, still validates as a number, and every message is then rejected for quoting a
template that was never registered.

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

## The garment service catalogue

A service is added, edited and retired on its own rather than by resending the whole
catalogue, so introducing one can never drop another by omission.

| Field | Meaning |
| --- | --- |
| `name` | What the resident sees. The id is derived from it when not given |
| `unitPricePaise` | The fallback price per garment |
| `pricesPaise` | Price per garment category. A category left out falls back to `unitPricePaise` |
| `requiresClean` | Whether the garments have to be cleaned |
| `cleanStage` | `wash`, `dry_clean` or `premium` |
| `requiresPress` | Whether the garments have to be ironed |
| `isBase` | The service a plan covers by default. Exactly one, and it cannot be retired |

The processing flags are what let an Iron Only order skip washing entirely. See
[PROCESSING.md](PROCESSING.md).

A service is **retired**, never deleted, because orders already in flight reference it.
Retiring sets `isActive` to false: it disappears from booking and stays readable on the
orders that used it.

## What a plan covers

Each plan carries `coveredServiceIds`, the services it includes at no extra charge. A
garment sent for a service outside that list is priced per garment even while allowance
remains. See [PRICING.md](PRICING.md).

## Where the day ends

`scheduling.serviceDayOffsetMinutes` is how far ahead of UTC the operation's calendar
day runs. It defaults to `330`, which is India.

This matters more than it looks. With the day computed in UTC, an operation in India
finishes its day at half past five the following morning: between midnight and 05:30
the backend still believes it is yesterday, so yesterday's pickup slots stay bookable
and a report run early in the morning quietly means the day before. Everything that
turns a timestamp into a date goes through `serviceDay` in
`src/services/scheduling-service.ts`, so no two parts of the system can disagree.

For an operation somewhere else, set the offset and nothing else changes.

## Pay as you go garment prices

`garmentPricesPaise` on the system config is the price of one garment of each category
for a resident with no plan, before any service charge. A category with no entry falls
back to `nonSubscriberGarmentRatePaise`.

This is deliberately separate from anything to do with subscriptions. Changing a
garment price never alters a plan's allowance or the services it covers, and editing a
plan never moves a garment price. See [PRICING.md](PRICING.md).
