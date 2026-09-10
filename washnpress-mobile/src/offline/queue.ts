import { afterFailure, streamOf } from "./queue-rules";

// A small offline action queue. Operator actions are enqueued locally and drained
// when connectivity is available, so pickups and pipeline updates logged in a
// basement laundry room are never lost. Storage and the action runner are injected
// so this module has no framework dependency and is easy to test.
export interface QueuedAction {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
  // How many times the server has refused this one. Absent on an action queued
  // before the count existed, which reads as none.
  //
  // Only a refusal counts. Being offline does not, or a handset that spent an
  // afternoon in a basement would throw away a shift's work for having tried.
  attempts?: number;
}

export interface QueueStorage {
  load(): Promise<QueuedAction[]>;
  save(actions: QueuedAction[]): Promise<void>;
}

export type ActionRunner = (action: QueuedAction) => Promise<void>;

export interface SyncResult {
  synced: number;
  // Still owed, and still going to be tried.
  failed: number;
  // Refused so often that the queue has stopped asking. Surfaced rather than
  // swallowed: work that will never reach the backend is something the operator has
  // to be told about, because they are the only one who can do it again by hand.
  givenUp: number;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class OfflineQueue {
  constructor(private readonly storage: QueueStorage, private readonly runner: ActionRunner) {}

  async enqueue(kind: string, payload: Record<string, unknown>): Promise<QueuedAction> {
    const actions = await this.storage.load();
    const action: QueuedAction = { id: uid(), kind, payload, createdAt: new Date().toISOString(), attempts: 0 };
    actions.push(action);
    await this.storage.save(actions);
    return action;
  }

  async pending(): Promise<QueuedAction[]> {
    return this.storage.load();
  }

  async pendingCount(): Promise<number> {
    return (await this.storage.load()).length;
  }

  // Throw the queue away.
  //
  // Signing out is the moment for it. The queue used to survive a sign-out, so on a
  // shared shift handset the counts operator A logged with no signal were sent under
  // operator B's token the moment B signed in and the signal came back — recorded
  // against B's name in the audit log, on orders in B's blocks. The storage is also
  // keyed per person now, so this is the second of two locks rather than the only
  // one.
  async clear(): Promise<void> {
    await this.storage.save([]);
  }

  // Drain the queue.
  //
  // In order within an order — collection has to be recorded before washing starts —
  // and independently across orders, so one order nobody can settle no longer holds
  // up a whole shift. See `queue-rules`: a failure with no signal costs an action
  // nothing and stops the drain, and a refusal from the server costs it one of a
  // few tries.
  async sync(): Promise<SyncResult> {
    const actions = await this.storage.load();
    const remaining: QueuedAction[] = [];
    // Orders whose queue is stuck behind something that has just failed. Anything
    // else for the same order waits its turn rather than being applied out of
    // sequence.
    const blocked = new Set<string>();
    let synced = 0;
    let givenUp = 0;
    let stopped = false;

    for (const action of actions) {
      const stream = streamOf(action);
      if (stopped || blocked.has(stream)) { remaining.push(action); continue; }
      try {
        await this.runner(action);
        synced += 1;
      } catch (error) {
        const verdict = afterFailure(action, error);
        if (verdict.keep) remaining.push(verdict.keep); else givenUp += 1;
        // Whether it is kept or given up on, nothing else for this order can be
        // applied: the step it depended on did not happen.
        blocked.add(stream);
        if (verdict.stopDraining) stopped = true;
      }
    }

    await this.storage.save(remaining);
    return { synced, failed: remaining.length, givenUp };
  }
}
