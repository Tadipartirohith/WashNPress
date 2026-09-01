import { describe, it, expect } from "vitest";
import {
  clashingCommitments, serviceSpan, slotSpan, spansOverlap,
  type Commitment,
} from "../../src/domain/operator-workload";

// An operator does laundry and services out of the same day. A collection booked
// for ten till twelve and a car wash booked for half past ten are two jobs for one
// person in one place at one time, and assigning both is not a scheduling decision —
// it is a promise to a resident that nobody can keep.

const laundry = (start: string, end: string): Commitment => ({
  kind: "laundry", label: "a collection from Tower B", reference: "ord-1",
  ...slotSpan("2026-09-10", start, end),
});

describe("whether two pieces of work run at the same time", () => {
  it("sees an overlap that starts inside another", () => {
    // The case from the report: 10:00-12:00 laundry, 10:30-11:30 car wash.
    const wash = serviceSpan("2026-09-10T10:30:00.000Z", { window: { startTime: "10:30", endTime: "11:30" } });
    expect(spansOverlap(wash, laundry("10:00", "12:00"))).toBe(true);
  });

  it("sees an overlap that swallows another whole", () => {
    const long = serviceSpan("2026-09-10T09:00:00.000Z", { estimatedHours: 5 });
    expect(spansOverlap(long, laundry("10:00", "12:00"))).toBe(true);
  });

  it("lets work start exactly as other work finishes", () => {
    // Back to back is a full day, not a double booking.
    const after = serviceSpan("2026-09-10T12:00:00.000Z", { window: { startTime: "12:00", endTime: "13:00" } });
    expect(spansOverlap(after, laundry("10:00", "12:00"))).toBe(false);
  });

  it("lets work finish exactly as other work starts", () => {
    const before = serviceSpan("2026-09-10T09:00:00.000Z", { window: { startTime: "09:00", endTime: "10:00" } });
    expect(spansOverlap(before, laundry("10:00", "12:00"))).toBe(false);
  });

  it("leaves a different day alone", () => {
    const tomorrow = serviceSpan("2026-09-11T10:30:00.000Z", { window: { startTime: "10:30", endTime: "11:30" } });
    expect(spansOverlap(tomorrow, laundry("10:00", "12:00"))).toBe(false);
  });
});

describe("how long a service occupies", () => {
  it("takes the window it was booked into, because that is what was promised", () => {
    const span = serviceSpan("2026-09-10T10:00:00.000Z", {
      window: { startTime: "10:00", endTime: "12:00" },
      // The window wins over the estimate: the estimate is what the resident
      // guessed, the window is what the service actually reserved.
      estimatedHours: 1,
    });
    expect(span.end).toBe("2026-09-10T12:00:00.000Z");
  });

  it("takes the estimated hours where the service runs to no timetable", () => {
    const span = serviceSpan("2026-09-10T10:00:00.000Z", { estimatedHours: 2.5 });
    expect(span.end).toBe("2026-09-10T12:30:00.000Z");
  });

  it("gives an hour to a job that says nothing about its length", () => {
    // A guess, but a better one than treating the job as instantaneous, which
    // would make every operator infinitely available.
    expect(serviceSpan("2026-09-10T10:00:00.000Z").end).toBe("2026-09-10T11:00:00.000Z");
  });

  it("does not produce a span that ends before it starts", () => {
    const span = serviceSpan("2026-09-10T10:00:00.000Z", { window: { startTime: "12:00", endTime: "10:00" } });
    expect(span.end > span.start).toBe(true);
  });
});

describe("what an operator is already committed to", () => {
  const held: Commitment[] = [
    laundry("10:00", "12:00"),
    { kind: "service", label: "a bike wash", reference: "svc-9", ...serviceSpan("2026-09-10T15:00:00.000Z") },
  ];

  it("finds nothing when the day is free at that hour", () => {
    const span = serviceSpan("2026-09-10T13:00:00.000Z");
    expect(clashingCommitments(span, held)).toEqual([]);
  });

  it("names what is in the way rather than only refusing", () => {
    // "no" is not a reason anybody can act on; "already collecting from Tower B
    // between ten and twelve" is.
    const span = serviceSpan("2026-09-10T10:30:00.000Z");
    const clashes = clashingCommitments(span, held);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].label).toBe("a collection from Tower B");
  });

  it("reports every clash, not only the first", () => {
    const allDay = serviceSpan("2026-09-10T09:00:00.000Z", { estimatedHours: 8 });
    expect(clashingCommitments(allDay, held)).toHaveLength(2);
  });

  it("has nothing to say about an operator holding nothing", () => {
    expect(clashingCommitments(serviceSpan("2026-09-10T10:30:00.000Z"), [])).toEqual([]);
  });
});
