#!/usr/bin/env node
// Prove that EXPO_PUBLIC_API_URL survives the build.
//
// It did not. `src/config.ts` read it through an optional chain, and
// `babel-preset-expo` inlines `EXPO_PUBLIC_*` with a visitor that matches
// `MemberExpression` and nothing else — an `OptionalMemberExpression` is never
// visited. So the variable was read at runtime, in a bundle where `process.env` is
// empty, and every build fell back to `http://localhost:8080` while looking
// perfectly configured.
//
// That is a bad failure to ship. A store build pointed at localhost reaches nothing
// for anybody, and iOS refuses the plain-HTTP request before it is even made, so
// the symptom is an app that loads and then does nothing at all.
//
// This runs the project's real Babel config over the real file, in both the modes
// the preset behaves differently in, and checks the value actually made it.
//
//   node scripts/verify-env-inlining.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { transformAsync } from "@babel/core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const file = resolve(root, "src/config.ts");
const source = readFileSync(file, "utf8");

const SENTINEL = "https://api.example.invalid";

// babel-preset-expo behaves differently either side of this: a production build
// gets the value as a string literal, a development build gets a reference to
// Expo's own env module. Both have to carry it; only production can be checked by
// looking for the value, so development is checked for the reference.
async function build(production) {
  process.env.EXPO_PUBLIC_API_URL = SENTINEL;
  const result = await transformAsync(source, {
    filename: file,
    cwd: root,
    root,
    babelrc: false,
    configFile: false,
    presets: [["babel-preset-expo", { jsxRuntime: "automatic" }]],
    caller: {
      name: "metro",
      bundler: "metro",
      platform: "ios",
      isDev: !production,
      isServer: false,
      supportsStaticESM: true,
    },
  });
  return result.code;
}

let failures = 0;

function check(label, ok, detail) {
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}`);
  if (!ok) {
    failures += 1;
    if (detail) console.log(`        ${detail}`);
  }
}

console.log("EXPO_PUBLIC_API_URL survives the build\n");

const prod = await build(true);
check(
  "a production build carries the value itself",
  prod.includes(SENTINEL),
  "the variable was not inlined; check that src/config.ts reads it as process.env.EXPO_PUBLIC_API_URL, with no optional chaining",
);
check(
  "and nothing is left reading process at runtime",
  !/process\s*\.\s*env/.test(prod),
  "a process.env access survived the transform, which means it will be read in a bundle that has no such thing",
);

const dev = await build(false);
check(
  "a development build references Expo's env module",
  dev.includes("expo/virtual/env") && dev.includes("EXPO_PUBLIC_API_URL"),
  "the dev server would not pick the variable up either",
);

// The fallback has to be a real default rather than something that only works on
// the machine that built it — but it is also the value a store build must never
// keep, so it is worth seeing in the output rather than assuming.
check(
  "the fallback is the documented local default",
  source.includes('"http://localhost:8080"'),
  "the default changed; update the README if that was deliberate",
);

console.log();
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed.");
