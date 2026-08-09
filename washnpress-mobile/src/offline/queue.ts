// A small offline action queue. Operator actions are enqueued locally and drained
// when connectivity is available, so pickups and pipeline updates logged in a
// basement laundry room are never lost. Storage and the action runner are injected
// so this module has no framework dependency and is easy to test.
export interface QueuedAction {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface QueueStorage {
  load(): Promise<QueuedAction[]>;
  save(actions: QueuedAction[]): Promise<void>;
}

export type ActionRunner = (action: QueuedAction) => Promise<void>;

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class OfflineQueue {
  constructor(private readonly storage: QueueStorage, private readonly runner: ActionRunner) {}

  async enqueue(kind: string, payload: Record<string, unknown>): Promise<QueuedAction> {
    const actions = await this.storage.load();
    const action: QueuedAction = { id: uid(), kind, payload, createdAt: new Date().toISOString() };
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

  // Drain the queue in order. An action that succeeds is removed; the first failure
  // stops the drain and leaves the rest queued so ordering is preserved for retry.
  async sync(): Promise<{ synced: number; failed: number }> {
    const actions = await this.storage.load();
    let synced = 0;
    for (const action of actions) {
      try {
        await this.runner(action);
        synced += 1;
      } catch {
        const remaining = actions.slice(synced);
        await this.storage.save(remaining);
        return { synced, failed: remaining.length };
      }
    }
    await this.storage.save([]);
    return { synced, failed: 0 };
  }
}
