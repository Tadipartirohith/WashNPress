import { describe, it, expect } from "vitest";
import { STATES, isState, stateFor } from "../../src/domain/regions";

describe("where the platform operates", () => {
  it("knows a state when it sees one, whatever the casing", () => {
    expect(isState("Telangana")).toBe(true);
    expect(stateFor("telangana")).toBe("Telangana");
    expect(stateFor("  Karnataka  ")).toBe("Karnataka");
  });

  it("reads a city written into the state field as the state it is in", () => {
    // The field used to be free text and collected city names, so grouping by
    // state matched nothing a person would have predicted.
    expect(stateFor("Hyderabad")).toBe("Telangana");
    expect(stateFor("Bengaluru")).toBe("Karnataka");
    expect(stateFor("Mumbai")).toBe("Maharashtra");
  });

  it("says it does not know rather than guessing", () => {
    expect(stateFor("Atlantis")).toBeNull();
    expect(stateFor("")).toBeNull();
    expect(stateFor(null)).toBeNull();
  });

  it("offers a closed list, so a state cannot be invented at the keyboard", () => {
    expect(STATES).toContain("Andhra Pradesh");
    expect(STATES).toContain("Tamil Nadu");
    expect(isState("Hyderabad")).toBe(false);
  });
});
