import Fastify, { type FastifyInstance } from "fastify";
import type { Container } from "../container";
import { registerHealthRoutes } from "./routes/health";
import { registerAuthRoutes } from "./routes/auth";
import { registerCatalogRoutes } from "./routes/catalog";
import { registerSubscriptionRoutes } from "./routes/subscription";
import { registerPickupRoutes } from "./routes/pickups";
import { registerOrderRoutes } from "./routes/orders";
import { registerOperationsRoutes } from "./routes/operations";
import { registerWalletRoutes } from "./routes/wallet";
import { registerPaymentRoutes } from "./routes/payments";
import { registerSupportRoutes } from "./routes/support";
import { registerSustainabilityRoutes } from "./routes/sustainability";
import { registerAdminRoutes } from "./routes/admin";

export function buildApp(container: Container): FastifyInstance {
  const app = Fastify({ logger: { level: container.config.app.logLevel } });

  // Capture the raw JSON body so payment webhook signatures verify over exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = body as string;
    (_req as unknown as { rawBody: string }).rawBody = raw;
    try { done(null, raw.length ? JSON.parse(raw) : {}); }
    catch (error) { done(error as Error, undefined); }
  });

  registerHealthRoutes(app, container);
  registerAuthRoutes(app, container);
  registerCatalogRoutes(app, container);
  registerSubscriptionRoutes(app, container);
  registerPickupRoutes(app, container);
  registerOrderRoutes(app, container);
  registerOperationsRoutes(app, container);
  registerWalletRoutes(app, container);
  registerPaymentRoutes(app, container);
  registerSupportRoutes(app, container);
  registerSustainabilityRoutes(app, container);
  registerAdminRoutes(app, container);

  return app;
}
