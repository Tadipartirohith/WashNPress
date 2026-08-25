import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // A functional test builds a whole application and seeds a store before it
    // asserts anything, so the five second default — a budget meant for unit tests —
    // is spent on setup rather than on the thing being tested. On a cold module cache
    // (a clean checkout, a fresh CI runner) that was enough to fail seven of them at
    // once, none of which had anything wrong with them.
    //
    // A hung test still fails, just later. What this removes is a class of failure
    // that depends on how fast the machine is rather than on the code.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/domain/**", "src/services/**"],
    },
  },
});
