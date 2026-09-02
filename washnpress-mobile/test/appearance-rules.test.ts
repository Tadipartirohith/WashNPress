import { describe, it, expect } from "vitest";
import {
  APPEARANCE_CHOICES, appearanceHint, isAppearance, resolveScheme,
} from "../src/appearance-rules";

// The palette followed the operating system and nothing else, which is the right
// default and a poor total. Somebody who wants the app dark on a phone they keep in
// light — or light on a phone they keep dark — had no way to say so.
//
// The trap in adding one is shipping a two-state switch. "Dark mode: on/off" removes
// "follow the system" as a destination, so the first person who touches it is pinned
// to whichever they picked for good.

describe("what a person can choose", () => {
  it("offers three, and following the system is one of them", () => {
    expect(APPEARANCE_CHOICES).toEqual(["system", "light", "dark"]);
  });

  it("recognises only those three", () => {
    expect(isAppearance("system")).toBe(true);
    expect(isAppearance("dark")).toBe(true);
    expect(isAppearance("sepia")).toBe(false);
    expect(isAppearance(undefined)).toBe(false);
    expect(isAppearance(null)).toBe(false);
  });
});

describe("what it resolves to", () => {
  it("takes an explicit choice over the device, which is the whole point", () => {
    expect(resolveScheme("dark", "light")).toBe("dark");
    expect(resolveScheme("light", "dark")).toBe("light");
  });

  it("follows the device when asked to", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
  });

  it("lands on light when the device will not say", () => {
    // Null on the web until the browser reports one, and on a device that has never
    // been told. Light is the mode the product was designed in and the safer one to
    // be wrong about in daylight.
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("system", undefined)).toBe("light");
  });

  it("still honours an explicit dark when the device says nothing", () => {
    // The failure this prevents: treating "no system preference" as a reason to
    // ignore what the person actually asked for.
    expect(resolveScheme("dark", null)).toBe("dark");
  });
});

describe("the line under the control", () => {
  it("says which way the system has currently gone", () => {
    // "Follow the system" on its own reads as a setting that has not taken effect.
    expect(appearanceHint("system", "dark")).toMatch(/dark/);
    expect(appearanceHint("system", "light")).toMatch(/light/);
  });

  it("says the device is being overridden when it is", () => {
    expect(appearanceHint("dark", "light")).toMatch(/whatever your device/i);
    expect(appearanceHint("light", "dark")).toMatch(/whatever your device/i);
  });
});
