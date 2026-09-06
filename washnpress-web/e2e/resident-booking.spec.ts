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

test.describe("Resident web app — booking a pickup", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("positive: full booking flow (service + slot) succeeds and lands on Orders", async ({ page }) => {
    await page.getByRole("button", { name: /book a pickup/i }).click();
    await expect(page.getByRole("heading", { name: /book a pickup/i })).toBeVisible();

    // Choose the first service card.
    await page.locator("section", { hasText: "Choose a service" }).locator("button").first().click();

    // Bump quantity up once to exercise the stepper.
    await page.getByRole("button", { name: "More" }).click();

    // Today's slots may already be past their cutoff depending on the time of day
    // this suite runs; the date picker (added for parity with the mobile app,
    // which already had one) lets the test move to tomorrow, which always has a
    // full set of fresh slots in the seeded demo data.
    const slotsSection = page.locator("section", { hasText: /pick a slot for/i });
    let hasSlots = await slotsSection.locator("button").first().isVisible().catch(() => false);
    if (!hasSlots) {
      const dateInput = page.locator('input[type="date"]');
      const tomorrow = await dateInput.evaluate((el: HTMLInputElement) => {
        const d = new Date(el.min);
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      });
      await dateInput.fill(tomorrow);
      hasSlots = await slotsSection.locator("button").first().isVisible({ timeout: 10_000 }).catch(() => false);
    }
    test.skip(!hasSlots, "No slots available today or tomorrow in the seeded demo data.");

    await slotsSection.locator("button").first().click();

    const confirmButton = page.getByRole("button", { name: /confirm pickup/i });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page.getByRole("heading", { name: /your orders/i })).toBeVisible({ timeout: 10_000 });
    // The freshly booked order should appear somewhere in the list.
    await expect(page.getByText(/in progress|upcoming/i).first()).toBeVisible();
  });

  test("positive: choosing a future day updates the slot list for that day", async ({ page }) => {
    await page.getByRole("button", { name: /book a pickup/i }).click();
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible();
    const min = await dateInput.getAttribute("min");
    expect(min).toBeTruthy();

    const tomorrow = await dateInput.evaluate((el: HTMLInputElement) => {
      const d = new Date(el.min);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    });
    await dateInput.fill(tomorrow);
    await expect(page.getByRole("heading", { name: new RegExp(`pick a slot for ${tomorrow}`, "i") })).toBeVisible();
  });

  test("negative: confirm button stays disabled until both a service and a slot are chosen", async ({ page }) => {
    await page.getByRole("button", { name: /book a pickup/i }).click();
    const confirmButton = page.getByRole("button", { name: /confirm pickup/i });
    await expect(confirmButton).toBeDisabled();

    await page.locator("section", { hasText: "Choose a service" }).locator("button").first().click();
    // Service picked but no slot yet — must still be disabled.
    await expect(confirmButton).toBeDisabled();
  });

  test("positive: the sticky summary shows a live total and slots show remaining capacity", async ({ page }) => {
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
    test.skip(!hasSlots, "No slots available today or tomorrow in the seeded demo data.");

    // A slot with capacity left says so, right on the chip.
    await expect(slotsSection.getByText(/\d+ left/i).first()).toBeVisible();

    // Before picking a slot, the sticky bar has nothing to quote yet.
    const stickyTotal = page.locator("p.font-display.text-lg.font-bold");
    await expect(stickyTotal).toHaveText("—");

    await slotsSection.locator("button").first().click();
    // Once service + slot are both chosen, the backend-computed total appears —
    // live, before the booking is ever confirmed.
    await expect(stickyTotal).toHaveText(/^₹[\d,]+\.\d{2}$/, { timeout: 10_000 });
  });

  test("negative: garment quantity stepper cannot go below 1 or above 50", async ({ page }) => {
    await page.getByRole("button", { name: /book a pickup/i }).click();
    const fewer = page.getByRole("button", { name: "Fewer" });
    const qty = page.locator("span.font-display.text-xl.font-bold");
    for (let i = 0; i < 5; i++) await fewer.click();
    await expect(qty).toHaveText("1");

    const more = page.getByRole("button", { name: "More" });
    for (let i = 0; i < 60; i++) await more.click();
    await expect(qty).toHaveText("50");
  });

  test("Orders tab shows an empty state copy when there is nothing to show, otherwise real orders", async ({ page }) => {
    await page.getByRole("button", { name: "Orders" }).click();
    await expect(page.getByRole("heading", { name: /your orders/i })).toBeVisible();
    const emptyVisible = await page.getByText(/no orders yet/i).isVisible().catch(() => false);
    if (!emptyVisible) {
      // At least one order row should be clickable through to tracking.
      const firstRow = page.locator("button", { hasText: /scheduled|in progress|delivered|picked|washing|ironing/i }).first();
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        await expect(page.getByRole("button", { name: /orders/i })).toBeVisible();
      }
    }
  });
});
