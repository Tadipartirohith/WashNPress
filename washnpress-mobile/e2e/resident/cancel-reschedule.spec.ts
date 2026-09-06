import { test, expect, type Page } from "@playwright/test";
import { clearAuth, loginWithDemoAccount } from "../helpers";

/** Books a fresh pickup and lands back on Home. Returns false if no slot was available. */
async function bookFreshPickup(page: Page): Promise<boolean> {
  await page.getByRole("tab", { name: /^book/i }).click();
  await expect(page.getByText(/schedule a pickup/i)).toBeVisible({ timeout: 10_000 });

  let slotButton = page.getByRole("button", { name: /available/i }).first();
  let hasSlot = await slotButton.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (!hasSlot) {
    await page.getByText(/^\u{1F4C5}/u).first().click();
    await expect(page.getByText(/^(january|february|march|april|may|june|july|august|september|october|november|december)/i)).toBeVisible({ timeout: 5_000 });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.getByText(String(tomorrow.getDate()), { exact: true }).click();
    slotButton = page.getByRole("button", { name: /available/i }).first();
    hasSlot = await slotButton.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  }
  if (!hasSlot) return false;
  await slotButton.click();

  await page.getByRole("button", { name: /increase.*garments/i }).click();
  await page.getByLabel(/approximate weight/i).fill("4.5");
  await page.getByRole("button", { name: /add another item/i }).click();

  const bookButton = page.getByRole("button", { name: /^book pickup$/i });
  await expect(bookButton).toBeEnabled({ timeout: 10_000 });
  await bookButton.click();
  await expect(page.getByText(/confirm pickup/i)).toBeVisible({ timeout: 10_000 });
  await page.getByText(/confirm booking/i).click();
  await expect(page.getByText(/^scheduled$/i).first()).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe("Mobile resident app — cancel and reschedule", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Resident (Anusha)");
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 10_000 });
  });

  test("positive: a freshly booked pickup can be cancelled for free, within the hour", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No pickup slots available today or tomorrow in this environment.");

    // The tracking view for the order just booked is already showing.
    await expect(page.getByText(/change this booking/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/free to cancel or reschedule/i)).toBeVisible();

    await page.getByRole("button", { name: /^cancel booking$/i }).click();
    // A confirm modal guards the destructive action.
    await expect(page.getByText("Cancel this booking?", { exact: true })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /^cancel booking$/i }).last().click();
    await expect(page.getByText(/free, within the hour/i)).toBeVisible({ timeout: 10_000 });
  });

  test("positive: a freshly booked pickup can be rescheduled to another slot", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No pickup slots available today or tomorrow in this environment.");

    await page.getByRole("button", { name: /^reschedule booking$/i }).click();
    // The reschedule wizard: Date -> Time -> Review.
    await expect(page.getByText(/^date$/i).first()).toBeVisible({ timeout: 10_000 });
    const nextButton = page.getByRole("button", { name: /^next$/i });
    if (await nextButton.isVisible().catch(() => false)) await nextButton.click();

    const slotButton = page.getByRole("button", { name: /available/i }).first();
    const found = await slotButton.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No slots available to reschedule into.");
    await slotButton.click();
    const next2 = page.getByRole("button", { name: /^next$/i });
    if (await next2.isVisible().catch(() => false)) await next2.click();

    await page.getByRole("button", { name: /confirm/i }).last().click();
    await expect(page.getByText(/free, within the hour|fee was charged|fee applies/i)).toBeVisible({ timeout: 10_000 });
  });
});
