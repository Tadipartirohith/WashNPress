import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";

export function registerCatalogRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/plans", async () => ({ plans: (await container.store.plans.all()).filter((p) => p.isActive) }));
  app.get("/v1/addons", async () => ({ addons: (await container.store.addons.all()).filter((a) => a.isActive) }));
  app.get("/v1/societies", async () => ({ societies: (await container.store.societies.all()).filter((s) => s.status !== "inactive") }));
  app.get("/v1/societies/nearby", async () => ({ societies: (await container.store.societies.find((s) => s.status === "active")) }));
}
