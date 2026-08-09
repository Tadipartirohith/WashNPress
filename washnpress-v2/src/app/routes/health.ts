import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";

export function registerHealthRoutes(app: FastifyInstance, container: Container): void {
  app.get("/health", async () => ({ status: "ok", env: container.config.app.env, storage: container.config.storage.driver, time: new Date().toISOString() }));
}
