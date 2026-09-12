// One thing at a time, per key.
//
// Two places in this service read a record, decide from it, and then write — a slot
// creation checking for a duplicate, and an OTP send checking the resend cooldown.
// Both have an await between the read and the write, so two requests that arrive
// together both read the world before either has changed it, and both go on to act
// on an answer that is no longer true. That is a supervisor's double tap creating two
// slots for one window, and a resident's double tap sending two codes of which only
// the second will be accepted.
//
// Requests for different keys still run at the same time; only the pair that would
// collide is made to queue. The second one then re-reads and is refused, or allowed,
// by the same rule that would have judged it a minute later — which is the answer it
// should have had in the first place.
//
// Process-local, and honestly so: a second replica needs the database to hold the
// line (a unique index, an atomic reservation). This closes the gap one server opens
// on every double click, which is where the reports come from.
export class OneAtATime {
  private readonly running = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.running.get(key) ?? Promise.resolve();
    // A refusal must not poison the queue behind it: whoever is waiting still has to
    // run, and be told what they clashed with.
    const queued = previous.catch(() => undefined).then(work);
    const tail = queued.catch(() => undefined);
    this.running.set(key, tail);
    try {
      return await queued;
    } finally {
      // Only the last one out clears the key, so the map does not grow by an entry
      // per thing ever done.
      if (this.running.get(key) === tail) this.running.delete(key);
    }
  }
}
