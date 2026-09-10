import { describe, it, expect, vi, beforeEach } from "vitest";
import { OfflineQueue, type QueuedAction, type QueueStorage } from "../src/offline/queue";
import { NETWORK_ERROR_CODE } from "../src/api/request-rules";
import { MAX_ACTION_ATTEMPTS } from "../src/offline/queue-rules";

// The offline queue existed and persistent storage existed, but the application
// wired the in-memory one — so a pickup logged in a basement laundry room was lost
// the moment the app was closed, which is the situation the queue is for.

// Stands in for AsyncStorage: a store that survives the object using it, the way a
// device's storage survives the app being killed.
function deviceStorage(initial = "") {
  let raw = initial;
  return {
    read: () => raw,
    corrupt: (text: string) => { raw = text; },
    storage: {
      async load(): Promise<QueuedAction[]> {
        try {
          const parsed = JSON.parse(raw || "[]") as unknown;
          if (!Array.isArray(parsed)) return [];
          return parsed.filter((a): a is QueuedAction =>
            Boolean(a) && typeof (a as QueuedAction).id === "string" && typeof (a as QueuedAction).kind === "string");
        } catch {
          return [];
        }
      },
      async save(actions: QueuedAction[]): Promise<void> { raw = JSON.stringify(actions); },
    } satisfies QueueStorage,
  };
}

describe("work logged offline survives the app being closed", () => {
  it("is still there when a new queue reads the same storage", async () => {
    const device = deviceStorage();
    const ran: string[] = [];

    const before = new OfflineQueue(device.storage, async (a) => { ran.push(a.kind); });
    await before.enqueue("order.picked_up", { orderId: "ord-1", count: 3 });
    await before.enqueue("order.qc", { orderId: "ord-1", passed: true });
    expect(await before.pendingCount()).toBe(2);

    // The app is closed and started again: a new queue over the same storage.
    const after = new OfflineQueue(device.storage, async (a) => { ran.push(a.kind); });
    expect(await after.pendingCount()).toBe(2);
    const pending = await after.pending();
    expect(pending.map((a) => a.kind)).toEqual(["order.picked_up", "order.qc"]);
    expect(pending[0].payload).toEqual({ orderId: "ord-1", count: 3 });
  });

  it("keeps an action until it has actually been sent", async () => {
    const device = deviceStorage();
    let attempts = 0;
    const queue = new OfflineQueue(device.storage, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("still offline");
    });
    await queue.enqueue("order.picked_up", { orderId: "ord-2" });

    await queue.sync().catch(() => undefined);
    // The first attempt failed, so the work is still owed.
    expect(await queue.pendingCount()).toBe(1);

    await queue.sync();
    expect(await queue.pendingCount()).toBe(0);
  });

  it("treats unreadable storage as an empty queue rather than refusing to start", async () => {
    const device = deviceStorage("{ this is not json");
    const queue = new OfflineQueue(device.storage, async () => undefined);
    // Losing queued work is bad; an app that will not open at all is worse.
    expect(await queue.pending()).toEqual([]);
    await queue.enqueue("order.picked_up", { orderId: "ord-3" });
    expect(await queue.pendingCount()).toBe(1);
  });

  it("ignores stored entries that are not actions", async () => {
    const device = deviceStorage(JSON.stringify([{ nonsense: true }, { id: "a", kind: "order.qc", payload: {}, createdAt: "x" }]));
    const queue = new OfflineQueue(device.storage, async () => undefined);
    const pending = await queue.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe("order.qc");
  });
});

// Round 12: one action nobody can settle used to hold up a whole shift, and a queue
// left over from the last person to hold the phone drained under the next one.

const offline = { code: NETWORK_ERROR_CODE };

describe("a queued action the backend will never accept", () => {
  it("no longer blocks work on every other order", async () => {
    const device = deviceStorage();
    const done: string[] = [];
    const queue = new OfflineQueue(device.storage, async (a) => {
      if (a.payload["orderId"] === "ord-stuck") throw { code: "already_advanced", status: 409 };
      done.push(a.id);
    });
    await queue.enqueue("startWash", { orderId: "ord-stuck" });
    await queue.enqueue("startWash", { orderId: "ord-fine" });
    await queue.enqueue("completeWash", { orderId: "ord-other" });

    const result = await queue.sync();
    // The two orders behind the stuck one went through on the same drain.
    expect(done).toHaveLength(2);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(1);
  });

  it("is given up on rather than retried forever, and says so", async () => {
    const device = deviceStorage();
    const queue = new OfflineQueue(device.storage, async () => { throw { code: "already_advanced", status: 409 }; });
    await queue.enqueue("startWash", { orderId: "ord-stuck" });

    let givenUp = 0;
    for (let i = 0; i < MAX_ACTION_ATTEMPTS; i += 1) givenUp += (await queue.sync()).givenUp;

    expect(givenUp).toBe(1);
    expect(await queue.pendingCount()).toBe(0);
  });

  it("does not take the steps that came after it on the same order with it", async () => {
    const device = deviceStorage();
    const queue = new OfflineQueue(device.storage, async (a) => {
      if (a.kind === "markPickedUp") throw { code: "already_advanced", status: 409 };
    });
    await queue.enqueue("markPickedUp", { orderId: "ord-1" });
    await queue.enqueue("startWash", { orderId: "ord-1" });

    // Washing cannot be recorded before collection is, so it waits rather than being
    // applied out of sequence.
    const first = await queue.sync();
    expect(first.synced).toBe(0);
    expect(await queue.pendingCount()).toBe(2);
  });
});

describe("a queue with no signal behind it", () => {
  it("keeps everything and counts nothing against it", async () => {
    const device = deviceStorage();
    const queue = new OfflineQueue(device.storage, async () => { throw offline; });
    await queue.enqueue("markPickedUp", { orderId: "ord-1" });
    await queue.enqueue("startWash", { orderId: "ord-2" });

    // Far more drains than the give-up cap. A basement is not the action's fault.
    for (let i = 0; i < MAX_ACTION_ATTEMPTS * 2; i += 1) {
      const r = await queue.sync();
      expect(r.givenUp).toBe(0);
    }
    expect(await queue.pendingCount()).toBe(2);
  });

  it("stops the drain at the first one rather than trying the rest", async () => {
    const device = deviceStorage();
    let attempts = 0;
    const queue = new OfflineQueue(device.storage, async () => { attempts += 1; throw offline; });
    await queue.enqueue("startWash", { orderId: "ord-1" });
    await queue.enqueue("startWash", { orderId: "ord-2" });
    await queue.enqueue("startWash", { orderId: "ord-3" });

    await queue.sync();
    expect(attempts).toBe(1);
  });
});

describe("signing out", () => {
  it("leaves nothing for the next person to send under their own name", async () => {
    const device = deviceStorage();
    const ran: string[] = [];
    const queue = new OfflineQueue(device.storage, async (a) => { ran.push(a.kind); });
    await queue.enqueue("markPickedUp", { orderId: "ord-1" });

    await queue.clear();

    expect(await queue.pendingCount()).toBe(0);
    // And it is gone from the device, not merely from this object.
    const afterRestart = new OfflineQueue(device.storage, async (a) => { ran.push(a.kind); });
    await afterRestart.sync();
    expect(ran).toEqual([]);
  });
});
