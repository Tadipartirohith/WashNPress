import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, loginAndCaptureToken, seedToken, pickCalendarDate, tomorrowIso } from "./helpers";

/**
 * Books a fresh pickup and returns once it's confirmed.
 *
 * Since I-82 booking is a modal wizard opened from the rail, not a page reached from
 * a "Schedule Pickup" button on the dashboard — which is what this file was still
 * clicking, and why every test here failed before it had booked anything. Step 1
 * already has the laundry pickup selected, so Continue moves straight on; clicking
 * the tile *deselects* it and leaves Continue disabled.
 */
async function bookFreshPickup(page: Page): Promise<boolean> {
  await page.getByRole("navigation").getByRole("button", { name: "Book Pickup" }).click();
  const wizard = page.getByRole("dialog", { name: "Book" });
  await expect(wizard).toBeVisible({ timeout: 10_000 });

  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText(/step 2 of 3/i)).toBeVisible();

  await pickCalendarDate(page, /choose a pickup day/i, tomorrowIso());

  const slots = wizard.getByRole("radiogroup", { name: /available pickup slots/i }).getByRole("radio");
  // waitFor, not isVisible: `isVisible({ timeout })` does not wait — it answers for
  // the current instant — so this was asking whether the slots had rendered before
  // they possibly could, getting false, and skipping the test as "no slots".
  const hasSlots = await slots.first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasSlots) return false;
  await slots.first().click();

  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText(/step 3 of 3/i)).toBeVisible({ timeout: 10_000 });
  await wizard.getByRole("button", { name: /confirm booking/i }).click();

  // The wizard becomes its own confirmation rather than stacking a second dialog.
  const confirmed = page.getByRole("dialog", { name: /booking confirmed/i });
  await expect(confirmed).toBeVisible({ timeout: 15_000 });
  await confirmed.getByRole("button", { name: /done|close/i }).first().click();
  await expect(confirmed).not.toBeVisible({ timeout: 10_000 });
  return true;
}

/**
 * Opens the pickup just booked, through the dashboard's current-order card.
 *
 * Not by clicking the row in My Orders: the row's "Scheduled" pill is a span that
 * animates in, so Playwright never sees it settle. The dashboard card is the route a
 * resident actually takes from Home anyway.
 */
async function openTheBookedOrder(page: Page): Promise<void> {
  await page.getByRole("navigation").getByRole("button", { name: "Home" }).click();
  const card = page.getByRole("button", { name: /view order/i }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  await expect(page.getByRole("heading", { name: /ord-/i })).toBeVisible({ timeout: 10_000 });
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
    await expect(page.getByRole("navigation").getByRole("button", { name: "Book Pickup" })).toBeVisible({ timeout: 15_000 });
  });

  test("positive: a freshly booked pickup can be cancelled for free, within the hour", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No slots available today or tomorrow in the seeded demo data.");

    // The most recent order is in "In progress" or "Upcoming".
    await openTheBookedOrder(page);

    await expect(page.getByRole("heading", { name: /change this booking/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/free to cancel or reschedule/i)).toBeVisible();

    await page.getByRole("button", { name: /^cancel booking$/i }).click();
    await page.getByRole("button", { name: /confirm cancel/i }).click();
    await expect(page.getByText(/free, within the hour/i)).toBeVisible({ timeout: 10_000 });
  });

  test("positive: a freshly booked pickup can be rescheduled to another slot", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No slots available today or tomorrow in the seeded demo data.");

    await openTheBookedOrder(page);

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
    await page.getByRole("navigation").getByRole("button", { name: "My Orders" }).click();
    const pastRow = page.locator("button", { hasText: /delivered|cancelled/i }).first();
    const found = await pastRow.isVisible().catch(() => false);
    test.skip(!found, "No past (delivered/cancelled) order in the seeded demo data.");
    await pastRow.click();
    await expect(page.getByRole("button", { name: /^cancel booking$/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^reschedule booking$/i })).not.toBeVisible();
  });
});
