import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueueStorage, QueuedAction } from "./queue";

// Persists the offline action queue on the device so it survives an app restart.
//
// The queue existed and this file existed, but the application wired the in-memory
// storage instead — so a pickup logged in a basement laundry room was lost the
// moment the app was closed or killed, which is exactly the situation the queue is
// for. Reading is defensive: a queue that cannot be read is an empty queue rather
// than an app that will not start.
//
// Whose queue it is, is part of where it is kept.
//
// One key held everybody's work. On a shared shift handset that meant operator A's
// queued counts were drained under operator B's token the moment B signed in and the
// signal came back: B's name on the audit entry, B's account credited with a
// collection they never made, and A with no record of having done it. The key
// carries the person now, so a queue is invisible to anybody else who signs in on
// the same phone — and it survives A signing back in later, which clearing alone
// would not.
//
// Deliberately not migrated from the old unkeyed "wnp.offline.queue". Whatever is
// in there belongs to somebody, and there is nothing on the device that says who —
// moving it under the next person to sign in is precisely the defect this fixes.
const PREFIX = "wnp.offline.queue";

// A queue with nobody signed in.
//
// There should be none: the queue is built from a session. But a session restored
// from a store written before the user id was kept has no id to key on, and dropping
// that person's queued work would be a worse answer than parking it somewhere
// nobody's next sign-in will pick up.
const ANONYMOUS = "anonymous";

export class AsyncStorageQueue implements QueueStorage {
  private readonly key: string;

  constructor(actorId: string | null | undefined) {
    this.key = `${PREFIX}.${actorId || ANONYMOUS}`;
  }

  async load(): Promise<QueuedAction[]> {
    try {
      const raw = await AsyncStorage.getItem(this.key);
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
      await AsyncStorage.setItem(this.key, JSON.stringify(actions));
    } catch {
      // Losing the ability to persist is bad, but throwing here would lose the
      // action the caller is holding as well. The queue carries on in memory.
    }
  }
}
