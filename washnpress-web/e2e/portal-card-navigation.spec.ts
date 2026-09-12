import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

// I-105 and I-112: a card that counts something has to take you to the thing it
// counted, already narrowed to it.
//
// Every tile on all three dashboards rendered a number and then absorbed the click.
// The operations dashboard was worse than inert: "Scheduled" was wrapped in a
// `display: contents` button, so exactly one of seven identical-looking tiles
// navigated and there was no way to tell which by looking.
//
// These tests follow a card to its destination and check that the filter travelled
// with it — a card that lands on an unfiltered list is only half-fixed.

// The backend these specs seed data through. Defaults to the port e2e/README.md starts
// it on; set API_BASE_URL to point elsewhere. It used to default to 8200, a port
// that only ever existed on one throwaway test stack.
const API = process.env.API_BASE_URL ?? "http://localhost:8090";

async function tokenFor(request: APIRequestContext, phone: string): Promise<string> {
  const sent = await request.post(`${API}/v1/auth/otp/send`, { data: { phone } });
  const { otpForTesting } = await sent.json();
  const verified = await request.post(`${API}/v1/auth/otp/verify`, { data: { phone, otp: otpForTesting } });
  return (await verified.json()).token;
}

async function loginStaff(page: Page, portal: "admin" | "supervisor" | "operations", phone: string) {
  await page.goto(`/${portal}`);
  await clearAuth(page);
  await page.reload();
  await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(phone);
  await page.getByRole("button", { name: /send code/i }).click();
  const otp = page.locator('#portal-otp, input[inputmode="numeric"]').first();
  await expect(otp).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
}

/**
 * A left-nav destination, by name — the count badge means a nav button is called
 * "Issues 3" on a busy day and "Issues" on a quiet one, so an exact match passes only
 * while the queue is empty. Same shape as operations-portal.spec.ts's helper.
 */
function navButton(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("navigation").getByRole("button", { name: new RegExp(`^${escaped}( \\d+)?$`) });
}

test.describe("I-105 · admin dashboard cards", () => {
  test.beforeEach(async ({ page }) => {
    await loginStaff(page, "admin", DEMO_PHONES.admin);
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible({ timeout: 20_000 });
  });

  test("Total revenue opens the Revenue report, not the Overview one", async ({ page }) => {
    await page.getByRole("button", { name: /total revenue/i }).click();
    await expect(page.getByText(/where it came from/i)).toBeVisible({ timeout: 20_000 });
  });

  test("Issues pending opens Issues filtered to the open ones", async ({ page }) => {
    await page.getByRole("button", { name: /issues pending/i }).click();
    await expect(page.getByPlaceholder(/search by id/i)).toBeVisible({ timeout: 20_000 });
    // The status filter arrived set, so the list in front of the admin is the list
    // the number on the card was counting.
    await expect(page.getByRole("combobox").first()).toHaveValue("open");
  });

  test("Supervisors active opens People on its Supervisors tab", async ({ page }) => {
    await page.getByRole("button", { name: /supervisors active/i }).click();
    await expect(page.getByRole("button", { name: /new supervisor/i })).toBeVisible({ timeout: 20_000 });
  });

  test("Operations staff active opens People on its Operators tab", async ({ page }) => {
    await page.getByRole("button", { name: /operations staff active/i }).click();
    await expect(page.getByRole("button", { name: /new operator/i })).toBeVisible({ timeout: 20_000 });
  });

  test("Societies active opens Societies", async ({ page }) => {
    await page.getByRole("button", { name: /societies active/i }).click();
    await expect(page.getByRole("button", { name: /new society/i })).toBeVisible({ timeout: 20_000 });
  });

  test("Subscriptions active opens the Subscriptions list, filtered to active", async ({ page }) => {
    await page.getByRole("button", { name: /subscriptions active/i }).click();
    // Asserted on the filter rather than on rows: a demo dataset with no
    // subscriptions renders an empty state and no column headers at all, and the
    // point of this test is where the card landed, not what the table contains.
    const statusFilter = page.getByRole("combobox").first();
    // "Paused" exists only on the subscriptions filter, so this is the right screen…
    await expect(statusFilter.locator('option[value="paused"]')).toHaveCount(1, { timeout: 20_000 });
    // …and the card's filter travelled with it.
    await expect(statusFilter).toHaveValue("active");
  });

  test("an attention alert opens the queue it is warning about", async ({ page, request }) => {
    // Alerts only exist while something is actually wrong (dashboard-service.ts drops
    // any zero count), so one is created to click.
    const residentToken = await tokenFor(request, DEMO_PHONES.resident);
    const created = await request.post(`${API}/v1/support/tickets`, {
      headers: { authorization: `Bearer ${residentToken}` },
      data: { category: "resident_complaint", description: `E2E alert probe ${Date.now()}`, priority: "emergency" },
    });
    expect(created.ok(), `could not seed an emergency ticket: ${await created.text()}`).toBeTruthy();
    await page.reload();

    const alert = page.getByRole("button", { name: /critical issues/i });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await alert.click();

    await expect(page.getByPlaceholder(/search by id/i)).toBeVisible({ timeout: 20_000 });
    // Emergencies are a priority, not a status — the card has to set the right one.
    await expect(page.getByRole("combobox").nth(1)).toHaveValue("emergency");
  });
});

