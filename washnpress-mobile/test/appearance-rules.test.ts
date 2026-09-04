import { describe, it, expect } from "vitest";
import {
  APPEARANCE_CHOICES, DEFAULT_APPEARANCE, isAppearance, resolveScheme,
} from "../src/appearance-rules";

// The theme is now light or dark, chosen with a tap on the matching icon. "Follow the
// system" was removed: the app opens light by default and the person switches it
// themselves, so there is one clear active state rather than a mode that silently
// tracks the device.

describe("what a person can choose", () => {
  it("offers light and dark, and nothing else", () => {
    expect(APPEARANCE_CHOICES).toEqual(["light", "dark"]);
  });

  it("opens light by default", () => {
    expect(DEFAULT_APPEARANCE).toBe("light");
  });

  it("recognises only those two", () => {
    expect(isAppearance("light")).toBe(true);
    expect(isAppearance("dark")).toBe(true);
    // An older stored "system" preference is no longer valid, so it falls back to the
    // default rather than being honoured.
    expect(isAppearance("system")).toBe(false);
    expect(isAppearance("sepia")).toBe(false);
    expect(isAppearance(undefined)).toBe(false);
    expect(isAppearance(null)).toBe(false);
  });
});

describe("what it resolves to", () => {
  it("is the choice itself, whatever the device is doing", () => {
    expect(resolveScheme("dark", "light")).toBe("dark");
    expect(resolveScheme("light", "dark")).toBe("light");
  });

  it("ignores the device scheme entirely", () => {
    expect(resolveScheme("dark", null)).toBe("dark");
    expect(resolveScheme("light", undefined)).toBe("light");
    expect(resolveScheme("dark")).toBe("dark");
  });
});
