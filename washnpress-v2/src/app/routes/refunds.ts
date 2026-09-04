import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireAnyRole, hasRole } from "../guards";
import { RefundError, type RefundApprover } from "../../services/refund-service";

const requestSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(1),
});
const decisionSchema = z.object({ note: z.string().optional() });
const statusSchema = z.enum(["pending", "approved", "rejected"]);

// Where a RefundError maps to in HTTP. A decision the caller was not allowed to make
// is a 403; a clash with the order's current state is a 409; a missing thing is a 404.
function statusFor(code: string): number {
  if (code === "forbidden") return 403;
  if (code === "not_found" || code === "order_not_found") return 404;
  if (code === "already_requested" || code === "already_refunded" || code === "already_decided" || code === "nothing_to_refund") return 409;
  return 400;
}

export function registerRefundRoutes(app: FastifyInstance, container: Container): void {
  // Who is deciding, reduced to what the decision depends on: whether they are an
  // admin, and which societies they hold. An admin may act on any refund; a
  // supervisor only on refunds for their own societies.
  const approverFor = async (session: Parameters<typeof container.access.visibleSocietyIds>[0]): Promise<RefundApprover> => ({
    userId: session.userId,
    isAdmin: hasRole(session, "admin"),
    societyIds: [...await container.access.visibleSocietyIds(session)],
  });

  const fail = (reply: Parameters<typeof requireAnyRole>[1], error: unknown) => {
    if (error instanceof RefundError) return reply.code(statusFor(error.code)).send({ error: error.code, message: error.message });
    throw error;
  };

  // Ask for a refund on an order. Open to the staff who handle the order — an
  // operator or a supervisor — as well as an admin.
  app.post("/v1/refunds", async (req, reply) => {
    const session = await requireAnyRole(req, reply, container, ["operator", "supervisor", "admin"]);
    if (!session) return;
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: parsed.error.issues[0]?.message });
    try {
      const request = await container.refunds.request({ ...parsed.data, requestedByUserId: session.userId });
      return reply.code(201).send({ request });
    } catch (error) {
      return fail(reply, error);
    }
  });

  // The refunds a decider can see and act on: an admin sees all, a supervisor sees
  // their societies'. Optionally narrowed to one status, so a queue can ask for just
  // what is still pending.
  app.get<{ Querystring: { status?: string } }>("/v1/refunds", async (req, reply) => {
    const session = await requireAnyRole(req, reply, container, ["supervisor", "admin"]);
    if (!session) return;
    const status = req.query.status ? statusSchema.safeParse(req.query.status) : null;
    if (status && !status.success) return reply.code(400).send({ error: "invalid_status" });
    const approver = await approverFor(session);
    const requests = await container.refunds.list(approver, status?.success ? status.data : undefined);
    return reply.send({ requests });
  });

  app.post<{ Params: { id: string } }>("/v1/refunds/:id/approve", async (req, reply) => {
    const session = await requireAnyRole(req, reply, container, ["supervisor", "admin"]);
    if (!session) return;
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const request = await container.refunds.approve(req.params.id, await approverFor(session), parsed.data.note);
      return reply.send({ request });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>("/v1/refunds/:id/reject", async (req, reply) => {
    const session = await requireAnyRole(req, reply, container, ["supervisor", "admin"]);
    if (!session) return;
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const request = await container.refunds.reject(req.params.id, await approverFor(session), parsed.data.note);
      return reply.send({ request });
    } catch (error) {
      return fail(reply, error);
    }
  });
}
