import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

// I-99 and I-110: getting from a place to the people in it, and from a person to
// what they have ordered.
//
// Before this, the supervisor's tower cards were plain divs — clicking one did
// nothing — and the residents inside a tower were plain list items, so a supervisor
// could read that Anusha lives in A-402 and learn nothing else without going to
// Orders and searching by name. The admin's Society drawer had the same dead end in
// a different shape: a "Residents 12" tile that counted people and led nowhere.
//
// The chain these tests walk is the fix: place → residents → one resident → one
// order, with the right record at every step.

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

/**
 * Books one pickup for the demo resident and returns its order code.
 *
 * Seeded through the API rather than through the resident UI: this file is about
 * what the staff portals do with an order that exists, and driving the whole booking
 * journey to get one would make a failure here ambiguous between the two.
 */
async function seedOrder(request: APIRequestContext): Promise<string> {
  const token = await tokenFor(request, DEMO_PHONES.resident);
  const auth = { authorization: `Bearer ${token}` };
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = await request.get(`${API}/v1/slots?date=${tomorrow}`, { headers: auth });
  const slot = (await slots.json()).slots?.[0];
  expect(slot, "the demo society has no bookable slot tomorrow").toBeTruthy();
  const booked = await request.post(`${API}/v1/pickups`, {
    headers: auth,
    data: { slotId: slot.id, lines: [{ category: "shirt", serviceId: "iron_only", quantity: 2 }] },
  });
  expect(booked.ok(), `could not seed an order: ${await booked.text()}`).toBeTruthy();
  return (await booked.json()).order.orderCode as string;
}

async function loginStaff(page: Page, portal: "admin" | "supervisor", phone: string) {
  await page.goto(`/${portal}`);
  await clearAuth(page);
  await page.reload();
  await page.locator('#portal-phone, input[inputmode="tel"]').first().fill(phone);
  await page.getByRole("button", { name: /send code/i }).click();
  const otp = page.locator('#portal-otp, input[inputmode="numeric"]').first();
  await expect(otp).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
}

let orderCode: string;

test.beforeAll(async ({ request }) => {
  orderCode = await seedOrder(request);
});

test.describe("I-99 · supervisor: tower → resident → order", () => {
  test.beforeEach(async ({ page }) => {
    await loginStaff(page, "supervisor", DEMO_PHONES.supervisor);
    await page.getByRole("button", { name: "Society", exact: true }).click();
  });

  test("the whole tower card opens the tower, not just the links on it", async ({ page }) => {
    // The card is the target. Clicking its body used to be the commonest way to
    // discover that nothing on this screen responded.
    await page.getByRole("button", { name: "Tower A", exact: true }).click();

    const tower = page.getByRole("dialog", { name: "Tower A" });
    await expect(tower).toBeVisible({ timeout: 15_000 });
    // Tower details, not an empty shell: the counts and the operator covering it.
    await expect(tower.getByText(/residents \(\d+\)/i)).toBeVisible();
    await expect(tower.getByRole("heading", { name: /operators/i })).toBeVisible();
  });

  test("a resident in the tower opens their details and their order history", async ({ page }) => {
    await page.getByRole("button", { name: "Tower A", exact: true }).click();
    const tower = page.getByRole("dialog", { name: "Tower A" });
    await expect(tower).toBeVisible({ timeout: 15_000 });

    await tower.getByRole("button", { name: /anusha/i }).click();
    const resident = page.getByRole("dialog", { name: "Anusha" });
    await expect(resident).toBeVisible({ timeout: 15_000 });

    // Who they are and where they live — the tower is the one we came in through,
    // and the flat is theirs, which is what "pass the right record id" means here.
    await expect(resident.getByText("Tower A", { exact: true })).toBeVisible();
    await expect(resident.getByText("A-402", { exact: true })).toBeVisible();
    for (const label of ["Phone", "Floor", "Plan", "Subscription", "Total orders", "Active orders"]) {
      await expect(resident.getByText(label, { exact: true })).toBeVisible();
    }

    // Order history, and the order opens from it.
    const order = resident.getByRole("button", { name: new RegExp(orderCode) });
    await expect(order).toBeVisible({ timeout: 15_000 });
    await order.click();
    const orderDrawer = page.getByRole("dialog", { name: orderCode });
    await expect(orderDrawer).toBeVisible({ timeout: 15_000 });
    await expect(orderDrawer.getByText("Amount", { exact: true })).toBeVisible();
    await expect(orderDrawer.getByText("Services", { exact: true })).toBeVisible();
  });

  test("the Residents link on a tower card reaches the same resident", async ({ page }) => {
    // Two ways in, one destination — the link was the only one that worked before,
    // and it stopped at a list.
    await page.getByRole("button", { name: /^residents/i }).first().click();
    const drawer = page.getByRole("dialog", { name: "Tower A" });
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole("button", { name: /anusha/i }).click();
    await expect(page.getByRole("dialog", { name: "Anusha" })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("I-110 · admin: society → residents → resident → order", () => {
  test.beforeEach(async ({ page }) => {
    await loginStaff(page, "admin", DEMO_PHONES.admin);
    await page.getByRole("navigation").getByRole("button", { name: "Societies", exact: true }).click();
    await page.getByRole("button", { name: /my home bhooja/i }).first().click();
  });

  test("the resident count opens the residents, and a resident opens their profile", async ({ page }) => {
    const society = page.getByRole("dialog", { name: /my home bhooja/i });
    await expect(society).toBeVisible({ timeout: 15_000 });

    await society.getByRole("button", { name: /residents/i }).click();
    const residents = page.getByRole("dialog", { name: /residents · my home bhooja/i });
    await expect(residents).toBeVisible({ timeout: 15_000 });
    // The list says where each person lives, which is the whole reason to open it
    // from a society rather than from All users.
    await expect(residents.getByRole("button", { name: /anusha/i })).toContainText("A-402");

    await residents.getByRole("button", { name: /anusha/i }).click();
    const resident = page.getByRole("dialog", { name: "Anusha" });
    await expect(resident).toBeVisible({ timeout: 15_000 });
    for (const label of ["Flat", "Plan", "Subscription", "Joined on", "Total orders", "Active orders"]) {
      await expect(resident.getByText(label, { exact: true })).toBeVisible();
    }

    const order = resident.getByRole("button", { name: new RegExp(orderCode) });
    await expect(order).toBeVisible({ timeout: 15_000 });
    await order.click();
    await expect(page.getByRole("dialog", { name: orderCode })).toBeVisible({ timeout: 15_000 });
  });

  test("the counts that lead nowhere are not dressed up as buttons", async ({ page }) => {
    // I-112's other half. Residents leads somewhere, so it is a button; Operators and
    // Orders do not, so they must not look pressable — a card that invites a click
    // and swallows it is the defect, not a missing feature.
    const society = page.getByRole("dialog", { name: /my home bhooja/i });
    await expect(society).toBeVisible({ timeout: 15_000 });
    await expect(society.getByRole("button", { name: /residents/i })).toHaveCount(1);
    await expect(society.getByRole("button", { name: /^operators$/i })).toHaveCount(0);
    await expect(society.getByRole("button", { name: /^orders$/i })).toHaveCount(0);
  });
});
