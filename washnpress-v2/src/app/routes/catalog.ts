import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";

export function registerCatalogRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/plans", async (_req, _reply) => ({ plans: await container.subscriptions.listPlans() }));
  app.get("/v1/addons", async () => ({ addons: (await container.store.addons.all()).filter((a) => a.isActive) }));
  // The processing services a resident can pick per garment split, with the price
  // charged per garment on top of anything a subscription covers.
  app.get("/v1/services", async () => {
    const config = await container.systemConfig.get();
    return { services: config.garmentServices.filter((s) => s.isActive) };
  });
  app.get("/v1/societies", async () => ({ societies: (await container.store.societies.all()).filter((s) => s.status !== "inactive") }));
  app.get("/v1/societies/nearby", async () => ({ societies: await container.store.societies.find((s) => s.status === "active") }));
}
