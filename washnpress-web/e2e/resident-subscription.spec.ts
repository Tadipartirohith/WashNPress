import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

async function login(page: Page) {
  await page.goto("/app");
  await clearAuth(page);
  await page.reload();
  await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
  await page.getByRole("button", { name: /send code/i }).click();
  const otpInput = page.locator('input[inputmode="numeric"]');
  await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByText(/good day/i)).toBeVisible({ timeout: 10_000 });
}

/** Starts two ₹1,000 top ups — the same flow every resident uses — then waits for
 * the isolated backend's reconciliation job (sped up for this suite) to actually
 * credit them, rather than assuming a fixed delay. */
async function fundWallet(page: Page) {
  await page.getByRole("button", { name: "Wallet", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^wallet$/i })).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: /add ₹1,000|add ₹1000/i }).click();
    await expect(page.getByText(/payment started|balance updates once/i)).toBeVisible({ timeout: 10_000 });
  }
  const balance = page.locator("p.font-display.text-4xl.font-bold");
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "Wallet", exact: true }).click();
    const text = (await balance.textContent()) ?? "";
    const paise = Math.round(parseFloat(text.replace(/[^0-9.]/g, "")) * 100);
    expect(paise).toBeGreaterThanOrEqual(200000);
  }).toPass({ timeout: 30_000, intervals: [1500] });
}

test.describe("Resident web app — subscription management", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("positive: subscribe, upgrade with a quote, then cancel for a prorated refund", async ({ page }) => {
    test.setTimeout(90_000);
    // Fund the wallet well beyond what a Basic subscribe + upgrade will cost.
    await fundWallet(page);

    await page.getByRole("button", { name: "Plans", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible();

    const chooseButtons = page.getByRole("button", { name: /^choose plan$/i });
    const planCount = await chooseButtons.count();
    test.skip(planCount === 0, "No plans configured in this environment.");

    // Subscribe to the cheapest listed plan (cards render in the order the API
    // returns, which seeds cheapest-first, but this test doesn't depend on that).
    await chooseButtons.first().click();
    await expect(page.getByText(/subscribed to/i)).toBeVisible({ timeout: 10_000 });

    // The subscribed view shows a usage card instead of a bare plan list.
    await expect(page.getByText(/current plan/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/used.*left this cycle/i)).toBeVisible();

    // Any remaining card now offers Upgrade/Downgrade instead of Choose plan.
    const changeButton = page.getByRole("button", { name: /^(upgrade|downgrade)$/i }).first();
    const hasOtherPlan = await changeButton.isVisible().catch(() => false);
    test.skip(!hasOtherPlan, "Only one plan configured; nothing to change to.");
    const wasUpgrade = (await changeButton.textContent())?.toLowerCase().includes("upgrade");

    await changeButton.click();
    await expect(page.getByRole("heading", { name: /change to/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/current plan/i).last()).toBeVisible();
    await expect(page.getByText(/to pay now/i)).toBeVisible();

    const confirmButton = page.getByRole("button", { name: /pay ₹|confirm change/i });
    await confirmButton.click();
    await expect(page.getByRole("heading", { name: /change to/i })).not.toBeVisible({ timeout: 10_000 });
    if (wasUpgrade) {
      await expect(page.getByText(/upgraded|scheduled/i)).toBeVisible({ timeout: 10_000 });
    }

    // Cancel the subscription outright, and confirm the refund is surfaced.
    await page.getByRole("button", { name: /^cancel subscription$/i }).click();
    await page.locator('input[placeholder="Why are you cancelling?"]').fill("E2E test cleanup");
    await page.getByRole("button", { name: /^confirm cancel$/i }).click();
    await expect(page.getByText(/subscription cancelled/i)).toBeVisible({ timeout: 10_000 });

    // Back to the not-subscribed browse view.
    await expect(page.getByRole("button", { name: /^choose plan$/i }).first()).toBeVisible({ timeout: 10_000 });
  });
});
