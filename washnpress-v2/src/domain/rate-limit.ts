export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

// A simple fixed window limiter. In production the same interface is backed by
// Redis so the window is shared across instances; this in-memory version keeps
// the domain logic testable without external services.
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const current = this.now();
    const record = this.hits.get(key);
    if (!record || current - record.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: current });
      return { allowed: true, remaining: this.limit - 1, resetInSeconds: Math.ceil(this.windowMs / 1000) };
    }
    if (record.count >= this.limit) {
      const resetInSeconds = Math.ceil((record.windowStart + this.windowMs - current) / 1000);
      return { allowed: false, remaining: 0, resetInSeconds };
    }
    record.count += 1;
    const resetInSeconds = Math.ceil((record.windowStart + this.windowMs - current) / 1000);
    return { allowed: true, remaining: this.limit - record.count, resetInSeconds };
  }
}
