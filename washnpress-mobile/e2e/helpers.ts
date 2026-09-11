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

/**
 * The resident dashboard's own heading, whichever greeting it is showing.
 *
 * It says "Welcome to WashNPress" on a genuine first sign-in and "Good evening,
 * <name>" on every one after that. These specs asserted only the returning wording,
 * so they failed the moment the backend started reporting a first login correctly —
 * which, for a demo account on a fresh in-memory backend, is every run.
 */
export const RESIDENT_HOME = /welcome to washnpress|good (morning|afternoon|evening)/i;

/**
 * Books a laundry pickup through the three-step wizard, returning false if this
 * environment has no slot left to book into.
 *
 * Since I-36 the resident only chooses a day and a slot: the operator records the
 * garments, services and counts at the door. These specs were still driving the old
 * screen — garment counters, an approximate weight, "add another item", a sticky
 * total — none of which exists any more. Step one already has Laundry Pickup
 * selected, so Continue moves straight on; tapping the tile *deselects* it.
 */
export async function bookFreshPickup(page: Page): Promise<boolean> {
  await page.getByRole("tab", { name: /^book/i }).click();
  await expect(page.getByText(/what would you like to book/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^continue$/i }).click();

  // A slot chip says how much room is left on it, which is also what makes it
  // findable: "Evening 17:00-20:00 20 left".
  const slot = page.getByRole("button", { name: /\d+ left/i }).first();
  const hasSlot = await slot.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!hasSlot) return false;
  await slot.click();

  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByText(/booking summary/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^confirm booking$/i }).click();
  return true;
}

/**
 * Opens the most recent upcoming pickup from My Orders.
 *
 * My Orders opens on "Current / Active", which is empty until an operator is on the
 * way, so a freshly booked pickup is under "Upcoming" — a spec that reads the first
 * screen sees "Nothing in this group" and concludes, wrongly, that nothing was booked.
 */
export async function openUpcomingOrder(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /^orders/i }).click();
  await page.getByText("Upcoming", { exact: true }).first().click();
  const row = page.getByText(/ORD-/i).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByRole("button", { name: /^cancel booking$/i })).toBeVisible({ timeout: 15_000 });
}
