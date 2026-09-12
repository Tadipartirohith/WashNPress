import { test, expect, type Page } from "@playwright/test";
import { bookFreshPickup, clearAuth, loginWithDemoAccount, pickTomorrow, RESIDENT_HOME } from "../helpers";

// Additional services, from the resident's side.
//
// A car wash or an hour of ironing is booked against a slot the same way a laundry
// pickup is, and from there the resident was stuck: the list drew these as a flat
// card with no press handler, so there was nothing to open, and nowhere to cancel or
// move one from — while the identical laundry card beside it had both. The backend
// has had /v1/services/requests/:id/{cancel,reschedule} all along.
//
// These specs need an additional-service slot to exist. The seed creates laundry
// slots only, so they skip with a reason rather than failing when the environment
// has none — an empty service catalogue is a legitimate state, and pretending
// otherwise would make this file fail for a reason that is not a defect.

/** Books the first additional service on offer, or returns false if none is bookable. */
async function bookAnAdditionalService(page: Page): Promise<boolean> {
  await page.getByRole("tab", { name: /^book/i }).click();
  await expect(page.getByText(/what would you like to book/i)).toBeVisible({ timeout: 15_000 });

  // Laundry arrives selected. Turn it off and take the service on its own, so the
  // booking under test is unambiguously the additional service.
  await page.getByText(/^laundry pickup$/i).first().click();
  await page.getByText(/^at-home ironing$/i).first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForTimeout(1500);

  let slot = page.getByRole("button", { name: /\d+ left/i }).first();
  let hasSlot = await slot.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  if (!hasSlot) {
    await pickTomorrow(page);
    slot = page.getByRole("button", { name: /\d+ left/i }).first();
    hasSlot = await slot.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  }
  if (!hasSlot) return false;
  await slot.click();

  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByText(/booking summary/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^confirm booking$/i }).click();
  await page.waitForTimeout(2500);
  return true;
}

/** Opens the additional-service booking from My Orders. */
async function openTheService(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /^orders/i }).click();
  // Two filters, and both matter: the group (My Orders opens on "Current / Active",
  // which is empty until an operator is on the way) and the kind.
  await page.getByText("Upcoming", { exact: true }).first().click();
  await page.getByText("Additional services", { exact: true }).first().click();
  // The card, not the text inside it: the card is what carries the press handler.
  const card = page.getByRole("button").filter({ hasText: /at-home ironing/i }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
}

test.describe("Mobile resident app — additional services", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Resident (Anusha)");
    await expect(page.getByText(RESIDENT_HOME)).toBeVisible({ timeout: 15_000 });
  });

  test("a service booking opens, instead of being a card that does nothing", async ({ page }) => {
    const booked = await bookAnAdditionalService(page);
    test.skip(!booked, "No additional-service slot available in this environment.");
    await openTheService(page);

    // Its own screen, naming the service — not the laundry order screen, which would
    // be showing an order code and the wash/iron/QC progression.
    await expect(page.getByText(/^at-home ironing$/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^cancel booking$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^reschedule booking$/i })).toBeVisible();
  });

  test("a service nobody has counted yet is not described as free", async ({ page }) => {
    // Nothing is measured until the operator arrives, so the quote is zero — and the
    // card rendered that as "Included with plan", telling a resident with no plan
    // that an hour of ironing costs nothing because of a plan they do not have.
    const booked = await bookAnAdditionalService(page);
    test.skip(!booked, "No additional-service slot available in this environment.");
    await openTheService(page);

    await expect(page.getByText(/priced when the operator arrives/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/included with plan/i)).toHaveCount(0);
  });

  test("cancelling asks why before it will go through", async ({ page }) => {
    const booked = await bookAnAdditionalService(page);
    test.skip(!booked, "No additional-service slot available in this environment.");
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

  test("rescheduling offers another day and slot", async ({ page }) => {
    const booked = await bookAnAdditionalService(page);
    test.skip(!booked, "No additional-service slot available in this environment.");
    await openTheService(page);

    await page.getByRole("button", { name: /^reschedule booking$/i }).click();
    await expect(page.getByText(/service day/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /confirm new slot/i })).toBeVisible();
  });
});

// The laundry journey has to keep working exactly as it did — the service screen is
// new plumbing in the same list, and the cheapest way to break it is to route both
// kinds of card through one handler.
test.describe("Mobile resident app — laundry is unaffected", () => {
  test("a laundry pickup still opens its own order screen", async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Resident (Anusha)");
    const booked = await bookFreshPickup(page);
    test.skip(!booked, "No pickup slot available in this environment.");

    await page.getByRole("tab", { name: /^orders/i }).click();
    await page.getByText("Upcoming", { exact: true }).first().click();
    const row = page.getByText(/ORD-/i).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByText(/tracking/i).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Mobile resident app — a booking that half succeeds", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAuth(page);
    await page.reload();
    await loginWithDemoAccount(page, "Resident (Anusha)");
    await expect(page.getByText(RESIDENT_HOME)).toBeVisible({ timeout: 15_000 });
  });

  // ST1-I097. Laundry and a service are two requests. When the second fails the first
  // has already been booked, and a bare error told the resident nothing had happened —
  // so they confirmed again and got a second pickup.
  //
  // Only the service leg is faked: it offers one slot and then refuses it the way a
  // slot that has just filled refuses it. The laundry leg books for real, which is the
  // whole point — there must be a genuine pickup for the screen to be honest about.
  test("says which half went through when the service fails after the pickup is booked", async ({ page }) => {
    await page.route("**/v1/services/date-slots**", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ slots: [{ id: "svc-slot-fake", window: "Morning", startTime: "09:00", endTime: "12:00", capacityRemaining: 5, capacityTotal: 10, full: false }] }),
    }));
    await page.route("**/v1/services/slot-requests", (route) => route.fulfill({
      status: 409, contentType: "application/json",
      body: JSON.stringify({ error: "slot_full", message: "At-home ironing is full for the Morning slot." }),
    }));

    await page.getByRole("tab", { name: /^book/i }).click();
    await expect(page.getByText(/what would you like to book/i)).toBeVisible({ timeout: 15_000 });
    // Laundry arrives selected; add the service on top of it.
    await page.getByText(/^at-home ironing$/i).first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    for (const step of ["pickup", "service"]) {
      let slot = page.getByRole("button", { name: /\d+ left/i }).first();
      let has = await slot.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
      if (!has) {
        await pickTomorrow(page);
        slot = page.getByRole("button", { name: /\d+ left/i }).first();
        has = await slot.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
      }
      test.skip(!has, `No ${step} slot is bookable in this environment.`);
      await slot.click();
      await page.getByRole("button", { name: /^continue$/i }).click();
    }

    await expect(page.getByText(/booking summary/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^confirm booking$/i }).click();

    await expect(page.getByText("Partly booked")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ORD-\d+/).first()).toBeVisible();
    await expect(page.getByText(/not booked/i)).toBeVisible();
    // The review step has gone, so there is no Confirm left to press a second time.
    await expect(page.getByRole("button", { name: /^confirm booking$/i })).toHaveCount(0);
  });
});
