import { isConnectivityFailure } from "../api/request-rules";
import type { QueuedAction } from "./queue";

// What to do with a queued action that has just failed, and what a failure means
// for the ones behind it.
//
// The drain used to stop at the first failure with no cap at all: one action the
// backend would never accept — an order somebody else had already advanced, a
// duplicate confirmation — sat at the head of the queue and every action behind it
// waited forever, on a handset whose operator had no way to see why. Meanwhile a
// perfectly ordinary spell with no signal looked exactly the same.
//
// The two are not the same and must not be treated the same, which is the whole of
// this file. Nothing is at fault when there is no signal, so nothing is counted
// against the action and the drain simply stops and waits. A server that answered
// with a refusal has judged this particular action, and repeating it forever will
// not change its mind, so that one is counted — and given up on after a few tries
// rather than left to jam the queue.

// Enough that a transient server fault (a restart, a deploy, a moment of lock
// contention) is ridden out, few enough that a genuinely impossible action is out of
// the way within a shift.
export const MAX_ACTION_ATTEMPTS = 5;

// Which actions have to stay in order relative to one another.
//
// Ordering matters within an order and nowhere else: collecting must be recorded
// before washing starts, but nothing about order A's queue says anything about order
// B's. Treating the queue as one strict line meant a stuck action on one order held
// up work on every other order in the shift.
//
// An action with no order is a stream of its own, so it neither blocks anything nor
// is blocked.
export function streamOf(action: QueuedAction): string {
  const orderId = action.payload["orderId"];
  return typeof orderId === "string" && orderId ? `order:${orderId}` : `action:${action.id}`;
}

export type FailureVerdict =
  // Nothing reached the server. Nothing is anybody's fault, nothing is counted, and
  // no later action in this drain is going to fare better.
  | { keep: QueuedAction; stopDraining: true }
  // The server refused it. Counted, and tried again on the next drain.
  | { keep: QueuedAction; stopDraining: false }
  // Refused too many times. Given up on, so that the actions behind it can move.
  | { keep: null; stopDraining: false };

export function afterFailure(action: QueuedAction, error: unknown): FailureVerdict {
  if (isConnectivityFailure(error)) return { keep: action, stopDraining: true };
  const attempts = (action.attempts ?? 0) + 1;
  if (attempts >= MAX_ACTION_ATTEMPTS) return { keep: null, stopDraining: false };
  return { keep: { ...action, attempts }, stopDraining: false };
}
