// What an operator is already committed to, and whether one more thing fits.
//
// An operator does laundry and services out of the same day. A collection booked
// for ten till twelve and a car wash booked for half past ten are two jobs for one
// person in one place at one time, and assigning both is not a scheduling decision —
// it is a promise to a resident that nobody can keep.
//
// The two kinds of work are held in different shapes: a service carries the moment
// it is scheduled for, and a laundry order reaches its time through the pickup's
// slot. Both are reduced to a span here so the question can be asked once.

export interface TimeSpan {
  // ISO instants. End is exclusive: work finishing at eleven does not clash with
  // work starting at eleven.
  start: string;
  end: string;
}

export interface Commitment extends TimeSpan {
  kind: "service" | "laundry";
  // What to call it when telling somebody why the assignment was refused.
  label: string;
  reference: string;
}

export function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

// Everything already held that would run at the same time as the new work.
//
// Returned rather than reduced to a boolean, because "Operator 01 is collecting
// from Tower B between 10:00 and 12:00" is a reason somebody can act on and "no"
// is not.
export function clashingCommitments(candidate: TimeSpan, held: readonly Commitment[]): Commitment[] {
  return held.filter((commitment) => spansOverlap(candidate, commitment));
}

// How long a service booking occupies.
//
// The window it was booked into is the truth where there is one — that is what the
// resident was shown and what the capacity was counted against. Failing that, an
// hourly service takes the hours it estimated, and anything else takes an hour,
// which is a guess but a better one than treating the job as instantaneous.
export const DEFAULT_SERVICE_MINUTES = 60;

export function serviceSpan(
  scheduledFor: string,
  options: { estimatedHours?: number | null; window?: { startTime: string; endTime: string } | null } = {},
): TimeSpan {
  const minutes = options.window
    ? minutesBetween(options.window.startTime, options.window.endTime)
    : options.estimatedHours && options.estimatedHours > 0
      ? Math.round(options.estimatedHours * 60)
      : DEFAULT_SERVICE_MINUTES;
  return { start: scheduledFor, end: addMinutes(scheduledFor, Math.max(minutes, 1)) };
}

// A laundry collection occupies the slot it was booked into.
export function slotSpan(date: string, startTime: string, endTime: string): TimeSpan {
  return { start: `${date}T${startTime}:00.000Z`, end: `${date}T${endTime}:00.000Z` };
}

function minutesBetween(startTime: string, endTime: string): number {
  const minutes = toMinutes(endTime) - toMinutes(startTime);
  // A window that ends before it starts is a configuration mistake rather than a
  // job that takes negative time; fall back rather than produce a span that can
  // never overlap anything.
  return minutes > 0 ? minutes : DEFAULT_SERVICE_MINUTES;
}

function toMinutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number);
  return (hours || 0) * 60 + (mins || 0);
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export class OperatorBusyError extends Error {
  constructor(public readonly clashes: Commitment[]) {
    const first = clashes[0];
    super(
      first
        ? `That operator is already committed to ${first.label} at the same time.`
        : "That operator is already committed at the same time.",
    );
    this.name = "OperatorBusyError";
  }
}
