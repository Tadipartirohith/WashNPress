import { type Page, expect } from "@playwright/test";

export const DEMO_PHONES = {
  resident: "9876543210",
  admin: "9876500001",
  operations: "9876500002",
  supervisor: "9876500011",
};

/** Fills the phone stage of an OTP login form and sends the code. */
export async function sendOtp(page: Page, phone: string) {
  const phoneInput = page.locator('#portal-phone, input[inputmode="tel"]').first();
  await phoneInput.fill(phone);
  await page.getByRole("button", { name: /send code/i }).click();
}

/**
 * Full OTP login using the demo-mode auto-filled code. Assumes the phone stage is
 * already visible. Returns once the OTP field has whatever the demo hint filled in.
 */
export async function loginWithDemoOtp(page: Page, phone: string) {
  await sendOtp(page, phone);
  // Demo mode returns the OTP and the UI pre-fills it; just confirm it landed.
  const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
  await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
}

export async function clearAuth(page: Page) {
  await page.evaluate(() => {
    try { window.localStorage.removeItem("wnp_token"); } catch { /* ignore */ }
  });
}
