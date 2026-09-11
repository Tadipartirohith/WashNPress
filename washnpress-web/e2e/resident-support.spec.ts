import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, GREETING, loginAndCaptureToken, seedToken } from "./helpers";

// Support is the resident's only way to say "this went wrong" once an order has left
// their hands, so the whole round trip has to work: raise it, be answered, answer
// back, and close it when it is settled. These tests walk that conversation.
//
// Two things about the app this file used to get wrong, both of which made every test
// in it fail before it asserted anything:
//   * the dashboard greeting is time-of-day based, so waiting for "Good day" waited
//     forever — GREETING in helpers.ts is the anchor now;
//   * Support is not a tab. The nav rail carries Home / Book Pickup / My Orders /
//     Profile, and Plan, Wallet and Support are the three account services on
//     Profile. Reaching it any other way is reaching something that isn't there.
//
// The backend refuses a second OTP for the same number inside its resend cooldown, so
// signing in on every test rate-limits the suite against itself. Sign in once, then
// replay the token.
let token: string;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  token = await loginAndCaptureToken(page, DEMO_PHONES.resident);
  await page.close();
});

/** Signs in with the captured token and walks the real route to Support. */
async function openSupport(page: Page) {
  await seedToken(page, token);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("navigation").getByRole("button", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: /^profile$/i })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /contact support/i }).click();
  await expect(page.getByRole("heading", { name: /^support$/i })).toBeVisible({ timeout: 10_000 });
}

test.describe("Resident web app — support tickets", () => {
  test("positive: raise a ticket, reply on it, then close it", async ({ page }) => {
    test.setTimeout(90_000);
    await openSupport(page);

    await page.getByRole("button", { name: /new ticket/i }).click();
    const description = `E2E test ticket ${Date.now()}`;
    await page.getByLabel(/what's going on/i).fill(description);
    await page.getByRole("button", { name: /^submit ticket$/i }).click();

    // Submitting opens the fresh ticket straight away. Views cross-fade with
    // AnimatePresence, so for a moment the list and the detail are both mounted and
    // the list carries this ticket's own text and a row of "Open" badges from earlier
    // runs. Waiting for the list heading to leave the DOM is what makes every
    // assertion below unambiguously about the ticket on screen.
    await expect(page.getByRole("button", { name: /^close ticket$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /^support$/i })).toHaveCount(0);
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByText(/^open$/i)).toBeVisible();

    // Send a reply and see it land on the "mine" (right-aligned) side. Anchoring on
    // the alignment matters: a resident who cannot tell their own words from the
    // operator's cannot follow the conversation at all.
    const reply = `Following up ${Date.now()}`;
    const replyBox = page.getByRole("textbox", { name: "Write a reply" });
    await replyBox.fill(reply);
    await page.getByRole("button", { name: "Send" }).click();
    const myMessage = page.locator("div.justify-end", { hasText: reply });
    await expect(myMessage).toBeVisible({ timeout: 10_000 });
    // The box empties on a successful send; a reply left sitting in it is how a
    // resident sends the same thing twice.
    await expect(replyBox).toHaveValue("");

    // Close it. The badge flips and the resident's own way of closing it goes.
    // (The reply box should go with them and does not — see the test.fail below.)
    await page.getByRole("button", { name: /^close ticket$/i }).click();
    await expect(page.getByText(/^closed$/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^close ticket$/i })).not.toBeVisible();

    // The conversation survives the round trip to the list and back — a closed
    // ticket is history, and history that is not readable is not kept.
    await page.getByRole("button", { name: "Support" }).last().click();
    await expect(page.getByRole("heading", { name: /^support$/i })).toBeVisible({ timeout: 10_000 });
    // Earlier runs against this demo backend leave other closed tickets around, so
    // scope to this ticket's own row rather than a page-wide "Closed". The row's
    // preview is the latest message (the reply just sent), not the original
    // description — the summary is meant to show what's newest.
    const row = page.locator("button", { hasText: reply });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/closed/i)).toBeVisible();

    await row.click();
    await expect(page.getByRole("heading", { name: /^support$/i })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByText(reply)).toBeVisible();
    // Read fresh from the backend, the closed ticket is what it should be: no reply
    // box, and a sentence saying why rather than a control that has simply vanished.
    await expect(page.getByText(/closed.*kept as history/i)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Write a reply" })).toHaveCount(0);
  });

  // Closing a ticket used to leave the reply box on screen: close() reloaded the
  // ticket but not the conversation, and `canReply` lives on the conversation. The
  // badge said Closed, the "Close ticket" button went away, and the composer stayed —
  // so a resident typing "thanks, all sorted" got the backend's 409 for their trouble.
  test("positive: closing a ticket takes the reply box away there and then", async ({ page }) => {
    test.setTimeout(90_000);
    await openSupport(page);
    await page.getByRole("button", { name: /new ticket/i }).click();
    await page.getByLabel(/what's going on/i).fill(`Closes immediately ${Date.now()}`);
    await page.getByRole("button", { name: /^submit ticket$/i }).click();
    await expect(page.getByRole("button", { name: /^close ticket$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /^support$/i })).toHaveCount(0);

    await page.getByRole("button", { name: /^close ticket$/i }).click();
    await expect(page.getByText(/^closed$/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("textbox", { name: "Write a reply" })).toHaveCount(0);
    await expect(page.getByText(/closed.*kept as history/i)).toBeVisible();
  });

  test("positive: a ticket can be raised without any subscription", async ({ page }) => {
    // No subscribe step anywhere in this test — a ticket must not require one. Support
    // is where somebody goes when the product has already failed them, and gating it
    // behind a paid plan would shut out exactly the person with the most to complain
    // about.
    await openSupport(page);
    await page.getByRole("button", { name: /new ticket/i }).click();
    await page.getByLabel(/what's going on/i).fill(`Pay-as-you-go ticket ${Date.now()}`);
    await page.getByRole("button", { name: /^submit ticket$/i }).click();
    await expect(page.getByRole("button", { name: /^close ticket$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /^support$/i })).toHaveCount(0);
    await expect(page.getByText(/^open$/i)).toBeVisible();
  });

  test("negative: an empty ticket cannot be submitted", async ({ page }) => {
    // A blank description is refused by the button rather than by the backend, so the
    // resident is never told off for something the form could have prevented. This
    // guards the disabled state: if it regresses, the first thing support receives is
    // a stream of empty tickets nobody can act on.
    await openSupport(page);
    await page.getByRole("button", { name: /new ticket/i }).click();
    const submit = page.getByRole("button", { name: /^submit ticket$/i });
    await expect(submit).toBeDisabled();
    // Whitespace is not a description either.
    await page.getByLabel(/what's going on/i).fill("   ");
    await expect(submit).toBeDisabled();
    await page.getByLabel(/what's going on/i).fill("The bag came back one shirt short.");
    await expect(submit).toBeEnabled();
  });
});
