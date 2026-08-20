import Fastify, { type FastifyInstance } from "fastify";
import { metrics } from "../observability/metrics";
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
import { registerSupervisorRoutes } from "./routes/supervisor";
import { registerResidentRoutes } from "./routes/resident";
import { buildOpenApiDocument, SWAGGER_UI_HTML, type RegisteredRoute } from "./openapi";
import { registerRouteDocs } from "./route-docs";

export function buildApp(container: Container): FastifyInstance {
  const app = Fastify({ logger: { level: container.config.app.logLevel } });

  // Collected as routes are registered, so the API documentation is generated from
  // exactly what the server serves rather than from a hand written list.
  const registeredRoutes: RegisteredRoute[] = [];
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      registeredRoutes.push({ method, url: route.url });
    }
  });

  // Capture the raw JSON body so payment webhook signatures verify over exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = body as string;
    (_req as unknown as { rawBody: string }).rawBody = raw;
    try { done(null, raw.length ? JSON.parse(raw) : {}); }
    catch (error) { done(error as Error, undefined); }
  });

  // Cross origin access for the browser build of the app, which is served from a
  // different origin than the API. Only the configured origins are allowed, and a
  // preflight is answered here rather than falling through to a route.
  const allowedOrigins = container.config.app.corsOrigins;
  if (allowedOrigins.length) {
    const allowAny = allowedOrigins.includes("*");
    app.addHook("onRequest", async (request, reply) => {
      const origin = request.headers.origin;
      if (!origin) return;
      if (!allowAny && !allowedOrigins.includes(origin)) return;
      // With a wildcard the response cannot be credentialed, so the app signs its
      // requests with a bearer token instead of relying on the session cookie.
      reply.header("access-control-allow-origin", allowAny ? "*" : origin);
      reply.header("vary", "origin");
      if (!allowAny) reply.header("access-control-allow-credentials", "true");
      reply.header("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      reply.header("access-control-allow-headers", "content-type,authorization");
      reply.header("access-control-max-age", "600");
      if (request.method === "OPTIONS") reply.code(204).send();
    });
  }

  // Optional API rate limiting, shared across instances when Redis is configured.
  if (container.config.rateLimit.apiEnabled) {
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0];
      if (path === "/health" || path === "/metrics") return;
      const ip = request.ip || "unknown";
      const r = await container.rateLimit.hit(`api:${ip}`, container.config.rateLimit.api.limit, container.config.rateLimit.api.windowSeconds * 1000);
      if (!r.allowed) {
        reply.header("retry-after", String(r.resetSeconds));
        reply.code(429).send({ error: "rate_limited", retryAfterSeconds: r.resetSeconds });
      }
    });
  }

  // Count every response for the metrics endpoint.
  app.addHook("onResponse", async (request, reply) => {
    const route = (request.routeOptions && request.routeOptions.url) || request.url.split("?")[0];
    metrics.inc("http_requests_total", { method: request.method, route, status: String(reply.statusCode) });
  });

  // Prometheus scrape endpoint.
  if (container.config.observability.metricsEnabled) {
    app.get("/metrics", async (_request, reply) => {
      reply.header("content-type", "text/plain; version=0.0.4");
      return metrics.render();
    });
  }

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
  registerSupervisorRoutes(app, container);
  registerResidentRoutes(app, container);

  // Interactive API documentation. Generated from the routes that are actually
  // registered, so it cannot drift from what the server serves. Registered last so
  // every route above is already known to Fastify.
  if (container.config.observability.docsEnabled) {
    registerRouteDocs();
    let cached: unknown = null;
    app.get("/openapi.json", async () => {
      if (!cached) {
        cached = buildOpenApiDocument(registeredRoutes, {
          version: container.config.app.version,
          baseUrl: container.config.app.publicUrl,
        });
      }
      return cached;
    });
    app.get("/docs", async (_request, reply) => {
      reply.header("content-type", "text/html; charset=utf-8");
      return SWAGGER_UI_HTML;
    });
  }

  return app;
}
