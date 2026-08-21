# How a garment is processed

Every garment is processed according to the service it was sent for. An order that
carries only ironing never goes near a washing machine, and an order carrying dry
cleaning and plain ironing goes through both. The order lifecycle itself is the same
for everyone:

```
Scheduled → Picked Up → processing → QC → Ready → Out for Delivery → Delivered
```

What changes between orders is what "processing" means for that particular batch.

## What a service says about itself

Each entry in the garment service catalogue declares what physically has to happen:

| Field | Meaning |
| --- | --- |
| `requiresClean` | The garments have to be cleaned before anything else |
| `cleanStage` | `wash`, `dry_clean` or `premium` — how they are cleaned, and what the stage is called |
| `requiresPress` | The garments have to be ironed |

The seeded catalogue:

| Service | Cleaning | Ironing |
| --- | --- | --- |
| Wash and Iron | Wash | Yes |
| Wash only | Wash | No |
| Iron only | — | Yes |
| Dry Clean and Iron | Dry clean | Yes |
| Premium care | Premium | Yes |

These are configuration, not code. An admin adding *Starch and Press* says whether it
needs cleaning and whether it needs ironing, and orders carrying it route themselves
from that moment on.

## What an order has to go through

An order's requirement is the **union** of what its lines need, computed in
`src/domain/processing.ts`:

```
Shirts × 4  →  Dry Clean and Iron   needs cleaning (dry clean) and ironing
Shirts × 6  →  Iron only            needs ironing only
                                    ─────────────────────────────────────
order:                              dry clean, then iron
```

When an order mixes services, the cleaning stage is named after the most specialised
one present — premium, then dry clean, then wash — because that is what dictates how
the batch is physically handled. An order carrying both dry cleaning and an ordinary
wash reads as **Dry Cleaning** throughout.

## What the operator is offered

`allowedNext(state, requirement)` narrows the state machine to the stages this batch
actually needs, and the order detail returns it as `nextActions`. The operations
portal renders those buttons and nothing else, so the wrong action is never on screen:

| Order | At Picked Up | Then |
| --- | --- | --- |
| Iron only | Start Ironing | Complete Ironing → QC |
| Wash only | Start Wash | Complete Wash → QC |
| Wash and Iron | Start Wash | Complete Wash → Start Ironing → Complete Ironing → QC |
| Dry Clean and Iron | Start Dry Clean | Complete Dry Clean → ironing → QC |

The buttons are a convenience, not the rule. `OrderService.apply` checks the same
requirement, so an Iron Only order sent to `POST /v1/operations/orders/:id/wash/start`
by any other client is refused with `409 illegal_transition`. A held batch coming back
from a failed QC is bound by the same rule, so it cannot be reprocessed through a
stage its garments never needed.

**QC is only reachable once every stage the garments need is done.** There is no path
from Picked Up to QC for an order that still has to be washed.

## What the resident sees

The tracking timeline is built from that same requirement, so it lists only the stages
this order goes through. An Iron Only order shows:

```
Scheduled → Picked Up → Ironing → QC → Ready → Out for Delivery → Delivered
```

with no washing step to sit at "pending" forever. A dry cleaning order shows its
cleaning stage as **Dry Cleaning** rather than "Washing".

The operations order detail also carries a per line checklist under `processing.lines`,
so the operator can see that four of the shirts are being dry cleaned and pressed while
six others are only being ironed.

## Orders that predate this

An order with no recorded lines — booked before per line services existed — keeps the
original full wash and iron path. A service stored without the processing flags is
filled in from the built-in catalogue when it is read, and an unknown one is assumed
to need both stages. Nothing already in flight can become unable to move.
