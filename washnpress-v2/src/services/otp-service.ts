import {
  generateOtp, isOtpUsable, isValidIndianMobile,
  lockoutUntil, lockoutWaitSeconds, resendWaitSeconds,
} from "../domain/otp";
import type { AppConfig } from "../config";
import type { RateLimitStore } from "../ports/repositories";
import { MemoryOtpStore, type OtpStore } from "../adapters/cache/otp-store";
import { createOtpSender, type OtpSender } from "../adapters/notifications/sms-otp";
import { OneAtATime } from "./one-at-a-time";

export class OtpService {
  constructor(
    private readonly config: AppConfig,
    private readonly rateLimit: RateLimitStore,
    // Both default so the existing wiring keeps working, and both are meant to be
    // supplied: the sender decides whether a code reaches a handset, and the store
    // decides whether it survives a restart or a second replica.
    private readonly sender: OtpSender = createOtpSender(config),
    private readonly store: OtpStore = new MemoryOtpStore(),
    private readonly rng?: () => number,
  ) {}

  private readonly sends = new OneAtATime();

  // A record has to outlive the code it holds, because the lockout it carries is
  // longer than the code's time to live and is the whole point of the lockout.
  private recordTtlSeconds(): number {
    return Math.max(this.config.auth.otpTtlSeconds, this.config.auth.lockoutMinutes * 60) + 60;
  }

  // `resendAfterSeconds` is the cooldown the caller must wait before asking again.
  // The clients need it to offer a working "Resend code": without it each one would
  // have to hardcode a guess at this deployment's cooldown, and be wrong whenever it
  // is configured differently — offering a button that the server then refuses.
  async send(phone: string, now: Date = new Date()): Promise<{ sent: boolean; otpForTesting?: string; resendAfterSeconds: number }> {
    // One send per number at a time.
    //
    // This is the reported "intermittent Invalid OTP". The cooldown below is read
    // from the store and the new code is written to it after the gateway has been
    // called, so two sends that arrive together — a double tap on Send OTP, a client
    // retrying a request whose answer was lost, the login screen's effect running
    // twice — both read a store with nothing in it, both pass the cooldown, and both
    // send a text. Two codes reach the handset, only the one that happened to be
    // written last is held, and SMS does not promise to deliver in the order it was
    // given. The resident reads a code that genuinely was sent to them, types it
    // correctly, and is told it is wrong.
    //
    // Queued rather than rejected outright, so the second caller reaches the cooldown
    // rule with the first one's record in front of it and is answered by that rule —
    // which is what `resendCooldownSeconds` was there to do.
    return this.sends.run(phone, () => this.sendOnce(phone, now));
  }

  private async sendOnce(phone: string, now: Date): Promise<{ sent: boolean; otpForTesting?: string; resendAfterSeconds: number }> {
    if (!isValidIndianMobile(phone)) throw new Error("Invalid Indian mobile number");
    if (this.config.rateLimit.otpSendEnabled) {
      const limit = await this.rateLimit.hit(`otp:${phone}`, this.config.rateLimit.otpSend.limit, this.config.rateLimit.otpSend.windowSeconds * 1000);
      if (!limit.allowed) throw new Error(`Too many OTP requests, retry in ${limit.resetSeconds} seconds`);
    }

    const existing = await this.store.get(phone);
    // A number serving a lockout cannot buy its way out with a fresh code, which is
    // exactly what it used to be able to do.
    const locked = lockoutWaitSeconds(existing?.lockedUntil ?? null, now);
    if (locked > 0) throw new Error(`Too many incorrect codes, retry in ${locked} seconds`);
    if (existing) {
      const wait = resendWaitSeconds(existing.issuedAt, now, this.config.auth.resendCooldownSeconds);
      if (wait > 0) throw new Error(`A code was already sent, retry in ${wait} seconds`);
    }

    const servedLockout = existing?.lockedUntil != null && locked === 0;
    const otp = generateOtp(this.config.auth.otpLength, this.rng);
    // Delivered before it is stored. The other order looks safer and is not: a
    // gateway that fails after the record is written leaves a fresh `issuedAt`
    // behind, so the resend the caller immediately makes is refused by the cooldown
    // and they are locked out of logging in by a gateway hiccup.
    await this.sender.send(phone, otp, this.config.auth.otpTtlSeconds);
    await this.store.set(phone, {
      otp,
      issuedAt: now.toISOString(),
      // The guesses already made are carried over. Resetting them here is what made
      // `otpMaxAttempts` decorative: guess to the cap, resend, guess again.
      // A lockout that has been served clears the count it was imposed for;
      // otherwise the number would come out of its fifteen minutes with no guesses
      // left and be locked out again on its first mistake, forever.
      attempts: servedLockout ? 0 : (existing?.attempts ?? 0),
      lockedUntil: null,
    }, this.recordTtlSeconds());

    // Non-production returns the code so the portals and the API documentation are
    // usable without a gateway. Production never does, which is why the sender above
    // has to be a real one before production can log anybody in.
    const expose = this.config.app.env !== "production";
    return {
      sent: true,
      otpForTesting: expose ? otp : undefined,
      resendAfterSeconds: this.config.auth.resendCooldownSeconds,
    };
  }

  async verify(phone: string, input: string, now: Date = new Date()): Promise<{ verified: boolean; reason?: string }> {
    const record = await this.store.get(phone);
    if (!record) return { verified: false, reason: "OTP expired or not found" };

    const locked = lockoutWaitSeconds(record.lockedUntil, now);
    if (locked > 0) return { verified: false, reason: `Too many attempts, retry in ${locked} seconds` };

    const check = isOtpUsable(input, record.issuedAt, record.attempts, now, record.otp, {
      ttlSeconds: this.config.auth.otpTtlSeconds,
      maxAttempts: this.config.auth.otpMaxAttempts,
    });
    if (!check.ok) {
      const attempts = await this.store.incrementAttempts(phone, this.recordTtlSeconds());
      const until = lockoutUntil(attempts, this.config.auth.otpMaxAttempts, now, this.config.auth.lockoutMinutes);
      if (until) {
        // Read again rather than writing back the record this verify started with. A
        // resend that landed in between has already put a new code in the store, and
        // writing the snapshot would restore the dead one over it — the number would
        // come out of its lockout holding a code its handset never received.
        const current = (await this.store.get(phone)) ?? record;
        await this.store.set(phone, { ...current, attempts, lockedUntil: until }, this.recordTtlSeconds());
      }
      return { verified: false, reason: check.reason };
    }
    await this.store.delete(phone);
    return { verified: true };
  }
}
