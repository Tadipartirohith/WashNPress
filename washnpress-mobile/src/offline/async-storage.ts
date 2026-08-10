import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueueStorage, QueuedAction } from "./queue";

// Persists the offline action queue on the device so it survives an app restart.
// This is a drop in replacement for MemoryQueueStorage. Install the dependency with
// npx expo install @react-native-async-storage/async-storage before using it.
const KEY = "wnp.offline.queue";

export class AsyncStorageQueue implements QueueStorage {
  async load(): Promise<QueuedAction[]> {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  }
  async save(actions: QueuedAction[]): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(actions));
  }
}
