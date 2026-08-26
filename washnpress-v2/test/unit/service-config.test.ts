import { describe, it, expect } from "vitest";
import {
  extendedServiceProblems, notifiesOn, serviceOnOffer, workflowFor,
} from "../../src/domain/service-catalogue";

describe("what is wrong with the rest of a service's configuration", () => {
  it("is silent about a service that simply has none of it", () => {
    // Everything here is optional, so a service written before any of it existed
    // must not become invalid the moment the sections were added.
    expect(extendedServiceProblems({})).toEqual([]);
  });

  it("refuses two options a resident could not tell apart", () => {
    const problems = extendedServiceProblems({
      options: [
        { id: "a", label: "Deluxe", priceDeltaPaise: 0, isActive: true },
        { id: "b", label: "deluxe", priceDeltaPaise: 100, isActive: true },
      ],
    });
    expect(problems.join(" ")).toMatch(/same label/);
  });

  it("refuses an add-on that costs a negative amount", () => {
    const problems = extendedServiceProblems({
      addOns: [{ id: "a", name: "Interior vacuum", pricePaise: -100, isActive: true }],
    });
    expect(problems.join(" ")).toMatch(/negative/);
  });

  it("refuses a service that stops before it starts", () => {
    const problems = extendedServiceProblems({
      availabilityWindow: { startDate: "2026-09-01", endDate: "2026-08-01" },
    });
    expect(problems.join(" ")).toMatch(/before it starts/);
  });

  it("refuses a capacity of nothing, which is a service that cannot be booked", () => {
    expect(extendedServiceProblems({ capacity: { maxBookingsPerDay: 0 } }).join(" "))
      .toMatch(/greater than zero/);
  });

  it("refuses a workflow with no way in or no way out", () => {
    expect(extendedServiceProblems({ operations: { workflow: ["in_progress", "completed"] } }).join(" "))
      .toMatch(/cannot be booked/);
    expect(extendedServiceProblems({ operations: { workflow: ["scheduled", "in_progress"] } }).join(" "))
      .toMatch(/never be finished/);
  });

  it("refuses stages out of the order they happen in", () => {
    // A quality check before the work is a stage nobody can complete.
    expect(extendedServiceProblems({ operations: { workflow: ["scheduled", "qc", "in_progress", "completed"] } }).join(" "))
      .toMatch(/order they happen/);
  });

  it("accepts a workflow that skips a stage it does not need", () => {
    // A car wash has no quality check, and should not be made to have one.
    expect(extendedServiceProblems({ operations: { workflow: ["scheduled", "assigned", "completed"] } })).toEqual([]);
  });

  it("keeps a refund between nothing and all of it", () => {
    expect(extendedServiceProblems({ cancellationRules: { refundPercent: 140 } }).join(" "))
      .toMatch(/nothing and all of it/);
    expect(extendedServiceProblems({ cancellationRules: { refundPercent: 100 } })).toEqual([]);
  });
});

describe("whether a service is on offer", () => {
  const day = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

  it("does not offer a draft", () => {
    const result = serviceOnOffer({ status: "draft", isActive: true });
    expect(result.ok).toBe(false);
    // "Still being set up" and "not offered at the moment" are different things
    // for the person asking.
    expect(result.reason).toMatch(/being set up/);
  });

  it("does not offer one that has been withdrawn", () => {
    expect(serviceOnOffer({ status: "inactive" }).ok).toBe(false);
  });

  it("reads a service written before draft existed from its flag", () => {
    expect(serviceOnOffer({ isActive: true }).ok).toBe(true);
    expect(serviceOnOffer({ isActive: false }).ok).toBe(false);
  });

  it("does not offer one that is paused, and says why", () => {
    const result = serviceOnOffer({
      status: "active",
      availabilityWindow: { suspended: true, suspendedReason: "Our machine is being repaired." },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Our machine is being repaired.");
  });

  it("does not offer one before it starts or after it ends", () => {
    const window = { availabilityWindow: { startDate: "2026-09-01", endDate: "2026-09-30" }, status: "active" as const };
    expect(serviceOnOffer(window, day("2026-08-31")).ok).toBe(false);
    expect(serviceOnOffer(window, day("2026-09-15")).ok).toBe(true);
    expect(serviceOnOffer(window, day("2026-10-01")).ok).toBe(false);
  });
});

describe("what a service actually does", () => {
  it("gives a service that says nothing the ordinary workflow", () => {
    // Rather than none, which would be a service nobody could progress.
    expect(workflowFor({})).toEqual(["scheduled", "assigned", "in_progress", "completed"]);
  });

  it("uses the stages it was configured with", () => {
    expect(workflowFor({ operations: { workflow: ["scheduled", "in_progress", "qc", "completed"] } }))
      .toEqual(["scheduled", "in_progress", "qc", "completed"]);
  });

  it("tells the resident everything until it is told otherwise", () => {
    expect(notifiesOn({}, "completed")).toBe(true);
    expect(notifiesOn({ notifyOn: [] }, "completed")).toBe(true);
  });

  it("tells them only what it was configured to", () => {
    expect(notifiesOn({ notifyOn: ["booked", "completed"] }, "completed")).toBe(true);
    expect(notifiesOn({ notifyOn: ["booked", "completed"] }, "delayed")).toBe(false);
  });
});
