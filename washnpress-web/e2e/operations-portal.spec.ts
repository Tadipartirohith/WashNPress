import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

async function loginOperations(page: Page) {
  await page.goto("/operations");
  await clearAuth(page);
  await page.reload();
  await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(DEMO_PHONES.operations);
  await page.getByRole("button", { name: /send code/i }).click();
  const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
  await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByText(/wrong account for this portal|pending verification/i)).not.toBeVisible({ timeout: 10_000 });
}

/**
 * A left-nav destination, by name.
 *
 * Scoped to the nav because the dashboard body has its own buttons called "Pickups to
 * collect", "Issues need attention" and "Ready for delivery" — a page-wide match on
 * "Pickups" hits two elements and fails strict mode instead of navigating. And the
 * name is a pattern, not an exact string, because a destination with work waiting
 * renders a count beside it: the button is called "Pickups 14" on a busy day and
 * "Pickups" on a quiet one, so an exact match passes only while the queue is empty.
 */
function navButton(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("navigation").getByRole("button", { name: new RegExp(`^${escaped}( \\d+)?$`) });
}

const NAV_ITEMS = ["Dashboard", "Pickups", "Active", "Claimable", "History", "Services", "Issues", "Profile"];

test.describe("Operations portal", () => {
  test.beforeEach(async ({ page }) => {
    await loginOperations(page);
  });

  test("smoke: every nav section renders without a crash", async ({ page }) => {
    for (const label of NAV_ITEMS) {
      await navButton(page, label).click();
      await expect(page.getByText(/application error|unhandled runtime error/i)).not.toBeVisible();
      await page.waitForTimeout(400);
    }
  });

  test("negative: marking a pickup failed requires a reason", async ({ page }) => {
    await navButton(page, "Pickups").click();
    const failButton = page.getByRole("button", { name: /^failed$/i }).first();
    const found = await failButton.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No pending pickups to mark failed in this demo dataset.");
    await failButton.click();
    const submit = page.getByRole("dialog").getByRole("button", { name: /fail|confirm/i }).last();
    await expect(submit).toBeDisabled();
  });
});
