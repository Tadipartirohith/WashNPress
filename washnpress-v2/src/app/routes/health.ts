import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { requireRole } from "../guards";

export function registerHealthRoutes(app: FastifyInstance, container: Container): void {
  // Public liveness only. The environment name and storage driver used to be here,
  // which told an unauthenticated caller how the deployment was put together.
  app.get("/health", async () => ({ status: "ok" }));

  // The same detail, for somebody who is allowed to see it.
  app.get("/v1/admin/diagnostics", async (req, reply) => {
    const session = await requireRole(req, reply, container, "admin"); if (!session) return;
    return reply.send({
      status: "ok",
      env: container.config.app.env,
      storage: container.config.storage.driver,
      time: new Date().toISOString(),
    });
  });
}
