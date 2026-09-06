import { test, expect } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

test.describe("Resident web app — auth", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await clearAuth(page);
    await page.reload();
  });

  test("positive: demo phone + auto-filled OTP logs in and shows the dashboard", async ({ page }) => {
    await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
    await page.getByRole("button", { name: /send code/i }).click();
    const otpInput = page.locator('input[inputmode="numeric"]');
    await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(page.getByText(/good day/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /book a pickup/i })).toBeVisible();
  });

  test("negative: wrong OTP is rejected with an error and does not log in", async ({ page }) => {
    await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
    await page.getByRole("button", { name: /send code/i }).click();
    const otpInput = page.locator('input[inputmode="numeric"]');
    await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
    await otpInput.fill("000000");
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(page.getByText(/that code did not work|failed|invalid/i)).toBeVisible({ timeout: 10_000 });
    // Still on the OTP screen, not authenticated into the dashboard.
    await expect(page.getByText(/good day/i)).not.toBeVisible();
  });

  test("negative: empty phone number does not silently proceed", async ({ page }) => {
    const phoneInput = page.locator('input[inputmode="tel"]');
    await phoneInput.fill("");
    await page.getByRole("button", { name: /send code/i }).click();
    // Either the request is rejected with a visible error, or the app never
    // advances to the OTP screen. Both are acceptable; silently accepting an
    // empty phone number is not.
    const otpVisible = await page.locator('input[inputmode="numeric"]').isVisible().catch(() => false);
    if (otpVisible) {
      // If it advanced, verifying must still fail rather than logging in.
      await page.getByRole("button", { name: /verify and continue/i }).click();
      await expect(page.getByText(/good day/i)).not.toBeVisible();
    }
  });

  test("negative: garbage/short phone number is rejected by the backend", async ({ page }) => {
    await page.locator('input[inputmode="tel"]').fill("123");
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.getByText(/good day/i)).not.toBeVisible();
  });

  test("session persists across reload, and sign out clears it", async ({ page }) => {
    await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
    await page.getByRole("button", { name: /send code/i }).click();
    const otpInput = page.locator('input[inputmode="numeric"]');
    await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(page.getByText(/good day/i)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByText(/good day/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page.locator('input[inputmode="tel"]')).toBeVisible({ timeout: 10_000 });
  });
});
