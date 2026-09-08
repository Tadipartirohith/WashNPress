import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, loginAndCaptureToken, seedToken, pickCalendarDate, tomorrowIso } from "./helpers";

/**
 * Books a fresh pickup and returns once it's confirmed, leaving the app on Orders.
 * Since I-36 the resident only picks a day and a slot; the date field is the I-68
 * calendar picker, driven through pickCalendarDate rather than a native input.
 */
async function bookFreshPickup(page: Page): Promise<boolean> {
  await page.getByRole("button", { name: /schedule pickup/i }).first().click();
  await expect(page.getByRole("heading", { name: /book a pickup/i })).toBeVisible();

  await pickCalendarDate(page, /choose a pickup day/i, tomorrowIso());

  const slotsSection = page.locator("section", { hasText: /pick a slot for/i });
  const firstSlot = slotsSection.locator("button").first();
  const hasSlots = await firstSlot.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!hasSlots) return false;

  await firstSlot.click();
  const continueButton = page.getByRole("button", { name: /^continue$/i });
  await expect(continueButton).toBeEnabled({ timeout: 10_000 });
  await continueButton.click();
  await expect(page.getByRole("heading", { name: /your orders/i })).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe("Resident web app — cancel and reschedule", () => {
  // One OTP login per file; the token is replayed before each test.
  let token: string;
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    token = await loginAndCaptureToken(page, DEMO_PHONES.resident);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await seedToken(page, token);
    await page.goto("/app");
    await expect(page.getByRole("button", { name: /schedule pickup/i }).first()).toBeVisible({ timeout: 10_000 });
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
    await page.getByRole("button", { name: /my orders/i }).first().click();
    const pastRow = page.locator("button", { hasText: /delivered|cancelled/i }).first();
    const found = await pastRow.isVisible().catch(() => false);
    test.skip(!found, "No past (delivered/cancelled) order in the seeded demo data.");
    await pastRow.click();
    await expect(page.getByRole("button", { name: /^cancel booking$/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^reschedule booking$/i })).not.toBeVisible();
  });
});
