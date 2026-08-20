import { randomUUID } from "node:crypto";
import type { IssueStatus, Role, SupportTicket } from "../domain/models";
import type { DataStore } from "../ports/repositories";

// The issue types the specification lists for residents, operations and supervisors.
export const ISSUE_TYPES = [
  "pickup_failed", "resident_unavailable", "garment_quantity_mismatch", "damaged_garment",
  "missing_garment", "wrong_garment", "washing_problem", "ironing_problem", "qc_fail",
  "payment_issue", "additional_charge_dispute", "delivery_issue", "slot_issue",
  "society_issue", "subscription_issue", "equipment_issue", "resident_complaint", "dispute",
] as const;

export interface IssueFilter {
  societyIds?: Set<string>;
  areaId?: string;
  status?: IssueStatus;
  type?: string;
  orderId?: string;
  residentId?: string;
  assignedToUserId?: string;
  escalatedOnly?: boolean;
}

// Issues and support tickets are the same record. A resident raises one from the
// support screen, operations raises one against an order, and a supervisor works
// it through open -> under review -> resolved, escalating to admin when needed.
export class IssueService {
  constructor(private readonly store: DataStore) {}

  async create(input: {
    residentId: string | null; orderId?: string | null; societyId?: string | null; areaId?: string | null;
    category: string; description: string; priority?: SupportTicket["priority"];
    reportedByUserId?: string | null; reportedByRole?: Role | "system" | null;
  }): Promise<SupportTicket> {
    let societyId = input.societyId ?? null;
    let areaId = input.areaId ?? null;
    if (!societyId && input.orderId) {
      const order = await this.store.orders.get(input.orderId);
      societyId = order?.societyId ?? null;
      areaId = areaId ?? order?.areaId ?? null;
    }
    if (!societyId && input.residentId) {
      const resident = await this.store.residents.get(input.residentId);
      societyId = resident?.societyId ?? null;
    }
    if (!areaId && societyId) {
      const society = await this.store.societies.get(societyId);
      areaId = society?.areaId ?? null;
    }
    const ticket: SupportTicket = {
      id: randomUUID(), residentId: input.residentId, orderId: input.orderId ?? null,
      societyId, areaId, category: input.category, description: input.description,
      status: "open", priority: input.priority ?? "normal",
      reportedByUserId: input.reportedByUserId ?? null, reportedByRole: input.reportedByRole ?? null,
      assignedToUserId: null, resolution: null, resolvedAt: null, escalatedToAdmin: false,
      messages: [], createdAt: new Date().toISOString(),
    };
    return this.store.tickets.put(ticket);
  }

  async reply(ticketId: string, author: string, body: string): Promise<SupportTicket | null> {
    const ticket = await this.store.tickets.get(ticketId);
    if (!ticket) return null;
    ticket.messages.push({ author, body, at: new Date().toISOString() });
    if (ticket.status === "open") ticket.status = "under_review";
    return this.store.tickets.put(ticket);
  }

  async setStatus(ticketId: string, status: IssueStatus, options: { resolution?: string; assignedToUserId?: string } = {}): Promise<{ previous: SupportTicket; current: SupportTicket } | null> {
    const found = await this.store.tickets.get(ticketId);
    if (!found) return null;
    const previous = { ...found };
    found.status = status;
    if (options.assignedToUserId) found.assignedToUserId = options.assignedToUserId;
    if (status === "resolved") {
      found.resolution = options.resolution ?? found.resolution ?? "Resolved";
      found.resolvedAt = new Date().toISOString();
    }
    await this.store.tickets.put(found);
    return { previous, current: found };
  }

  async assign(ticketId: string, userId: string) {
    const found = await this.store.tickets.get(ticketId);
    if (!found) return null;
    const previous = { ...found };
    found.assignedToUserId = userId;
    if (found.status === "open") found.status = "under_review";
    await this.store.tickets.put(found);
    return { previous, current: found };
  }

  // Escalation hands an issue to admin without taking it away from the supervisor.
  async escalate(ticketId: string, note: string, authorUserId: string) {
    const found = await this.store.tickets.get(ticketId);
    if (!found) return null;
    const previous = { ...found };
    found.escalatedToAdmin = true;
    found.priority = "high";
    found.messages.push({ author: authorUserId, body: `Escalated to admin: ${note}`, at: new Date().toISOString() });
    await this.store.tickets.put(found);
    return { previous, current: found };
  }

  async list(filter: IssueFilter = {}): Promise<SupportTicket[]> {
    let tickets = await this.store.tickets.all();
    if (filter.societyIds) tickets = tickets.filter((t) => (t.societyId ? filter.societyIds!.has(t.societyId) : false));
    if (filter.areaId) tickets = tickets.filter((t) => t.areaId === filter.areaId);
    if (filter.status) tickets = tickets.filter((t) => t.status === filter.status);
    if (filter.type) tickets = tickets.filter((t) => t.category === filter.type);
    if (filter.orderId) tickets = tickets.filter((t) => t.orderId === filter.orderId);
    if (filter.residentId) tickets = tickets.filter((t) => t.residentId === filter.residentId);
    if (filter.assignedToUserId) tickets = tickets.filter((t) => t.assignedToUserId === filter.assignedToUserId);
    if (filter.escalatedOnly) tickets = tickets.filter((t) => t.escalatedToAdmin);
    tickets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return tickets;
  }

  async listByResident(residentId: string): Promise<SupportTicket[]> {
    return this.list({ residentId });
  }

  async listAll(): Promise<SupportTicket[]> { return this.store.tickets.all(); }
}
