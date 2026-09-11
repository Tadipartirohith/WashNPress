import { test, expect, type Page } from "@playwright/test";

// The pages a store reviewer opens before they approve anything, and the ones a
// resident opens when something has gone wrong.
//
// All three are public and unauthenticated on purpose: Google Play requires an
// account-deletion URL reachable by somebody who has already uninstalled the app, and
// a privacy policy behind a login is not a privacy policy. None of this had any
// coverage, which for pages whose whole job is to be correct and present is the worst
// place to have none.

const LEGAL_PAGES = ["/privacy", "/terms", "/account/delete"] as const;

/**
 * A placeholder that has not been filled in yet: a `[Bracketed field]`, or an address
 * on the reserved `.example` TLD, which is chosen precisely because it never resolves.
 */
async function hasUnfilledPlaceholders(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText();
  return /\[[^\]]{3,40}\]/.test(text) || /@[\w.-]*\bexample\b/.test(text);
}

test.describe("Legal pages", () => {
  for (const path of LEGAL_PAGES) {
    test(`${path} is reachable with no account and says when it was last updated`, async ({ page }) => {
      // No token is seeded: this is what a store reviewer, or somebody who has
      // already deleted the app, actually gets.
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // A policy with no date cannot be told apart from a policy nobody has revisited.
      await expect(page.getByText(/last updated \d{4}-\d{2}-\d{2}/i)).toBeVisible();
    });

    test(`${path} never shows an unfilled placeholder without saying so`, async ({ page }) => {
      // The invariant, not the current state — so this test keeps its meaning after
      // the real company details are filled in and the banner is switched off. What
      // must never happen is a page carrying "[Grievance Officer name]" or an address
      // at a domain that does not exist while presenting itself as final.
      await page.goto(path);
      if (await hasUnfilledPlaceholders(page)) {
        await expect(page.getByText(/placeholder details/i).first()).toBeVisible();
        await expect(
          page.getByText(/must be replaced before this app is submitted/i).first(),
        ).toBeVisible();
      }
    });
  }

  test("privacy names a grievance officer a complaint can actually reach", async ({ page }) => {
    await page.goto("/privacy");
    // Rule 4(5) of the Consumer Protection (E-Commerce) Rules, 2020 wants a named
    // individual with contact details and an acknowledgement window — not a team
    // alias and not a contact form.
    await expect(page.getByRole("heading", { name: /grievance officer/i }).first()).toBeVisible();
    await expect(page.getByText(/rule 4\(5\)/i)).toBeVisible();
    await expect(page.getByText(/within 48 hours/i).first()).toBeVisible();
    // Name, email and phone all have to be present, filled in or not.
    for (const label of [/^name$/i, /^email$/i, /^phone$/i]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test("terms point at the policy and at the way out", async ({ page }) => {
    await page.goto("/terms");
    // An agreement that incorporates a privacy policy has to link to it, and a
    // resident reading the terms is exactly who wants to know how to leave.
    await expect(page.getByRole("link", { name: /privacy policy/i }).first()).toBeVisible();
    await expect(page.locator('a[href="/account/delete"]').first()).toBeVisible();
  });

  test("the deletion page works for somebody who has already uninstalled the app", async ({ page }) => {
    await page.goto("/account/delete");
    // Play requires this page to serve the person who no longer has the app, so it
    // has to give a route that does not start with "open the app".
    await expect(page.getByText(/if you have already uninstalled/i)).toBeVisible();
    await expect(page.getByText(/we verify that the number is yours/i)).toBeVisible();
    // And it has to be honest about what deletion does not erase.
    await expect(page.getByText(/what is deleted/i)).toBeVisible();
    await expect(page.getByText(/eight financial years/i)).toBeVisible();
    await expect(page.getByText(/not reversible/i).first()).toBeVisible();
  });
});
