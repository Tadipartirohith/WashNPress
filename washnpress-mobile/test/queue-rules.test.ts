import { describe, it, expect } from "vitest";
import { MAX_ACTION_ATTEMPTS, afterFailure, streamOf } from "../src/offline/queue-rules";
import { NETWORK_ERROR_CODE, TIMEOUT_ERROR_CODE } from "../src/api/request-rules";
import type { QueuedAction } from "../src/offline/queue";

// The drain stopped at the first failure and counted nothing, so one action the
// backend would never accept sat at the head of the queue and held up every action
// behind it — on a handset whose operator had no way to see why.

function action(over: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: "a1", kind: "markPickedUp", payload: { orderId: "ord-1" },
    createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

const offline = { code: NETWORK_ERROR_CODE };
const timedOut = { code: TIMEOUT_ERROR_CODE };
const refused = { code: "already_advanced", status: 409 };

describe("which queued actions have to wait for one another", () => {
  it("puts everything about one order in the same line", () => {
    expect(streamOf(action({ id: "a", payload: { orderId: "ord-1" } })))
      .toBe(streamOf(action({ id: "b", kind: "startWash", payload: { orderId: "ord-1" } })));
  });

  it("keeps two different orders out of each other's way", () => {
    // The whole point: one order nobody can settle must not hold up a shift.
    expect(streamOf(action({ payload: { orderId: "ord-1" } })))
      .not.toBe(streamOf(action({ payload: { orderId: "ord-2" } })));
  });

  it("gives an action with no order a line of its own", () => {
    const a = action({ id: "x", payload: {} });
    const b = action({ id: "y", payload: {} });
    expect(streamOf(a)).not.toBe(streamOf(b));
  });
});

describe("an action that failed because there was no signal", () => {
  it("is kept exactly as it was, with nothing counted against it", () => {
    // A handset that spent an afternoon in a basement must not throw away a shift's
    // work for having tried.
    const verdict = afterFailure(action({ attempts: 3 }), offline);
    expect(verdict.keep).toEqual(action({ attempts: 3 }));
  });

  it("stops the drain, because nothing behind it will fare better", () => {
    expect(afterFailure(action(), offline).stopDraining).toBe(true);
    expect(afterFailure(action(), timedOut).stopDraining).toBe(true);
  });

  it("survives any number of attempts without ever being given up on", () => {
    let current: QueuedAction | null = action();
    for (let i = 0; i < MAX_ACTION_ATTEMPTS * 3; i += 1) {
      const verdict = afterFailure(current!, offline);
      current = verdict.keep;
      expect(current).not.toBeNull();
    }
  });
});

describe("an action the server refused", () => {
  it("is counted, and tried again", () => {
    const verdict = afterFailure(action(), refused);
    expect(verdict.keep?.attempts).toBe(1);
    expect(verdict.stopDraining).toBe(false);
  });

  it("lets the rest of the queue carry on", () => {
    // The failure that used to jam everything behind it forever.
    expect(afterFailure(action(), refused).stopDraining).toBe(false);
  });

  it("is given up on once it has been refused enough times", () => {
    const verdict = afterFailure(action({ attempts: MAX_ACTION_ATTEMPTS - 1 }), refused);
    expect(verdict.keep).toBeNull();
  });

  it("counts an action queued before the count existed as having none", () => {
    const legacy = action();
    delete legacy.attempts;
    expect(afterFailure(legacy, refused).keep?.attempts).toBe(1);
  });
});
