# Roles and access control

The platform has four roles. Each one sees a different portal, and the boundary
between them is enforced by the backend, not by the app. A valid session for the
wrong area gets the same answer as a session asking for something that does not
exist, so probing an id cannot confirm it exists somewhere else.

## The hierarchy

```
Admin  (system wide)
  └── Area            one responsible Supervisor
        └── Society   many per area
              ├── Residents
              └── Operations staff
```

- An **Admin** is never restricted to an area.
- A **Supervisor** is created by an admin and assigned to exactly one area. Moving
  them to another area releases the previous one, so an area always has at most one
  responsible supervisor and a supervisor never holds two.
- An **Operations** user is created by a supervisor inside their own area and works
  the societies they are assigned to.
- A **Resident** belongs to one society and only ever sees their own data.

## Where the rule lives

`src/domain/access.ts` turns a session into a scope, and `src/services/access-service.ts`
resolves that scope against the store. Route handlers call `requireOrder`,
`requireSociety` or `visibleOrders` rather than filtering by hand, so the boundary is
applied identically on list endpoints and on direct lookups by id.

A supervisor cannot widen their own scope by supplying an `areaId` in a request body:
where an area is needed it is read from the session. The same applies to an operator
and their societies, and to a resident and their own record.

## What each role can do

| Capability | Admin | Supervisor | Operations | Resident |
| --- | :-: | :-: | :-: | :-: |
| System wide dashboard | yes | no | no | no |
| Create and edit areas | yes | no | no | no |
| Assign or change an area's supervisor | yes | no | no | no |
| Create supervisors | yes | no | no | no |
| Create operations staff | yes | own area | no | no |
| Create societies | yes | own area | no | no |
| Activate or deactivate any user | yes | own area operators | no | no |
| Manage pickup slots | yes | own area | no | no |
| Global subscription plans | yes | no | no | no |
| Global system configuration | yes | no | no | no |
| View orders | all | own area | assigned societies | own only |
| Record garment quantities | no | no | yes | no |
| Move an order through processing | no | no | yes | no |
| Record a QC result | no | no | yes | no |
| Resolve an issue | yes | own area | report only | raise only |
| Escalate an issue to admin | n/a | yes | no | no |
| Reports | system wide | own area | no | no |
| Audit log | yes | no | no | no |

## What a role explicitly cannot do

A **Supervisor** cannot create another supervisor or an admin, change their own area,
read another area's societies, residents, orders or operators, alter global plans or
system configuration, or reach any admin route.

An **Operations** user cannot create areas, supervisors, societies or slots, change a
resident's subscription or allowance, set the subscription usage or the additional
charge by hand, or see an order outside their assigned societies.

A **Resident** cannot see another resident's orders, wallet or subscription, change an
order's status, alter the quantities recorded by operations, or reach any staff route.
They cannot move themselves between societies: that is an admin or supervisor action.

## Deactivation takes effect immediately

A session is only as valid as the account behind it. `sessionFromToken` re-checks the
user on every request, so blocking an account ends its live sessions at once rather
than at the end of the session lifetime.

## Verifying it

`test/unit/access.test.ts` covers the scope rules in isolation.
`test/functional/rbac.dft.test.ts` drives the real API with a valid session for the
wrong area and asserts the refusal, including direct lookup by id and search. The
smoke tests repeat the key checks against a running instance.
