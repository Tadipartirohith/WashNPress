import { defineConfig, devices } from "@playwright/test";

// Two variants of the same Expo app are served on separate ports (see e2e/README):
// staff (operator/supervisor/admin) on 8081, resident on 8082.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 390, height: 844 },
  },
  projects: [
    { name: "staff", testMatch: /staff\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: process.env.STAFF_BASE_URL || "http://localhost:8081" } },
    { name: "resident", testMatch: /resident\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: process.env.RESIDENT_BASE_URL || "http://localhost:8082" } },
  ],
});
