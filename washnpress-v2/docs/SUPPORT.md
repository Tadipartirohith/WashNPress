# Customer support

A resident should never have to argue with an operator to get something put right.
Every question, complaint and dispute goes onto a ticket, the supervisor for that
area works it, and admin sees the whole picture.

## Who does what

```
Resident   raises the ticket, adds to it, and closes it when satisfied
Supervisor first line for their own area: investigates, replies, resolves, escalates
Operations supplies operational facts on an order; does not resolve tickets
Admin      sees every ticket, can reply and resolve, and receives escalations
```

An operator can read a ticket that belongs to a society they work, because they are
often the person who knows what happened. They cannot change its status: resolving is
the supervisor's job, so a dispute is never settled by the person it is about.

## The lifecycle

```
Open → Assigned → In Progress → Resolved → Closed
```

- **Open** is where a new ticket starts.
- **Assigned** means somebody owns it but has not started.
- **In Progress** is set explicitly, and also automatically the first time a
  supervisor replies, because replying is starting work.
- **Resolved** records a resolution note. The resident is notified.
- **Closed** is final and is the resident's decision. Nothing can be added afterwards.

Two transitions are deliberate:

- **Resolved can go back to In Progress.** If the resident replies to a resolved
  ticket, the person who raised it is saying it is not fixed, so it reopens.
- **Nothing goes back to Open**, and nothing comes back from Closed.

`ISSUE_TRANSITIONS` in `src/services/issue-service.ts` is the single definition, and
an illegal move returns `409 illegal_ticket_transition` rather than being applied.

## Priority and emergencies

`low`, `normal`, `high`, `emergency`. A resident can raise a ticket as an emergency,
which sorts it to the top of the supervisor's queue, sends a distinct notification,
and shows on the admin dashboard as its own count. Escalating a ticket to admin also
raises its priority.

Lists are ordered by priority first and age second, so the queue reads as a work list
rather than a log.

## Escalation

A supervisor escalates with a note when something needs a decision above them. The
ticket stays with the supervisor as well: escalation adds admin, it does not hand the
problem over. The note is appended to the conversation so the reason is on the record.

## What admin sees

`GET /v1/admin/issues/analytics` reports:

- volumes by status, plus pending, emergency, escalated and order related counts
- average resolution time, measured from raised to resolved or closed
- breakdowns by area, society, supervisor, category and priority
- the oldest tickets still waiting, which is where a queue goes wrong first

## Notifications

The other side is told whenever something happens: the supervisor when a resident
raises or replies, the resident when support replies or resolves. All of it also
lands in the in-app notification feed, so nothing depends on a push being delivered.

## Where it lives

| Concern | File |
| --- | --- |
| Lifecycle, transitions, analytics | `src/services/issue-service.ts` |
| Resident endpoints | `src/app/routes/support.ts` |
| Supervisor endpoints | `src/app/routes/supervisor.ts` |
| Admin endpoints | `src/app/routes/admin.ts` |
| Shared UI | `../washnpress-mobile/src/components/support.tsx` |

Tested by `test/unit/issue-lifecycle.test.ts` and
`test/functional/support.dft.test.ts`, and end to end by both smoke tests.
