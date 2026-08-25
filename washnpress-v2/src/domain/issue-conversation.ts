import type { Role, SupportTicket, IssueMessage, IssueStatus } from "./models";

// An issue is a conversation.
//
// The messages were always there, and so were the system events — an escalation
// already wrote "Escalated to supervisor." into the same list. What was missing was
// everything around them: who may still speak, who a reply is actually addressed to,
// what has been read, and what the last thing said was. Without those the screens had
// to guess, and they guessed the same way every time: a fixed "Answer the Resident"
// box that anybody could type into, however long ago the issue had left them.

export type ConversationRole = Role | "system";

// Where the message sits, which is what makes a chat readable at a glance. A person's
// own messages on one side, the other party's on the other, and the system in the
// middle belonging to nobody.
export type MessageSide = "mine" | "theirs" | "system";

export interface ConversationMessage {
  author: string;
  authorRole: ConversationRole | null;
  authorName: string | null;
  body: string;
  at: string;
  side: MessageSide;
  system: boolean;
  // Whether this arrived after the viewer last looked.
  unread: boolean;
}

export const ROLE_LABELS: Record<string, string> = {
  resident: "Resident",
  operator: "Operator",
  supervisor: "Supervisor",
  admin: "Admin",
  support: "Support",
  system: "System",
};

export function roleLabel(role: string | null | undefined): string {
  return role ? ROLE_LABELS[role] ?? role : "Unknown";
}

// ------------------------------------------------------------- who may speak

// The rungs, so "the operator who escalated to the supervisor" can be told apart from
// "the supervisor the issue is now with".
const RUNG: Record<string, number> = { operator: 1, supervisor: 2, admin: 3 };

export interface ReplyRight {
  canReply: boolean;
  // Why not, said in a sentence the screen can show rather than a bare disabled box.
  reason: string | null;
}

// Whether this viewer may still send a message.
//
// The rule the requirements care about most: escalating hands the issue on, and the
// person who escalated it keeps the conversation but loses the ability to add to it.
// Two people answering the same resident at once is how a resident gets two different
// answers.
export function replyRight(
  ticket: Pick<SupportTicket, "status" | "responsibleRole" | "residentId">,
  viewer: { roles: Role[]; residentId?: string | null },
): ReplyRight {
  const status = ticket.status as IssueStatus;

  // A closed issue is history for everybody.
  if (status === "closed") return { canReply: false, reason: "This issue is closed. The conversation is kept as history." };

  const isResident = Boolean(viewer.residentId && viewer.residentId === ticket.residentId);

  // A resolved issue is read-only history "unless the issue is reopened" — and the
  // resident replying is how it gets reopened. They raised it, so they are the one
  // who decides it is not fixed; disputing a resolution is a message, not a form.
  if (status === "resolved") {
    return isResident
      ? { canReply: true, reason: null }
      : { canReply: false, reason: "This issue is resolved. The conversation is read-only unless the resident reopens it." };
  }

  // The resident raised it and is being answered; they can always add to it.
  if (isResident) return { canReply: true, reason: null };

  const responsible = ticket.responsibleRole ?? "operator";
  const mine = Math.max(...viewer.roles.map((r) => RUNG[r] ?? 0), 0);
  const theirs = RUNG[responsible] ?? 0;

  // Anybody at or above the rung holding the issue may speak. The rule is about
  // handing an issue *up* — an operator who escalated to their supervisor goes quiet
  // — not about seniority blocking help: a supervisor stepping into an issue their
  // operator is handling is exactly what a supervisor is for.
  if (mine >= theirs && mine > 0) return { canReply: true, reason: null };

  // Below the rung that holds it: read, but not write. This is what an operator sees
  // after escalating to their supervisor.
  if (mine > 0) {
    return { canReply: false, reason: `This issue is currently with the ${roleLabel(responsible).toLowerCase()}. You can read the conversation but not add to it.` };
  }

  return { canReply: false, reason: "This issue is not yours to answer." };
}

// --------------------------------------------------------- who a reply is to

