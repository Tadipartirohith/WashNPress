import { describe, it, expect } from "vitest";
import type { SupportTicket } from "../../src/domain/models";
import {
  replyRight, replyRecipient, replyLabel, unreadCount, markRead,
  previewOf, latestMessage, conversationFor, roleLabel,
} from "../../src/domain/issue-conversation";

// An issue is a conversation. The messages were always there and so were the system
// events; what was missing was everything around them — who may still speak, who a
// reply is addressed to, and what has been read. Without those the screens guessed,
// and they guessed the same way every time: a fixed "Answer the Resident" box that
// anybody could type into however long ago the issue had left them.

function ticket(over: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "iss-1", residentId: "res-1", orderId: null, societyId: "soc-1", areaId: "area-1",
    category: "missing_garment", description: "A shirt is missing",
    status: "in_progress", priority: "normal",
    reportedByUserId: "user-res", reportedByRole: "resident",
    assignedToUserId: null, resolution: null, resolvedAt: null, closedAt: null,
    escalatedToAdmin: false, escalatedToSupervisor: false,
    responsibleRole: "operator",
    messages: [], createdAt: "2026-03-01T09:00:00.000Z",
    ...over,
  } as SupportTicket;
}

const resident = { userId: "user-res", roles: ["resident" as const], residentId: "res-1" };
const operator = { userId: "user-op", roles: ["operator" as const], residentId: null };
const supervisor = { userId: "user-sup", roles: ["supervisor" as const], residentId: null };
const admin = { userId: "user-admin", roles: ["admin" as const], residentId: null };

describe("who may still speak", () => {
  it("lets the operator answer an issue that is theirs", () => {
    expect(replyRight(ticket(), operator).canReply).toBe(true);
  });

  it("silences the operator once they escalate it", () => {
    // The rule the requirements care about most: two people answering the same
    // resident at once is how a resident gets two different answers.
    const escalated = ticket({ responsibleRole: "supervisor", status: "escalated_supervisor" });
    const right = replyRight(escalated, operator);
    expect(right.canReply).toBe(false);
    expect(right.reason).toMatch(/currently with the supervisor/);
    expect(right.reason).toMatch(/read the conversation but not add to it/);
  });

  it("lets the supervisor it went to carry on the same conversation", () => {
    const escalated = ticket({ responsibleRole: "supervisor", status: "escalated_supervisor" });
    expect(replyRight(escalated, supervisor).canReply).toBe(true);
  });

  it("silences the supervisor in turn once it reaches the admin", () => {
    const toAdmin = ticket({ responsibleRole: "admin", status: "escalated_admin" });
    expect(replyRight(toAdmin, supervisor).canReply).toBe(false);
    expect(replyRight(toAdmin, admin).canReply).toBe(true);
  });

  it("does not let seniority block help", () => {
    // A supervisor stepping into an issue their operator is handling is exactly what
    // a supervisor is for. The rule is about handing an issue up, not about rank.
    expect(replyRight(ticket({ responsibleRole: "operator" }), supervisor).canReply).toBe(true);
    expect(replyRight(ticket({ responsibleRole: "operator" }), admin).canReply).toBe(true);
  });

  it("always lets the resident who raised it add to it", () => {
    expect(replyRight(ticket({ responsibleRole: "admin" }), resident).canReply).toBe(true);
  });

  it("lets the resident dispute a resolution, which is how it gets reopened", () => {
    const resolved = ticket({ status: "resolved" });
    expect(replyRight(resolved, resident).canReply).toBe(true);
    // Staff cannot: for them a resolved issue is read-only history.
    const staff = replyRight(resolved, operator);
    expect(staff.canReply).toBe(false);
    expect(staff.reason).toMatch(/read-only unless the resident reopens it/);
  });

  it("closes the conversation to everybody once the issue is closed", () => {
    const closed = ticket({ status: "closed" });
    expect(replyRight(closed, resident).canReply).toBe(false);
    expect(replyRight(closed, admin).canReply).toBe(false);
    expect(replyRight(closed, resident).reason).toMatch(/kept as history/);
  });

  it("refuses somebody the issue has nothing to do with", () => {
    const stranger = { userId: "user-other", roles: ["resident" as const], residentId: "res-2" };
    expect(replyRight(ticket(), stranger).canReply).toBe(false);
  });
});

