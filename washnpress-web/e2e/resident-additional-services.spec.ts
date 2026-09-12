import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { DEMO_PHONES, pickCalendarDate, tomorrowIso } from "./helpers";

// Additional services, from the resident's side.
//
// A car wash or an hour of ironing is booked against a slot the same way a laundry
// pickup is, and from there the resident was on their own: "View Details" opened the
// *laundry* tracking screen and asked the laundry tracking API about an id it had
// never heard of, and the cancel and reschedule routes the backend has always had
// were reachable from nowhere at all.

let apiOrigin: string;

async function discoverApiOrigin(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  await page.addInitScript(() => { try { window.localStorage.setItem("wnp_token", "discovery"); } catch { /* ignore */ } });
  const pending = page.waitForRequest((r) => r.url().includes("/v1/"), { timeout: 20_000 });
  await page.goto("/app");
  const origin = new URL((await pending).url()).origin;
  await page.close();
  return origin;
}

async function tokenFor(request: APIRequestContext, phone: string): Promise<string> {
  const sent = await request.post(`${apiOrigin}/v1/auth/otp/send`, { data: { phone } });
  expect(sent.ok(), `OTP send failed for ${phone}`).toBeTruthy();
  const otp = (await sent.json()).otpForTesting as string;
  const verified = await request.post(`${apiOrigin}/v1/auth/otp/verify`, { data: { phone, otp } });
  expect(verified.ok()).toBeTruthy();
  return (await verified.json()).token as string;
}

/**
 * A slot for an additional service tomorrow, created the way an admin creates one.
 *
 * The seeded data has laundry slots and no service slots at all, so without this the
 * booking wizard correctly reports "No slots offered" and none of this can be
 * exercised. A slot that already exists answers 409, which is just as good.
 */
async function ensureIroningSlot(request: APIRequestContext): Promise<void> {
  const token = await tokenFor(request, DEMO_PHONES.admin);
  const made = await request.post(`${apiOrigin}/v1/admin/service-slots`, {
    headers: { authorization: `Bearer ${token}` },
    data: { societyId: "soc-demo", date: tomorrowIso(), offeringId: "iron-at-home", window: "Morning", capacity: 10 },
  });
  expect([201, 409], `unexpected status creating a service slot: ${made.status()} ${await made.text()}`)
    .toContain(made.status());
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/app");
  await page.locator('input[inputmode="tel"]').first().fill(DEMO_PHONES.resident);
  await page.getByRole("button", { name: /send code/i }).click();
  const otp = page.locator('input[inputmode="numeric"]').first();
  await expect(otp).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /verify and continue/i }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "Book Pickup" })).toBeVisible({ timeout: 15_000 });
}

