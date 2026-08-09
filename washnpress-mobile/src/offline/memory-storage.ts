import type { QueueStorage, QueuedAction } from "./queue";

// Keeps queued actions in memory for the session. For persistence across app
// restarts, replace this with an adapter over @react-native-async-storage/async-storage
// that JSON-serialises the array under a single key.
export class MemoryQueueStorage implements QueueStorage {
  private actions: QueuedAction[] = [];
  async load(): Promise<QueuedAction[]> { return [...this.actions]; }
  async save(actions: QueuedAction[]): Promise<void> { this.actions = [...actions]; }
}
