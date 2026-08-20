import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { requireRole } from "../guards";

export function registerSustainabilityRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/sustainability/impact", async (req, reply) => {
    const s = await requireRole(req, reply, container, "resident"); if (!s) return;
    if (!s.societyId) return reply.code(409).send({ error: "onboarding_incomplete" });
    return reply.send(await container.sustainability.impactForSociety(s.societyId));
  });
}
