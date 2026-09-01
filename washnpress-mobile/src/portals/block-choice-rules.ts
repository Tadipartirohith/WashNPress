// Which towers an operator may be put on.
//
// The assignment step used to compute this as:
//
//   const available = (blocks ?? []).filter(() => Boolean(societyId));
//
// a filter whose predicate never looks at the block. It asks only whether a
// society has been chosen at all, and then passes every block the page happens to
// have loaded. So an admin creating an operator in one society was offered the
// towers of all of them, and two societies that each have a tower called "A"
// produced a list reading "A, A, B" — the same name twice, for two different
// buildings, with nothing on screen to tell them apart.
//
// Kept here rather than in the component so it can be tested without rendering.

export interface BlockOption {
  id: string;
  name: string;
  flatCount?: number;
  societyId?: string;
  status?: string;
}

// The towers of one society, each appearing once, in name order.
//
// A block with no `societyId` is treated as belonging to the society being asked
// about: a supervisor's own screen passes the towers of the one society they run
// and has no reason to stamp each one with it.
export function blocksForSociety(
  blocks: readonly BlockOption[] | undefined,
  societyId: string | undefined,
): BlockOption[] {
  if (!societyId) return [];
  const seen = new Set<string>();
  return (blocks ?? [])
    .filter((b) => (b.societyId ?? societyId) === societyId)
    // An inactive tower is not work anybody can be given.
    .filter((b) => (b.status ?? "active") === "active")
    .filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
