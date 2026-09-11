import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, GREETING, loginAndCaptureToken, seedToken } from "./helpers";

// The resident app has no bottom tab bar. It has a left rail (a drawer on narrow
// screens) with four destinations, and Plan, Wallet and Support are reached through
// Profile. This file used to assert against "the bottom tab bar" and a "Plans" tab,
// both of which had already been removed from the app — and the TabBar component it
// was written against was still sitting in page.tsx, defined and never rendered.
//
// Since I-82 one of those four is not a destination at all: Book Pickup opens a modal
// wizard over whatever the resident is looking at, so the last two tests here are
// about the rail's relationship with that overlay rather than about a view change.
const nav = (page: Page) => page.getByRole("navigation");

test.describe("Resident web app — navigation", () => {
  // One OTP login for the whole file; the backend rate-limits codes per phone, so
  // signing in per test would make the suite trip its own cooldown.
  let token: string;
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    token = await loginAndCaptureToken(page, DEMO_PHONES.resident);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await seedToken(page, token);
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });
  });

  test("positive: the rail offers exactly the four things a resident came to do", async ({ page }) => {
    // My Plan, Wallet and Help & Support were top-level entries here as well as cards
    // on Profile, so the rail carried seven destinations and every account service was
    // reachable two ways. If that creeps back, this is where it shows up.
    await expect(nav(page).getByRole("button")).toHaveText(["Home", "Book Pickup", "My Orders", "Profile"]);
  });

  test("positive: each rail destination opens its own section, and Home comes back", async ({ page }) => {
    await nav(page).getByRole("button", { name: "My Orders" }).click();
    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeVisible({ timeout: 10_000 });
    // The section is really rendered, not just titled: My Orders owns the Active /
    // Upcoming / History tablist and nothing else in the app does.
    await expect(page.getByRole("tablist", { name: /order status/i })).toBeVisible();

    await nav(page).getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /residence details/i })).toBeVisible();

    await nav(page).getByRole("button", { name: "Home" }).click();
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 10_000 });
  });

  test("positive: the Plan page is reached through Profile in the nav rail, and leads back to it", async ({ page }) => {
    await nav(page).getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /view plan/i }).click();
    await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible({ timeout: 10_000 });
    // Profile stays lit in the rail while the resident is inside one of the services it
    // leads to, and the page itself offers the way back — a service reached through
    // Profile that dead-ends there is how residents got stranded on Wallet.
    await page.getByRole("button", { name: /^profile$/i }).first().click();
    await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("positive: Book Pickup opens the wizard over the current section instead of leaving it", async ({ page }) => {
    await nav(page).getByRole("button", { name: "My Orders" }).click();
    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeVisible({ timeout: 10_000 });

    const bookButton = nav(page).getByRole("button", { name: "Book Pickup" });
    await bookButton.click();
    const wizard = page.getByRole("dialog", { name: "Book" });
    await expect(wizard).toBeVisible({ timeout: 10_000 });
    // Over, not instead of: the section underneath is still the one the resident chose,
    // so cancelling the booking does not also cost them their place.
    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeVisible();

    await wizard.getByRole("button", { name: "Cancel" }).click();
    await expect(wizard).toBeHidden();
    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeVisible();
  });

  test("negative: Escape closes the booking wizard and returns focus to the nav", async ({ page }) => {
    const bookButton = nav(page).getByRole("button", { name: "Book Pickup" });
    await bookButton.click();
    const wizard = page.getByRole("dialog", { name: "Book" });
    await expect(wizard).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(wizard).toBeHidden();
    // Focus goes back to the control that opened it. Without this a keyboard user is
    // dropped at the top of the document every time they change their mind (SC 2.4.3).
    await expect(bookButton).toBeFocused();
  });

  test("negative: the rail cannot be used behind the open wizard", async ({ page }) => {
    await nav(page).getByRole("button", { name: "Book Pickup" }).click();
    const wizard = page.getByRole("dialog", { name: "Book" });
    await expect(wizard).toBeVisible({ timeout: 10_000 });

    // A modal that lets the page behind it be clicked is not modal: the resident would
    // navigate away mid-booking with the wizard still mounted over the new section.
    // The overlay must swallow the click, so this one is expected to fail actionability.
    await expect(nav(page).getByRole("button", { name: "My Orders" }).click({ timeout: 3_000 }))
      .rejects.toThrow(/intercepts pointer events/);
    await expect(wizard).toBeVisible();
    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeHidden();
  });
});
