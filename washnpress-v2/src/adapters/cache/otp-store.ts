import type Redis from "ioredis";

// What is held against a phone number between asking for a code and using it.
//
// `attempts` and `lockedUntil` outlive the code itself: the point of carrying them
// is that asking for a new code must not wipe the record of the guesses already
// made against the old one.
export interface OtpRecord {
  otp: string;
  issuedAt: string;
  attempts: number;
  lockedUntil: string | null;
}

// Where a pending login lives.
//
// It used to be a Map on the service instance, which is the reported "intermittent
// login failure": a deploy, a crash, or a second replica taking the verify request
// means the code the resident is reading off their phone was issued into a process
// that no longer holds it, and they are told it expired. Redis is already configured
// and already carries sessions and rate limits, so the pending login belongs there
// too.
export interface OtpStore {
  get(phone: string): Promise<OtpRecord | null>;
  set(phone: string, record: OtpRecord, ttlSeconds: number): Promise<void>;
  delete(phone: string): Promise<void>;
  // Returns the new count. Atomic where the backing store can be, because two
  // replicas taking two wrong guesses at once must cost two attempts, not one.
  incrementAttempts(phone: string, ttlSeconds: number): Promise<number>;
}

// Correct for a single instance and for tests. Anything with more than one replica,
// or a process that restarts, needs the Redis one.
export class MemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, { record: OtpRecord; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  async get(phone: string): Promise<OtpRecord | null> {
    const entry = this.records.get(phone);
    if (!entry) return null;
    // Expiry is checked on read rather than swept, so a stale record can never be
    // handed back as a live one after a clock has moved past it.
    if (entry.expiresAt <= this.now()) { this.records.delete(phone); return null; }
    return { ...entry.record };
  }

  async set(phone: string, record: OtpRecord, ttlSeconds: number): Promise<void> {
    this.records.set(phone, { record: { ...record }, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async delete(phone: string): Promise<void> { this.records.delete(phone); }

  async incrementAttempts(phone: string, ttlSeconds: number): Promise<number> {
    const entry = this.records.get(phone);
    if (!entry) return 0;
    entry.record.attempts += 1;
    entry.expiresAt = this.now() + ttlSeconds * 1000;
    return entry.record.attempts;
  }
}

// The pending login as a Redis hash with a time to live, so it is shared across
// replicas and clears itself.
//
// The key is namespaced away from `otp:<phone>`, which the rate limiter already
// owns — the limiter INCRs its key, and colliding with it would both destroy the
// record and corrupt the count.
export class RedisOtpStore implements OtpStore {
  constructor(private readonly redis: Redis) {}
  private key(phone: string): string { return `otp:pending:${phone}`; }

  async get(phone: string): Promise<OtpRecord | null> {
    const raw = await this.redis.hgetall(this.key(phone));
    if (!raw || !raw.otp) return null;
    return {
      otp: raw.otp,
      issuedAt: raw.issuedAt,
      attempts: Number(raw.attempts ?? 0),
      lockedUntil: raw.lockedUntil ? raw.lockedUntil : null,
    };
  }

  async set(phone: string, record: OtpRecord, ttlSeconds: number): Promise<void> {
    const key = this.key(phone);
    // The whole record is replaced rather than merged: a resend must not leave the
    // previous code's `lockedUntil` behind once the lockout has been served.
    await this.redis.del(key);
    await this.redis.hset(key, {
      otp: record.otp,
      issuedAt: record.issuedAt,
      attempts: String(record.attempts),
      lockedUntil: record.lockedUntil ?? "",
    });
    await this.redis.expire(key, ttlSeconds);
  }

  async delete(phone: string): Promise<void> { await this.redis.del(this.key(phone)); }

  async incrementAttempts(phone: string, ttlSeconds: number): Promise<number> {
    const key = this.key(phone);
    const count = await this.redis.hincrby(key, "attempts", 1);
    // HINCRBY creates the key if the record expired between the read and this call.
    // Re-applying the expiry stops that fragment outliving the login it belongs to.
    await this.redis.expire(key, ttlSeconds);
    return count;
  }
}
