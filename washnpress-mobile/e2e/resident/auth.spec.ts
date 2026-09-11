import { test, expect } from "@playwright/test";
import { clearAuth, loginWithDemoAccount, RESIDENT_HOME } from "../helpers";

test.describe("Mobile resident app — auth", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
  });

  test("positive: demo account logs in and lands on Home with the bottom tab bar", async ({ page }) => {
    await loginWithDemoAccount(page, "Resident (Anusha)");
    await expect(page.getByText(RESIDENT_HOME)).toBeVisible({ timeout: 10_000 });
    for (const tab of ["Home", "Book", "Orders", "Profile"]) {
      await expect(page.getByRole("tab", { name: new RegExp(tab, "i") })).toBeVisible();
    }
  });

  test("negative: wrong OTP is rejected and does not log in", async ({ page }) => {
    await page.getByRole("button", { name: "Resident (Anusha)", exact: true }).click();
    const otpField = page.getByLabel("Enter OTP");
    await expect(otpField).not.toHaveValue("", { timeout: 10_000 });
    await otpField.fill("000000");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByText(/did not work|incorrect|invalid/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(RESIDENT_HOME)).not.toBeVisible();
  });

  test("negative: Send OTP stays disabled until exactly 10 digits are entered", async ({ page }) => {
    const phone = page.getByLabel("Mobile number");
    await phone.fill("12345");
    await expect(page.getByRole("button", { name: "Send OTP" })).toBeDisabled();
    await phone.fill("123456789012"); // too long is clamped/blocked by the field itself or still invalid
    const value = await phone.inputValue();
    if (value.length !== 10) {
      await expect(page.getByRole("button", { name: "Send OTP" })).toBeDisabled();
    }
  });

  test("negative: a staff phone number in the resident app is refused as the wrong app, not logged in", async ({ page }) => {
    await page.getByLabel("Mobile number").fill("9876500002"); // operations demo account
    await page.getByRole("button", { name: "Send OTP" }).click();
    const otpField = page.getByLabel("Enter OTP");
    await expect(otpField).not.toHaveValue("", { timeout: 10_000 });
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByText("You are in the wrong app")).toBeVisible({ timeout: 10_000 });
  });
});
