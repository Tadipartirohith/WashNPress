import { test, expect } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

test.describe("Resident web app — navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await clearAuth(page);
    await page.reload();
    await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
    await page.getByRole("button", { name: /send code/i }).click();
    const otpInput = page.locator('input[inputmode="numeric"]');
    await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(page.getByText(/good day/i)).toBeVisible({ timeout: 10_000 });
  });

  test("positive: Plans is directly reachable from the bottom tab bar", async ({ page }) => {
    await page.getByRole("button", { name: "Plans", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible({ timeout: 10_000 });
  });

  test("positive: a recent order on Home opens straight into its tracking view", async ({ page }) => {
    const recentRow = page.getByRole("heading", { name: "Recent", exact: true, level: 3 })
      .locator("xpath=following-sibling::div[1]").locator("button").first();
    const hasRecent = await recentRow.isVisible().catch(() => false);
    test.skip(!hasRecent, "No recent orders in the seeded demo data for this run.");
    await recentRow.click();
    // Landing directly on the order's tracking view, not the Orders list — a
    // heading with the order code, and a "← Orders" back link confirming this is
    // one level deeper than the tab bar.
    await expect(page.getByRole("heading", { name: /ord-/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^orders$/i }).first()).toBeVisible();
  });
});
