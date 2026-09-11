import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError, humanMessage } from "../src/api/client";
import { MAX_ATTEMPTS, isConnectivityFailure } from "../src/api/request-rules";

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

// Round 12: the client was a bare fetch. A rejection reached the screen with the
// platform's own words on it — "Network request failed", and the `requestTimedOut`
// an operator reported from a failed sign-in — and a single dropped packet on a
// lift-lobby signal was a failed request rather than a retried one.

function rejectsWith(error: unknown, times = Infinity) {
  let calls = 0;
  const fetchMock = vi.fn(async () => {
    calls += 1;
    if (calls <= times) throw error;
    return { ok: true, status: 200, statusText: "OK", text: async () => "{}" };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls: () => fetchMock.mock.calls.length };
}

describe("a request that never reached the server", () => {
  it("does not put the platform's own message in front of the user", async () => {
    rejectsWith(new TypeError("Network request failed"));
    const failure = await api.getServices().catch((e) => e as ApiError);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.message).not.toMatch(/Network request failed|requestTimedOut|TypeError/);
    expect(failure.message).toMatch(/try again/i);
  });

  it("is not a 401, so a brief outage never looks like a rejected session", async () => {
    // App.tsx clears the stored token on 401 and only on 401.
    rejectsWith(new TypeError("Network request failed"));
    const failure = await api.getServices().catch((e) => e as ApiError);
    expect(failure.status).toBe(0);
  });

  it("carries a code the app can act on rather than a message to match against", async () => {
    rejectsWith(new TypeError("Network request failed"));
    const failure = await api.getServices().catch((e) => e as ApiError);
    expect(isConnectivityFailure(failure)).toBe(true);
  });
});

describe("asking again", () => {
  it("retries a read that failed for want of a connection", async () => {
    const seen = rejectsWith(new TypeError("Network request failed"), 2);
    await expect(api.getServices()).resolves.toEqual({});
    expect(seen.calls()).toBe(3);
  });

  it("gives up after a bounded number of attempts rather than hanging on", async () => {
    const seen = rejectsWith(new TypeError("Network request failed"));
    await expect(api.getServices()).rejects.toBeInstanceOf(ApiError);
    expect(seen.calls()).toBe(MAX_ATTEMPTS);
  });

  it("never repeats a write, because a lost reply is not a failed action", async () => {
    // Sending a pickup confirmation twice is a second collection on the same order.
    const seen = rejectsWith(new TypeError("Network request failed"));
    await expect(api.sendOtp("9876543210")).rejects.toBeInstanceOf(ApiError);
    expect(seen.calls()).toBe(1);
  });

  it("does not repeat a request the server actually answered", async () => {
    respondWith(JSON.stringify({ error: "server_error" }), { status: 500 });
    await expect(api.getServices()).rejects.toBeInstanceOf(ApiError);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("a failed request explains itself to a person", () => {
  // The client used to fall back to the response's machine code, so a mistyped OTP
  // put the literal token `otp_invalid` under the code box, and a form the server
  // rejected put `invalid_request` under the form. Neither says what to change.
  it("prefers a sentence the server wrote", () => {
    expect(humanMessage({ error: "otp_invalid", message: "Incorrect OTP" }, 401)).toBe("Incorrect OTP");
  });

  it("names the field when a schema rejected the body", () => {
    // Far more useful than any generic sentence: it says which box is wrong.
    expect(humanMessage({ error: "invalid_request", details: { fieldErrors: { floorCount: ["Must be a positive number"] } } }, 400))
      .toBe("Floor count: Must be a positive number");
  });

  it("never shows a bare machine code", () => {
    expect(humanMessage({ error: "invalid_request" }, 400)).toBe("Invalid request");
    expect(humanMessage({ error: "block_outside_society" }, 422)).toBe("Block outside society");
  });

  it("falls back to something true when the body says nothing", () => {
    expect(humanMessage({}, 500)).toBe("Request failed (500)");
  });
});
