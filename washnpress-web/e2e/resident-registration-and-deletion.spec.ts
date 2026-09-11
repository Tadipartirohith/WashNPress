import { test, expect, type Page } from "@playwright/test";
import { GREETING } from "./helpers";

// The two ends of a resident's life on this platform: arriving, and leaving.
//
// Neither had any coverage. Arriving matters because there is no separate sign-up
// form — entering a number nobody has seen before *is* registration, so the journey
// is easy to break without noticing and hard to notice is broken. Leaving matters
// because Apple 5.1.1(v) requires an app that creates an account to delete it from
// inside the app, and is explicit that offering to deactivate, or asking somebody to
// email support, does not count. Play requires the same plus a public URL, and from
// 13 May 2027 the DPDP Act's erasure right says it again in law.

/** A number nobody has registered, unique per run so a re-run is a fresh account. */
function unusedPhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

async function signInWith(page: Page, phone: string) {
  await page.goto("/app");
  await page.locator('input[inputmode="tel"]').first().fill(phone);
  await page.getByRole("button", { name: /send code/i }).click();
  const otp = page.locator('input[inputmode="numeric"]').first();
  // The code is auto-filled in demo mode; wait for it rather than typing one.
  await expect(otp).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
}

/** Fills the four dependent address selects, top down, choosing the first real option. */
async function completeRegistration(page: Page, name: string) {
  await page.getByLabel("Full name").fill(name);
  for (const field of ["Society", "Tower", "Floor", "Flat"]) {
    const select = page.getByLabel(field, { exact: true });
    await expect(select).toBeEnabled({ timeout: 10_000 });
    await select.selectOption({ index: 1 });
  }
  const submit = page.getByRole("button", { name: /complete registration/i });
  await expect(submit).toBeEnabled();
  await submit.click();
}

test.describe("Resident web app — registering", () => {
  test("positive: a number nobody has seen registers, rather than bouncing off a login", async ({ page }) => {
    const phone = unusedPhone();
    await signInWith(page, phone);

    // Not the dashboard, and not an error: a new resident is asked where they live,
    // because a pickup cannot happen without a door to knock on.
    await expect(page.getByRole("heading", { name: /let's set you up/i })).toBeVisible({ timeout: 15_000 });

    await completeRegistration(page, "Playwright Newcomer");
    await expect(page.getByRole("navigation").getByRole("button", { name: "Book Pickup" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(GREETING)).toBeVisible();
  });

  test("negative: registration cannot be submitted until the address is complete", async ({ page }) => {
    await signInWith(page, unusedPhone());
    await expect(page.getByRole("heading", { name: /let's set you up/i })).toBeVisible({ timeout: 15_000 });

    // An operator sent to a flat that was never chosen is a wasted trip and a
    // resident who thinks the service does not work, so the form has to hold the line.
    await expect(page.getByRole("button", { name: /complete registration/i })).toBeDisabled();

    // The address selects are dependent: a tower belongs to a society, a flat to a
    // tower. Offering them all at once would let somebody pick a flat in a building
    // that is not in their society.
    await expect(page.getByLabel("Tower", { exact: true })).toBeDisabled();
    await page.getByLabel("Full name").fill("Half Way");
    await expect(page.getByRole("button", { name: /complete registration/i })).toBeDisabled();

    await page.getByLabel("Society", { exact: true }).selectOption({ index: 1 });
    await expect(page.getByLabel("Tower", { exact: true })).toBeEnabled();
    // A society alone is still not an address.
    await expect(page.getByRole("button", { name: /complete registration/i })).toBeDisabled();
  });
});

test.describe("Resident web app — deleting the account", () => {
  test("negative: the confirmation cannot be triggered by accident", async ({ page }) => {
    const phone = unusedPhone();
    await signInWith(page, phone);
    await completeRegistration(page, "Playwright Stays");
    await page.getByRole("navigation").getByRole("button", { name: "Profile" }).click();

    await page.getByRole("button", { name: "Delete Account" }).click();
    const dialog = page.getByRole("dialog", { name: /delete your account/i });
    await expect(dialog).toBeVisible();

    // Irreversible and one tap from a menu, so the dialog demands a typed word. A
    // mis-tap must not be able to erase somebody's account.
    await expect(dialog.getByRole("button", { name: "Delete Account" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: /type delete to confirm/i }).fill("delete me");
    await expect(dialog.getByRole("button", { name: "Delete Account" })).toBeDisabled();

    // And backing out has to genuinely back out.
    await dialog.getByRole("button", { name: /keep my account/i }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole("navigation").getByRole("button", { name: "Book Pickup" })).toBeVisible({ timeout: 15_000 });
  });

  test("positive: deleting erases the account, signs the resident out, and releases their number", async ({ page }) => {
    const phone = unusedPhone();
    await signInWith(page, phone);
    await completeRegistration(page, "Playwright Leaves");
    await page.getByRole("navigation").getByRole("button", { name: "Profile" }).click();

    // The resident is told what survives before they commit, not afterwards: the
    // money records have to be kept for tax, and hiding that would be the surprise.
    await expect(page.getByText(/orders and invoices are kept/i)).toBeVisible();

    await page.getByRole("button", { name: "Delete Account" }).click();
    const dialog = page.getByRole("dialog", { name: /delete your account/i });
    await dialog.getByRole("textbox", { name: /type delete to confirm/i }).fill("DELETE");
    const confirm = dialog.getByRole("button", { name: "Delete Account" });
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The dialog says which of the two things actually happened before it drops the
    // resident out, so nobody is told their account is gone when it is not.
    await expect(dialog.getByText(/your account has been deleted/i)).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /^sign out$/i }).click();

    // Deletion that leaves a working session is not deletion.
    await expect(page.locator('input[inputmode="tel"]').first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator('input[inputmode="tel"]').first()).toBeVisible({ timeout: 15_000 });

    // The number has to come back into circulation. Indian mobile numbers are
    // recycled, and somebody who leaves must be able to return — so signing in with
    // it again lands on registration, as a stranger, not on the old account.
    await signInWith(page, phone);
    await expect(page.getByRole("heading", { name: /let's set you up/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Full name")).toHaveValue("");
  });
});
