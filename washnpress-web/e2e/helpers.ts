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

/**
 * Logs a demo user in through the OTP flow and returns their auth token. The backend
 * rate-limits OTP requests per phone, so a suite that logged in on every test would
 * trip that limit; callers instead do this once (beforeAll) and replay the token via
 * seedToken on each test.
 */
export async function loginAndCaptureToken(page: Page, phone: string): Promise<string> {
  await page.goto("/app");
  await clearAuth(page);
  await page.reload();
  await page.locator('input[inputmode="tel"]').fill(phone);
  await page.getByRole("button", { name: /send code/i }).click();
  const otpInput = page.locator('input[inputmode="numeric"]');
  await expect(otpInput).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
  // "Welcome back" is also the login-page heading, so anchor on the Schedule Pickup
  // button, which only exists once the authed dashboard has rendered.
  await expect(page.getByRole("button", { name: /schedule pickup/i }).first()).toBeVisible({ timeout: 15_000 });
  const token = await page.evaluate(() => window.localStorage.getItem("wnp_token"));
  if (!token) throw new Error("Login did not persist a wnp_token");
  return token;
}

/** Primes localStorage with a captured token before the app boots, skipping OTP. */
export async function seedToken(page: Page, token: string) {
  await page.addInitScript((t) => {
    try { window.localStorage.setItem("wnp_token", t); } catch { /* ignore */ }
  }, token);
}

/**
 * Picks a date in the calendar DatePicker (I-68) that replaced the native
 * `<input type="date">` across the resident portal. Opens the popover via the
 * trigger's aria-label, steps forward to the target month if needed, then clicks
 * the day cell. `target` is a yyyy-mm-dd string.
 */
export async function pickCalendarDate(page: Page, triggerName: RegExp | string, target: string) {
  const [y, m, d] = target.split("-").map(Number);
  const monthYear = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  await page.getByRole("button", { name: triggerName }).first().click();
  // The popover opens on the selected value's month; step forward until the target
  // month is on screen (bounded so a wrong target can never loop forever).
  for (let i = 0; i < 12; i++) {
    if (await page.getByText(monthYear, { exact: true }).isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await page.getByRole("button", { name: String(d), exact: true }).click();
}

/** Tomorrow as a yyyy-mm-dd string, in local time (matching the picker's own todayIso). */
export function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
