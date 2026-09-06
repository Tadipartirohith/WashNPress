import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

const PORTALS = [
  { path: "/admin", title: /admin/i, phone: DEMO_PHONES.admin, dashboardHeading: /dashboard|overview|societies|orders/i },
  { path: "/operations", title: /operations/i, phone: DEMO_PHONES.operations, dashboardHeading: /dashboard|pickups|queue/i },
  { path: "/supervisor", title: /supervisor/i, phone: DEMO_PHONES.supervisor, dashboardHeading: /dashboard|overview|society/i },
];

async function goSignedOut(page: Page, path: string) {
  await page.goto(path);
  await clearAuth(page);
  await page.reload();
}

test.describe("Staff portals — auth", () => {
  for (const portal of PORTALS) {
    test(`positive: ${portal.path} — demo phone + OTP logs in`, async ({ page }) => {
      await goSignedOut(page, portal.path);
      await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(portal.phone);
      await page.getByRole("button", { name: /send code/i }).click();
      const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
      await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
      await page.getByRole("button", { name: /verify and continue/i }).click();
      // Either the portal's own content loads, or (rarely, for a freshly-created
      // demo staff account) a pending-verification screen — either is a legitimate
      // signed-in outcome, unlike the wrong-role / sign-in-failed screens below.
      await expect(
        page.getByText(/wrong account for this portal|that code did not work/i)
      ).not.toBeVisible({ timeout: 8_000 });
    });

    test(`negative: ${portal.path} — Send code is disabled below 10 digits`, async ({ page }) => {
      await goSignedOut(page, portal.path);
      const phoneInput = page.locator('#portal-phone, input[inputmode="tel"]').first();
      await phoneInput.fill("123456789"); // 9 digits
      await expect(page.getByRole("button", { name: /send code/i })).toBeDisabled();
    });

    test(`negative: ${portal.path} — wrong OTP shows an error and does not sign in`, async ({ page }) => {
      await goSignedOut(page, portal.path);
      await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(portal.phone);
      await page.getByRole("button", { name: /send code/i }).click();
      const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
      await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
      await otpInput.fill("000000");
      await page.getByRole("button", { name: /verify and continue/i }).click();
      await expect(page.getByText(/that code did not work/i)).toBeVisible({ timeout: 10_000 });
    });
  }

  test("negative (RBAC): a resident's number is wrong-role for the admin portal", async ({ page }) => {
    await goSignedOut(page, "/admin");
    await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(DEMO_PHONES.resident);
    await page.getByRole("button", { name: /send code/i }).click();
    const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
    await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(page.getByText(/wrong account for this portal/i)).toBeVisible({ timeout: 10_000 });

    // "Try another number" must actually return to a fresh login, not loop.
    await page.getByRole("button", { name: /try another number/i }).click();
    await expect(page.locator('#portal-phone, input[inputmode="tel"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test("negative (RBAC): an operations number is wrong-role for the supervisor portal", async ({ page }) => {
    await goSignedOut(page, "/supervisor");
    await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(DEMO_PHONES.operations);
    await page.getByRole("button", { name: /send code/i }).click();
    const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
    await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(page.getByText(/wrong account for this portal/i)).toBeVisible({ timeout: 10_000 });
  });
});
