import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, requireSession, hasRole } from "../guards";
import { formatInr } from "../../domain/money";

const topupSchema = z.object({ amountPaise: z.number().int().positive() });

export function registerWalletRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/wallet", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const balancePaise = await container.wallet.balancePaise(s.residentId!);
    return reply.send({ balancePaise, balanceFormatted: formatInr(balancePaise) });
  });

  app.get("/v1/wallet/transactions", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    return reply.send({ transactions: await container.wallet.transactions(s.residentId!) });
  });

  app.post("/v1/wallet/topup", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    const parsed = topupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const order = await container.wallet.startTopUp(s.residentId!, parsed.data.amountPaise);
    return reply.send({ paymentOrder: order });
  });

  // Balance lookup by resident id. A resident may read their own; an admin may read
  // anybody's. Before this the route was open to the world, so knowing or guessing a
  // resident id was enough to read their wallet.
  app.get<{ Params: { residentId: string } }>("/v1/wallet/:residentId/balance", async (req, reply) => {
    const session = await requireSession(req, reply, container); if (!session) return;
    const isOwner = session.residentId === req.params.residentId;
    if (!isOwner && !hasRole(session, "admin")) {
      return reply.code(403).send({ error: "forbidden_scope" });
    }
    const balancePaise = await container.wallet.balancePaise(req.params.residentId);
    return reply.send({ residentId: req.params.residentId, balancePaise, balanceFormatted: formatInr(balancePaise) });
  });
}
