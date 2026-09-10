// Nothing that unlocks an account may survive into a shipped binary.
//
// The staff app used to hard-code demo logins — the platform administrator's number
// among them — and render them as tap-to-login buttons in every build. Anybody who
// installed it tapped Admin, tapped Verify, and was an administrator; the backend
// handed the code back in its own response, so the second tap needed nothing either.
//
// The fix is `__DEV__`, which Metro folds at build time so the numbers are not in a
// release bundle at all. That is the right mechanism and it is invisible: a later
// edit that moves one number outside the guard, or a helpful refactor that hoists the
// list to module scope, reintroduces the hole with nothing to say so. `npm test`
// cannot see it either, because tests run the source and not the bundle.
//
// So this compiles an actual production bundle and reads it. It is slow, and it is
// the only check here that looks at what ships rather than at what was written.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The seeded accounts, and any string that would hand somebody a way in. These are
// literals rather than an import: the point is to catch the day the source stops
// agreeing with itself, so reading them from the source would defeat the check.
const MUST_NOT_APPEAR = [
  "9876500001", // admin
  "9876500011", // supervisor
  "9876500002", // operator
  "9876543210", // resident
];

// Proof that the search itself works. Without these a broken grep, a changed bundle
// format or an empty file reads as a clean pass — which is the failure mode this
// script exists to avoid, so it must not be able to fall into it.
const MUST_APPEAR = ["Send OTP", "Wash N Press"];

const variant = process.argv[2] ?? "staff";
const out = mkdtempSync(join(tmpdir(), "wnp-release-"));

try {
  execFileSync(
    "npx",
    ["expo", "export", "--platform", "android", "--output-dir", out, "--no-minify"],
    {
      stdio: "pipe",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        APP_VARIANT: variant,
        // Never the real host: this bundle is compiled to be read, not run.
        EXPO_PUBLIC_API_URL: "https://release-check.invalid",
      },
    },
  );

  const bundles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".hbc") || entry.endsWith(".js")) bundles.push(path);
    }
  };
  walk(out);

  if (bundles.length === 0) {
    console.error("release-safety: the export produced no bundle to inspect.");
    process.exit(1);
  }

  // Latin1 rather than utf8: Hermes bytecode is not text, and decoding it as utf8
  // replaces bytes it cannot map, which can destroy the very string being searched for.
  const haystack = bundles.map((b) => readFileSync(b, "latin1")).join("\n");

  const missing = MUST_APPEAR.filter((s) => !haystack.includes(s));
  if (missing.length > 0) {
    console.error(
      `release-safety: cannot trust this check — expected ${JSON.stringify(missing)} in the bundle and did not find them.\n` +
      "The bundle format or the search may have changed. Fix the check before trusting a pass.",
    );
    process.exit(1);
  }

  const leaked = MUST_NOT_APPEAR.filter((s) => haystack.includes(s));
  if (leaked.length > 0) {
    console.error(
      `release-safety: ${leaked.length} credential(s) reached the ${variant} release bundle: ${leaked.join(", ")}.\n` +
      "Something that unlocks an account is compiled into what users install. Put it back behind __DEV__.",
    );
    process.exit(1);
  }

  console.log(
    `release-safety: ${variant} bundle clean — ${MUST_NOT_APPEAR.length} credentials absent, search verified against ${MUST_APPEAR.length} known strings.`,
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
