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
import { registerServiceRoutes } from "./routes/services";
import { buildOpenApiDocument, SWAGGER_UI_HTML, type RegisteredRoute } from "./openapi";
import { registerRouteDocs } from "./route-docs";
import { ForbiddenScopeError } from "../domain/access";

// Walks a parsed body looking for a null byte in any string. Bodies are small, and
// this runs once per request in place of a check on every field of every schema.
function containsNullByte(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some((item) => containsNullByte(item, depth + 1));
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes("\u0000") || containsNullByte(item, depth + 1)) return true;
    }
  }
  return false;
}

export function buildApp(container: Container): FastifyInstance {
  const app = Fastify({
    logger: { level: container.config.app.logLevel },
    // Big enough for a photograph on a support ticket, and no bigger.
    //
    // Fastify's default is one megabyte. The attachment rule allows two, and base64
    // inflates by a third on the way through JSON — so the cap the API advertised
    // could never actually be reached, and a legitimate one-and-a-half megabyte
    // photograph came back 413 from the framework before the rule that would have
    // accepted it ever ran. Six leaves room for the encoding and still bounds the
    // request; the two megabyte limit is enforced on the decoded bytes, where it
    // means something.
    bodyLimit: 6 * 1024 * 1024,
  });

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
    try {
      const parsed = raw.length ? JSON.parse(raw) : {};
      // PostgreSQL cannot store a null byte inside a JSONB document, and nothing a
      // person would type into a name, a note or a description contains one. Left
      // alone it reaches the driver and comes back as 22P05, which is a 500 for
      // something the caller could have avoided. One check here covers every write
      // endpoint rather than a validator on every text field.
      if (containsNullByte(parsed)) {
        const rejected = new Error("A text value contains a null byte, which cannot be stored") as Error & { statusCode?: number; code?: string };
        rejected.statusCode = 400;
        rejected.code = "FST_ERR_CTP_INVALID_JSON_BODY";
        done(rejected, undefined);
        return;
      }
      done(null, parsed);
    }
    catch (error) {
      // A body the client could not serialise is the client's mistake, not ours.
      // Fastify's built-in parser marks this 400; ours has to say so explicitly,
      // otherwise a malformed body surfaces as a 500 and looks like a server fault.
      const failure = error as Error & { statusCode?: number; code?: string };
      failure.statusCode = 400;
      failure.code = "FST_ERR_CTP_INVALID_JSON_BODY";
      done(failure, undefined);
    }
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
  registerServiceRoutes(app, container);

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

  // One shape for every error the API can answer with. Routes still handle the
  // failures they know how to explain; this catches everything that reaches the
  // framework, so a caller never gets Fastify's own error body in one place and
  // { error, message } in another, and never gets a stack trace at all.
  app.setErrorHandler((error: unknown, request, reply) => {
    const failure = error as { statusCode?: number; code?: string; message?: string };
    const status = typeof failure.statusCode === "number" && failure.statusCode >= 400 && failure.statusCode < 600
      ? failure.statusCode
      : 500;

    // A scope failure that escaped its route is still a scope failure.
    if (error instanceof ForbiddenScopeError) {
      return reply.code(403).send({ error: "forbidden_scope", message: error.message });
    }

    if (status >= 500) {
      // Logged in full, answered in outline: the detail belongs in the operator's
      // logs, not in the response to whoever triggered it.
      request.log.error({ err: error, url: request.url }, "unhandled error");
      metrics.inc("wnp_unhandled_errors_total", { method: request.method });
      return reply.code(500).send({ error: "internal_error", message: "Something went wrong. The problem has been logged." });
    }

    return reply.code(status).send({
      error: failure.code ?? "request_failed",
      message: failure.message ?? "Request failed.",
    });
  });

  // And one shape for a route that does not exist, rather than Fastify's default.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: "not_found", message: `No route for ${request.method} ${request.url}` });
  });

  return app;
}
