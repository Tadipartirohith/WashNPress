import { randomUUID } from "node:crypto";
import type { IssuePriority, IssueStatus, Role, SupportTicket, User, Resident, Society } from "../domain/models";
import {
  conversationFor, replyRight, replyRecipient, replyLabel,
  markRead, latestMessage, previewOf, unreadCount,
} from "../domain/issue-conversation";
import type { DataStore } from "../ports/repositories";
import { withinServiceDays } from "./scheduling-service";
import { STATE_LABELS } from "../domain/order-state-machine";

// The issue types the specification lists for residents, operations and supervisors.
export const ISSUE_TYPES = [
  "pickup_failed", "resident_unavailable", "garment_quantity_mismatch", "damaged_garment",
  "missing_garment", "wrong_garment", "washing_problem", "ironing_problem", "qc_fail",
  "payment_issue", "additional_charge_dispute", "delivery_issue", "slot_issue",
  "society_issue", "subscription_issue", "equipment_issue", "operator_issue",
  "resident_complaint", "dispute", "general_query",
] as const;

export const ISSUE_PRIORITIES: IssuePriority[] = ["low", "normal", "high", "emergency"];

// A ticket moves forward through these states. Reopening is deliberately not a
// transition: a resident who is still unhappy replies, which pulls a resolved ticket
// back into progress, and only a closed ticket is final.
// The lifecycle in order, for filter chips and for anything rendering a ticket's
// progress.
export const ISSUE_STATUSES: IssueStatus[] = [
  "open", "in_progress", "waiting_resident", "waiting_operator",
  "escalated_supervisor", "escalated_admin", "resolved", "closed",
];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting_resident: "Waiting for Resident",
  waiting_operator: "Waiting for Operator",
  escalated_supervisor: "Escalated to Supervisor",
  escalated_admin: "Escalated to Admin",
  resolved: "Resolved",
  closed: "Closed",
};

// A ticket may move to any live stage while it is being worked, may be resolved from
// any of them, and may be closed from anywhere. What it may not do is come back from
// closed, or go down the hierarchy once escalated.
const LIVE: IssueStatus[] = ["in_progress", "waiting_resident", "waiting_operator"];

export const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  open: [...LIVE, "escalated_supervisor", "escalated_admin", "resolved", "closed"],
  in_progress: [...LIVE, "escalated_supervisor", "escalated_admin", "resolved", "closed"],
  waiting_resident: [...LIVE, "escalated_supervisor", "escalated_admin", "resolved", "closed"],
  waiting_operator: [...LIVE, "escalated_supervisor", "escalated_admin", "resolved", "closed"],
  // Once with a supervisor it can go up to admin but not back down to the operator.
  escalated_supervisor: ["in_progress", "waiting_resident", "escalated_admin", "resolved", "closed"],
  escalated_admin: ["in_progress", "waiting_resident", "resolved", "closed"],
  // Replying to a resolved ticket reopens it, which is why in_progress is reachable.
  resolved: ["closed", "in_progress"],
  closed: [],
};

// Who is expected to act next, given who raised it. A resident's issue is the
// operator's to answer first; an operator's issue is the supervisor's.
export function firstResponderFor(reportedByRole: string | null | undefined): Role | null {
  if (reportedByRole === "resident") return "operator";
  if (reportedByRole === "operator") return "supervisor";
  if (reportedByRole === "supervisor") return "admin";
  return "supervisor";
}

// The next rung up the hierarchy, and nothing beyond admin.
export function escalationTargetFor(current: Role | null): Role | null {
  if (current === "operator") return "supervisor";
  if (current === "supervisor") return "admin";
  return null;
}

const RUNG: Partial<Record<Role, number>> = { operator: 1, supervisor: 2, admin: 3 };

// Escalating means "up from me". A supervisor escalating an issue that is still
// nominally the operator's sends it to the admin, not back to themselves — otherwise
// escalation would appear to do nothing.
export function escalationTargetFrom(responsible: Role | null, actor: Role): Role | null {
  const from = (RUNG[actor] ?? 0) >= (RUNG[responsible ?? "operator"] ?? 0) ? actor : responsible;
  return escalationTargetFor(from);
}

