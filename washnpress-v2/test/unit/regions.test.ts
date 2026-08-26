import { describe, it, expect } from "vitest";
import { STATES, areaKey, isState, stateFor } from "../../src/domain/regions";

describe("where the platform operates", () => {
  it("knows a state when it sees one, whatever the casing", () => {
    expect(isState("Telangana")).toBe(true);
    expect(stateFor("telangana")).toBe("Telangana");
    expect(stateFor("  Karnataka  ")).toBe("Karnataka");
  });

  it("reads a city written into the region field as the state it is in", () => {
    // The field used to be free text and collected city names, so filtering areas
    // by state matched nothing a person would have predicted.
    expect(stateFor("Hyderabad")).toBe("Telangana");
    expect(stateFor("Bengaluru")).toBe("Karnataka");
    expect(stateFor("Mumbai")).toBe("Maharashtra");
  });

  it("says it does not know rather than guessing", () => {
    expect(stateFor("Atlantis")).toBeNull();
    expect(stateFor("")).toBeNull();
    expect(stateFor(null)).toBeNull();
  });

  it("offers a closed list, so a region cannot be invented at the keyboard", () => {
    expect(STATES).toContain("Andhra Pradesh");
    expect(STATES).toContain("Tamil Nadu");
    expect(isState("Hyderabad")).toBe(false);
  });
});

describe("what makes two areas the same area", () => {
  it("is the state and the name together", () => {
    expect(areaKey("Telangana", "Gandhinagar")).toBe(areaKey("Telangana", "gandhinagar"));
    // The same name in another state is another area. There is a Gandhinagar in
    // more than one, and neither of them is the other.
    expect(areaKey("Telangana", "Gandhinagar")).not.toBe(areaKey("Gujarat", "Gandhinagar"));
  });

  it("does not treat spacing as a distinction anybody meant", () => {
    expect(areaKey("Telangana", "Gandhi  Nagar")).toBe(areaKey("Telangana", "Gandhi Nagar"));
  });
});
