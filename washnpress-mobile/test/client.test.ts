import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError } from "../src/api/client";

// The frontend defects from the sixth round: a response that is not JSON crashed
// the client with a parser error instead of saying what went wrong.

const originalFetch = globalThis.fetch;

function respondWith(body: string, init: { status?: number; statusText?: string } = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    text: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { globalThis.fetch = originalFetch; });

describe("a response the client cannot read", () => {
  it("does not surface a parser error to the user", async () => {
    // What a proxy or a misconfigured gateway actually returns.
    respondWith("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", { status: 502, statusText: "Bad Gateway" });
    await expect(api.getServices()).rejects.toBeInstanceOf(ApiError);
    await expect(api.getServices()).rejects.toThrow(/Request failed \(502/);
  });

  it("says so even when the status was a success", async () => {
    respondWith("not json at all", { status: 200 });
    const failure = await api.getServices().catch((e) => e as ApiError);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.code).toBe("invalid_response");
    // A sentence rather than "Unexpected token < in JSON at position 0".
    expect(failure.message).not.toMatch(/JSON|token|position/i);
  });

  it("still reads a real error body", async () => {
    respondWith(JSON.stringify({ error: "forbidden_scope", message: "That issue is outside your area." }), { status: 403 });
    const failure = await api.getServices().catch((e) => e as ApiError);
    expect(failure.status).toBe(403);
    expect(failure.code).toBe("forbidden_scope");
    expect(failure.message).toBe("That issue is outside your area.");
  });

  it("treats an empty body as an empty answer rather than a failure", async () => {
    respondWith("", { status: 200 });
    await expect(api.getServices()).resolves.toEqual({});
  });
});