export const ESCALATION_STATUS: Partial<Record<Role, IssueStatus>> = {
  supervisor: "escalated_supervisor",
  admin: "escalated_admin",
};

export class IssueEscalationError extends Error {
  constructor(message: string) { super(message); this.name = "IssueEscalationError"; }
}

// This viewer may read the conversation but not add to it: the issue has moved on
// to somebody above them, or it is finished. Distinct from not being allowed to see
// it at all, which is a scope question and answered elsewhere.
export class ConversationClosedError extends Error {
  constructor(message: string) { super(message); this.name = "ConversationClosedError"; }
}

export class IssueTransitionError extends Error {
  constructor(from: IssueStatus, to: IssueStatus) {
    super(`A ticket cannot move from ${from} to ${to}`);
    this.name = "IssueTransitionError";
  }
}

export function canTransitionIssue(from: IssueStatus, to: IssueStatus): boolean {
  return ISSUE_TRANSITIONS[from]?.includes(to) ?? false;
}

// Who is looking. A ticket is visible to the person who raised it, to whoever is
// being asked to act, to the society it belongs to, and to an admin — which is a
// wider rule than "the society matches", and is the rule the requirements describe.
export interface IssueViewer {
  userId: string;
  role: Role;
  societyIds?: Set<string>;
  residentId?: string | null;
}

// The lookups a ticket needs to be readable, gathered once for a whole list.
// Who opened the ticket, said the way the person reading it needs to hear it.
//
// A resident is identified by their flat and their society; a member of staff by
// their employee id and the society they work. The two are different questions with
// different answers, and one "reported by" name answered neither.
function raisedBy(
  ticket: SupportTicket,
  ctx: IssueDecoration,
  resident: Resident | null,
  residentUser: User | null,
  society: Society | null,
): {
  role: string; name: string | null; phone: string | null;
  unitNumber: string | null; employeeId: string | null; societyName: string | null;
} {
  const author = ticket.reportedByUserId ? ctx.users.get(ticket.reportedByUserId) ?? null : null;
  const role = ticket.reportedByRole ?? (author?.roles?.[0] ?? "system");
  if (role === "resident") {
    // The resident record is the one on the ticket, which is the resident the issue
    // is about — and for a resident-raised ticket that is the same person.
    return {
      role, name: author?.fullName ?? residentUser?.fullName ?? null,
      phone: author?.phone ?? residentUser?.phone ?? null,
      unitNumber: resident?.unitNumber ?? null,
      employeeId: null,
      societyName: society?.name ?? null,
    };
  }
  return {
    role,
    name: author?.fullName ?? null,
    phone: author?.phone ?? null,
    unitNumber: null,
    employeeId: author?.employeeId ?? null,
    // Staff work a society; which one is what tells a reader whether this issue is
    // theirs to answer.
    societyName: society?.name
      ?? (author?.societyIds ?? []).map((id) => ctx.societies.get(id)?.name).filter(Boolean)[0]
      ?? null,
  };
}

export interface IssueDecoration {
  users: Map<string, User>;
  residents: Map<string, Resident>;
  societies: Map<string, Society>;
}

export interface IssueFilter {
  viewer?: IssueViewer;
  societyIds?: Set<string>;
  status?: IssueStatus;
  statuses?: IssueStatus[];
  priority?: IssuePriority;
  type?: string;
  orderId?: string;
  residentId?: string;
  assignedToUserId?: string;
  escalatedOnly?: boolean;
  emergencyOnly?: boolean;
  openOnly?: boolean;
  from?: string;
  to?: string;
}

// Issues and support tickets are the same record. A resident raises one from the
// support screen, operations raises one against an order, and a supervisor works it
// through assigned, in progress and resolved, escalating to admin when needed. The
// resident closes it once they are satisfied.
export class IssueService {
  constructor(private readonly store: DataStore) {}

