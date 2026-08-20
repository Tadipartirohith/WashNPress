import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, requireSession, withScope } from "../guards";
import { ISSUE_TYPES } from "../../services/issue-service";

const createSchema = z.object({ orderId: z.string().optional(), category: z.string(), description: z.string().min(1) });
const replySchema = z.object({ body: z.string().min(1) });

export function registerSupportRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/support/issue-types", async () => ({ issueTypes: ISSUE_TYPES }));

  app.post("/v1/support/tickets", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return withScope(reply, async () => {
      // A ticket may only be raised against the resident's own order.
      if (parsed.data.orderId) await container.access.requireOrder(session, parsed.data.orderId);
      const ticket = await container.issues.create({
        residentId: session.residentId, orderId: parsed.data.orderId,
        societyId: session.societyId, category: parsed.data.category, description: parsed.data.description,
        reportedByUserId: session.userId, reportedByRole: "resident",
      });
      await container.notifications.notifyRoleInArea(ticket.areaId, "supervisor", {
        type: "issue.created", orderId: ticket.orderId, title: "New resident issue",
        body: `${parsed.data.category}: ${parsed.data.description}`,
      });
      return reply.code(201).send({ ticket });
    });
  });

  app.get("/v1/support/tickets", async (req, reply) => {
    const session = await requireRole(req, reply, container, "resident"); if (!session) return;
    if (!session.residentId) return reply.send({ tickets: [] });
    return reply.send({ tickets: await container.issues.listByResident(session.residentId) });
  });

  app.post<{ Params: { id: string } }>("/v1/support/tickets/:id/reply", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const existing = await container.store.tickets.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    // A resident may only reply on their own ticket; staff are bound by their scope.
    if (session.residentId && existing.residentId !== session.residentId) {
      return reply.code(403).send({ error: "forbidden_scope" });
    }
    if (!session.residentId && existing.societyId && !(await container.access.canSeeSociety(session, existing.societyId))) {
      return reply.code(403).send({ error: "forbidden_scope" });
    }
    const ticket = await container.issues.reply(req.params.id, session.userId, parsed.data.body);
    return reply.send({ ticket });
  });
}
