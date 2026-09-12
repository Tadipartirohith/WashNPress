import { describe, it, expect } from "vitest";
import { loadConfig, resetConfigCache } from "../../src/config";
import { OtpService } from "../../src/services/otp-service";
import { MemoryOtpStore } from "../../src/adapters/cache/otp-store";
import { MemoryRateLimitStore } from "../../src/adapters/cache/memory-rate-limit";
import type { OtpSender } from "../../src/adapters/notifications/sms-otp";

// What happens to a login code between being generated and being used.
//
// The service used to generate a code, put it in a Map on itself and return. Nothing
// was called: no SMS, no notification, nothing. In development the code came back in
// the response so it looked like it worked, and in production it did not, so nobody
// could log in at all. `resendCooldownSeconds` and `lockoutMinutes` were read by
// nothing, and a resend wrote `attempts: 0`, so the attempt cap could be cleared by
// asking for another code.

class RecordingSender implements OtpSender {
  public readonly sent: { phone: string; code: string }[] = [];
  async send(phone: string, code: string): Promise<void> { this.sent.push({ phone, code }); }
}

// The same, but it takes a moment to reach the gateway, which is what a real one
// does and what opens the window two requests arrive in.
class SlowSender implements OtpSender {
  public readonly sent: { phone: string; code: string }[] = [];
  async send(phone: string, code: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.sent.push({ phone, code });
  }
}

const PHONE = "9876543210";

function build(env: Record<string, string> = {}) {
  resetConfigCache();
  const config = loadConfig({
    reload: true,
    env: {
      WNP_APP__ENV: "test",
      WNP_RATELIMIT__OTPSENDENABLED: "false",
      WNP_AUTH__OTPMAXATTEMPTS: "3",
      WNP_AUTH__RESENDCOOLDOWNSECONDS: "30",
      WNP_AUTH__LOCKOUTMINUTES: "15",
      ...env,
    },
  });
  let clock = new Date("2026-01-01T10:00:00.000Z");
  const sender = new RecordingSender();
  const store = new MemoryOtpStore(() => clock.getTime());
  const service = new OtpService(config, new MemoryRateLimitStore(), sender, store);
  return {
    service, sender, store, config,
    now: () => clock,
    advance(seconds: number) { clock = new Date(clock.getTime() + seconds * 1000); },
  };
}

describe("sending a login code", () => {
  it("hands the code to a sender", async () => {
    const t = build();
    const result = await t.service.send(PHONE, t.now());
    expect(result.sent).toBe(true);
    // The assertion the old implementation could never have passed.
    expect(t.sender.sent).toHaveLength(1);
    expect(t.sender.sent[0].phone).toBe(PHONE);
    expect(t.sender.sent[0].code).toBe(result.otpForTesting);
  });

  it("keeps nothing back when the sender refuses", async () => {
    // A gateway that rejects the message must not leave a code the caller was never
    // told about, and must not read as a successful send.
    const t = build();
    const failing: OtpSender = { async send() { throw new Error("gateway rejected"); } };
    const service = new OtpService(t.config, new MemoryRateLimitStore(), failing, t.store);
    await expect(service.send(PHONE, t.now())).rejects.toThrow(/gateway/);
    expect(await t.store.get(PHONE)).toBeNull();
  });

  it("refuses a resend inside the cooldown and allows one after it", async () => {
    const t = build();
    await t.service.send(PHONE, t.now());
    t.advance(10);
    await expect(t.service.send(PHONE, t.now())).rejects.toThrow(/retry in 20 seconds/);
    t.advance(20);
    await expect(t.service.send(PHONE, t.now())).resolves.toMatchObject({ sent: true });
    expect(t.sender.sent).toHaveLength(2);
  });
});

describe("verifying a login code", () => {
  it("accepts the code that was sent, once", async () => {
    const t = build();
    const { otpForTesting } = await t.service.send(PHONE, t.now());
    expect(await t.service.verify(PHONE, otpForTesting!, t.now())).toEqual({ verified: true });
    // Spent. A code that survived its own use would be a replayable password.
    expect((await t.service.verify(PHONE, otpForTesting!, t.now())).verified).toBe(false);
  });

  it("carries the attempt count across a resend", async () => {
    // The bypass in one test: guess to one short of the cap, ask for a new code, and
    // the counter used to be back at zero. Now it is not.
    const t = build();
    await t.service.send(PHONE, t.now());
    await t.service.verify(PHONE, "000000", t.now());
    await t.service.verify(PHONE, "000000", t.now());
    t.advance(30);
    const resent = await t.service.send(PHONE, t.now());
    expect((await t.store.get(PHONE))?.attempts).toBe(2);
    // One guess left, not three.
    const wrong = await t.service.verify(PHONE, "000000", t.now());
    expect(wrong.verified).toBe(false);
    expect((await t.service.verify(PHONE, resent.otpForTesting!, t.now())).reason).toMatch(/Too many attempts/);
  });

  it("locks the number out once the cap is reached, and the lockout outlives a resend", async () => {
    const t = build();
    const first = await t.service.send(PHONE, t.now());
    for (let i = 0; i < 3; i += 1) await t.service.verify(PHONE, "000000", t.now());
    // Even the right code is refused while the lockout stands.
    expect((await t.service.verify(PHONE, first.otpForTesting!, t.now())).reason).toMatch(/retry in 900 seconds/);
    // And a fresh code cannot be bought to escape it.
    t.advance(60);
    await expect(t.service.send(PHONE, t.now())).rejects.toThrow(/Too many incorrect codes/);
    expect(t.sender.sent).toHaveLength(1);
  });

  it("lets the number back in once the lockout has been served", async () => {
    const t = build();
    await t.service.send(PHONE, t.now());
    for (let i = 0; i < 3; i += 1) await t.service.verify(PHONE, "000000", t.now());
    t.advance(15 * 60);
    const fresh = await t.service.send(PHONE, t.now());
    expect(await t.service.verify(PHONE, fresh.otpForTesting!, t.now())).toEqual({ verified: true });
  });

  it("does not find a code issued into a store it no longer shares", async () => {
    // The reported intermittent login failure, reproduced: the code was issued into
    // one process's memory and verified against another's. Passing the same store to
    // both instances is what a Redis backed store buys.
    const t = build();
    const { otpForTesting } = await t.service.send(PHONE, t.now());
    const restarted = new OtpService(t.config, new MemoryRateLimitStore(), t.sender, new MemoryOtpStore());
    expect((await restarted.verify(PHONE, otpForTesting!, t.now())).reason).toMatch(/not found/);
    const shared = new OtpService(t.config, new MemoryRateLimitStore(), t.sender, t.store);
    expect(await shared.verify(PHONE, otpForTesting!, t.now())).toEqual({ verified: true });
  });
});

