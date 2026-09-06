import { defineConfig } from "vitest/config";

// Playwright's own specs (e2e/**/*.spec.ts) use the same *.spec.ts naming vitest
// looks for by default, and get collected as vitest tests otherwise — they fail
// immediately since they call Playwright's test.describe() outside a Playwright
// run. Vitest only owns test/**.
export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
