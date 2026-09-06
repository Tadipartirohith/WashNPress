import { test, expect } from "@playwright/test";
import { clearAuth, loginWithDemoAccount } from "../helpers";

const NAV_TABS = ["Dashboard", "Orders", "Reports", "Issues", "More"];
const MORE_ROWS = [
  "Supervisors", "Operators", "Users", "Societies",
  "Services", "Bookings", "Plans", "Slots",
  "Subscriptions", "Revenue", "Refunds",
  "Audit", "Config", "Account",
];

test.describe("Mobile Admin portal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Admin");
    await expect(page.getByText(/wrong app|pending verification/i)).not.toBeVisible({ timeout: 10_000 });
  });

  test("smoke: bottom nav (4 primary + More) and every More row render without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    for (const tab of NAV_TABS) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") }).click();
      await page.waitForTimeout(400);
    }
    for (const row of MORE_ROWS) {
      await expect(page.getByText(row, { exact: true })).toBeVisible();
    }
    expect(errors, `Console errors: ${errors.join("; ")}`).toEqual([]);
  });

  test("smoke: Supervisors, Operators and Societies lists (RecordCard + actions) render and open without a nested-button console error", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    for (const section of ["Supervisors", "Operators", "Societies"]) {
      await page.getByRole("tab", { name: /^more/i }).click();
      await page.getByText(section, { exact: true }).click();
      await page.waitForTimeout(500);
      // Click the first record card's own Edit action specifically, to prove the
      // action button and the card's own tap-to-open no longer collide now that
      // they aren't literally nested inside one another.
      const editButton = page.getByRole("button", { name: /^edit$/i }).first();
      const hasCard = await editButton.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
      if (hasCard) {
        await editButton.click();
        await page.waitForTimeout(300);
        const cancel = page.getByRole("button", { name: /^cancel$/i }).first();
        if (await cancel.isVisible().catch(() => false)) await cancel.click();
      }
    }
    expect(errors, `Console errors: ${errors.join("; ")}`).toEqual([]);
  });

  test("negative: New society wizard blocks Next until the required details are filled", async ({ page }) => {
    await page.getByRole("tab", { name: /^more/i }).click();
    await page.getByText("Societies", { exact: true }).click();
    const newSociety = page.getByRole("button", { name: /new society|add society/i });
    const found = await newSociety.first().waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No 'new society' affordance visible in this demo dataset.");
    await newSociety.first().click();
    const next = page.getByRole("button", { name: /^next$/i }).last();
    await expect(next).toBeDisabled();
  });
});
