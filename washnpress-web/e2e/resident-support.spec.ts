import { test, expect, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

async function login(page: Page) {
  await page.goto("/app");
  await clearAuth(page);
  await page.reload();
  await page.locator('input[inputmode="tel"]').fill(DEMO_PHONES.resident);
  await page.getByRole("button", { name: /send code/i }).click();
  const otpInput = page.locator('input[inputmode="numeric"]');
  await expect(otpInput).not.toHaveValue("", { timeout: 10_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByText(/good day/i)).toBeVisible({ timeout: 10_000 });
}

test.describe("Resident web app — support tickets", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("positive: raise a ticket, reply on it, then close it", async ({ page }) => {
    // Reachable from the header icon, not a bottom tab — support isn't a
    // frequent-enough action to compete with Home/Book/Orders/Wallet/Plans.
    await page.getByRole("button", { name: "Support" }).click();
    await expect(page.getByRole("heading", { name: /^support$/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /new ticket/i }).click();
    const description = `E2E test ticket ${Date.now()}`;
    await page.locator("textarea").fill(description);
    await page.getByRole("button", { name: /^submit ticket$/i }).click();

    // Submitting opens the fresh ticket straight away. The list briefly shows the
    // new ticket too (its own reload lands before the view finishes switching), so
    // wait for something that only exists on the detail screen before asserting on
    // it — otherwise "Open" can match several list rows from earlier test runs.
    await expect(page.getByRole("button", { name: /^close ticket$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.getByText(/^open$/i)).toBeVisible();

    // Send a reply and see it land on "mine" (right-aligned) side.
    const reply = `Following up ${Date.now()}`;
    await page.locator("textarea").fill(reply);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(reply)).toBeVisible({ timeout: 10_000 });

    // Close it, and confirm the reply box goes away (read only from here).
    await page.getByRole("button", { name: /^close ticket$/i }).click();
    await expect(page.getByText(/^closed$/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^close ticket$/i })).not.toBeVisible();

    // Back on the list, the ticket row shows its closed status. The row's preview
    // text is the latest message (the reply just sent), not the original
    // description — the conversation summary is meant to show what's newest.
    await page.getByRole("button", { name: "Support" }).last().click();
    await expect(page.getByRole("heading", { name: /^support$/i })).toBeVisible({ timeout: 10_000 });
    // Earlier runs against this shared demo backend leave other closed tickets
    // around, so scope to this ticket's own row rather than a page-wide "Closed".
    const row = page.locator("button", { hasText: reply });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/closed/i)).toBeVisible();
  });

  test("positive: a ticket can be raised without any subscription", async ({ page }) => {
    // No subscribe step anywhere in this test — a ticket must not require one.
    await page.getByRole("button", { name: "Support" }).click();
    await page.getByRole("button", { name: /new ticket/i }).click();
    await page.locator("textarea").fill(`Pay-as-you-go ticket ${Date.now()}`);
    await page.getByRole("button", { name: /^submit ticket$/i }).click();
    await expect(page.getByRole("button", { name: /^close ticket$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^open$/i)).toBeVisible();
  });
});
