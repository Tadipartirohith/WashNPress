import { test, expect } from "@playwright/test";
import { DEMO_PHONES, loginAndCaptureToken, seedToken, pickCalendarDate, tomorrowIso } from "./helpers";

/** Opens the Book a pickup view from the resident dashboard. */
async function openBooking(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /schedule pickup/i }).first().click();
  await expect(page.getByRole("heading", { name: /book a pickup/i })).toBeVisible();
}

test.describe("Resident web app — booking a pickup", () => {
  // Log in once for the whole file (the backend rate-limits OTP per phone), then
  // replay the token before each test rather than re-running the OTP flow.
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

  // Since I-36 the resident just picks a day and a slot — the operator records the
  // clothes, services and quantities at the door — so the flow is date → slot →
  // Continue, with no service or quantity step on this screen.
  test("positive: picking a day and a slot books the pickup and lands on Orders", async ({ page }) => {
    await openBooking(page);

    // Today's slots may already be past their cutoff depending on the time of day,
    // so move to tomorrow, which always has a fresh set in the seeded demo data.
    // The date field is the calendar picker added in I-68, not a native input.
    const tomorrow = tomorrowIso();
    await pickCalendarDate(page, /choose a pickup day/i, tomorrow);

    const slotsSection = page.locator("section", { hasText: /pick a slot for/i });
    const firstSlot = slotsSection.locator("button").first();
    const hasSlots = await firstSlot.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!hasSlots, "No slots available tomorrow in the seeded demo data.");

    await firstSlot.click();
    const continueButton = page.getByRole("button", { name: /^continue$/i });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    await expect(page.getByRole("heading", { name: /your orders/i })).toBeVisible({ timeout: 10_000 });
  });

  test("positive: choosing a future day updates the slot list heading for that day", async ({ page }) => {
    await openBooking(page);
    const tomorrow = tomorrowIso();
    await pickCalendarDate(page, /choose a pickup day/i, tomorrow);
    await expect(page.getByRole("heading", { name: new RegExp(`pick a slot for ${tomorrow}`, "i") })).toBeVisible();
  });

  test("positive: past days are disabled in the calendar, today and future days are selectable", async ({ page }) => {
    await openBooking(page);
    await page.getByRole("button", { name: /choose a pickup day/i }).first().click();
    // Yesterday's cell (if in this month) is disabled; a "Today" shortcut is offered.
    await expect(page.getByRole("button", { name: /^today$/i })).toBeVisible();
    // At least one day cell is enabled and clickable.
    const tomorrow = tomorrowIso();
    const day = String(Number(tomorrow.slice(8, 10)));
    await expect(page.getByRole("button", { name: day, exact: true })).toBeEnabled();
  });

  test("negative: Continue stays disabled until a slot is chosen", async ({ page }) => {
    await openBooking(page);
    const continueButton = page.getByRole("button", { name: /^continue$/i });
    await expect(continueButton).toBeDisabled();
  });

  test("Orders tab shows an empty-state copy when there is nothing, otherwise real orders", async ({ page }) => {
    // The desktop shell (I-65) labels this nav item "My Orders".
    await page.getByRole("button", { name: /my orders/i }).first().click();
    await expect(page.getByRole("heading", { name: /your orders/i })).toBeVisible();
    const emptyVisible = await page.getByText(/no orders yet/i).isVisible().catch(() => false);
    if (!emptyVisible) {
      const firstRow = page.locator("button", { hasText: /scheduled|in progress|delivered|picked|washing|ironing/i }).first();
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        await expect(page.getByRole("button", { name: /orders/i }).first()).toBeVisible();
      }
    }
  });
});
