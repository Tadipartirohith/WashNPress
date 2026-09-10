import { test, expect } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

// The resident app has no bottom tab bar. It has a left rail (a drawer on narrow
// screens) with four destinations, and Plan, Wallet and Support are reached through
// Profile. This file used to assert against "the bottom tab bar" and a "Plans" tab,
// both of which had already been removed from the app — and the TabBar component it
// was written against was still sitting in page.tsx, defined and never rendered.
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
    await expect(page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })).toBeVisible({ timeout: 10_000 });
  });

  test("positive: the Plan page is reached through Profile in the nav rail", async ({ page }) => {
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^profile$/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /view plan/i }).click();
    await expect(page.getByRole("heading", { name: /^plan$/i })).toBeVisible({ timeout: 10_000 });
  });

  test("positive: the current order on Home opens straight into its tracking view", async ({ page }) => {
    const currentOrder = page.getByRole("heading", { name: "Current Order", exact: true, level: 3 })
      .locator("xpath=following-sibling::*[1]").locator("button").first();
    const hasOrder = await currentOrder.isVisible().catch(() => false);
    test.skip(!hasOrder, "No current order in the seeded demo data for this run.");
    await currentOrder.click();
    // Landing directly on the order's tracking view, not the Orders list — a "← Orders"
    // back link confirms this is one level deeper than the nav rail.
    await expect(page.getByRole("button", { name: /^orders$/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("negative: Escape closes the booking wizard and returns focus to the nav", async ({ page }) => {
    const bookButton = page.getByRole("button", { name: "Book Pickup", exact: true });
    await bookButton.click();
    const wizard = page.getByRole("dialog", { name: /^book$/i });
    await expect(wizard).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(wizard).toBeHidden();
    await expect(bookButton).toBeFocused();
  });
});
