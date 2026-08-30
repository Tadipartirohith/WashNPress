#!/usr/bin/env node
// Measure every colour pair the two apps actually put on screen, against WCAG 2.2.
//
// This exists because the palette it replaced did not pass and nobody could have
// known: fifteen of twenty-six pairs in daily use were below the minimum, including
// white on the primary button at 2.93:1. A ratio is not something to judge by eye,
// and a colour nobody measures is a colour that drifts.
//
// It reads src/theme.ts rather than a copy of the values, so a token edited without
// checking it fails here instead of on somebody's phone.
//
//   node scripts/verify-contrast.mjs          light (what ships today)
//   node scripts/verify-contrast.mjs --dark   the authored dark map
//
// Exit 1 on any required failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/theme.ts"), "utf8");

// The token file is TypeScript, so it is transpiled with the compiler the project
// already builds with rather than with a regex that pretends to understand types.
// A regex stripper is fine right up until somebody adds a construct it has not met,
// and then it reports a contrast pass on a file it failed to read.
const { default: ts } = await import("typescript");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const tokens = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const modeIsDark = process.argv.includes("--dark");
const t = modeIsDark ? tokens.dark : tokens.light;

// ---------------------------------------------------------------- WCAG 2.2 maths

function channels(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)];
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ------------------------------------------------------------------- the pairs
//
// Required pairs are text somebody has to read and controls somebody has to find.
// Advisory pairs are decoration: a hairline between two cards carries no
// information, and holding it to 3:1 would mean drawing the page in charcoal.

const { text, surface, border, action, brand, feedback } = t;
const card = surface.card;
const page = surface.page;

const REQUIRED = [
  ["button label on the primary fill", text.onAction, action.primary],
  ["button label on the pressed fill", text.onAction, action.primaryPressed],
  ["secondary button label, on a page", action.secondaryBorder, page],
  ["secondary button label, on a card", action.secondaryBorder, card],
  ["destructive button label", action.destructive, card],
  ["link and back arrow, on a page", text.link, page],
  ["body copy, on a card", text.secondary, card],
  ["body copy, on a page", text.secondary, page],
  ["heading, on a page", text.primary, page],
  ["heading, on a card", text.primary, card],
  ["muted label, on a card", text.tertiary, card],
  ["muted label, on a page", text.tertiary, page],
  ["text on the inverse surface", text.onInverse, surface.inverse],
  ["text on the brand tint", text.primary, brand.tint],
  ["brand text on the brand tint", brand.solid, brand.tint],
  ["success text, on a card", feedback.successText, card],
  ["success text, on its own tint", feedback.successText, feedback.successTint],
  ["warning text, on a card", feedback.warningText, card],
  ["warning text, on its own tint", feedback.warningText, feedback.warningTint],
  ["danger text, on a card", feedback.dangerText, card],
  ["danger text, on its own tint", feedback.dangerText, feedback.dangerTint],
  ["info text, on its own tint", feedback.infoText, feedback.infoTint],
];

// Non-text contrast: 1.4.11 asks 3:1 of anything that has to be identified as a
// control or that carries state.
const REQUIRED_UI = [
  ["input and toggle outline, on a card", border.strong, card],
  ["input and toggle outline, on a page", border.strong, page],
  ["focus ring, on a card", border.focus, card],
  ["selected tab underline", action.primary, card],
  ["toggle track when on", feedback.successSolid, card],
  ["meter fill against its track", brand.solid, surface.sunken],
];

const ADVISORY = [
  ["hairline between surfaces, on a page", border.subtle, page],
  ["hairline inside a card", border.subtle, card],
  ["disabled label", text.disabled, card],
  ["brand tint against the page", brand.tint, page],
];

// Every order state renders as pill text on both a card and a page, in whichever
// mode is being checked.
const STATE_PAIRS = Object.entries(tokens.stateColorsFor(t)).flatMap(([state, colour]) => [
  [`state pill "${state}", on a card`, colour, card],
  [`state pill "${state}", on a page`, colour, page],
]);

// ------------------------------------------------------------------- the report

let failures = 0;
let checked = 0;

function report(title, pairs, minimum, required) {
  console.log(`\n${title}  (minimum ${minimum.toFixed(1)}:1)`);
  console.log("-".repeat(72));
  for (const [label, fg, bg] of pairs) {
    if (!fg || !bg) {
      console.log(`  ${label.padEnd(46)} MISSING TOKEN`);
      failures += 1;
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= minimum;
    checked += 1;
    if (required && !ok) failures += 1;
    const verdict = ok ? "pass" : required ? "FAIL" : "note";
    console.log(`  ${label.padEnd(46)} ${r.toFixed(2).padStart(6)}  ${verdict}`);
  }
}

console.log(`WashNPress colour contrast — ${modeIsDark ? "dark" : "light"}`);
report("Text", REQUIRED, 4.5, true);
report("Controls and state", REQUIRED_UI, 3.0, true);
report("Order state pills", STATE_PAIRS, 4.5, true);
report("Decoration (advisory, not a gate)", ADVISORY, 3.0, false);

console.log("\n" + "=".repeat(72));
if (failures > 0) {
  console.log(`${failures} required pair(s) below the minimum, of ${checked} checked.`);
  process.exit(1);
}
console.log(`All ${checked} pairs pass WCAG 2.2 AA.`);
