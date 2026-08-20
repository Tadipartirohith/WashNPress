import { describe, it, expect } from "vitest";
import { makeTestApp } from "./helpers";

// The browser build of the app runs on a different origin from the API, so the
// API has to say so explicitly or the browser blocks every call.
describe("DFT cross origin access", () => {
  it("answers a preflight without falling through to a route", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({
      method: "OPTIONS", url: "/v1/auth/otp/send",
      headers: { origin: "http://localhost:8081", "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(String(res.headers["access-control-allow-headers"])).toContain("authorization");
    await app.close();
  });

  it("marks ordinary responses as readable by the browser", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:8081" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    await app.close();
  });

  it("leaves same origin requests untouched", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