  async create(input: {
    residentId: string | null; orderId?: string | null; societyId?: string | null;
    category: string; description: string; priority?: IssuePriority;
    reportedByUserId?: string | null; reportedByRole?: Role | "system" | null;
  }): Promise<SupportTicket> {
    let societyId = input.societyId ?? null;
    if (!societyId && input.orderId) {
      const order = await this.store.orders.get(input.orderId);
      societyId = order?.societyId ?? null;
    }
    if (!societyId && input.residentId) {
      const resident = await this.store.residents.get(input.residentId);
      societyId = resident?.societyId ?? null;
    }
    // An operator raising an issue that is not about a particular order still belongs
    // somewhere: to the society they cover. Without this a ticket has no society, and
    // anything scoped by society cannot see it — which is how an operator's own issue
    // became invisible to them and to their supervisor while remaining visible to the
    // admin. Every member of staff now holds exactly one society, so there is always
    // an answer.
    if (!societyId && input.reportedByUserId) {
      const author = await this.store.users.get(input.reportedByUserId);
      if (author && author.societyIds.length >= 1) societyId = author.societyIds[0];
    }
    const ticket: SupportTicket = {
      id: randomUUID(), residentId: input.residentId, orderId: input.orderId ?? null,
      societyId, category: input.category, description: input.description,
      status: "open", priority: input.priority ?? "normal",
      reportedByUserId: input.reportedByUserId ?? null, reportedByRole: input.reportedByRole ?? null,
      assignedToUserId: null, resolution: null, resolvedAt: null, closedAt: null,
      escalatedToAdmin: false,
      // Who answers it first follows from who raised it, not from who happens to be
      // looking. A resident's issue is the operator's; an operator's is the
      // supervisor's. Everyone above still sees it, but is not the one being asked.
      responsibleRole: firstResponderFor(input.reportedByRole),
      escalatedToSupervisor: false,
      messages: [], createdAt: new Date().toISOString(),
    };
    return this.store.tickets.put(ticket);
  }

  async get(ticketId: string): Promise<SupportTicket | null> {
    return this.store.tickets.get(ticketId);
  }

  // A message from either side. A reply from the supervisor on an open ticket starts
  // work on it; a reply from the resident on a resolved ticket reopens the work,
  // because the person who raised it is the one who decides it is not fixed.
  async reply(
    ticketId: string,
    author: string,
    authorRole: Role | "system" | null,
    body: string,
    // Who is sending it, so the conversation's own rules decide whether they may.
    // Absent for a system message, which is written by nobody and always allowed.
    viewer?: { roles: Role[]; residentId?: string | null },
  ): Promise<SupportTicket | null> {
    const ticket = await this.store.tickets.get(ticketId);
    if (!ticket || ticket.status === "closed") return null;

    // Escalating hands an issue on. The person who escalated it keeps the
    // conversation and loses the ability to add to it: two people answering the same
    // resident at once is how a resident gets two different answers.
    if (viewer) {
      const right = replyRight(ticket, viewer);
      if (!right.canReply) throw new ConversationClosedError(right.reason ?? "You cannot add to this conversation.");
    }

    ticket.messages.push({ author, authorRole, body, at: new Date().toISOString() });
    // Sending a message means having read what came before it.
    markRead(ticket, author);
    if (authorRole === "resident") {
      if (ticket.status === "resolved") { ticket.status = "in_progress"; ticket.resolvedAt = null; }
    } else if (ticket.status === "open") {
      ticket.status = "in_progress";
      if (!ticket.assignedToUserId) ticket.assignedToUserId = author;
    }
    return this.store.tickets.put(ticket);
  }

  // The conversation as one person sees it: the messages in the order they happened,
  // whether this viewer may still add to it, and who a reply would be addressed to.
  // Looking at it counts as reading it.
  async conversation(
    ticketId: string,
    viewer: { userId: string; roles: Role[]; residentId?: string | null },
    options: { markRead?: boolean } = {},
  ) {
    const ticket = await this.store.tickets.get(ticketId);
    if (!ticket) return null;

    // Who said what, by name, so a chat does not read as a wall of identifiers.
    const authors = new Set(ticket.messages.map((m) => m.author));
    const names = new Map<string, string | null>();
    for (const id of authors) {
      const user = await this.store.users.get(id);
      if (user) names.set(id, user.fullName);
    }

    const view = conversationFor(ticket, viewer, names);
    if (options.markRead !== false) {
      markRead(ticket, viewer.userId);
      await this.store.tickets.put(ticket);
    }
    return view;
  }

