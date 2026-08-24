import { describe, it, expect, vi, beforeEach } from "vitest";
import { OfflineQueue, type QueuedAction, type QueueStorage } from "../src/offline/queue";

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
