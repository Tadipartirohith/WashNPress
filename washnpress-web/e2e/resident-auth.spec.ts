import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, GREETING, clearAuth, seedToken } from "./helpers";

/**
 * The backend refuses a second code for the same number inside a second ("A code was
 * already sent, retry in N seconds"), and this is the one file that must sign the
 * same demo resident in over and over rather than replaying a captured token. Retry
 * the send until the OTP stage actually appears, so a cooldown left over from the
 * previous test never decides whether this one passes.
 */
async function sendCode(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator('input[inputmode="numeric"]')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Signs in with the demo resident's auto-filled code and waits for the authed shell. */
async function signIn(page: Page) {
  await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
  await sendCode(page);
  const otpInput = page.locator('input[inputmode="numeric"]');
  await expect(otpInput).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
}

/**
 * The one error the sign-in card shows. Scoped past Next's always-present (and empty)
 * route-announcer, which also carries role="alert".
 */
function loginAlert(page: Page) {
  return page.getByRole("alert").filter({ hasText: /\S/ });
}

test.describe("Resident web app — auth", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
    await clearAuth(page);
    await page.reload();
  });

  test("positive: demo phone + auto-filled OTP logs in and shows the dashboard", async ({ page }) => {
    await signIn(page);
    // The greeting is time-of-day based, so anchor on GREETING rather than one fixed
    // wording — and on the heading rather than loose text, so a stray mention of
    // "good evening" anywhere else on the page cannot stand in for the dashboard.
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });
    // The authed shell, not just a greeting: the nav rail only renders once signed in.
    await expect(page.getByRole("navigation").getByRole("button", { name: "Book Pickup" })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("wnp_token"))).toBeTruthy();
  });

  test("negative: wrong OTP is rejected with an error and does not log in", async ({ page }) => {
    await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
    await sendCode(page);
    const otpInput = page.locator('input[inputmode="numeric"]');
    await expect(otpInput).not.toHaveValue("", { timeout: 15_000 });
    await otpInput.fill("000000");
    await page.getByRole("button", { name: /verify and continue/i }).click();
    // role="alert" matters as much as the wording: every failure in this app used to
    // be a paragraph that appeared silently (SC 4.1.3).
    await expect(loginAlert(page)).toBeVisible({ timeout: 10_000 });
    // Still on the OTP step, with nothing persisted — a rejected code must not leave
    // a usable session behind.
    await expect(otpInput).toBeVisible();
    await expect(page.getByRole("heading", { name: GREETING })).toBeHidden();
    expect(await page.evaluate(() => window.localStorage.getItem("wnp_token"))).toBeNull();
  });

  // DEFECT: a resident who mistypes their code is shown the string "otp_invalid".
  //
  // This used to show the public the string `otp_invalid`. The verify endpoint sent
  // its sentence in `reason`, which no client reads, and `req()` fell back to the
  // machine code. Both halves are fixed: the route now also sends `message`, and
  // `humanMessage()` in lib/api-client.ts never lets a bare code reach a screen.
  test("negative: the rejection is written for a person, not an error code", async ({ page }) => {
    await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
    await sendCode(page);
    const otpInput = page.locator('input[inputmode="numeric"]');
    await expect(otpInput).not.toHaveValue("", { timeout: 15_000 });
    await otpInput.fill("000000");
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(loginAlert(page)).toBeVisible({ timeout: 10_000 });
    await expect(loginAlert(page)).toContainText(/did not work|incorrect|invalid code|wrong/i);
    await expect(loginAlert(page)).not.toContainText(/^[a-z]+(_[a-z]+)+$/);
  });

  test("negative: an empty phone number cannot even be submitted", async ({ page }) => {
    // The field arrives pre-filled with the demo number, so clear it first.
    const phoneInput = page.locator('input[inputmode="tel"]');
    await phoneInput.fill("");
    // Disabled, not "rejected after a round trip". Weakening this to "the OTP screen
    // did not appear" would pass just as well against a button that fires a doomed
    // request, which is what this used to be.
    await expect(page.getByRole("button", { name: /send code/i })).toBeDisabled();
    // Nothing is said about a field nobody has filled in yet — the empty state is the
    // button's problem, not an error message's.
    await expect(page.getByText(/valid 10-digit mobile number/i)).toBeHidden();
    await expect(page.locator('input[inputmode="numeric"]')).toBeHidden();
  });

  test("negative: a number that is not a plausible Indian mobile is refused in the form", async ({ page }) => {
    const phoneInput = page.locator('input[inputmode="tel"]');
    const sendButton = page.getByRole("button", { name: /send code/i });

    // Too short.
    await phoneInput.fill("123");
    await expect(sendButton).toBeDisabled();
    await expect(page.getByText(/valid 10-digit mobile number/i)).toBeVisible();

    // Ten digits, but no Indian mobile starts with 1 — the form applies the same rule
    // the API does, so this never costs a round trip to be told no.
    await phoneInput.fill("1234567890");
    await expect(sendButton).toBeDisabled();
    await expect(page.getByText(/valid 10-digit mobile number/i)).toBeVisible();

    // And it recovers: a real number clears the error and arms the button.
    await phoneInput.fill(DEMO_PHONES.resident);
    await expect(page.getByText(/valid 10-digit mobile number/i)).toBeHidden();
    await expect(sendButton).toBeEnabled();
    await expect(page.locator('input[inputmode="numeric"]')).toBeHidden();
  });

  test("session persists across reload, and signing out clears it", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });

    // Sign out lives on Profile behind a confirmation dialog — a session is not
    // something to end on a single stray tap.
    await page.getByRole("navigation").getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^sign out$/i }).click();
    const dialog = page.getByRole("dialog", { name: /sign out\?/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^sign out$/i }).click();

    await expect(page.locator('input[inputmode="tel"]')).toBeVisible({ timeout: 10_000 });
    // Signed out means the token is gone, not merely that a login screen is showing.
    expect(await page.evaluate(() => window.localStorage.getItem("wnp_token"))).toBeNull();
    await page.reload();
    await expect(page.locator('input[inputmode="tel"]')).toBeVisible({ timeout: 10_000 });
  });

  test("negative: a stale or revoked token lands on sign-in rather than a broken shell", async ({ page }) => {
    // Tokens expire and an admin can revoke one, so a resident really does arrive
    // holding a token the backend no longer honours. The app must drop it and show
    // the sign-in form; before this it sat on the splash or rendered a shell where
    // every request 401'd.
    await seedToken(page, "not-a-real-token");
    await page.goto("/app");
    await expect(page.locator('input[inputmode="tel"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: GREETING })).toBeHidden();
    expect(await page.evaluate(() => window.localStorage.getItem("wnp_token"))).toBeNull();
  });
});