describe("who a reply is addressed to", () => {
  it("answers the resident when staff are holding it", () => {
    expect(replyRecipient(ticket(), operator)).toBe("resident");
    expect(replyLabel(replyRecipient(ticket(), operator))).toBe("Reply to Resident");
  });

  it("answers the operator when the supervisor is waiting on them", () => {
    // "Answer the Resident" was written into the screen, so a supervisor asking their
    // operator for information was told they were answering the resident.
    const waiting = ticket({ status: "waiting_operator", responsibleRole: "supervisor" });
    expect(replyRecipient(waiting, supervisor)).toBe("operator");
    expect(replyLabel(replyRecipient(waiting, supervisor))).toBe("Reply to Operator");
  });

  it("answers the resident when they are the ones being waited on", () => {
    const waiting = ticket({ status: "waiting_resident" });
    expect(replyRecipient(waiting, supervisor)).toBe("resident");
  });

  it("sends a resident's message to whoever holds the issue", () => {
    expect(replyRecipient(ticket({ responsibleRole: "operator" }), resident)).toBe("operator");
    expect(replyLabel(replyRecipient(ticket({ responsibleRole: "supervisor" }), resident))).toBe("Reply to Supervisor");
    expect(replyLabel(replyRecipient(ticket({ responsibleRole: "admin" }), resident))).toBe("Reply to Admin");
  });

  it("sends it up the chain where nobody raised it", () => {
    const staffRaised = ticket({ residentId: null, reportedByRole: "operator", responsibleRole: "supervisor" });
    expect(replyRecipient(staffRaised, supervisor)).toBe("supervisor");
  });
});

describe("what has been read", () => {
  const withMessages = () => ticket({
    messages: [
      { author: "user-res", authorRole: "resident", body: "A shirt is missing", at: "2026-03-01T09:00:00.000Z" },
      { author: "user-op", authorRole: "operator", body: "Checking now", at: "2026-03-01T10:00:00.000Z" },
      { author: "user-op", authorRole: "system", body: "Escalated to supervisor.", at: "2026-03-01T11:00:00.000Z" },
    ],
  });

  it("counts everything as unread before anybody looks", () => {
    expect(unreadCount(withMessages(), "user-sup")).toBe(3);
  });

  it("never counts a person's own messages against them", () => {
    expect(unreadCount(withMessages(), "user-op")).toBe(1);
    expect(unreadCount(withMessages(), "user-res")).toBe(2);
  });

  it("counts only what arrived since somebody last looked", () => {
    const seen = markRead(withMessages(), "user-sup", "2026-03-01T10:30:00.000Z");
    expect(unreadCount(seen, "user-sup")).toBe(1);
  });

  it("keeps read state per person rather than per issue", () => {
    const seen = markRead(withMessages(), "user-sup", "2026-03-01T12:00:00.000Z");
    expect(unreadCount(seen, "user-sup")).toBe(0);
    // The supervisor reading it says nothing about whether the resident has.
    expect(unreadCount(seen, "user-res")).toBe(2);
  });
});