describe("two sends at once", () => {
  it("sends one code, not two", async () => {
    // ST1-I102, the intermittent "Invalid OTP". The cooldown is read from the store
    // and the new code written to it after the gateway call, so two sends that
    // arrive together — a double tap on Send OTP, a client retrying a request whose
    // answer was lost, a login screen whose effect runs twice — both read an empty
    // store, both pass the cooldown, and both send a text. Two codes reach the
    // handset, only the last one written is held, and SMS does not promise to
    // deliver in the order it was given: the resident reads a code that genuinely
    // was sent to them and is told it is wrong.
    const t = build();
    const sender = new SlowSender();
    const service = new OtpService(t.config, new MemoryRateLimitStore(), sender, t.store);

    const results = await Promise.allSettled([service.send(PHONE, t.now()), service.send(PHONE, t.now())]);

    expect(sender.sent).toHaveLength(1);
    const sent = results.filter((r) => r.status === "fulfilled");
    expect(sent).toHaveLength(1);
    // The one that lost is refused by the cooldown rule, which is what it is for.
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(refused.reason)).toMatch(/A code was already sent/);

    // And the code that was actually delivered is the one that works.
    expect(await service.verify(PHONE, sender.sent[0].code, t.now())).toEqual({ verified: true });
  });

  it("still sends to two different numbers at the same time", async () => {
    // Only the pair that would collide waits. Serialising every send behind every
    // other one would turn a busy morning into a queue.
    const t = build();
    const sender = new SlowSender();
    const service = new OtpService(t.config, new MemoryRateLimitStore(), sender, t.store);

    await Promise.all([service.send(PHONE, t.now()), service.send("9812345678", t.now())]);
    expect(sender.sent).toHaveLength(2);
  });
});

describe("which code is the live one", () => {
  it("accepts the latest code and refuses the one it replaced", async () => {
    const t = build();
    const first = await t.service.send(PHONE, t.now());
    t.advance(30);
    const second = await t.service.send(PHONE, t.now());
    expect(second.otpForTesting).not.toBe(first.otpForTesting);

    // The code that was replaced is dead, and saying so costs an attempt.
    expect((await t.service.verify(PHONE, first.otpForTesting!, t.now())).verified).toBe(false);
    // The latest one works, inside its validity.
    expect(await t.service.verify(PHONE, second.otpForTesting!, t.now())).toEqual({ verified: true });
  });

  it("does not let a code issued for one number sign in another", async () => {
    const t = build();
    const mine = await t.service.send(PHONE, t.now());
    await t.service.send("9812345678", t.now());
    const crossed = await t.service.verify("9812345678", mine.otpForTesting!, t.now());
    expect(crossed.verified).toBe(false);
    expect(crossed.reason).toBe("Incorrect OTP");
    // And it still works on the number it was sent to.
    expect(await t.service.verify(PHONE, mine.otpForTesting!, t.now())).toEqual({ verified: true });
  });

  it("says something different for a code that expired and a code that is wrong", async () => {
    const t = build();
    const { otpForTesting } = await t.service.send(PHONE, t.now());
    expect((await t.service.verify(PHONE, "000000", t.now())).reason).toBe("Incorrect OTP");

    t.advance(t.config.auth.otpTtlSeconds + 1);
    expect((await t.service.verify(PHONE, otpForTesting!, t.now())).reason).toBe("OTP expired");
  });

  it("does not put a dead code back when a lockout is written", async () => {
    // The lockout used to be written with the record the verify had started with,
    // `otp` and all. A resend landing in the gap between the two would have its code
    // overwritten by the one it replaced, so the number came out of its fifteen
    // minutes holding a code its handset had never received.
    const t = build();
    const first = await t.service.send(PHONE, t.now());
    // One guess short of the cap of three.
    await t.service.verify(PHONE, "000000", t.now());
    await t.service.verify(PHONE, "000000", t.now());

    t.advance(30);
    const second = await t.service.send(PHONE, t.now());
    // The third guess, which locks the number out, must not resurrect the first code.
    await t.service.verify(PHONE, "000000", t.now());
    expect((await t.store.get(PHONE))?.otp).toBe(second.otpForTesting);
    expect((await t.store.get(PHONE))?.otp).not.toBe(first.otpForTesting);
  });
});