  // What a list row shows: the last thing said and how much of it this person has not
  // seen — rather than the description somebody typed when they opened it a week ago.
  conversationSummary(ticket: SupportTicket, userId: string) {
    const last = latestMessage(ticket);
    return {
      preview: previewOf(ticket),
      lastMessageAt: last?.at ?? null,
      lastMessageRole: last?.authorRole ?? null,
      unreadCount: unreadCount(ticket, userId),
      messageCount: ticket.messages.length,
    };
  }

  async setStatus(ticketId: string, status: IssueStatus, options: { resolution?: string; actorUserId?: string } = {}): Promise<{ previous: SupportTicket; current: SupportTicket } | null> {
    const found = await this.store.tickets.get(ticketId);
    if (!found) return null;
    if (found.status === status) return { previous: { ...found }, current: found };
    if (!canTransitionIssue(found.status, status)) throw new IssueTransitionError(found.status, status);
    const previous = { ...found };
    found.status = status;
    if (status === "in_progress" && options.actorUserId && !found.assignedToUserId) {
      found.assignedToUserId = options.actorUserId;
    }
    if (status === "resolved") {
      found.resolution = options.resolution ?? found.resolution ?? "Resolved";
      found.resolvedAt = new Date().toISOString();
    }
    if (status === "closed") {
      found.closedAt = new Date().toISOString();
      if (!found.resolvedAt) found.resolvedAt = found.closedAt;
      if (!found.resolution) found.resolution = options.resolution ?? "Closed";
    }
    await this.store.tickets.put(found);
    return { previous, current: found };
  }

  async assign(ticketId: string, userId: string) {
    const found = await this.store.tickets.get(ticketId);
    if (!found || found.status === "closed") return null;
    const previous = { ...found };
    found.assignedToUserId = userId;
    // Taking a ticket starts work on it; there is no separate "taken" stage.
    if (found.status === "open") found.status = "in_progress";
    await this.store.tickets.put(found);
    return { previous, current: found };
  }

  // Escalate one rung. A ticket goes up the hierarchy and never back down, so an
  // issue that has reached the admin cannot be quietly pushed back to an operator.
  async escalateOneLevel(ticketId: string, note: string, actorUserId: string, actorRole: Role) {
    const ticket = await this.store.tickets.get(ticketId);
    if (!ticket || ticket.status === "closed") return null;
    const responsible = ticket.responsibleRole ?? firstResponderFor(ticket.reportedByRole);
    const target = escalationTargetFrom(responsible, actorRole);
    if (!target) throw new IssueEscalationError("This issue is already with the admin, who is the last resort.");

    const previous = { ...ticket };
    ticket.responsibleRole = target;
    ticket.status = ESCALATION_STATUS[target] ?? ticket.status;
    if (target === "supervisor") ticket.escalatedToSupervisor = true;
    if (target === "admin") { ticket.escalatedToAdmin = true; ticket.escalatedToSupervisor = true; }
    // Escalating hands the ticket on, so it is no longer anybody's in particular
    // until somebody at the new level takes it.
    ticket.assignedToUserId = null;
    const at = new Date().toISOString();
    // The escalation itself goes on the record as its own line, so the trail reads the
    // same whether or not the person escalating had anything to add. Their note is a
    // separate line in their own voice.
    ticket.messages.push({ author: actorUserId, authorRole: "system", body: `Escalated to ${target}.`, at });
    if (note.trim()) ticket.messages.push({ author: actorUserId, authorRole: actorRole, body: note.trim(), at });
    await this.store.tickets.put(ticket);
    return { previous, current: ticket, target };
  }

  // Closed is the end of an issue for everybody except the admin who closed it. This
  // is the one way back, it is recorded on the ticket, and it puts the issue back
  // with whoever was answering it rather than at the top of the hierarchy.
  async reopen(ticketId: string, reason: string, actorUserId: string) {
    const ticket = await this.store.tickets.get(ticketId);
    if (!ticket) return null;
    const previous = { ...ticket };
    ticket.status = "in_progress";
    ticket.closedAt = null;
    ticket.resolvedAt = null;
    ticket.resolution = null;
    ticket.responsibleRole = ticket.responsibleRole ?? firstResponderFor(ticket.reportedByRole);
    ticket.messages.push({
      author: actorUserId, authorRole: "system",
      body: `Reopened by the admin: ${reason}`, at: new Date().toISOString(),
    });
    await this.store.tickets.put(ticket);
    return { previous, current: ticket };
  }

