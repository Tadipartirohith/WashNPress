import { describe, it, expect } from "vitest";
import { MemoryRateLimitStore } from "../../src/adapters/cache/memory-rate-limit";

describe("memory rate limit store", () => {
  it("allows up to the limit then blocks in the window", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    expect((await store.hit("k", 2, 1000)).allowed).toBe(true);
    expect((await store.hit("k", 2, 1000)).allowed).toBe(true);
    expect((await store.hit("k", 2, 1000)).allowed).toBe(false);
    now = 1001;
    expect((await store.hit("k", 2, 1000)).allowed).toBe(true);
  });
});
