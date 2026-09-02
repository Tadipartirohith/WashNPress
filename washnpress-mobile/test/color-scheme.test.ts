import { describe, it, expect, afterEach } from "vitest";
import { theme, stateColor, light, dark, setColorScheme, colorScheme, themes } from "../src/theme";

// Dark mode was fully authored and switched off for the life of the product, because
// `StyleSheet.create` runs once at module load and copies whatever colour it is given
// into the sheet. Every screen resolved against light before the first render and
// never looked again, so turning the palette on would have meant rewriting all
// twenty-eight stylesheets into hooks and the five hundred references inside them.
//
// Instead the theme is read live and the sheets are built once per mode. That makes
// these the load-bearing tests: if the proxy stops following the active mode, every
// screen silently renders one palette's text on the other palette's ground, and
// nothing else in the suite would notice.

afterEach(() => { setColorScheme("light"); });

describe("reading the theme live", () => {
  it("starts in light, which is what a build with no system preference gets", () => {
    expect(colorScheme()).toBe("light");
    expect(theme.text.primary).toBe(light.text.primary);
  });

  it("follows the mode without the reference being re-imported", () => {
    // The whole mechanism in two lines: the same `theme` object a screen captured at
    // module load returns the other palette after the switch.
    setColorScheme("dark");
    expect(theme.text.primary).toBe(dark.text.primary);
    expect(theme.surface.page).toBe(dark.surface.page);
    setColorScheme("light");
    expect(theme.text.primary).toBe(light.text.primary);
  });

  it("follows the mode through the flat aliases the old screens use", () => {
    // Screens written before the token groups existed say `theme.aqua` and
    // `theme.bg`. They have to move too, or half a screen changes and half does not.
    setColorScheme("dark");
    expect(theme.aqua).toBe(dark.brand.solid);
    expect(theme.bg).toBe(dark.surface.page);
    expect(theme.deepTeal).toBe(dark.text.primary);
  });

  it("moves the state colours as well, so a pill is not lit for the wrong ground", () => {
    const inLight = stateColor["pickup_failed"];
    setColorScheme("dark");
    expect(stateColor["pickup_failed"]).not.toBe(inLight);
  });

  it("still enumerates, because a proxy that cannot be spread breaks a style array", () => {
    expect(Object.keys(theme)).toContain("surface");
    expect(Object.keys(theme)).toContain("aqua");
    expect("feedback" in theme).toBe(true);
  });
});

describe("the two built themes", () => {
  it("describe exactly the same set of things", () => {
    // A key present in one mode and missing in the other is a screen that renders in
    // one and crashes in the other.
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it("do not accidentally share a palette", () => {
    expect(themes.light.surface.page).not.toBe(themes.dark.surface.page);
    expect(themes.light.text.primary).not.toBe(themes.dark.text.primary);
  });

  it("invert the action rather than reusing the light one", () => {
    // On a dark page the brand becomes the button and takes ink text: a white label
    // on a mid jade is the pairing that reads as washed out.
    expect(themes.dark.action.primary).not.toBe(themes.light.action.primary);
    expect(themes.dark.text.onAction).not.toBe(themes.light.text.onAction);
  });
});
