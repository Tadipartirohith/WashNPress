import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueueStorage, QueuedAction } from "./queue";

// Persists the offline action queue on the device so it survives an app restart.
//
// The queue existed and this file existed, but the application wired the in-memory
// storage instead — so a pickup logged in a basement laundry room was lost the
// moment the app was closed or killed, which is exactly the situation the queue is
// for. Reading is defensive: a queue that cannot be read is an empty queue rather
// than an app that will not start.
const KEY = "wnp.offline.queue";

export class AsyncStorageQueue implements QueueStorage {
  async load(): Promise<QueuedAction[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      // Anything that is not a list of actions is not a queue.
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((a): a is QueuedAction =>
        Boolean(a) && typeof (a as QueuedAction).id === "string" && typeof (a as QueuedAction).kind === "string");
    } catch {
      return [];
    }
  }

  async save(actions: QueuedAction[]): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(actions));
    } catch {
      // Losing the ability to persist is bad, but throwing here would lose the
      // action the caller is holding as well. The queue carries on in memory.
    }
  }
}