test.describe("I-105 · supervisor overview tiles", () => {
  test.beforeEach(async ({ page }) => {
    await loginStaff(page, "supervisor", DEMO_PHONES.supervisor);
    await expect(page.getByRole("navigation", { name: "Supervisor" })).toBeVisible({ timeout: 20_000 });
  });

  test("Pickups pending opens Orders & Pickups on the Pickups view", async ({ page }) => {
    await page.getByRole("button", { name: /pickups pending/i }).click();
    // Asserted on which view is selected rather than on what the table contains: a
    // quiet day renders an empty state with no columns at all, and this test is about
    // where the tile landed.
    await expect(page.getByRole("button", { name: "Pickups", exact: true }))
      .toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  });

  test("QC failed opens the Quality checks view, not a raw order list", async ({ page }) => {
    await page.getByRole("button", { name: /qc failed/i }).click();
    await expect(page.getByRole("button", { name: "Quality checks", exact: true }))
      .toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(page.getByPlaceholder(/search order or resident/i)).toBeVisible();
  });

  test("Active operators opens the Operators tab", async ({ page }) => {
    await page.getByRole("button", { name: /active operators/i }).click();
    await expect(page.getByRole("button", { name: /add operator/i }).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("I-105 · operations dashboard tiles", () => {
  test.beforeEach(async ({ page }) => {
    await loginStaff(page, "operations", DEMO_PHONES.operations);
    await expect(page.getByRole("navigation", { name: "Operations" })).toBeVisible({ timeout: 20_000 });
  });

  // A tile renders its number above its label, so its accessible name reads
  // "0 Scheduled" rather than "Scheduled 0".
  const tile = (page: Page, label: string) =>
    page.getByRole("button", { name: new RegExp(`^\\d+ ${label}$`) });

  test("every Today's Work tile navigates, not just the one that used to", async ({ page }) => {
    // "Scheduled" was the only clickable one, and nothing about it said so.
    await tile(page, "Scheduled").click();
    await expect(navButton(page, "Pickups")).toHaveAttribute("aria-current", "page", { timeout: 20_000 });

    await navButton(page, "Dashboard").click();
    await tile(page, "QC Failed").click();
    // Active Orders, already on the QC Failed stage rather than on everything — the
    // stage is the half of this that used to be missing even where a tile did work.
    await expect(page.getByRole("heading", { name: /active orders/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^QC Failed \d+$/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("Additional Services tiles open the Services tab", async ({ page }) => {
    await tile(page, "Pending").first().click();
    await expect(navButton(page, "Services")).toHaveAttribute("aria-current", "page", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /additional services/i })).toBeVisible();
  });
});
