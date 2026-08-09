import { describe, it, expect } from "vitest";
import { FixedWindowRateLimiter } from "../../src/domain/rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit then blocks within the window", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(2, 1000, () => now);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
  });
  it("resets after the window passes", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, 1000, () => now);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
    now = 1001;
    expect(limiter.check("k").allowed).toBe(true);
  });
});