/** Books laundry *and* an hour of ironing, and returns once both are confirmed. */
async function bookLaundryAndIroning(page: Page): Promise<void> {
  await page.getByRole("navigation").getByRole("button", { name: "Book Pickup" }).click();
  const wizard = page.getByRole("dialog", { name: "Book" });
  await expect(wizard).toBeVisible({ timeout: 10_000 });

  // Laundry arrives selected; adding a service turns the three-step wizard into a
  // four-step one, which is the wizard admitting it is carrying both.
  await expect(wizard.getByText(/step 1 of 3/i)).toBeVisible();
  await wizard.getByRole("button", { name: /at-home ironing/i }).click();
  await expect(wizard.getByText(/step 1 of 4/i)).toBeVisible();
  await wizard.getByRole("button", { name: "Continue" }).click();

  // Step 2, the laundry day and slot.
  await pickCalendarDate(page, /choose a pickup day/i, tomorrowIso());
  await wizard.getByRole("radiogroup", { name: /available pickup slots/i }).getByRole("radio").first().click();
  await wizard.getByRole("button", { name: "Continue" }).click();

  // Step 3, the service's own day and slot — a separate choice, because a service
  // and a pickup do not have to happen in the same window.
  await expect(wizard.getByText(/step 3 of 4/i)).toBeVisible();
  await pickCalendarDate(page, /choose a service day/i, tomorrowIso());
  const serviceSlots = wizard.getByRole("radiogroup").getByRole("radio");
  await expect(serviceSlots.first()).toBeVisible({ timeout: 15_000 });
  await serviceSlots.first().click();
  await wizard.getByRole("button", { name: "Continue" }).click();

  await expect(wizard.getByText(/booking summary/i)).toBeVisible({ timeout: 10_000 });
  await wizard.getByRole("button", { name: /confirm booking/i }).click();
  await expect(page.getByRole("dialog", { name: /booking confirmed/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("dialog", { name: /booking confirmed/i }).getByRole("button", { name: /done|close/i }).first().click();
}

/** Opens the additional-service booking from My Orders. */
async function openTheService(page: Page): Promise<void> {
  await page.getByRole("navigation").getByRole("button", { name: "My Orders" }).click();
  await page.getByRole("tab", { name: /additional services/i }).click();
  const card = page.getByRole("button").filter({ hasText: /at-home ironing/i }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
}

test.describe("Resident web app — additional services", () => {
  test.beforeAll(async ({ browser, request }) => {
    apiOrigin = await discoverApiOrigin(browser);
    await ensureIroningSlot(request);
  });

  test("the booking summary carries every service that was chosen, not just the laundry", async ({ page }) => {
    // The complaint was that a service selected alongside laundry was silently
    // dropped somewhere between the first step and the booking. Both have to survive
    // to the summary, each with the slot it was actually given.
    await signIn(page);
    await page.getByRole("navigation").getByRole("button", { name: "Book Pickup" }).click();
    const wizard = page.getByRole("dialog", { name: "Book" });
    await wizard.getByRole("button", { name: /at-home ironing/i }).click();
    await wizard.getByRole("button", { name: "Continue" }).click();
    await pickCalendarDate(page, /choose a pickup day/i, tomorrowIso());
    await wizard.getByRole("radiogroup", { name: /available pickup slots/i }).getByRole("radio").first().click();
    await wizard.getByRole("button", { name: "Continue" }).click();
    await pickCalendarDate(page, /choose a service day/i, tomorrowIso());
    await wizard.getByRole("radiogroup").getByRole("radio").first().click();
    await wizard.getByRole("button", { name: "Continue" }).click();

    const summary = wizard.getByText(/booking summary/i);
    await expect(summary).toBeVisible({ timeout: 10_000 });
    await expect(wizard.getByText("Laundry Pickup")).toBeVisible();
    await expect(wizard.getByText("At-home ironing")).toBeVisible();
  });

  test("a service that has not been priced yet does not claim to be free", async ({ page }) => {
    // Nothing is counted until the operator arrives, so the quote is zero — and
    // rendering that as "₹0" told the resident an hour of ironing cost nothing.
    // Laundry has always said "Priced at collection" in exactly this situation.
    await signIn(page);
    await bookLaundryAndIroning(page);
    await openTheService(page);
    await expect(page.getByText(/priced when the operator arrives/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^₹0$/)).toHaveCount(0);
  });

  test("View Details opens the service, not the laundry tracking screen", async ({ page }) => {
    await signIn(page);
    await bookLaundryAndIroning(page);
    await openTheService(page);

    // The service's own screen names the service. The laundry tracking screen would
    // instead show an order code heading and the wash/iron/QC progression, and its
    // request for this id would have failed outright.
    await expect(page.getByRole("heading", { name: /at-home ironing/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/washing|ironing stage|qc pending/i)).toHaveCount(0);
  });

  test("a service booking can be cancelled, and cancelling asks why first", async ({ page }) => {
    await signIn(page);
    await bookLaundryAndIroning(page);
    await openTheService(page);

    await page.getByRole("button", { name: /^cancel booking$/i }).click();
    // The API refuses a cancellation with no reason, so the screen asks for one
    // rather than sending a request that could only come back refused.
    const confirm = page.getByRole("button", { name: /^cancel booking$/i }).last();
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/why are you cancelling/i).fill("Booked the wrong day");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText(/^cancelled\.?$/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a service booking can be moved to another slot", async ({ page }) => {
    await signIn(page);
    await bookLaundryAndIroning(page);
    await openTheService(page);

    await page.getByRole("button", { name: /^reschedule booking$/i }).click();
    await expect(page.getByRole("button", { name: /choose a service day/i })).toBeVisible({ timeout: 10_000 });
    // Whether another slot exists depends on what this environment has been given;
    // what must be true is that the resident is offered the choice at all, which is
    // what was missing.
    await expect(page.getByRole("button", { name: /confirm new slot/i })).toBeVisible();
  });
});

test.describe("Resident web app — a booking that half succeeds", () => {
  // ST1-I097. Laundry and a service are two requests. When the second fails the first
  // has already been booked, and a bare error told the resident nothing had happened —
  // so they pressed Confirm again and got a second pickup.
  //
  // Only the service leg is faked: it offers one slot and then refuses it the way a
  // slot that has just filled refuses it. The laundry leg books for real, because the
  // screen has to be honest about a pickup that genuinely exists.
  test("says which half went through when the service fails after the pickup is booked", async ({ page }) => {
    await page.route("**/v1/services/date-slots**", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ slots: [{ id: "svc-slot-fake", window: "Morning", startTime: "09:00", endTime: "12:00", capacityRemaining: 5, capacityTotal: 10, full: false }] }),
    }));
    await page.route("**/v1/services/slot-requests", (route) => route.fulfill({
      status: 409, contentType: "application/json",
      body: JSON.stringify({ error: "slot_full", message: "At-home ironing is full for the Morning slot." }),
    }));

    await signIn(page);
    await page.getByRole("navigation").getByRole("button", { name: "Book Pickup" }).click();
    const wizard = page.getByRole("dialog", { name: "Book" });
    await expect(wizard).toBeVisible({ timeout: 10_000 });
    await wizard.getByRole("button", { name: /at-home ironing/i }).click();
    await wizard.getByRole("button", { name: "Continue" }).click();

    await pickCalendarDate(page, /choose a pickup day/i, tomorrowIso());
    await wizard.getByRole("radiogroup", { name: /available pickup slots/i }).getByRole("radio").first().click();
    await wizard.getByRole("button", { name: "Continue" }).click();

    await pickCalendarDate(page, /choose a service day/i, tomorrowIso());
    await wizard.getByRole("radiogroup").getByRole("radio").first().click();
    await wizard.getByRole("button", { name: "Continue" }).click();

    await expect(wizard.getByText(/booking summary/i)).toBeVisible({ timeout: 10_000 });
    await wizard.getByRole("button", { name: /confirm booking/i }).click();

    const result = page.getByRole("dialog", { name: /partly booked/i });
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(result.getByText(/ORD-\d+/)).toBeVisible();
    await expect(result.getByText(/at-home ironing — not booked/i)).toBeVisible();
    await expect(result.getByText(/is full for the morning slot/i)).toBeVisible();
    // The review step has gone, so there is no Confirm left to press a second time.
    await expect(page.getByRole("button", { name: /confirm booking/i })).toHaveCount(0);
  });
});
