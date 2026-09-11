import { test, expect, type Browser, type Page } from "@playwright/test";
import { DEMO_PHONES } from "./helpers";

/**
 * Signing in to a staff portal, and — far more importantly — being refused by one.
 *
 * A staff portal that lets the wrong role in is the worst failure this product can
 * have: an operator would see every society's orders, a resident would see the
 * platform's books. So the refusal path is tested from both ends here — the whole
 * OTP journey a person actually walks, and the full role × portal matrix replayed
 * from a captured token, which is cheap enough to cover every combination.
 */

const PORTALS = [
  { path: "/admin", nav: "Admin", phone: DEMO_PHONES.admin },
  { path: "/operations", nav: "Operations", phone: DEMO_PHONES.operations },
  { path: "/supervisor", nav: "Supervisor", phone: DEMO_PHONES.supervisor },
] as const;

const WRONG_ROLE = /wrong account for this portal/i;

/**
 * Opens a portal's sign-in screen. Every test gets a fresh browser context, so there
 * is no stored session to clear first — waiting for the phone stage to render is the
 * whole job, and it doubles as proof the portal serves a login to a stranger rather
 * than anything behind it.
 */
async function goSignedOut(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("button", { name: /send code/i })).toBeVisible({ timeout: 20_000 });
}

/**
 * Clicks "Send code" until the OTP stage is actually on screen.
 *
 * The backend refuses a second code for the same number inside a one-second window
 * ("A code was already sent, retry in N seconds") and the form stays on the phone
 * stage when it does. Every spec in this suite drives the same four demo numbers, so
 * without this a spec passes alone and fails in a batch — which looks exactly like a
 * broken portal and is not one. Retrying the click is the fix; waiting a fixed
 * number of milliseconds only moves the race.
 */