  async setPriority(ticketId: string, priority: IssuePriority) {
    const found = await this.store.tickets.get(ticketId);
    if (!found) return null;
    const previous = { ...found };
    found.priority = priority;
    await this.store.tickets.put(found);
    return { previous, current: found };
  }

  // Escalation hands an issue to admin without taking it away from the supervisor.
  // Can this person see this ticket at all?
  static canSee(ticket: SupportTicket, viewer: IssueViewer): boolean {
    // An admin monitors everything, which is the point of admin.
    if (viewer.role === "admin") return true;
    // Whoever raised it always keeps sight of it, wherever it goes.
    if (ticket.reportedByUserId && ticket.reportedByUserId === viewer.userId) return true;
    if (ticket.assignedToUserId && ticket.assignedToUserId === viewer.userId) return true;
    if (viewer.role === "resident") return Boolean(viewer.residentId && ticket.residentId === viewer.residentId);
    // A supervisor owns a society and everything raised in it, whoever raised it.
    if (viewer.role === "supervisor") {
      return Boolean(ticket.societyId && viewer.societyIds?.has(ticket.societyId));
    }
    // An operator sees the society they work in. A ticket with no society at all is
    // nobody's in particular, so it stays with the admin rather than appearing for
    // every operator on the platform.
    if (viewer.role === "operator") {
      return Boolean(ticket.societyId && viewer.societyIds?.has(ticket.societyId));
    }
    return false;
  }

  async list(filter: IssueFilter = {}): Promise<SupportTicket[]> {
    let tickets = await this.store.tickets.all();
    if (filter.viewer) tickets = tickets.filter((t) => IssueService.canSee(t, filter.viewer!));
    else if (filter.societyIds) tickets = tickets.filter((t) => (t.societyId ? filter.societyIds!.has(t.societyId) : false));
    if (filter.status) tickets = tickets.filter((t) => t.status === filter.status);
    if (filter.statuses) tickets = tickets.filter((t) => filter.statuses!.includes(t.status));
    if (filter.priority) tickets = tickets.filter((t) => t.priority === filter.priority);
    if (filter.type) tickets = tickets.filter((t) => t.category === filter.type);
    if (filter.orderId) tickets = tickets.filter((t) => t.orderId === filter.orderId);
    if (filter.residentId) tickets = tickets.filter((t) => t.residentId === filter.residentId);
    if (filter.assignedToUserId) tickets = tickets.filter((t) => t.assignedToUserId === filter.assignedToUserId);
    if (filter.escalatedOnly) tickets = tickets.filter((t) => t.escalatedToAdmin);
    if (filter.emergencyOnly) tickets = tickets.filter((t) => t.priority === "emergency");
    if (filter.openOnly) tickets = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
    if (filter.from || filter.to) tickets = tickets.filter((t) => withinServiceDays(t.createdAt, filter.from, filter.to));
    // Emergencies first, then the oldest waiting, so the queue reads as a work list.
    // It used to say that and do the opposite: equal priorities came back newest
    // first, so the ageing view and the queue disagreed about which issue had been
    // waiting longest, and the oldest sat at the bottom of the list nobody scrolls to.
    const weight = (t: SupportTicket) => (t.priority === "emergency" ? 0 : t.priority === "high" ? 1 : t.priority === "normal" ? 2 : 3);
    tickets.sort((a, b) => (weight(a) - weight(b)) || a.createdAt.localeCompare(b.createdAt));
    return tickets;
  }

  async listByResident(residentId: string): Promise<SupportTicket[]> {
    return this.list({ residentId });
  }

  async listAll(): Promise<SupportTicket[]> { return this.store.tickets.all(); }

  // The decorated view every support screen renders: the ticket plus the names the
  // reader needs, so no screen has to resolve ids itself.
  // Everything decorating a ticket needs, read once. Passing this in is what turns
  // a list of a hundred issues from a hundred table scans into four.
  private async decorationContext(): Promise<IssueDecoration> {
    const [users, residents, societies] = await Promise.all([
      this.store.users.all(), this.store.residents.all(),
      this.store.societies.all(),
    ]);
    return {
      users: new Map(users.map((u) => [u.id, u])),
      residents: new Map(residents.map((r) => [r.id, r])),
      societies: new Map(societies.map((s) => [s.id, s])),
    };
  }

