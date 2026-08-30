import { describe, it, expect } from "vitest";
import {
  dark, font, light, motion, radius, size, space, stateColorsFor, theme, type,
} from "../src/theme";

// The rules the token system is built on, held to.
//
// Contrast is measured separately by `npm run verify:contrast`, which reads the
// same file. This covers the structural promises a ratio cannot: that the scales
// are scales, that the spacing hierarchy runs the right way round, and that the
// two modes describe the same set of things.

const HEX = /^#[0-9A-Fa-f]{6}$/;

function everyValue(node: unknown, path = "", out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) everyValue(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

describe("the spacing scale", () => {
  it("puts the outside of a card further out than the inside", () => {
    // The one hierarchy that must never be flat. The page had 12 at its edge and 12
    // inside every card, and with both the same a card does not sit *in* a page.
    expect(space.page).toBeGreaterThan(space.card);
    expect(space.card).toBeGreaterThan(space.base);
  });

  it("rises, without two steps close enough to be confused", () => {
    const steps = [space.tight, space.snug, space.base, space.card, space.page, space.section, space.block];
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  });

  it("gives a section seam more room than anything inside one", () => {
    expect(space.section).toBeGreaterThanOrEqual(space.page * 1.5);
  });
});

describe("the type scale", () => {
  it("gives every style a complete instruction", () => {
    // A size on its own is not a text style. Pairing one with a weight by hand at
    // each call site is how the application arrived at thirteen sizes.
    const families = new Set(Object.values(font));
    for (const [name, style] of Object.entries(type)) {
      expect(style.fontSize, name).toBeGreaterThan(0);
      expect(style.lineHeight, name).toBeGreaterThan(style.fontSize);
      expect(style.letterSpacing, name).toBeDefined();
      // Weight is the file, not a number. React Native will not synthesise a
      // weight for a custom family, so a fontWeight beside one is silently
      // ignored on Android and the text renders at the wrong weight on half the
      // devices that run it.
      expect(families.has(style.fontFamily as string), `${name} names a real font file`).toBe(true);
      expect(style, name).not.toHaveProperty("fontWeight");
    }
  });

  it("keeps a real distance between a heading and body copy", () => {
    // Timid scale contrast is what a template looks like.
    expect(type.display.fontSize / type.body.fontSize).toBeGreaterThanOrEqual(2.4);
    expect(type.title.fontSize).toBeGreaterThan(type.heading.fontSize);
  });

  it("sets anything that has to line up in a column in the mono family", () => {
    // `tabular-nums` is honoured on one platform and ignored on the other, and a
    // column that lines up on iOS only is not a column.
    expect(font.mono).toContain("Mono");
    expect(font.monoSemi).toContain("Mono");
  });

  it("tightens tracking as type grows and opens it on small capitals", () => {
    expect(type.display.letterSpacing).toBeLessThan(0);
    expect(type.title.letterSpacing).toBeLessThan(0);
    expect(type.overline.letterSpacing).toBeGreaterThan(0);
  });

  it("leaves leading loose enough to read at body size", () => {
    expect(type.body.lineHeight / type.body.fontSize).toBeGreaterThanOrEqual(1.35);
  });
});

describe("the motion tokens", () => {
  it("presses a control by an amount that is felt rather than seen", () => {
    // A control that shrinks to 0.9 reads as a toy.
    expect(motion.pressScale).toBeGreaterThan(0.95);
    expect(motion.pressScale).toBeLessThan(1);
  });

  it("uses a spring that settles rather than wobbles", () => {
    // Underdamped springs are the reason a lot of app motion feels cheap.
    for (const spring of [motion.press, motion.settle]) {
      const critical = 2 * Math.sqrt(spring.stiffness * spring.mass);
      expect(spring.damping / critical).toBeGreaterThan(0.6);
    }
  });

  it("keeps an entrance short enough to be missed", () => {
    expect(motion.fast).toBeLessThan(motion.base);
    expect(motion.base).toBeLessThan(motion.slow);
    expect(motion.slow).toBeLessThanOrEqual(300);
    expect(motion.enterOffset).toBeLessThanOrEqual(16);
  });
});

describe("shape and target size", () => {
  it("keeps one radius language rather than nine", () => {
    const values = Object.values(radius);
    expect(new Set(values).size).toBe(values.length);
    expect(radius.sm).toBeLessThan(radius.md);
    expect(radius.md).toBeLessThan(radius.lg);
  });

  it("never offers a target smaller than a finger", () => {
    // The counter buttons were 34 across and the tab strip about 33.
    expect(size.touch).toBeGreaterThanOrEqual(44);
    expect(size.control.md).toBeGreaterThanOrEqual(44);
    expect(size.control.lg).toBeGreaterThan(size.control.md);
  });
});

describe("the two semantic maps", () => {
  it("describe the same set of things", () => {
    // A dark map missing a token is a screen that renders undefined as a colour.
    expect(everyValue(dark).map(([p]) => p).sort()).toEqual(everyValue(light).map(([p]) => p).sort());
  });

  it("hold real colours everywhere except the two scrims", () => {
    for (const map of [light, dark]) {
      for (const [path, value] of everyValue(map)) {
        if (path.endsWith("scrim")) {
          expect(value, path).toMatch(/^rgba\(/);
          continue;
        }
        expect(value, path).toMatch(HEX);
      }
    }
  });

  it("uses neither pure black nor pure white for text", () => {
    // #000 on #fff is the tell of an interface nobody chose the colours for.
    for (const map of [light, dark]) {
      expect([map.text.primary.toUpperCase(), map.text.secondary.toUpperCase()])
        .not.toContain("#000000");
      expect(map.text.primary.toUpperCase()).not.toBe("#FFFFFF");
    }
  });

  it("darkens rather than lightens as a light surface goes deeper", () => {
    expect(light.surface.card).toBe("#FFFFFF");
    expect(light.surface.page < light.surface.card).toBe(true);
  });

  it("does not make the brand carry the primary button", () => {
    // The whole reason the previous palette could not be alive: one teal did the
    // button, the links and the headings, and because a white label had to survive
    // on it, it could never be brighter than a certain darkness. The action is ink
    // now, which frees the brand entirely.
    expect(light.action.primary).toBe(light.text.primary);
    expect(light.action.primary).not.toBe(light.brand.solid);
    expect(light.brand.vivid).not.toBe(light.brand.solid);
  });

  it("lightens a near-black button under a finger, because darkening has nowhere to go", () => {
    expect(light.action.primaryPressed > light.action.primary).toBe(true);
  });

  it("names a state colour for every state, in both modes", () => {
    const states = Object.keys(stateColorsFor(light));
    expect(states.length).toBeGreaterThan(10);
    expect(Object.keys(stateColorsFor(dark))).toEqual(states);
    for (const [state, colour] of Object.entries(stateColorsFor(dark))) {
      expect(colour, state).toMatch(HEX);
    }
  });
});

describe("the names the screens were written against", () => {
  it("still resolve, so a screen written before the tokens existed still reads", () => {
    // The four portals reference these directly. They are kept and pointed at
    // values that pass rather than renamed across thirty-nine files.
    for (const key of ["aqua", "deepTeal", "ice", "amber", "white", "slate", "bg", "muted", "border", "danger", "success"] as const) {
      expect(theme[key], key).toMatch(HEX);
    }
  });

  it("point at the semantic layer rather than at values of their own", () => {
    expect(theme.aqua).toBe(light.brand.solid);
    expect(theme.deepTeal).toBe(light.text.primary);
    expect(theme.muted).toBe(light.text.tertiary);
    expect(theme.bg).toBe(light.surface.page);
  });
});
