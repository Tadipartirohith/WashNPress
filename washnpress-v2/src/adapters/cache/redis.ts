import Redis from "ioredis";
import type { RateHit, RateLimitStore, SessionRepository } from "../../ports/repositories";
import type { Session } from "../../domain/models";

export function createRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
}

// Shared fixed window limiter across instances. INCR is atomic, and the key expires
// after one window so counts reset automatically.
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}
  async hit(key: string, limit: number, windowMs: number): Promise<RateHit> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, windowMs);
    const ttl = await this.redis.pttl(key);
    const resetSeconds = Math.ceil((ttl > 0 ? ttl : windowMs) / 1000);
    if (count > limit) return { allowed: false, remaining: 0, resetSeconds };
    return { allowed: true, remaining: limit - count, resetSeconds };
  }
}

// Sessions held in Redis with a time to live, so they are shared across instances and
// expire on their own.
export class RedisSessionRepository implements SessionRepository {
  constructor(private readonly redis: Redis, private readonly ttlSeconds: number) {}
  private key(token: string): string { return `session:${token}`; }
  async create(session: Session): Promise<Session> {
    await this.redis.set(this.key(session.token), JSON.stringify(session), "EX", this.ttlSeconds);
    return session;
  }
  async findByToken(token: string): Promise<Session | null> {
    const raw = await this.redis.get(this.key(token));
    return raw ? (JSON.parse(raw) as Session) : null;
  }
  async delete(token: string): Promise<void> { await this.redis.del(this.key(token)); }
}
