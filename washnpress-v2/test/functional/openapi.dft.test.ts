import { describe, it, expect } from "vitest";
import { makeTestApp } from "./helpers";

// The API documentation is generated from the routes the server actually registers,
// so an endpoint cannot be served without appearing in it.
describe("DFT API documentation", () => {
  it("serves an OpenAPI document covering the registered routes", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe("Wash N Press API");
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");

    for (const path of [
      "/v1/auth/otp/verify",
      "/v1/pickups",
      "/v1/operations/orders/{id}/picked-up",
      "/v1/supervisor/dashboard",
      "/v1/admin/config",
      "/v1/support/tickets",
    ]) {
      expect(spec.paths[path], `${path} is missing from the document`).toBeDefined();
    }

    const pickedUp = spec.paths["/v1/operations/orders/{id}/picked-up"].post;
    expect(pickedUp.tags).toContain("Operations");
    expect(pickedUp.requestBody.content["application/json"].schema.properties.items).toBeDefined();
    // The path parameter is derived from the route, so it cannot be forgotten.
    expect(pickedUp.parameters.some((p: { name: string; in: string }) => p.name === "id" && p.in === "path")).toBe(true);
    // The roles allowed are stated, so a tester knows which token to authorise with.
    expect(pickedUp.description).toContain("operator");
    await app.close();
  });

  it("documents every route the server serves", async () => {
    const { app } = await makeTestApp();
    const spec = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    const undocumented: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths as Record<string, Record<string, { tags: string[] }>>)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (operation.tags?.includes("Undocumented")) undocumented.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(undocumented).toEqual([]);
    await app.close();
  });

  it("serves the Swagger UI page", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("/openapi.json");
    await app.close();
  });
});
