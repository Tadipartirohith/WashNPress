import { describe, it, expect } from "vitest";
import {
  liveExceptions, allClearLine, pipelineOf, busiestStage, pipelineTotal,
  type Exception,
} from "../src/portals/dashboard-rules";

// All four dashboards were a vertical run of section headings each followed by a
// grid of equal tiles — the operations one showed "Ready for delivery" in three
// separate grids, the admin one drew the whole order state machine as fifteen
// squares. A screen where every number is equally prominent has answered nothing.

const some: Exception[] = [
  { key: "delayed", label: "Delayed orders", count: 2, tone: "danger" },
  { key: "qc", label: "Awaiting QC", count: 9, tone: "warn" },
  { key: "failed", label: "Failed pickups", count: 5, tone: "danger" },
  { key: "escalated", label: "Escalated issues", count: 0, tone: "danger" },
];

describe("what needs a person", () => {
  it("leaves out everything that is not happening", () => {
    expect(liveExceptions(some).map((e) => e.key)).not.toContain("escalated");
  });

  it("puts somebody already waiting above somebody who will be", () => {
    // Nine awaiting QC is a bigger number than two delayed orders and matters
    // less: the delay is a resident already let down.
    const order = liveExceptions(some).map((e) => e.key);
    expect(order.indexOf("failed")).toBeLessThan(order.indexOf("qc"));
    expect(order.indexOf("delayed")).toBeLessThan(order.indexOf("qc"));
  });

  it("ranks equally serious things by how many there are", () => {
    expect(liveExceptions(some).map((e) => e.key).slice(0, 2)).toEqual(["failed", "delayed"]);
  });

  it("returns nothing at all on a good day", () => {
    const calm = some.map((e) => ({ ...e, count: 0 }));
    expect(liveExceptions(calm)).toEqual([]);
  });

  it("has something to say when there is nothing to say", () => {
    // A screen that silently omits its most important section reads as one that
    // failed to load.
    expect(allClearLine("your blocks")).toMatch(/nothing needs attention/i);
    expect(allClearLine("your blocks")).toContain("your blocks");
  });
});

describe("the order pipeline", () => {
  const counts = {
    scheduled: 4, pickedUp: 2, washing: 11, ironing: 3,
    qcPending: 1, qcFailed: 2, readyForDelivery: 6, outForDelivery: 1,
  };

  it("runs in the order the work actually moves", () => {
    expect(pipelineOf(counts).map((s) => s.key)).toEqual([
      "scheduled", "picked_up", "in_wash", "ironing",
      "qc", "qc_hold", "ready_for_delivery", "out_for_delivery",
    ]);
  });

  it("keeps a stage that is empty, because a gap in a flow is information", () => {
    const stages = pipelineOf({ ...counts, ironing: 0 });
    expect(stages.map((s) => s.key)).toContain("ironing");
    expect(stages.find((s) => s.key === "ironing")!.count).toBe(0);
  });

  it("marks the stage that means the process has stopped", () => {
    const failed = pipelineOf(counts).find((s) => s.key === "qc_hold")!;
    expect(failed.stuck).toBe(true);
    // Nothing else is a stuck stage; the rest are steps.
    expect(pipelineOf(counts).filter((s) => s.stuck)).toHaveLength(1);
  });

  it("names where the work has banked up", () => {
    expect(busiestStage(pipelineOf(counts))!.key).toBe("in_wash");
  });

  it("does not call the start or the end of the line a pile-up", () => {
    // Everything sitting in Scheduled is a normal morning, not a bottleneck.
    const front = { scheduled: 50, pickedUp: 1, washing: 0, ironing: 0, qcPending: 0, qcFailed: 0, readyForDelivery: 0, outForDelivery: 40 };
    expect(busiestStage(pipelineOf(front))!.key).toBe("picked_up");
  });

  it("names nothing when there is nothing in the middle", () => {
    const empty = { scheduled: 3, outForDelivery: 2 };
    expect(busiestStage(pipelineOf(empty))).toBeNull();
  });

  it("counts what is in the pipeline, so an empty one can say so", () => {
    expect(pipelineTotal(pipelineOf(counts))).toBe(30);
    expect(pipelineTotal(pipelineOf({}))).toBe(0);
  });

  it("treats a missing count as none rather than breaking", () => {
    expect(() => pipelineOf({ washing: undefined })).not.toThrow();
    expect(pipelineTotal(pipelineOf({ washing: undefined }))).toBe(0);
  });
});
