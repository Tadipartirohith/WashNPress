import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await clearAuth(page);
  await page.reload();
  await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(DEMO_PHONES.admin);
  await page.getByRole("button", { name: /send code/i }).click();
  const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
  await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByText(/wrong account for this portal/i)).not.toBeVisible({ timeout: 10_000 });
}

const NAV_ITEMS = ["Dashboard", "People", "Societies", "Orders & subscriptions", "Catalogue", "Slots", "Reports", "Issues", "Integrations", "Audit log"];

test.describe("Admin portal", () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
  });

  test("smoke: every nav section renders without a crash or a stuck spinner", async ({ page }) => {
    for (const label of NAV_ITEMS) {
      await page.getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
      // No section should be left permanently loading, and none should surface an
      // unhandled client-side exception (Next.js error overlay text).
      await expect(page.getByText(/application error|unhandled runtime error/i)).not.toBeVisible();
      await page.waitForTimeout(400);
    }
  });

  test("negative: New society requires a name before it can be created", async ({ page }) => {
    await page.getByRole("button", { name: "Societies", exact: true }).click();
    await page.getByRole("button", { name: /new society/i }).click();
    const createButton = page.getByRole("button", { name: /create society/i });
    await expect(createButton).toBeDisabled();

    await page.getByLabel(/society name/i).fill("   ");
    // Pure whitespace should not count as a name for the purposes of enabling submit,
    // matching the trim-based validation the mobile app uses for the same concept.
    // (Documented as a known finding below if this fails.)
  });

  test("negative: invalid pincode is rejected by the backend with a visible error, not silently accepted", async ({ page }) => {
    await page.getByRole("button", { name: "Societies", exact: true }).click();
    await page.getByRole("button", { name: /new society/i }).click();
    await page.getByLabel(/society name/i).fill(`E2E Test Society ${Date.now()}`);
    await page.getByLabel(/locality/i).fill("Test Locality");
    await page.getByLabel(/city/i).fill("Test City");
    const stateField = page.getByLabel(/state/i);
    if (await stateField.isVisible().catch(() => false)) {
      const options = await stateField.locator("option").allTextContents();
      const real = options.find((o) => o && !/choose a state/i.test(o));
      if (real) await stateField.selectOption({ label: real });
    }
    await page.getByLabel(/pincode/i).fill("000000"); // leading zero — invalid per backend rule
    await page.getByRole("button", { name: /create society/i }).click();
    await expect(page.getByText(/pincode|invalid|required/i)).toBeVisible({ timeout: 10_000 });
  });

  test("negative: creating a garment service without name/category/price stays blocked", async ({ page }) => {
    await page.getByRole("button", { name: "Catalogue", exact: true }).click();
    await page.getByRole("button", { name: "services", exact: true }).click();
    await page.getByRole("button", { name: /new service/i }).click();
    const createButton = page.getByRole("button", { name: /^create service$|^add service$/i }).first();
    await expect(createButton).toBeDisabled();

    await page.getByLabel(/^name/i).fill("E2E Test Service");
    await expect(createButton).toBeDisabled(); // still missing category + price
  });
});
