import { describe, it, expect } from "vitest";
import { reserve, release } from "../../src/domain/slots";
import { today, serviceDay, isPastSlot, setServiceDayOffsetMinutes } from "../../src/services/scheduling-service";

const base = { id: "s1", capacityTotal: 2, capacityRemaining: 1, isActive: true };

describe("slots", () => {
  it("reserves one unit of capacity", () => {
    expect(reserve(base).capacityRemaining).toBe(0);
  });
  it("refuses a full slot", () => {
    expect(() => reserve({ ...base, capacityRemaining: 0 })).toThrow(/full/);
  });
  it("refuses an inactive slot", () => {
    expect(() => reserve({ ...base, isActive: false })).toThrow(/not active/);
  });
  it("never releases above the total capacity", () => {
    expect(release({ ...base, capacityRemaining: 2 }).capacityRemaining).toBe(2);
  });
});

describe("the service day", () => {
  it("ends at midnight where the operation is, not at midnight UTC", () => {
    // Half past midnight in India on the 22nd is still the 21st in UTC. A slot for
    // the 21st has to be past by then, or yesterday's slots stay bookable through
    // the small hours.
    const justAfterMidnightIST = new Date("2026-08-21T19:00:00.000Z");
    expect(today(justAfterMidnightIST)).toBe("2026-08-22");
    expect(isPastSlot({ date: "2026-08-21" }, justAfterMidnightIST)).toBe(true);
    expect(isPastSlot({ date: "2026-08-22" }, justAfterMidnightIST)).toBe(false);
  });

  it("agrees with itself about which day a timestamp falls in", () => {
    const at = "2026-08-21T19:30:00.000Z";
    expect(serviceDay(at)).toBe(today(new Date(at)));
  });

  it("can be moved for an operation somewhere else", () => {
    setServiceDayOffsetMinutes(0);
    expect(today(new Date("2026-08-21T19:00:00.000Z"))).toBe("2026-08-21");
    setServiceDayOffsetMinutes(330);
    expect(today(new Date("2026-08-21T19:00:00.000Z"))).toBe("2026-08-22");
  });
});
