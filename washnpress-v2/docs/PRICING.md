# Subscriptions, pricing and services

Two rules shape everything here:

1. **A subscription is optional.** A resident with no plan can still book, and pays
   an ordinary per garment price. Nothing in the product forces a plan on them.
2. **The operator only ever enters the actual accepted quantity.** Every other number
   is derived by the backend.

## What a resident pays

| | With a plan | Without a plan |
| --- | --- | --- |
| Monthly fee | The plan price | None |
| Garments included | The plan's allowance | None |
| Beyond that | `additionalGarmentRatePaise` each | `nonSubscriberGarmentRatePaise` each, from the first garment |
| Turnaround | The plan's turnaround | The default turnaround |
| Services the plan covers | Included, and they spend allowance | n/a |
| Services the plan does not cover | Charged per garment, and they do not spend allowance | Charged per garment |
| Add-ons | Charged separately | Charged separately |

Both rates are admin configuration, so a change takes effect for the next order
without a deploy. `priceOrder` in `src/domain/pricing.ts` is the whole calculation.

## Services within one order

A garment category is not tied to one service for the whole quantity. A resident can
send four shirts for dry cleaning and six for an ordinary wash in the same order.
Each split is an **order line** carrying its own service, add-ons and price.

```
Shirts × 4  →  Dry Clean and Iron   ₹80 each
Shirts × 6  →  Wash and Iron        included
```

## Price per garment, not per service

A service is priced **per garment category**, because pressing a saree is not pressing
a shirt. Each service carries a `pricesPaise` map, and a category left out of it falls
back to the service's own `unitPricePaise`:

```
Dry Clean and Iron    Shirts ₹80    Sarees ₹250    Jackets ₹180    anything else ₹80
```

Add-ons are priced once per garment in the line.

## What a plan covers

A plan names the services it includes, in `coveredServiceIds`. That decides two things
per garment:

| The garment was sent for | Service charge | Spends allowance |
| --- | --- | --- |
| A service the plan covers | None, the plan absorbs it | Yes |
| A service the plan does not cover | Its own per garment price | No |

So a Basic plan covering *Wash and Iron* and *Wash only* charges nothing for a washed
shirt and takes one off the allowance, while a saree sent for dry cleaning is billed at
₹250 and leaves the allowance untouched — it was never part of what the resident
bought. Sending everything for dry cleaning does not silently consume a month's worth
of a plan that does not include it.

Coverage is recorded on the order line at the moment of booking, so changing the
catalogue or the plan later never rewrites what an order in flight was supposed to
cost. A plan stored before coverage existed is read as covering the ordinary wash and
iron, which is what those plans have always included.

The catalogue is configuration, published at `GET /v1/services` and editable from the
admin config screen, so no client hard codes a price. An unknown or withdrawn service
is refused with `400 unknown_service` — and refused *before* slot capacity is taken,
so a bad request never consumes a slot.

Operations sees the requested splits on the order, which is what lets each garment be
processed the way the resident asked.

## What happens at pickup

The operator enters what they actually received. Then, in one place:

```
accepted            = the quantity the operator entered
subscription covered = min(accepted, remaining allowance)      0 with no plan
additional           = accepted − covered                      all of it with no plan
garment charge       = additional × the applicable rate
services             = the sum of the order lines
total                = garment charge + services
```

Subscription usage is finalised here, from the accepted quantity — never from the
estimate the resident gave when booking. The charge is settled from the wallet if it
covers it; otherwise it stays `pending` and the resident is told, rather than the
pickup being blocked.

Neither the operator nor the resident can supply the covered quantity, the additional
quantity or the charge. They are outputs.

## Where it lives

| Concern | File |
| --- | --- |
| Line building and order pricing | `src/domain/pricing.ts` |
| The allowance split | `src/domain/garments.ts` |
| Applying it at pickup | `src/services/order-service.ts` |
| Quoting before booking | `src/services/scheduling-service.ts`, `GET /v1/pickups/preview` |
| Rates and catalogue | `src/services/system-config-service.ts` |

Tested by `test/unit/pricing.test.ts`, `test/unit/garments.test.ts` and
`test/functional/ordering.dft.test.ts`, and end to end by both smoke tests.
