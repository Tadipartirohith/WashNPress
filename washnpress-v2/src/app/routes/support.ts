import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, requireSession, withScope } from "../guards";
import { ISSUE_TYPES, ISSUE_PRIORITIES, IssueService, IssueTransitionError } from "../../services/issue-service";
import type { Role, SupportTicket } from "../../domain/models";

const createSchema = z.object({
  orderId: z.string().optional(),
  category: z.enum(ISSUE_TYPES as unknown as [string, ...string[]]),
  description: z.string().min(1),
  priority: z.enum(["low", "normal", "high", "emergency"]).optional(),
});
const replySchema = z.object({ body: z.string().min(1) });

// Customer support. A resident raises a question, complaint or dispute here instead
// of having to settle it with an operator directly. The supervisor for that area is
// the first line; anything they cannot settle is escalated to admin.
export function registerSupportRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/support/issue-types", async () => ({ issueTypes: ISSUE_TYPES, priorities: ISSUE_PRIORITIES }));

  app.post("/v1/support/tickets", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    return withScope(reply, async () => {
      // A ticket may only be raised against the resident's own order.
      if (parsed.data.orderId) await container.access.requireOrder(session, parsed.data.orderId);
      const ticket = await container.issues.create({
        residentId: session.residentId, orderId: parsed.data.orderId,
        societyId: session.societyId, category: parsed.data.category, description: parsed.data.description,
        priority: parsed.data.priority ?? "normal",
        reportedByUserId: session.userId, reportedByRole: "resident",
      });
      const urgent = ticket.priority === "emergency";
      await container.notifications.notifyRoleInArea(ticket.areaId, "supervisor", {
        type: urgent ? "issue.emergency" : "issue.created",
        orderId: ticket.orderId,
        title: urgent ? "Emergency support ticket" : "New resident issue",
        body: `${parsed.data.category}: ${parsed.data.description}`,
      });
      return reply.code(201).send({ ticket: await container.issues.detail(ticket) });
    });
  });

  app.get("/v1/support/tickets", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    if (!session.residentId) return reply.send({ tickets: [] });
    const tickets = await container.issues.listByResident(session.residentId);
    return reply.send({ tickets: await container.issues.details(tickets) });
  });

  // Reading one ticket. A resident sees only their own; staff are bound by scope.
  app.get<{ Params: { id: string } }>("/v1/support/tickets/:id", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    const ticket = await container.store.tickets.get(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not_found" });
    if (!(await canReachTicket(container, session, ticket))) return reply.code(403).send({ error: "forbidden_scope" });
    return reply.send({ ticket: await container.issues.detail(ticket) });
  });

  app.post<{ Params: { id: string } }>("/v1/support/tickets/:id/reply", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const existing = await container.store.tickets.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!(await canReachTicket(container, session, existing))) return reply.code(403).send({ error: "forbidden_scope" });
    if (existing.status === "closed") return reply.code(409).send({ error: "ticket_closed", message: "This ticket is closed" });

    const role = primaryRole(session.roles);
    const ticket = await container.issues.reply(req.params.id, session.userId, role, parsed.data.body);
    if (!ticket) return reply.code(404).send({ error: "not_found" });

    // The other side is told there is something to read.
    if (role === "resident") {
      await container.notifications.notifyRoleInArea(ticket.areaId, "supervisor", {
        type: "issue.replied", orderId: ticket.orderId, title: "Resident replied on a ticket", body: parsed.data.body,
      });
    } else if (ticket.residentId) {
      await container.notifications.notifyResident(ticket.residentId, {
        type: "issue.replied", orderId: ticket.orderId, title: "Support replied to your ticket", body: parsed.data.body,
      });
    }
    return reply.send({ ticket: await container.issues.detail(ticket) });
  });

  // The resident closes their own ticket once they are satisfied. Closing is final.
  app.post<{ Params: { id: string } }>("/v1/support/tickets/:id/close", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    const ticket = await container.store.tickets.get(req.params.id);
    if (!ticket) return reply.code(404).send({ error: "not_found" });
    if (ticket.residentId !== session.residentId) return reply.code(403).send({ error: "forbidden_scope" });
    try {
      const result = await container.issues.setStatus(req.params.id, "closed", { actorUserId: session.userId });
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({
        session, action: "issue.closed", resource: "issue", resourceId: ticket.id,
        previousValue: { status: result.previous.status }, newValue: { status: "closed" },
      });
      return reply.send({ ticket: await container.issues.detail(result.current) });
    } catch (error) {
      if (error instanceof IssueTransitionError) return reply.code(409).send({ error: "illegal_ticket_transition", message: error.message });
      throw error;
    }
  });
}

function primaryRole(roles: Role[]): Role {
  for (const role of ["admin", "supervisor", "operator", "resident"] as Role[]) {
    if (roles.includes(role)) return role;
  }
  return roles[0] ?? "resident";
}

// One rule for who reaches a ticket, shared with every other issue route. It is
// decided by the role the session is acting in rather than by which fields the
// session happens to carry: a staff account that also has a residentId used to be
// judged as a resident, and a ticket with no society was unreachable for staff even
// when it plainly belonged to their area.
export async function canReachTicket(
  container: Container,
  session: { userId?: string; residentId: string | null; roles: Role[]; areaId?: string | null; societyIds?: string[] },
  ticket: SupportTicket,
): Promise<boolean> {
  const role = primaryRole(session.roles);
  const societyIds = new Set(
    role === "resident"
      ? []
      : session.societyIds ?? (await container.access.visibleSocietyIds(session as never)),
  );
  return IssueService.canSee(ticket, {
    userId: session.userId ?? "",
    role,
    areaId: session.areaId ?? null,
    societyIds,
    residentId: session.residentId,
  });
}
