import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError, humanMessage } from "../src/api/client";
import { MAX_ATTEMPTS, isConnectivityFailure } from "../src/api/request-rules";
import { historyQuery } from "../src/portals/operations-history-rules";
import { createIssuePayload } from "../src/portals/operations-issues-rules";
import { pickupFailRequest } from "../src/portals/operations-pickup-row-rules";
import { deliveryPayload } from "../src/portals/operations-delivery-rules";
import { qcBatchFailPayload } from "../src/portals/operations-qc-rules";

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

describe("opsHistoryAll matches Web historyAll", () => {
  it("GETs /v1/operations/history/all with the same query keys and no body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({ records: [], page: { total: 0, limit: 20, offset: 20, hasMore: false } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.opsHistoryAll("tok", historyQuery({
      type: "service", status: "completed", dateBucket: "custom",
      from: "2026-08-01", to: "2026-08-15", q: "Ravi", offset: 20,
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/operations/history/all?");
    expect(url).toContain("type=service");
    expect(url).toContain("status=completed");
    expect(url).toContain("dateBucket=custom");
    expect(url).toContain("from=2026-08-01");
    expect(url).toContain("to=2026-08-15");
    expect(url).toContain("q=Ravi");
    expect(url).toContain("limit=20");
    expect(url).toContain("offset=20");
    expect(String(init.method ?? "GET").toUpperCase()).toBe("GET");
    expect(init.body).toBeUndefined();
  });
});

describe("opsCreateIssue matches Web createIssue", () => {
  it("POSTs /v1/operations/issues without orderId when none was given", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 201, statusText: "Created",
      text: async () => JSON.stringify({ issue: { id: "iss-1" } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.opsCreateIssue(createIssuePayload({
      type: "other", description: "Bag left at gate", priority: "normal",
    }), "tok");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/operations/issues");
    expect(String(init.method).toUpperCase()).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "other", description: "Bag left at gate", priority: "normal",
    });
  });

  it("includes a trimmed orderId when one is given", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 201, statusText: "Created",
      text: async () => JSON.stringify({ issue: { id: "iss-2" } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.opsCreateIssue(createIssuePayload({
      type: "damage", description: "Zip broken", priority: "high", orderId: " ord-9 ",
    }), "tok");

    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      type: "damage", description: "Zip broken", orderId: "ord-9", priority: "high",
    });
  });
});

describe("failPickup matches Web pickupFailed", () => {
  it("POSTs /pickup-failed with { reason }", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({ order: { id: "ord-9" } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const call = pickupFailRequest("ord-9", "  Resident out  ")!;
    await api.failPickup("ord-9", call.body.reason, "tok");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(call.path);
    expect(String(init.method).toUpperCase()).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Resident out" });
  });
});

describe("deliver matches Web deliver", () => {
  it("omits discrepancyReason when the count matches", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({ order: { id: "ord-1" } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const body = deliveryPayload("11", 11, "ignored");
    await api.deliver("ord-1", body.deliveryCount, body.discrepancyReason, "tok");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/operations/orders/ord-1/deliver");
    expect(String(init.method).toUpperCase()).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ deliveryCount: 11 });
  });

  it("sends a trimmed reason when the count differs", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({ order: { id: "ord-1" } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const body = deliveryPayload("10", 11, "  one short  ");
    await api.deliver("ord-1", body.deliveryCount, body.discrepancyReason, "tok");
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      deliveryCount: 10, discrepancyReason: "one short",
    });
  });
});

describe("opsProfile matches Web operationsApi.profile", () => {
  it("GETs /v1/operations/profile", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({
        profile: { email: "op@washnpress.com", flatsCovered: 48 },
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await api.opsProfile("tok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/operations/profile");
    expect(String(init.method ?? "GET").toUpperCase()).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(r.profile.email).toBe("op@washnpress.com");
    expect(r.profile.flatsCovered).toBe(48);
  });
});

describe("opsBatchQc matches Web batchQc evidenceUrl", () => {
  it("includes evidenceUrl when a link is given and omits it when not", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify({ order: {}, batches: [] }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.opsBatchQc("ord-1", "bat-2", false, qcBatchFailPayload({
      reason: "garment_damage", remarks: "rip", evidenceUrl: " https://img.example/a.jpg ",
    }), "tok");
    const withUrl = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(withUrl[0]).toContain("/v1/operations/orders/ord-1/batches/bat-2/qc");
    expect(JSON.parse(String(withUrl[1].body))).toEqual({
      passed: false, reason: "garment_damage", remarks: "rip",
      evidenceUrl: "https://img.example/a.jpg",
    });

    await api.opsBatchQc("ord-1", "bat-2", false, qcBatchFailPayload({
      reason: "poor_ironing", remarks: "crease",
    }), "tok");
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({
      passed: false, reason: "poor_ironing", remarks: "crease",
    });
  });
});
