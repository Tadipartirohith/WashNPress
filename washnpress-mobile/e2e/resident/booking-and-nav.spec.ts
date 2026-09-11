import { test, expect } from "@playwright/test";
import { bookFreshPickup, clearAuth, loginWithDemoAccount, RESIDENT_HOME } from "../helpers";

test.describe("Mobile resident app — booking and navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Resident (Anusha)");
    await expect(page.getByText(RESIDENT_HOME)).toBeVisible({ timeout: 10_000 });
  });

  test("smoke: every primary tab opens without a console error", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    // Four tabs, no More menu: the resident app now carries the same four
    // destinations as the web rail, and everything that used to sit behind More is
    // on Profile.
    for (const tab of ["Home", "Book", "Orders", "Profile"]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") }).click();
      await page.waitForTimeout(400);
    }
    expect(errors, `Console errors while navigating tabs: ${errors.join("; ")}`).toEqual([]);
  });

  test("Profile reaches the plan, the wallet, alerts, support and account deletion", async ({ page }) => {
    // These used to live behind a More tab. Losing one of them is losing the only
    // route to it — and "Delete my account" is the one Apple 5.1.1(v) requires to
    // exist inside the app at all.
    await page.getByRole("tab", { name: /^profile/i }).click();
    for (const row of [/my plan/i, /repeat pickups/i, /wallet/i, /alerts/i, /help & support/i, /delete my account/i]) {
      await expect(page.getByRole("button", { name: row })).toBeVisible({ timeout: 10_000 });
    }
    await page.getByRole("button", { name: /alerts/i }).click();
    await expect(page.getByText(/notification/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("negative: nothing selected means nothing to continue with", async ({ page }) => {
    await page.getByRole("tab", { name: /^book/i }).click();
    await expect(page.getByText(/what would you like to book/i)).toBeVisible({ timeout: 15_000 });

    // Laundry Pickup arrives selected, so the way to have nothing in the booking is
    // to turn it off. The wizard must then refuse to go on rather than carrying an
    // empty booking to the slot step.
    await page.getByText(/^laundry pickup$/i).first().click();
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  });

  test("positive: a pickup can be booked end to end and reaches My Orders", async ({ page }) => {
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No pickup slot available today in this environment.");

    // The booking has to exist somewhere the resident can find it again.
    // Under "Upcoming", not the "Current / Active" group My Orders opens on — that
    // one stays empty until an operator is on the way.
    await page.getByRole("tab", { name: /^orders/i }).click();
    await page.getByText("Upcoming", { exact: true }).first().click();
    await expect(page.getByText(/ORD-/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
