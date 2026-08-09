import { randomUUID } from "node:crypto";
import type { DataStore } from "../ports/repositories";
import type { SupportTicket } from "../domain/models";

export class SupportService {
  constructor(private readonly store: DataStore) {}

  async create(input: {
    residentId: string | null; orderId?: string | null; category: string; description: string;
    priority?: SupportTicket["priority"];
  }): Promise<SupportTicket> {
    const ticket: SupportTicket = {
      id: randomUUID(), residentId: input.residentId, orderId: input.orderId ?? null,
      category: input.category, description: input.description, status: "open",
      priority: input.priority ?? "normal", messages: [], createdAt: new Date().toISOString(),
    };
    return this.store.tickets.put(ticket);
  }

  async reply(ticketId: string, author: string, body: string): Promise<SupportTicket | null> {
    const ticket = await this.store.tickets.get(ticketId);
    if (!ticket) return null;
    ticket.messages.push({ author, body, at: new Date().toISOString() });
    ticket.status = "in_progress";
    return this.store.tickets.put(ticket);
  }

  async setStatus(ticketId: string, status: SupportTicket["status"]): Promise<SupportTicket | null> {
    const ticket = await this.store.tickets.get(ticketId);
    if (!ticket) return null;
    ticket.status = status;
    return this.store.tickets.put(ticket);
  }

  async listByResident(residentId: string): Promise<SupportTicket[]> {
    return this.store.tickets.find((t) => t.residentId === residentId);
  }

  async listAll(): Promise<SupportTicket[]> { return this.store.tickets.all(); }
}
