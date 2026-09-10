import { describe, it, expect } from "vitest";
import type { OperationsDashboard } from "../src/api/types";
import { moreBadge, operationsBadges } from "../src/portals/operations-badge-rules";

// The web operator portal puts a count on four tabs — pickups waiting, orders in
// flight, orders free to claim, issues open. Mobile's tab bar has supported a badge
// the whole time and no portal but the resident's ever passed one, so an operator on
// a phone had to open four tabs to learn what the browser said at a glance.
//
// Web is the source of truth under I-72, which is also why supervisor and admin are
// left alone here: neither web portal badges its tabs, and adding it on mobile would
// be exactly the sort of mobile-only extra the parity commits have been removing.

const dash = (over: Partial<OperationsDashboard> = {}) => ({
  pickups: { today: 4, pending: 3, completed: 1, failed: 0 },
  orders: { active: 7, pending: 2, total: 40 },
  issues: { pending: 2, open: 5, total: 9 },
  ...over,
}) as unknown as OperationsDashboard;

describe("what the operator's tabs say", () => {
  it("carries the same four counts the web portal does", () => {
    expect(operationsBadges(dash(), 5)).toEqual({
      pickups: 3, active: 7, issues: 2, claimable: 5,
    });
  });

  it("reads the field the web portal picked, not the nearest neighbour", () => {
    // `orders.active` is what is in flight; `orders.total` is the history of the
    // society. A badge showing 40 on a quiet morning is the bug this prevents.
    const badges = operationsBadges(dash(), 0);
    expect(badges.active).toBe(7);
    expect(badges.active).not.toBe(40);
    expect(badges.issues).toBe(2);
    expect(badges.issues).not.toBe(9);
  });

  it("says nothing at all when there is nothing waiting", () => {
    // The state an operator is in most of the day. A bar wearing four zeroes teaches
    // the eye that the badges mean nothing.
    const quiet = dash({
      pickups: { today: 0, pending: 0, completed: 4, failed: 0 },
      orders: { active: 0, pending: 0, total: 40 },
      issues: { pending: 0, open: 0, total: 9 },
    } as Partial<OperationsDashboard>);
    expect(operationsBadges(quiet, 0)).toEqual({});
  });

  it("shows nothing rather than guessing before the dashboard arrives", () => {
    expect(operationsBadges(null, null)).toEqual({});
    expect(operationsBadges(undefined, undefined)).toEqual({});
  });

  it("still badges what it does know when half the answer is missing", () => {
    // The queue and the dashboard are two requests; one can land first, or fail.
    expect(operationsBadges(null, 4)).toEqual({ claimable: 4 });
    expect(operationsBadges(dash(), null).claimable).toBeUndefined();
  });

  it("survives a dashboard that is missing the counts entirely", () => {
    // An older backend, or a partial payload. Reading `.pending` off undefined is
    // what would take the whole portal down rather than lose a badge.
    expect(() => operationsBadges({} as OperationsDashboard, 1)).not.toThrow();
    expect(operationsBadges({} as OperationsDashboard, 1)).toEqual({ claimable: 1 });
  });
});

describe("what More has to say", () => {
  const primary = ["home", "pickups", "active", "issues"] as const;

  it("adds up only what the bar could not show", () => {
    // Claimable is the one badged tab that does not fit in five slots.
    const badges = operationsBadges(dash(), 5);
    expect(moreBadge(badges, primary)).toBe(5);
  });

  it("stays silent when everything with a count is already visible", () => {
    // Nothing is hidden, so More has nothing to add — a badge here would be a
    // duplicate of numbers already on screen.
    const badges = operationsBadges(dash(), 0);
    expect(moreBadge(badges, primary)).toBeUndefined();
  });

  it("sums rather than dots, so the sheet does not have to be opened to find out", () => {
    expect(moreBadge({ claimable: 3, history: 2 }, primary as readonly string[])).toBe(5);
  });

  it("is silent when there is nothing anywhere", () => {
    expect(moreBadge({}, primary)).toBeUndefined();
  });
});