// Who the next message is addressed to.
//
// "Answer the Resident" was written into the screen, so a supervisor asking their
// operator for information was told they were answering the resident. The recipient
// follows the assignment: whoever the issue is waiting on, or the person on the other
// side of it.
export function replyRecipient(
  ticket: Pick<SupportTicket, "status" | "responsibleRole" | "residentId">,
  viewer: { roles: Role[]; residentId?: string | null },
): Role | null {
  const status = ticket.status as IssueStatus;
  const isResident = Boolean(viewer.residentId && viewer.residentId === ticket.residentId);

  // A resident always writes to whoever is holding the issue.
  if (isResident) return ticket.responsibleRole ?? "operator";

  // Waiting on somebody in particular answers the question outright.
  if (status === "waiting_resident") return "resident";
  if (status === "waiting_operator") return "operator";

  // Otherwise staff are answering the person who raised it. Where nobody raised it —
  // an issue an operator opened about an order — it goes to whoever holds it next.
  if (ticket.residentId) return "resident";
  return ticket.responsibleRole ?? null;
}

export function replyLabel(recipient: Role | null): string {
  return recipient ? `Reply to ${roleLabel(recipient)}` : "Add a message";
}

// ----------------------------------------------------------------- read state

// When this viewer last looked at the conversation. Kept per user on the ticket,
// because "read" is a fact about a person and not about the issue.
export function lastReadAt(ticket: { readBy?: Record<string, string> }, userId: string): string | null {
  return ticket.readBy?.[userId] ?? null;
}

// How many messages have arrived since. A person's own messages never count as
// unread, and neither do the system lines they caused.
export function unreadCount(
  ticket: { messages: IssueMessage[]; readBy?: Record<string, string> },
  userId: string,
): number {
  const since = lastReadAt(ticket, userId);
  return ticket.messages.filter((m) => m.author !== userId && (!since || m.at > since)).length;
}

export function markRead<T extends { readBy?: Record<string, string>; messages: IssueMessage[] }>(
  ticket: T,
  userId: string,
  at: string = new Date().toISOString(),
): T {
  ticket.readBy = { ...(ticket.readBy ?? {}), [userId]: at };
  return ticket;
}

// The last thing anybody said, which is what a list of issues should show instead of
// the description somebody typed when they opened it a week ago.
export function latestMessage(ticket: { messages: IssueMessage[] }): IssueMessage | null {
  return ticket.messages.length ? ticket.messages[ticket.messages.length - 1] : null;
}

// A one-line preview: who said it and what, short enough for a list row.
export function previewOf(ticket: { messages: IssueMessage[]; description?: string }, limit = 80): string {
  const last = latestMessage(ticket);
  if (!last) return (ticket.description ?? "").slice(0, limit);
  const who = last.authorRole === "system" ? "" : `${roleLabel(last.authorRole)}: `;
  const text = `${who}${last.body}`;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// ------------------------------------------------------------ the whole thing

export interface ConversationView {
  messages: ConversationMessage[];
  canReply: boolean;
  readOnlyReason: string | null;
  replyTo: Role | null;
  replyLabel: string;
  unreadCount: number;
  lastMessageAt: string | null;
  preview: string;
}

// The conversation as one viewer sees it. Everything a chat screen needs, decided
// here rather than by each screen working it out from a status and a role.
export function conversationFor(
  ticket: SupportTicket,
  viewer: { userId: string; roles: Role[]; residentId?: string | null },
  names: Map<string, string | null> = new Map(),
): ConversationView {
  const since = lastReadAt(ticket, viewer.userId);
  const right = replyRight(ticket, viewer);
  const recipient = replyRecipient(ticket, viewer);

  const messages: ConversationMessage[] = ticket.messages.map((message) => {
    const system = message.authorRole === "system";
    return {
      author: message.author,
      authorRole: message.authorRole,
      authorName: system ? null : names.get(message.author) ?? null,
      body: message.body,
      at: message.at,
      system,
      side: system ? "system" : message.author === viewer.userId ? "mine" : "theirs",
      unread: message.author !== viewer.userId && (!since || message.at > since),
    };
  });
  // Chronological, always. A conversation that is not in the order it happened is not
  // a conversation.
  messages.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1));

  const last = latestMessage(ticket);
  return {
    messages,
    canReply: right.canReply,
    readOnlyReason: right.reason,
    replyTo: recipient,
    replyLabel: replyLabel(recipient),
    unreadCount: messages.filter((m) => m.unread).length,
    lastMessageAt: last?.at ?? null,
    preview: previewOf(ticket),
  };
}
