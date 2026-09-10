import type { OperationsDashboard } from "../api/types";

// What each tab in the operator's bar has to say for itself.
//
// The web portal puts a count on four of its tabs — pickups waiting, orders in
// flight, orders free to claim, issues open — so an operator can see where the work
// is without opening anything. Mobile had the capability and never passed a number,
// so the same operator on a phone had to visit four tabs to learn what the browser
// told them at a glance.
//
// The bar holds five tabs against the web portal's eight, which is the one thing
// that cannot be copied across directly. Claimable lives behind "More" on a phone,
// so its count is rolled up: a number that only appears once you have already tapped
// through is a number that has failed at its job.

export type OperationsBadgeTab = "pickups" | "active" | "claimable" | "issues";

export type BadgeMap<T extends string> = Partial<Record<T, number>>;

// A count worth interrupting somebody for.
//
// Zero is deliberately absent rather than shown as "0". A bar wearing four zeroes
// teaches the eye that the badges mean nothing, which costs more than it tells —
// and it is the state an operator is in most of the day.
function live(count: number | null | undefined): number | undefined {
  return typeof count === "number" && count > 0 ? count : undefined;
}

export function operationsBadges(
  dashboard: OperationsDashboard | null | undefined,
  claimable: number | null | undefined,
): BadgeMap<OperationsBadgeTab> {
  const badges: BadgeMap<OperationsBadgeTab> = {};
  // Named individually rather than assigned in a loop: each one is a different
  // question, and the web portal chose these four fields specifically. `orders.active`
  // is what is in flight, not `orders.total`; `issues.pending` is what is waiting on
  // somebody, not `issues.total`.
  const pickups = live(dashboard?.pickups?.pending);
  const active = live(dashboard?.orders?.active);
  const issues = live(dashboard?.issues?.pending);
  const free = live(claimable);

  if (pickups !== undefined) badges.pickups = pickups;
  if (active !== undefined) badges.active = active;
  if (issues !== undefined) badges.issues = issues;
  if (free !== undefined) badges.claimable = free;
  return badges;
}

// What "More" shows: everything the bar could not.
//
// Summed rather than counted, because the badge answers "how much is behind here",
// and a bare dot would make an operator open the sheet to find out whether it was
// one claimable order or eleven.
export function moreBadge<T extends string>(
  badges: BadgeMap<T>,
  // The keys the bar is showing. Deliberately wider than the badged keys: a bar
  // holds tabs that never carry a number — a dashboard, "More" itself — and this
  // only asks whether a key is visible.
  primary: readonly string[],
): number | undefined {
  const hidden = (Object.keys(badges) as T[])
    .filter((key) => !primary.includes(key))
    .reduce((total, key) => total + (badges[key] ?? 0), 0);
  return hidden > 0 ? hidden : undefined;
}
