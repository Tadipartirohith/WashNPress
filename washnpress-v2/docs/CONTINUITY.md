# Staff availability and continuity

Employee availability must not be a single point of failure. Nobody is ever deleted,
no area loses its data when its supervisor leaves, and no order gets stuck behind one
person being unavailable.

## Account states

| Status | Can sign in | Holds work | Meaning |
| --- | :-: | :-: | --- |
| `active` | yes | yes | On duty |
| `on_leave` | no | no | Temporarily unavailable; the account and its history stay |
| `blocked` | no | no | Deactivated |

`on_leave` and `blocked` differ only in intent, and both end any live session: a
session is re-checked against the account on every request, so taking somebody off
duty stops them working immediately rather than at the end of their session. Coming
back is a single call with `status: active`.

Deleting a staff account is not an operation the API offers.

## When an operator goes off duty

`POST /v1/supervisor/operators/:id/availability` (or the admin equivalent) does the
whole thing in one step:

1. The account is marked, never removed.
2. Everything they still hold is found: `openWorkFor` is every order assigned to them
   that is not delivered, cancelled or disputed.
3. Each order is either handed to a named replacement or returned to the shared queue.
4. Every move is written to the audit log with the previous and the new holder.
5. The supervisors for the area are notified.

Reassignment never touches the order's state or its history. A batch that was mid
wash is still mid wash; only the name against it changes. The timeline gains an entry
saying it was reassigned, so the handover is visible rather than silent.

`GET /v1/supervisor/operators/:id/handover` shows what they are holding and who could
take it, so the decision is made with the facts in view.

### The shared queue

An order with no operator is not stranded. It appears in `GET /v1/operations/queue`
for every operator in the area, and any of them can take it with
`POST /v1/operations/orders/:id/claim`. Claiming picks the order up exactly where it
was left.

A replacement must be an active operator in the same area; anything else is refused
with `409 handover_failed` rather than quietly leaving the work unassigned.

## When a supervisor goes off duty

The area is the unit of organisation, and it survives the person. Deactivating a
supervisor leaves the area, its societies, residents, slots, orders, subscriptions
and history exactly as they were.

While the area has no active supervisor, the admin covers it. `GET /v1/admin/coverage`
lists the areas in that position, and the admin dashboard shows them at the top.
Admin can do the supervisor's job in the meantime, on any area:

- create, edit and cancel pickup slots
- create and edit societies
- create and reassign operations staff
- assign and reassign orders
- read and resolve the area's support tickets

Assigning a new supervisor is a single call. They inherit the area immediately,
because scope is derived from the area on their account rather than from anything
copied at creation time. Historical audit entries keep the previous supervisor's name:
what happened is not rewritten when who is responsible changes.

## Where it lives

| Concern | File |
| --- | --- |
| Availability, handover, coverage | `src/services/staffing-service.ts` |
| Reassignment on the order | `src/services/order-service.ts` (`assignOperator`, `openWorkFor`) |
| Supervisor endpoints | `src/app/routes/supervisor.ts` |
| Admin cover endpoints | `src/app/routes/admin.ts` |
| Shared queue and claim | `src/app/routes/operations.ts` |

Tested by `test/functional/staffing.dft.test.ts`, and end to end by both smoke tests.
