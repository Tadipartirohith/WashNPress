import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

async function loginSupervisor(page: Page) {
  await page.goto("/supervisor");
  await clearAuth(page);
  await page.reload();
  await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(DEMO_PHONES.supervisor);
  await page.getByRole("button", { name: /send code/i }).click();
  const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
  await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByText(/wrong account for this portal|pending verification/i)).not.toBeVisible({ timeout: 10_000 });
}

const NAV_ITEMS = ["Overview", "Society", "Slots", "Operators", "Orders & Pickups", "Issues", "Plans"];

test.describe("Supervisor portal", () => {
  test.beforeEach(async ({ page }) => {
    await loginSupervisor(page);
  });

  test("smoke: every nav section renders without a crash", async ({ page }) => {
    for (const label of NAV_ITEMS) {
      await page.getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
      await expect(page.getByText(/application error|unhandled runtime error/i)).not.toBeVisible();
      await page.waitForTimeout(400);
    }
  });

  test("negative: adding a tower requires a name", async ({ page }) => {
    await page.getByRole("button", { name: "Society", exact: true }).click();
    const addTower = page.getByRole("button", { name: /add tower|new tower/i });
    const found = await addTower.first().waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No 'add tower' affordance visible for this demo supervisor's society.");
    await addTower.first().click();
    const submit = page.getByRole("dialog").getByRole("button", { name: /^add tower$/i });
    await expect(submit).toBeDisabled();
  });

  test("negative: a negative floor count is rejected, not silently accepted", async ({ page }) => {
    await page.getByRole("button", { name: "Society", exact: true }).click();
    const addTower = page.getByRole("button", { name: /add tower|new tower/i });
    const found = await addTower.first().waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No 'add tower' affordance visible for this demo supervisor's society.");
    await addTower.first().click();
    await page.getByLabel(/tower name/i).fill(`E2E-${Date.now()}`);
    await page.getByLabel(/floors/i).fill("-3");
    await page.getByLabel(/flats/i).fill("10");
    const submit = page.getByRole("dialog").getByRole("button", { name: /^add tower$/i });
    await expect(submit).toBeEnabled(); // client doesn't block it — the backend must
    await submit.click();
    await expect(page.getByText(/positive|invalid|must be/i)).toBeVisible({ timeout: 10_000 });
  });
});
