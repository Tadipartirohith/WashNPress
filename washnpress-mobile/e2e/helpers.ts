import { type Page, expect } from "@playwright/test";

export async function clearAuth(page: Page) {
  await page.evaluate(() => {
    try { window.localStorage.clear(); } catch { /* ignore */ }
  });
}

/** Uses the demo-account shortcut button (auto-fills phone + OTP) to log in. */
export async function loginWithDemoAccount(page: Page, accountLabel: string) {
  await page.getByRole("button", { name: accountLabel, exact: true }).click();
  const otpField = page.getByLabel("Enter OTP");
  await expect(otpField).not.toHaveValue("", { timeout: 10_000 });
  await page.getByRole("button", { name: "Verify and continue" }).click();
}
