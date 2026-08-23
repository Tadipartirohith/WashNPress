import { describe, it, expect } from "vitest";
import { canTransitionIssue, resolutionMinutes, ISSUE_TRANSITIONS } from "../../src/services/issue-service";
import type { SupportTicket } from "../../src/domain/models";

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "t1", residentId: "res-1", orderId: null, societyId: "soc-1", areaId: "area-1",
    category: "delivery_issue", description: "Where is my order", status: "open", priority: "normal",
    reportedByUserId: "u1", reportedByRole: "resident", assignedToUserId: null,
    resolution: null, resolvedAt: null, closedAt: null, escalatedToAdmin: false,
    responsibleRole: "operator", escalatedToSupervisor: false,
    messages: [], createdAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

describe("support ticket lifecycle", () => {
  it("moves forward through the documented states", () => {
    expect(canTransitionIssue("open", "in_progress")).toBe(true);
    expect(canTransitionIssue("in_progress", "in_progress")).toBe(true);
    expect(canTransitionIssue("in_progress", "resolved")).toBe(true);
    expect(canTransitionIssue("resolved", "closed")).toBe(true);
  });

  it("lets a resolved ticket go back into progress when the resident is not satisfied", () => {
    expect(canTransitionIssue("resolved", "in_progress")).toBe(true);
  });

  it("treats closed as final", () => {
    expect(ISSUE_TRANSITIONS.closed).toEqual([]);
    for (const state of ["open", "in_progress", "in_progress", "resolved"] as const) {
      expect(canTransitionIssue("closed", state)).toBe(false);
    }
  });

  it("never moves backwards to open", () => {
    for (const state of ["in_progress", "in_progress", "resolved", "closed"] as const) {
      expect(canTransitionIssue(state, "open")).toBe(false);
    }
  });

  it("measures resolution time from raised to settled", () => {
    expect(resolutionMinutes(ticket())).toBeNull();
    expect(resolutionMinutes(ticket({ resolvedAt: "2026-08-20T11:30:00.000Z" }))).toBe(150);
    // A ticket closed without an explicit resolve still reports a time.
    expect(resolutionMinutes(ticket({ closedAt: "2026-08-20T09:45:00.000Z" }))).toBe(45);
  });
});
