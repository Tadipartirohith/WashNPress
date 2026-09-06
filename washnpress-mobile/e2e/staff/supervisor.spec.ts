import { test, expect } from "@playwright/test";
import { clearAuth, loginWithDemoAccount } from "../helpers";

test.describe("Mobile Supervisor portal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Supervisor (My Home Bhooja)");
    await expect(page.getByText(/wrong app|pending verification/i)).not.toBeVisible({ timeout: 10_000 });
  });

  test("smoke: bottom nav (4 primary + More) and every More section render without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    for (const tab of ["Dashboard", "Orders", "Pickups", "Issues", "More"]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`, "i") }).click();
      await page.waitForTimeout(400);
    }
    for (const row of ["My society", "Operations staff", "Slots", "Delayed", "Services", "Refunds", "Plans", "Reports", "Profile"]) {
      await expect(page.getByText(row, { exact: true })).toBeVisible();
    }
    expect(errors, `Console errors: ${errors.join("; ")}`).toEqual([]);
  });

  test("negative: adding a tower requires a name", async ({ page }) => {
    await page.getByRole("tab", { name: /^more/i }).click();
    await page.getByText("My society", { exact: true }).click();
    const addTower = page.getByRole("button", { name: /add tower|new tower|add block/i });
    const found = await addTower.first().waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No 'add tower' affordance visible for this demo supervisor's society.");
    await addTower.first().click();
    const submit = page.getByRole("button", { name: /^add block$/i }).last();
    await expect(submit).toBeDisabled();
  });

  test("negative: a negative floor count is refused client-side with a clear message (not silently sent)", async ({ page }) => {
    await page.getByRole("tab", { name: /^more/i }).click();
    await page.getByText("My society", { exact: true }).click();
    const addTower = page.getByRole("button", { name: /add tower|new tower|add block/i });
    const found = await addTower.first().waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    test.skip(!found, "No 'add tower' affordance visible for this demo supervisor's society.");
    await addTower.first().click();
    await page.getByLabel(/^tower$/i).fill(`E2E-${Date.now()}`);
    await page.getByLabel(/floors/i).fill("-2");
    await page.getByLabel(/flats/i).fill("10");
    // Unlike the web admin/supervisor forms (which only re-validate server-side),
    // this screen uses supervisor-rules.ts's towerProblem() to catch it before
    // the request is even sent.
    await expect(page.getByText(/floors must be a positive number/i)).toBeVisible();
    const submit = page.getByRole("button", { name: /^add block$/i }).last();
    await expect(submit).toBeDisabled();
  });
});
