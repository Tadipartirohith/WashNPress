import type { Block, User } from "./models";

// Who collects an order, decided by the tower it is collected from.
//
// The chain the whole platform is built on ends
// `Resident → Society → Tower/Block → Assigned operator → Order`, and until now the
// last arrow was missing. An order was created with no operator on it and stayed
// that way until somebody opened the Pickups page and claimed it, so a screen that
// knew perfectly well which operator covers Tower B still printed "Unassigned"
// beside an order from Tower B.
//
// The mapping already exists — a block names its operators — so the assignment is
// not a decision anybody has to make, it is a lookup. This module is that lookup,
// and it does no I/O so the rule can be read on its own.

// Never by society. Two towers of the same society routinely have different
// operators, so falling back to "somebody in this society" would hand the order to
// whoever happened to be first in the list and be wrong about half the time.
// An order whose tower has nobody on it stays unassigned, and a supervisor assigns
// it by hand — which is a real state, not a failure.
export function operatorForBlock(
  block: Block | null | undefined,
  candidates: Map<string, User> | ((id: string) => User | null | undefined),
): string | null {
  if (!block) return null;
  const lookup = typeof candidates === "function" ? candidates : (id: string) => candidates.get(id);
  const covering = (block.operatorUserIds ?? [])
    .map((id) => lookup(id))
    .filter((u): u is User => Boolean(u) && canTakeWork(u!));
  if (!covering.length) return null;
  // Somebody on duty before somebody on leave: both keep the block, because the
  // assignment is what gets handed over when they go, but a new order should not
  // land on the one who is away when a colleague covers the same tower.
  const onDuty = covering.find((u) => u.status === "active");
  return (onDuty ?? covering[0]).id;
}

// A blocked or deleted account is not an operator any more, whatever the block
// still says about it.
export function canTakeWork(user: User): boolean {
  if (!user.roles.includes("operator")) return false;
  if (user.status === "blocked" || user.status === "deleted") return false;
  return (user.verificationStatus ?? "approved") === "approved";
}