  async detail(ticket: SupportTicket, context?: IssueDecoration, viewer?: { userId: string; roles: Role[]; residentId?: string | null }) {
    const ctx = context ?? (await this.decorationContext());
    const resident = ticket.residentId ? ctx.residents.get(ticket.residentId) ?? null : null;
    const residentUser = resident ? ctx.users.get(resident.userId) ?? null : null;
    // The order is the one thing worth fetching by id: a list of issues touches far
    // fewer orders than there are orders.
    const order = ticket.orderId ? await this.store.orders.get(ticket.orderId) : null;
    // When the collection was, which the resident is usually asking about.
    const pickup = order?.pickupId ? await this.store.pickups.get(order.pickupId) : null;
    const slot = pickup?.slotId ? await this.store.slots.get(pickup.slotId) : null;
    const society = ticket.societyId ? ctx.societies.get(ticket.societyId) ?? null : null;
    const assignee = ticket.assignedToUserId ? ctx.users.get(ticket.assignedToUserId) ?? null : null;
    const users = ctx.users;
    // What a list row shows: the last thing said and how much of it this viewer has
    // not seen, rather than the description somebody typed when they opened it a week
    // ago. And, where the viewer is known, whether they may still add to it.
    const conversation = viewer
      ? {
          ...this.conversationSummary(ticket, viewer.userId),
          ...replyRight(ticket, viewer),
          replyTo: replyRecipient(ticket, viewer),
          replyLabel: replyLabel(replyRecipient(ticket, viewer)),
        }
      : this.conversationSummary(ticket, "");

    return {
      ...ticket,
      conversation,
      residentName: residentUser?.fullName ?? null,
      residentPhone: residentUser?.phone ?? null,
      unitNumber: resident?.unitNumber ?? null,
      societyName: society?.name ?? null,
      assignedToName: assignee?.fullName ?? null,
      // Who raised it, and everything that identifies them.
      //
      // A ticket used to say only which resident it was about, so an issue an
      // operator raised showed no operator — and the resident and order behind it
      // had to be guessed from the description. Every issue is traceable
      // Issue → Raised by → Order → Resident → Operator now, whichever end it
      // started from.
      raisedBy: raisedBy(ticket, ctx, resident, residentUser, society),
      order: order
        ? {
            id: order.id, orderCode: order.orderCode, state: order.state,
            stateLabel: STATE_LABELS[order.state] ?? order.state,
            residentName: residentUser?.fullName ?? null,
            unitNumber: resident?.unitNumber ?? null,
            societyName: society?.name ?? null,
            createdAt: order.createdAt,
            pickupAt: pickup?.scheduledFor ?? null,
            slotLabel: slot ? `${slot.startTime} – ${slot.endTime}` : null,
            garments: order.acceptedCount ?? order.estimatedCount ?? null,
            acceptedCount: order.acceptedCount,
            amountPaise: (order.servicesPaise ?? 0) + (order.additionalChargePaise ?? 0),
            paymentStatus: order.additionalChargeStatus ?? "none",
            operatorUserId: order.assignedOperatorUserId,
            operatorName: order.assignedOperatorUserId ? users.get(order.assignedOperatorUserId)?.fullName ?? null : null,
          }
        : null,
      messages: ticket.messages.map((m) => ({ ...m, authorName: users.get(m.author)?.fullName ?? null })),
      ageHours: Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / 3600_000),
      resolutionMinutes: resolutionMinutes(ticket),
    };
  }

  async details(tickets: SupportTicket[], viewer?: { userId: string; roles: Role[]; residentId?: string | null }) {
    if (!tickets.length) return [];
    const context = await this.decorationContext();
    return Promise.all(tickets.map((t) => this.detail(t, context, viewer)));
  }

  // Everything the admin support dashboard reports, in one pass.
  async analytics(tickets: SupportTicket[]) {
    const societies = new Map((await this.store.societies.all()).map((s) => [s.id, s]));
    const users = new Map((await this.store.users.all()).map((u) => [u.id, u]));

    const countBy = <T>(keyOf: (t: SupportTicket) => T | null, label: (key: T) => string) => {
      const map = new Map<string, { key: string; label: string; total: number; open: number; resolved: number }>();
      for (const ticket of tickets) {
        const raw = keyOf(ticket);
        const key = raw === null || raw === undefined ? "unassigned" : String(raw);
        if (!map.has(key)) {
          map.set(key, { key, label: raw === null || raw === undefined ? "Unassigned" : label(raw), total: 0, open: 0, resolved: 0 });
        }
        const row = map.get(key)!;
        row.total += 1;
        if (ticket.status === "resolved" || ticket.status === "closed") row.resolved += 1;
        else row.open += 1;
      }
      return [...map.values()].sort((a, b) => b.total - a.total);
    };

    const settled = tickets.filter((t) => resolutionMinutes(t) !== null);
    const averageResolutionMinutes = settled.length
      ? Math.round(settled.reduce((sum, t) => sum + (resolutionMinutes(t) ?? 0), 0) / settled.length)
      : null;

    const stillOpen = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
    const ageing = stillOpen
      .map((t) => ({ id: t.id, category: t.category, priority: t.priority, status: t.status, createdAt: t.createdAt, ageHours: Math.round((Date.now() - new Date(t.createdAt).getTime()) / 3600_000) }))
      .sort((a, b) => b.ageHours - a.ageHours)
      .slice(0, 20);

    const ageBands = [
      { key: "under_24h", label: "Under 24 hours", max: 24 },
      { key: "1_3d", label: "1 to 3 days", max: 72 },
      { key: "3_7d", label: "3 to 7 days", max: 168 },
      { key: "over_7d", label: "Over 7 days", max: Number.POSITIVE_INFINITY },
    ].map((band, index, all) => {
      const floor = index === 0 ? 0 : all[index - 1].max;
      return {
        key: band.key,
        label: band.label,
        count: stillOpen.filter((t) => {
          const hours = (Date.now() - new Date(t.createdAt).getTime()) / 3600_000;
          return hours >= floor && hours < band.max;
        }).length,
      };
    });

    const oldestOpen = stillOpen.length
      ? [...stillOpen].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      : null;

    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      escalated_supervisor: tickets.filter((t) => t.status === "escalated_supervisor").length,
      escalated_admin: tickets.filter((t) => t.status === "escalated_admin").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
      closed: tickets.filter((t) => t.status === "closed").length,
      // Pending is everything still needing work, which is what an admin scans for.
      pending: stillOpen.length,
      emergency: tickets.filter((t) => t.priority === "emergency" && t.status !== "closed").length,
      // Anything that has been handed up at all, at whichever level it now sits.
      // This used to count only escalatedToAdmin, so every issue waiting on a
      // supervisor was reported as never having been escalated.
      escalated: stillOpen.filter((t) => t.escalatedToSupervisor || t.escalatedToAdmin).length,
      escalatedToAdmin: stillOpen.filter((t) => t.escalatedToAdmin).length,
      orderRelated: tickets.filter((t) => Boolean(t.orderId)).length,
      averageResolutionMinutes,
      bySociety: countBy((t) => t.societyId, (id) => societies.get(String(id))?.name ?? "Unknown"),
      bySupervisor: countBy(
        (t) => (t.societyId ? societies.get(t.societyId)?.supervisorUserId ?? null : null),
        (id) => users.get(String(id))?.fullName ?? "Unknown",
      ),
      byCategory: countBy((t) => t.category, (c) => String(c)),
      byPriority: countBy((t) => t.priority, (p) => String(p)),
      ageBands,
      oldestOpen: oldestOpen
        ? {
            id: oldestOpen.id, category: oldestOpen.category, priority: oldestOpen.priority,
            createdAt: oldestOpen.createdAt,
            ageHours: Math.round((Date.now() - new Date(oldestOpen.createdAt).getTime()) / 3600_000),
          }
        : null,
      ageing,
    };
  }
}

export function resolutionMinutes(ticket: SupportTicket): number | null {
  const finished = ticket.resolvedAt ?? ticket.closedAt;
  if (!finished) return null;
  return Math.max(0, Math.round((new Date(finished).getTime() - new Date(ticket.createdAt).getTime()) / 60000));
}
