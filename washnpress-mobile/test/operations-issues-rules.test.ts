import { describe, it, expect } from "vitest";
import {
  CREATE_ISSUE_ENDPOINT, ISSUE_PRIORITIES, canRaiseIssue, createIssuePayload,
  createIssueRequest, issueTypeLabel,
} from "../src/portals/operations-issues-rules";

describe("create issue matches Web CreateIssueModal", () => {
  it("omits Order ID when it is blank", () => {
    expect(createIssuePayload({
      type: "other", description: "Bag left at gate", priority: "normal", orderId: "",
    })).toEqual({
      type: "other", description: "Bag left at gate", orderId: undefined, priority: "normal",
    });
    expect(createIssuePayload({
      type: "other", description: "Bag left at gate", priority: "normal", orderId: "   ",
    }).orderId).toBeUndefined();
  });

  it("sends a trimmed Order ID when one is given", () => {
    expect(createIssuePayload({
      type: "missing_item", description: "One shirt short", priority: "high", orderId: "  ord-9  ",
    })).toEqual({
      type: "missing_item", description: "One shirt short", orderId: "ord-9", priority: "high",
    });
  });

  it("requires a type and a non-empty description", () => {
    expect(canRaiseIssue({ type: "", description: "x" })).toBe(false);
    expect(canRaiseIssue({ type: "other", description: "   " })).toBe(false);
    expect(canRaiseIssue({ type: "other", description: "x" })).toBe(true);
  });

  it("trims the description and defaults priority the way Web does", () => {
    expect(createIssuePayload({ type: "other", description: "  wet bag  " })).toEqual({
      type: "other", description: "wet bag", orderId: undefined, priority: "normal",
    });
  });

  it("POSTs /v1/operations/issues with Web's body keys", () => {
    const req = createIssueRequest({
      type: "damage", description: "Zip broken", priority: "low", orderId: "ord-1",
    });
    expect(req).toEqual({
      method: "POST",
      path: CREATE_ISSUE_ENDPOINT,
      body: { type: "damage", description: "Zip broken", orderId: "ord-1", priority: "low" },
    });
    expect(CREATE_ISSUE_ENDPOINT).toBe("/v1/operations/issues");
    expect(ISSUE_PRIORITIES.map((p) => p.key)).toEqual(["low", "normal", "high"]);
    expect(issueTypeLabel("pickup_failed")).toBe("pickup failed");
  });
});
