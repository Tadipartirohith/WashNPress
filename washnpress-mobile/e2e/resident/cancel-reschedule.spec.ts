import { test, expect } from "@playwright/test";
import { bookFreshPickup, clearAuth, loginWithDemoAccount, openUpcomingOrder, RESIDENT_HOME } from "../helpers";

test.describe("Mobile resident app — cancel and reschedule", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Resident (Anusha)");
    await expect(page.getByText(RESIDENT_HOME)).toBeVisible({ timeout: 10_000 });
  });

  test("positive: a freshly booked pickup can be cancelled for free, within the hour", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No pickup slots available today or tomorrow in this environment.");

    // Confirmation now ends on its own screen rather than dropping straight into the
    // order, so the order has to be opened from My Orders.
    await openUpcomingOrder(page);
    await expect(page.getByText(/tracking/i).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^cancel booking$/i }).click();
    // A confirm modal guards the destructive action.
    await expect(page.getByText("Cancel this booking?", { exact: true })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /^cancel booking$/i }).last().click();
    await expect(page.getByText(/free, within the hour/i)).toBeVisible({ timeout: 10_000 });
  });

  test("positive: a freshly booked pickup can be rescheduled to another slot", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No pickup slots available today or tomorrow in this environment.");

    await openUpcomingOrder(page);
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
