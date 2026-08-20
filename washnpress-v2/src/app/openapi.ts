import type { FastifySchema } from "fastify";

// The OpenAPI document is generated from the routes themselves rather than kept in a
// parallel file, so it cannot drift from what the server actually serves. Each route
// carries a small `schema` describing it; anything without one still appears, which
// makes an undocumented endpoint visible rather than invisible.

export interface RouteDoc {
  summary: string;
  description?: string;
  tags: string[];
  // Roles allowed to call it, rendered into the description so a tester knows which
  // token to use before they press Try it out.
  roles?: string[];
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  responses?: Record<string, string>;
}

const registry = new Map<string, RouteDoc>();

export function docKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

// Attaches documentation to a route. Returns a Fastify schema object so it can be
// passed straight into the route options.
export function doc(method: string, url: string, info: RouteDoc): FastifySchema {
  registry.set(docKey(method, url), info);
  return {} as FastifySchema;
}

export function describedRoutes(): Map<string, RouteDoc> {
  return registry;
}

function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function paramNames(url: string): string[] {
  return [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: { type: "string", description: "Stable machine readable code" },
    message: { type: "string" },
  },
  required: ["error"],
};

export interface RegisteredRoute { method: string; url: string }

// `routes` is collected from Fastify's onRoute hook, which is the only list that is
// guaranteed to match what the server actually serves.
export function buildOpenApiDocument(routes: RegisteredRoute[], options: { version: string; baseUrl: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const info = registry.get(docKey(route.method, route.url));
    const path = toOpenApiPath(route.url);
    paths[path] = paths[path] ?? {};

    const parameters = [
      ...paramNames(route.url).map((name) => ({
        name, in: "path", required: true,
        schema: { type: "string" },
        description: info?.params?.[name] ?? "",
      })),
      ...Object.entries(info?.query ?? {}).map(([name, description]) => ({
        name, in: "query", required: false, schema: { type: "string" }, description,
      })),
    ];

    const responses: Record<string, unknown> = {
      "200": { description: info?.responses?.["200"] ?? "Success" },
    };
    for (const [code, description] of Object.entries(info?.responses ?? {})) {
      responses[code] = {
        description,
        ...(code.startsWith("4") || code.startsWith("5")
          ? { content: { "application/json": { schema: ERROR_SCHEMA } } }
          : {}),
      };
    }
    if (!responses["401"]) responses["401"] = { description: "No valid session", content: { "application/json": { schema: ERROR_SCHEMA } } };

    const roleNote = info?.roles?.length
      ? `\n\n**Roles:** ${info.roles.join(", ")}. The scope comes from the session, so a request for another area returns the same answer as one for a resource that does not exist.`
      : "";

    paths[path][route.method.toLowerCase()] = {
      summary: info?.summary ?? `${route.method} ${route.url}`,
      description: `${info?.description ?? (info ? "" : "This endpoint is not yet documented.")}${roleNote}`,
      tags: info?.tags ?? ["Undocumented"],
      security: [{ bearerAuth: [] }],
      ...(parameters.length ? { parameters } : {}),
      ...(info?.body && route.method !== "GET"
        ? { requestBody: { required: true, content: { "application/json": { schema: info.body } } } }
        : {}),
      responses,
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Wash N Press API",
      version: options.version,
      description: [
        "The Wash N Press platform API.",
        "",
        "Authenticate with `POST /v1/auth/otp/send` then `POST /v1/auth/otp/verify`. In local mode the",
        "verify response includes `otpForTesting`, so no SMS gateway is needed. Paste the returned",
        "`token` into Authorize to call the protected endpoints.",
        "",
        "Demo accounts: resident 9876543210, operations 9876500002, supervisor 9876500011, admin 9876500001.",
        "",
        "Every endpoint is scoped by the role on the session. See docs/RBAC.md for the matrix.",
      ].join("\n"),
    },
    servers: [{ url: options.baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "The token returned by /v1/auth/otp/verify" },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
    tags: [
      { name: "Auth", description: "Sign in, onboarding and identity" },
      { name: "Catalog", description: "Plans, add-ons and societies" },
      { name: "Resident", description: "The resident portal" },
      { name: "Scheduling", description: "Slots, booking and pickups" },
      { name: "Subscription", description: "Plans and usage" },
      { name: "Wallet", description: "Balance, transactions and top up" },
      { name: "Support", description: "Customer support tickets" },
      { name: "Operations", description: "The operations portal" },
      { name: "Supervisor", description: "The supervisor portal, scoped to one area" },
      { name: "Admin", description: "The admin portal, system wide" },
      { name: "Payments", description: "Provider webhooks" },
      { name: "Operational", description: "Health and metrics" },
    ],
    paths,
  };
}

// The Swagger UI page. The viewer itself is loaded from a CDN to keep the image
// small; when that is unreachable the page says so and points at /openapi.json,
// which is served by this app and is the actual source of truth.
export const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wash N Press API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
      .fallback { padding: 32px; max-width: 760px; margin: 0 auto; color: #24343a; }
      .fallback code { background: #eef3f3; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div id="swagger"></div>
    <noscript class="fallback">
      <h1>Wash N Press API</h1>
      <p>Swagger UI needs JavaScript. The raw document is at <code>/openapi.json</code>.</p>
    </noscript>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.addEventListener('load', function () {
        if (typeof SwaggerUIBundle === 'undefined') {
          document.getElementById('swagger').innerHTML =
            '<div class="fallback"><h1>Wash N Press API</h1>' +
            '<p>Swagger UI could not be loaded from the network. The full OpenAPI document is still ' +
            'available at <code>/openapi.json</code> and can be opened in any OpenAPI viewer.</p></div>';
          return;
        }
        SwaggerUIBundle({
          url: '/openapi.json',
          dom_id: '#swagger',
          docExpansion: 'none',
          persistAuthorization: true,
          tryItOutEnabled: true
        });
      });
    </script>
  </body>
</html>`;