describe("what a list row shows", () => {
  it("shows the last thing said rather than the description", () => {
    const t = ticket({
      messages: [
        { author: "user-res", authorRole: "resident", body: "A shirt is missing", at: "2026-03-01T09:00:00.000Z" },
        { author: "user-op", authorRole: "operator", body: "Coming, wait for 10 minutes", at: "2026-03-01T10:00:00.000Z" },
      ],
    });
    expect(previewOf(t)).toBe("Operator: Coming, wait for 10 minutes");
    expect(latestMessage(t)?.body).toBe("Coming, wait for 10 minutes");
  });

  it("shows a system line without attributing it to anybody", () => {
    const t = ticket({ messages: [{ author: "user-op", authorRole: "system", body: "Escalated to supervisor.", at: "2026-03-01T11:00:00.000Z" }] });
    expect(previewOf(t)).toBe("Escalated to supervisor.");
  });

  it("falls back to the description on an issue nobody has answered", () => {
    expect(previewOf(ticket())).toBe("A shirt is missing");
  });

  it("shortens a long message rather than letting it run", () => {
    const long = "x".repeat(200);
    const t = ticket({ messages: [{ author: "user-op", authorRole: "operator", body: long, at: "2026-03-01T10:00:00.000Z" }] });
    expect(previewOf(t).length).toBeLessThanOrEqual(80);
    expect(previewOf(t).endsWith("…")).toBe(true);
  });
});

describe("the conversation as one person sees it", () => {
  const full = () => ticket({
    responsibleRole: "supervisor",
    status: "escalated_supervisor",
    messages: [
      { author: "user-res", authorRole: "resident", body: "Okay, I am waiting", at: "2026-03-01T09:00:00.000Z" },
      { author: "user-op", authorRole: "operator", body: "Coming, wait for 10 minutes", at: "2026-03-01T10:00:00.000Z" },
      { author: "user-op", authorRole: "system", body: "Escalated to supervisor.", at: "2026-03-01T11:00:00.000Z" },
      { author: "user-sup", authorRole: "supervisor", body: "I am reviewing the issue", at: "2026-03-01T12:00:00.000Z" },
    ],
  });

  it("puts a person's own messages on one side and everybody else's on the other", () => {
    const view = conversationFor(full(), operator);
    expect(view.messages.map((m) => m.side)).toEqual(["theirs", "mine", "system", "theirs"]);
  });

  it("keeps the system in the middle, belonging to nobody", () => {
    const view = conversationFor(full(), resident);
    const system = view.messages.find((m) => m.system)!;
    expect(system.side).toBe("system");
    expect(system.authorName).toBeNull();
  });

  it("is in the order it happened, always", () => {
    const scrambled = full();
    scrambled.messages.reverse();
    const view = conversationFor(scrambled, supervisor);
    expect(view.messages.map((m) => m.at)).toEqual([...view.messages.map((m) => m.at)].sort());
  });

  it("tells the operator who escalated it that they may read but not write", () => {
    const view = conversationFor(full(), operator);
    expect(view.canReply).toBe(false);
    expect(view.readOnlyReason).toMatch(/currently with the supervisor/);
    // The whole conversation is still there. Escalation hides nothing.
    expect(view.messages).toHaveLength(4);
  });

  it("tells the supervisor they may carry on, and who to", () => {
    const view = conversationFor(full(), supervisor);
    expect(view.canReply).toBe(true);
    expect(view.replyLabel).toBe("Reply to Resident");
  });

  it("names the people who spoke, where it knows them", () => {
    const names = new Map([["user-op", "Operator 01"], ["user-sup", "Ravi Kumar"]]);
    const view = conversationFor(full(), resident, names);
    expect(view.messages[1].authorName).toBe("Operator 01");
    expect(view.messages[3].authorName).toBe("Ravi Kumar");
  });

  it("says how much is unread and what the last thing said was", () => {
    const view = conversationFor(full(), supervisor);
    expect(view.unreadCount).toBe(3);
    expect(view.lastMessageAt).toBe("2026-03-01T12:00:00.000Z");
    expect(view.preview).toBe("Supervisor: I am reviewing the issue");
  });
});

describe("roles read as words", () => {
  it("says what a role is called rather than its key", () => {
    expect(roleLabel("supervisor")).toBe("Supervisor");
    expect(roleLabel("system")).toBe("System");
    expect(roleLabel(null)).toBe("Unknown");
  });
});