async function sendCode(page: Page) {
  const otpInput = page.locator('#portal-otp, input[inputmode="numeric"]').first();
  await expect(async () => {
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(otpInput).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
  // Demo mode returns the code and the form pre-fills it.
  await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
}

/**
 * A full OTP sign-in in its own context, returning the session token so it can be
 * replayed. Its own context because these run back to back for four accounts, and a
 * shared one would carry the previous account's session into the next sign-in.
 */
async function captureToken(
  browser: Browser,
  baseURL: string | undefined,
  path: string,
  phone: string,
  ready: (page: Page) => Promise<void>,
): Promise<string> {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await goSignedOut(page, path);
    await page.locator('input[inputmode="tel"]').first().fill(phone);
    await sendCode(page);
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await ready(page);
    const token = await page.evaluate(() => window.localStorage.getItem("wnp_token"));
    if (!token) throw new Error(`Signing in at ${path} did not persist a wnp_token`);
    return token;
  } finally {
    await context.close();
  }
}

/** Primes a fresh context with a captured session before the app boots. */
async function useSession(page: Page, token: string) {
  await page.addInitScript((t) => {
    try { window.localStorage.setItem("wnp_token", t); } catch { /* ignore */ }
  }, token);
}

const tokens: Record<string, string> = {};

test.describe("Staff portals — auth", () => {
  // One sign-in per demo account for the whole file. The role × portal matrix below
  // replays these tokens rather than walking OTP nine more times, which would take
  // minutes and spend most of them bouncing off the resend cooldown.
  test.beforeAll(async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    for (const portal of PORTALS) {
      tokens[portal.nav] = await captureToken(browser, baseURL, portal.path, portal.phone, async (page) => {
        await expect(page.getByRole("navigation", { name: portal.nav })).toBeVisible({ timeout: 20_000 });
      });
    }
    tokens.Resident = await captureToken(browser, baseURL, "/app", DEMO_PHONES.resident, async (page) => {
      // "Welcome back" is also the login heading, so anchor on the resident nav.
      await expect(page.getByRole("navigation").getByRole("button", { name: "Book Pickup" })).toBeVisible({ timeout: 20_000 });
    });
  });

  for (const portal of PORTALS) {
    test(`positive: ${portal.path} — demo phone + OTP reaches the portal itself`, async ({ page }) => {
      await goSignedOut(page, portal.path);
      await page.locator("#portal-phone").fill(portal.phone);
      await sendCode(page);
      await page.getByRole("button", { name: /verify and continue/i }).click();
      // The old version of this test only asserted that no failure text appeared,
      // which the "checking session" spinner also satisfies. Assert the portal's own
      // nav landmark instead: it exists only once the guard has said yes and the
      // authed shell has rendered.
      await expect(page.getByRole("navigation", { name: portal.nav })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(WRONG_ROLE)).toHaveCount(0);
      expect(await page.evaluate(() => window.localStorage.getItem("wnp_token"))).toBeTruthy();
    });

    test(`negative: ${portal.path} — Send code stays disabled for a number that isn't one`, async ({ page }) => {
      await goSignedOut(page, portal.path);
      const phoneInput = page.locator("#portal-phone");
      const sendButton = page.getByRole("button", { name: /send code/i });

      await phoneInput.fill("123456789"); // nine digits
      await expect(sendButton).toBeDisabled();

      // Ten digits is not the rule — an Indian mobile starts 6-9. Length alone was
      // once the whole gate here, so "abcdefghij" reached the API; keep both halves
      // of the rule under test.
      await phoneInput.fill("1234567890");
      await expect(sendButton).toBeDisabled();
      await expect(page.getByText(/enter a valid 10-digit mobile number/i)).toBeVisible();

      await phoneInput.fill(portal.phone);
      await expect(sendButton).toBeEnabled();
    });

    test(`negative: ${portal.path} — a wrong OTP is refused and leaves no session`, async ({ page }) => {
      await goSignedOut(page, portal.path);
      await page.locator("#portal-phone").fill(portal.phone);
      await sendCode(page);
      await page.locator("#portal-otp").fill("000000");
      await page.getByRole("button", { name: /verify and continue/i }).click();
      await expect(page.getByText(/that code did not work/i)).toBeVisible({ timeout: 15_000 });
      // A refused code must not half-open the door: no portal shell, no stored token.
      await expect(page.getByRole("navigation", { name: portal.nav })).toHaveCount(0);
      expect(await page.evaluate(() => window.localStorage.getItem("wnp_token"))).toBeNull();
    });
  }

  test("negative (RBAC): a resident's number is refused by the admin portal, end to end", async ({ page }) => {
    await goSignedOut(page, "/admin");
    await page.locator("#portal-phone").fill(DEMO_PHONES.resident);
    await sendCode(page);
    await page.getByRole("button", { name: /verify and continue/i }).click();
    // The code is right — this account exists — so the refusal has to come from the
    // portal guard, not from the OTP check.
    await expect(page.getByText(WRONG_ROLE)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
    await expect(page.getByText(/societies active|total revenue/i)).toHaveCount(0);

    // "Try another number" must actually return to a fresh login, not loop.
    await page.getByRole("button", { name: /try another number/i }).click();
    await expect(page.getByRole("button", { name: /send code/i })).toBeVisible({ timeout: 15_000 });
  });

  test("negative (RBAC): an operations number is refused by the supervisor portal, end to end", async ({ page }) => {
    await goSignedOut(page, "/supervisor");
    await page.locator("#portal-phone").fill(DEMO_PHONES.operations);
    await sendCode(page);
    await page.getByRole("button", { name: /verify and continue/i }).click();
    await expect(page.getByText(WRONG_ROLE)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Supervisor" })).toHaveCount(0);
    await expect(page.getByText(/your society/i)).toHaveCount(0);
  });

  // The full matrix. Admin is excluded from the "refused" list on purpose and gets
  // its own test below — an admin covering a society without a supervisor is a
  // designed capability, not a hole.
  const REFUSED: { portal: (typeof PORTALS)[number]; roles: string[] }[] = [
    { portal: PORTALS[0], roles: ["Operations", "Supervisor", "Resident"] },
    { portal: PORTALS[1], roles: ["Supervisor", "Resident"] },
    { portal: PORTALS[2], roles: ["Operations", "Resident"] },
  ];

  for (const { portal, roles } of REFUSED) {
    for (const role of roles) {
      test(`negative (RBAC): a ${role.toLowerCase()} session cannot open ${portal.path}`, async ({ page }) => {
        await useSession(page, tokens[role]);
        await page.goto(portal.path);
        await expect(page.getByText(WRONG_ROLE)).toBeVisible({ timeout: 20_000 });
        // Not one nav item, not one row of the portal's data — the guard renders the
        // refusal instead of the shell, so nothing behind it is ever mounted.
        await expect(page.getByRole("navigation")).toHaveCount(0);
      });
    }
  }

  test("positive (RBAC): an admin covers the supervisor and operations portals", async ({ page }) => {
    // Deliberate, and load-bearing: four of the six demo societies have no
    // supervisor, and the admin dashboard's own "Supervisor coverage" panel says the
    // admin runs those directly. If this ever starts failing, admins have been
    // locked out of the societies they are the fallback for.
    await useSession(page, tokens.Admin);

    await page.goto("/supervisor");
    await expect(page.getByRole("navigation", { name: "Supervisor" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(WRONG_ROLE)).toHaveCount(0);

    await page.goto("/operations");
    await expect(page.getByRole("navigation", { name: "Operations" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(WRONG_ROLE)).toHaveCount(0);
  });
});
