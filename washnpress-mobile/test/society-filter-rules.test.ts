import { describe, it, expect } from "vitest";
import { societyEmptyLine } from "../src/portals/society-filter-rules";

// Society management could only be narrowed by name. An admin looking for the ones
// they had switched off had to read every card, and the page gave no way to ask.
// It has a status dropdown now — All societies, Active, Inactive — which the server
// applies alongside the search rather than the page applying to what it was given.
//
// The one decision worth keeping out of the screen is what an empty result says,
// because "No societies yet" is true of an empty platform and false of every other
// way the list can come back with nothing in it.

describe("what an empty society list says", () => {
  it("says the platform has none only when nothing is narrowing it", () => {
    expect(societyEmptyLine("", undefined)).toBe("No societies yet.");
  });

  it("blames the search when there is a search", () => {
    expect(societyEmptyLine("bhavani", undefined)).toBe("No societies match that search.");
  });

  it("blames the status when the status is the only thing narrowing", () => {
    // The case the dropdown introduces: every society is running, the admin asks
    // for the inactive ones, and "No societies yet" would read as data loss.
    expect(societyEmptyLine("", "inactive")).toBe("No inactive societies.");
    expect(societyEmptyLine("", "active")).toBe("No active societies.");
  });

  it("names both when both are on, so neither is the hidden one", () => {
    expect(societyEmptyLine("bhavani", "inactive")).toBe("No inactive societies match that search.");
  });

  it("ignores a status it cannot put into a sentence", () => {
    // "coming_soon" is a stored state with no way to reach it and no dropdown entry.
    // Printing it raw would produce "No coming_soon societies."
    expect(societyEmptyLine("", "coming_soon")).toBe("No societies yet.");
    expect(societyEmptyLine("bhavani", "coming_soon")).toBe("No societies match that search.");
  });
});
