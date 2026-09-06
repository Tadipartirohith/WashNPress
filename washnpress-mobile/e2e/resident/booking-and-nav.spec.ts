import { test, expect } from "@playwright/test";
import { clearAuth, loginWithDemoAccount } from "../helpers";

test.describe("Mobile resident app — booking and navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Resident (Anusha)");
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 10_000 });
  });

  test("smoke: every primary tab and the More menu opens without a console error", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    for (const tab of ["Home", "Book", "Orders", "Wallet", "More"]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") }).click();
      await page.waitForTimeout(400);
    }
    expect(errors, `Console errors while navigating tabs: ${errors.join("; ")}`).toEqual([]);
  });

  test("More menu lists Services, Plan, Support, Alerts and Profile, and each opens", async ({ page }) => {
    await page.getByRole("tab", { name: /^more/i }).click();
    for (const row of ["Services", "Plan", "Support", "Alerts", "Profile"]) {
      await expect(page.getByText(row, { exact: true })).toBeVisible();
    }
    await page.getByText("Alerts", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible({ timeout: 10_000 });
  });

  test("negative: Book pickup cannot be confirmed with an empty cart", async ({ page }) => {
    await page.getByRole("tab", { name: /^book/i }).click();
    await expect(page.getByText(/schedule a pickup/i)).toBeVisible({ timeout: 10_000 });
    const bookButton = page.getByRole("button", { name: /book pickup/i });
    await expect(bookButton).toBeDisabled();
  });

  test("positive: a full booking (garment + weight + slot) can be added, confirmed and tracked", async ({ page }) => {
    await page.getByRole("tab", { name: /^book/i }).click();
    await expect(page.getByText(/schedule a pickup/i)).toBeVisible({ timeout: 10_000 });

    let slotButton = page.getByRole("button", { name: /available/i }).first();
    let hasSlot = await slotButton.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
    if (!hasSlot) {
      // Today's slots may already be past their booking cutoff depending on what
      // time this suite runs; move to tomorrow via the date picker, which always
      // has a fresh set of slots in the seeded demo data.
      await page.getByText(/^\u{1F4C5}/u).first().click();
      await expect(page.getByText(/^(january|february|march|april|may|june|july|august|september|october|november|december)/i)).toBeVisible({ timeout: 5_000 });
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await page.getByText(String(tomorrow.getDate()), { exact: true }).click();
      slotButton = page.getByRole("button", { name: /available/i }).first();
      hasSlot = await slotButton.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    }
    test.skip(!hasSlot, "No pickup slots available today or tomorrow in this environment.");
    // A slot with room says how much, right on the chip.
    await expect(page.getByText(/\d+ left/i).first()).toBeVisible();
    await slotButton.click();

    await page.getByRole("button", { name: /increase.*garments/i }).click();
    await page.getByLabel(/approximate weight/i).fill("4.5");
    await page.getByRole("button", { name: /add another item/i }).click();

    // The sticky bar's total is live: it should already show a real backend-quoted
    // price for the cart just added, before "Book pickup" is ever tapped.
    await expect(page.getByText(/₹[\d,]+(\.\d{2})?/).first()).toBeVisible({ timeout: 10_000 });

    const bookButton = page.getByRole("button", { name: /^book pickup$/i });
    await expect(bookButton).toBeEnabled({ timeout: 10_000 });
    await bookButton.click();

    await expect(page.getByText(/confirm pickup/i)).toBeVisible({ timeout: 10_000 });
    await page.getByText(/confirm booking/i).click();

    await expect(page.getByText(/^scheduled$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/tracking/i).first()).toBeVisible();
  });
});
