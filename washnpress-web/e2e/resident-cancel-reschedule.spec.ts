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

/** Books a fresh pickup and returns once it's confirmed, leaving the app on Orders. */
async function bookFreshPickup(page: Page): Promise<boolean> {
  await page.getByRole("button", { name: /book a pickup/i }).click();
  await page.locator("section", { hasText: "Choose a service" }).locator("button").first().click();

  const slotsSection = page.locator("section", { hasText: /pick a slot for/i });
  let hasSlots = await slotsSection.locator("button").first().isVisible().catch(() => false);
  if (!hasSlots) {
    const dateInput = page.locator('input[type="date"]');
    const tomorrow = await dateInput.evaluate((el: HTMLInputElement) => {
      const d = new Date(el.min); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10);
    });
    await dateInput.fill(tomorrow);
    hasSlots = await slotsSection.locator("button").first().isVisible({ timeout: 10_000 }).catch(() => false);
  }
  if (!hasSlots) return false;

  await slotsSection.locator("button").first().click();
  const confirmButton = page.getByRole("button", { name: /confirm pickup/i });
  await expect(confirmButton).toBeEnabled({ timeout: 10_000 });
  await confirmButton.click();
  await expect(page.getByRole("heading", { name: /your orders/i })).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe("Resident web app — cancel and reschedule", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("positive: a freshly booked pickup can be cancelled for free, within the hour", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No slots available today or tomorrow in the seeded demo data.");

    // The most recent order is in "In progress" or "Upcoming".
    await page.getByText(/scheduled/i).first().click();
    await expect(page.getByRole("heading", { name: /ord-/i })).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("heading", { name: /change this booking/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/free to cancel or reschedule/i)).toBeVisible();

    await page.getByRole("button", { name: /^cancel booking$/i }).click();
    await page.getByRole("button", { name: /confirm cancel/i }).click();
    await expect(page.getByText(/free, within the hour/i)).toBeVisible({ timeout: 10_000 });
  });

  test("positive: a freshly booked pickup can be rescheduled to another slot", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No slots available today or tomorrow in the seeded demo data.");

    await page.getByText(/scheduled/i).first().click();
    await expect(page.getByRole("heading", { name: /ord-/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^reschedule booking$/i }).click();
    // The inline reschedule picker reuses the same date+slot pattern as Book(). Its
    // "Never mind" button is unique to it, so anchor there instead of guessing at
    // container classes shared with the rest of the page.
    const neverMind = page.getByRole("button", { name: /never mind/i });
    await expect(neverMind).toBeVisible({ timeout: 10_000 });
    const picker = neverMind.locator("xpath=..");
    const slotButtons = picker.locator("button").filter({ hasNotText: /never mind|confirm new slot/i });
    const found = await slotButtons.first().waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No slots available to reschedule into.");
    await slotButtons.first().click();
    await page.getByRole("button", { name: /confirm new slot/i }).click();
    await expect(page.getByText(/free, within the hour|fee was charged|fee applies/i)).toBeVisible({ timeout: 10_000 });
  });

  test("negative: an order that's already been delivered offers no cancel/reschedule at all", async ({ page }) => {
    // Sanity check on the eligibility gate itself, using whatever the Orders list
    // already has rather than manufacturing a delivered order end-to-end.
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    const pastRow = page.locator("button", { hasText: /delivered|cancelled/i }).first();
    const found = await pastRow.isVisible().catch(() => false);
    test.skip(!found, "No past (delivered/cancelled) order in the seeded demo data.");
    await pastRow.click();
    await expect(page.getByRole("button", { name: /^cancel booking$/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^reschedule booking$/i })).not.toBeVisible();
  });
});
