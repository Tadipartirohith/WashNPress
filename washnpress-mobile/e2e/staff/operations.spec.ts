import { test, expect } from "@playwright/test";
import { clearAuth, loginWithDemoAccount } from "../helpers";

test.describe("Mobile Operations portal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Operations (Operator 01)");
    await expect(page.getByText(/wrong app|pending verification/i)).not.toBeVisible({ timeout: 10_000 });
  });

  test("smoke: bottom nav (4 primary + More) and every More row render without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    for (const tab of ["Dashboard", "Pickups", "Active", "Issues", "More"]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") }).click();
      await page.waitForTimeout(400);
    }
    for (const row of ["Services", "History", "Profile"]) {
      await expect(page.getByText(row, { exact: true })).toBeVisible();
    }
    expect(errors, `Console errors: ${errors.join("; ")}`).toEqual([]);
  });

  test("negative: reconciling a pickup with zero entered quantity stays blocked", async ({ page }) => {
    await page.getByRole("tab", { name: /^pickups/i }).click();
    const collectButton = page.getByRole("button", { name: /confirm quantities and collect/i }).first();
    const found = await collectButton.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No pending pickups to reconcile in this demo dataset.");
    await collectButton.click();
    const checkSummary = page.getByRole("button", { name: /check quantity summary/i });
    await expect(checkSummary).toBeDisabled();
  });
});
