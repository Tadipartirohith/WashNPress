import type { RateHit, RateLimitStore } from "../../ports/repositories";

// Fixed window rate limiter kept in process memory. Correct for a single instance and
// for tests. Under multiple instances use the Redis backed store so the window is shared.
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateHit> {
    const current = this.now();
    const record = this.hits.get(key);
    if (!record || current - record.windowStart >= windowMs) {
      this.hits.set(key, { count: 1, windowStart: current });
      return { allowed: true, remaining: limit - 1, resetSeconds: Math.ceil(windowMs / 1000) };
    }
    if (record.count >= limit) {
      return { allowed: false, remaining: 0, resetSeconds: Math.ceil((record.windowStart + windowMs - current) / 1000) };
    }
    record.count += 1;
    return { allowed: true, remaining: limit - record.count, resetSeconds: Math.ceil((record.windowStart + windowMs - current) / 1000) };
  }
}
