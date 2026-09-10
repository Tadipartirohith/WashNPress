import { describe, it, expect } from "vitest";
import {
  MAX_ATTEMPTS, NETWORK_ERROR_CODE, TIMEOUT_ERROR_CODE,
  connectivityMessage, isConnectivityFailure, retryDelayMs, shouldRetry,
} from "../src/api/request-rules";

// The client was a bare fetch: no timeout, no retry, and a rejection that reached
// the screen with the platform's own words on it. The operator report was a login
// that failed with `requestTimedOut`, which is a message from iOS to itself.

const network = { code: NETWORK_ERROR_CODE };
const timeout = { code: TIMEOUT_ERROR_CODE };
const refused = { code: "slot_unavailable", status: 409 };

describe("telling a failure that never reached the server from one that did", () => {
  it("recognises both ways a request can fail without an answer", () => {
    expect(isConnectivityFailure(network)).toBe(true);
    expect(isConnectivityFailure(timeout)).toBe(true);
  });

  it("does not mistake a refusal for connectivity loss", () => {
    expect(isConnectivityFailure(refused)).toBe(false);
    // The check used to be a regular expression over the message, so a support
    // ticket about the society's network would have been queued as offline work.
    expect(isConnectivityFailure(new Error("the network cable in the clubhouse"))).toBe(false);
  });

  it("survives being handed nothing at all", () => {
    expect(isConnectivityFailure(null)).toBe(false);
    expect(isConnectivityFailure(undefined)).toBe(false);
    expect(isConnectivityFailure("Network request failed")).toBe(false);
  });
});

describe("what a connectivity failure is allowed to say", () => {
  it("names something the person can do about it", () => {
    for (const code of [NETWORK_ERROR_CODE, TIMEOUT_ERROR_CODE]) {
      expect(connectivityMessage(code)).toMatch(/try again/i);
    }
  });

  it("never repeats the platform's own wording", () => {
    for (const code of [NETWORK_ERROR_CODE, TIMEOUT_ERROR_CODE]) {
      expect(connectivityMessage(code)).not.toMatch(/requestTimedOut|Network request failed|AbortError/);
    }
  });

  it("distinguishes waiting too long from not arriving", () => {
    expect(connectivityMessage(TIMEOUT_ERROR_CODE)).not.toBe(connectivityMessage(NETWORK_ERROR_CODE));
  });
});

describe("which requests are worth sending again", () => {
  it("retries a read that never reached the server", () => {
    expect(shouldRetry("GET", 1, network)).toBe(true);
    expect(shouldRetry("get", 1, timeout)).toBe(true);
  });

  it("never repeats a write, because a lost reply is not a failed action", () => {
    // A pickup confirmation that timed out may well have been recorded. Sending it
    // twice is a second collection on the same order.
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(shouldRetry(method, 1, timeout)).toBe(false);
    }
  });

  it("does not retry something the server actually answered", () => {
    expect(shouldRetry("GET", 1, refused)).toBe(false);
  });

  it("stops at the cap", () => {
    expect(shouldRetry("GET", MAX_ATTEMPTS - 1, network)).toBe(true);
    expect(shouldRetry("GET", MAX_ATTEMPTS, network)).toBe(false);
    expect(shouldRetry("GET", MAX_ATTEMPTS + 1, network)).toBe(false);
  });
});

describe("the wait between attempts", () => {
  it("backs off rather than failing three times in the same instant", () => {
    expect(retryDelayMs(1)).toBeGreaterThan(0);
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
  });

  it("stays short enough that somebody is still holding the phone", () => {
    // Every delay before the cap, summed, has to be a pause and not an outage.
    let total = 0;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) total += retryDelayMs(attempt);
    expect(total).toBeLessThan(3000);
  });
});
