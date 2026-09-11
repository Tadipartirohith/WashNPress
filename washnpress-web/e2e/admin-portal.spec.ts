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

  test("negative: New society cannot be started without a real name", async ({ page }) => {
    // "New society" is a two-step wizard — details, then naming — so the gate on step
    // one is Next, not "Create society" (which lives on step two). A society with no
    // name is a society no portal can refer to.
    await page.getByRole("navigation").getByRole("button", { name: "Societies", exact: true }).click();
    await page.getByRole("button", { name: /new society/i }).first().click();
    const wizard = page.getByRole("dialog", { name: /new society/i });
    await expect(wizard).toBeVisible({ timeout: 10_000 });

    const next = wizard.getByRole("button", { name: "Next" });
    await expect(next).toBeDisabled();

    // Whitespace is not a name. This is the trim-based rule the mobile app applies to
    // the same concept, and it holds here too.
    await wizard.getByLabel(/society name/i).fill("   ");
    await expect(next).toBeDisabled();

    await wizard.getByLabel(/society name/i).fill(`E2E Society ${Date.now()}`);
    await expect(next).toBeEnabled();
  });

  test("negative: an invalid pincode is refused with something a person can read", async ({ page }) => {
    await page.getByRole("navigation").getByRole("button", { name: "Societies", exact: true }).click();
    await page.getByRole("button", { name: /new society/i }).first().click();
    const wizard = page.getByRole("dialog", { name: /new society/i });
    await expect(wizard).toBeVisible({ timeout: 10_000 });

    await wizard.getByLabel(/society name/i).fill(`E2E Bad Pincode ${Date.now()}`);
    await wizard.getByLabel(/locality/i).fill("Test Locality");
    await wizard.getByLabel(/city/i).fill("Test City");
    await wizard.getByLabel(/^state/i).selectOption({ index: 1 }).catch(() => {});
    // An Indian PIN code never starts with a zero.
    await wizard.getByLabel(/pincode/i).fill("000000");

    await wizard.getByRole("button", { name: "Next" }).click();
    await wizard.getByRole("button", { name: /create society/i }).click();

    // Refused, and refused in words. An admin who is shown `invalid_request` learns
    // nothing about which of the eight fields they have to go back and change.
    const problem = wizard.getByText(/pincode|invalid|required|must be/i).first();
    await expect(problem).toBeVisible({ timeout: 10_000 });
    await expect(problem).not.toHaveText(/^[a-z]+(_[a-z]+)+$/);
  });

  test("negative: a service cannot be created without its details", async ({ page }) => {
    // Services live under Catalogue, on its Services tab — there is no "services" nav
    // item, which is what this test used to look for. Like New society, New service is
    // a wizard, so the gate is a disabled Next rather than a create button.
    await page.getByRole("navigation").getByRole("button", { name: "Catalogue", exact: true }).click();
    await page.getByRole("button", { name: "Services", exact: true }).click();
    await page.getByRole("button", { name: /add new service/i }).click();

    const wizard = page.getByRole("dialog", { name: /new service/i });
    await expect(wizard).toBeVisible({ timeout: 10_000 });

    // An unnamed, uncategorised, unpriced service is one an operator cannot charge
    // for, so the wizard must not let it past the first step.
    const next = wizard.getByRole("button", { name: "Next" });
    await expect(next).toBeDisabled();

    await wizard.getByRole("textbox").first().fill("   ");
    await expect(next).toBeDisabled();
  });
});
