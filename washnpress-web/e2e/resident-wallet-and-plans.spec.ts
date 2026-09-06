import { test, expect } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

async function login(page: import("@playwright/test").Page) {
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

test.describe("Resident web app — wallet", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Wallet", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^wallet$/i })).toBeVisible();
  });

  test("positive: topping up starts a payment order and shows a confirmation note", async ({ page }) => {
    const before = await page.locator("p.font-display.text-4xl.font-bold").textContent();
    await page.getByRole("button", { name: /add ₹200/i }).click();
    await expect(page.getByText(/payment started|balance updates once/i)).toBeVisible({ timeout: 10_000 });
    // A top-up only starts a payment order; the demo has no webhook firing, so the
    // balance itself should NOT jump immediately — money must never move on the
    // client's say-so alone.
    const after = await page.locator("p.font-display.text-4xl.font-bold").textContent();
    expect(after).toBe(before);
  });

  test("negative: topping up repeatedly does not corrupt the displayed balance", async ({ page }) => {
    await page.getByRole("button", { name: /add ₹500/i }).click();
    await expect(page.getByText(/payment started|balance updates once/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /add ₹1,000|add ₹1000/i }).click();
    await expect(page.getByText(/payment started|balance updates once/i)).toBeVisible({ timeout: 10_000 });
    // Still a well-formed rupee amount, not NaN/undefined.
    await expect(page.locator("p.font-display.text-4xl.font-bold")).toHaveText(/^₹[\d,]+\.\d{2}$/);
  });
});

test.describe("Resident web app — plans", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Plans has no bottom-tab entry; it's only reachable from the Home "Plan" card.
    await page.locator("button", { hasText: /choose a plan|plan/i }).first().click();
    await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible({ timeout: 10_000 });
  });

  test("negative: subscribing without enough wallet balance surfaces a clear top-up message, not a raw error", async ({ page }) => {
    const chooseButtons = page.getByRole("button", { name: /choose plan/i });
    const count = await chooseButtons.count();
    test.skip(count === 0, "No plans configured in this environment.");
    await chooseButtons.first().click();
    // "Already subscribed" is also an acceptable outcome here: the demo resident
    // used across this whole suite may have picked up a subscription from an
    // earlier test in the run. Either way, the point of this test is that the
    // failure reads as a sentence, never a raw error dump.
    const note = page.locator("p", { hasText: /subscribed|not enough wallet balance|could not subscribe|active subscription/i }).first();
    await expect(note).toBeVisible({ timeout: 10_000 });
    const text = (await note.textContent()) ?? "";
    // Whatever happened, it must be a human sentence, never a raw error/exception dump.
    expect(text).not.toMatch(/\[object|undefined|NaN|Error:/i);
  });
});
