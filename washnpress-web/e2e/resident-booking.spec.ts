import { test, expect, type Locator, type Page } from "@playwright/test";
import { DEMO_PHONES, GREETING, loginAndCaptureToken, seedToken, pickCalendarDate, tomorrowIso } from "./helpers";

/**
 * Opens the booking wizard. Since I-82 booking is a modal over whatever the resident
 * is looking at, reached from the rail — the dashboard has no CTA of its own, and the
 * one it used to have ("Schedule Pickup") is what every test in this file was still
 * clicking. The rail is also the stable anchor: the dashboard's own buttons change
 * with whether the resident has a plan or an order.
 */
async function openWizard(page: Page): Promise<Locator> {
  await page.getByRole("navigation").getByRole("button", { name: "Book Pickup" }).click();
  const wizard = page.getByRole("dialog", { name: "Book" });
  await expect(wizard).toBeVisible({ timeout: 10_000 });
  await expect(wizard.getByText(/step 1 of 3/i)).toBeVisible();
  return wizard;
}

/**
 * Walks the wizard from step 1 to the slot choice with tomorrow's first free slot
 * selected, and returns the slot's label so the caller can check it is repeated back.
 * Tomorrow rather than today: slots close two hours before pickup, so today's set is
 * empty for most of the working day.
 */
async function chooseTomorrowsFirstSlot(page: Page, wizard: Locator): Promise<{ window: string; time: string }> {
  await wizard.getByRole("button", { name: "Continue" }).click();
  await expect(wizard.getByText(/step 2 of 3/i)).toBeVisible();

  await pickCalendarDate(page, /choose a pickup day/i, tomorrowIso());

  const slots = wizard.getByRole("radiogroup", { name: /available pickup slots/i }).getByRole("radio");
  // Tomorrow always carries the seeded Morning/Afternoon/Evening set. If this ever
  // finds nothing the booking journey is broken, so it must fail rather than skip.
  const first = slots.first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await first.click();
  await expect(first).toHaveAttribute("aria-checked", "true");

  // Read the label off the slot that is actually selected, and only once it is.
  // Reading it before the click raced the date change: the list still held today's
  // single Evening slot for a moment, so the test remembered "Evening" and then
  // clicked whatever had replaced it — Morning — and accused the review step of
  // repeating back the wrong slot.
  const chosen = {
    window: ((await first.locator("span").nth(0).textContent()) ?? "").trim(),
    time: ((await first.locator("span").nth(1).textContent()) ?? "").trim(),
  };
  return chosen;
}

/** How many orders My Orders is currently counting in one bucket. */
async function bucketCount(page: Page, bucket: RegExp): Promise<number> {
  await page.getByRole("navigation").getByRole("button", { name: "My Orders" }).click();
  const tab = page.getByRole("tab", { name: bucket });
  await expect(tab).toBeVisible({ timeout: 10_000 });
  return Number(((await tab.textContent()) ?? "").replace(/\D/g, "") || 0);
}

test.describe("Resident web app — booking a pickup", () => {
  // Log in once for the whole file (the backend rate-limits OTP per phone), then
  // replay the token before each test rather than re-running the OTP flow.
  let token: string;
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    token = await loginAndCaptureToken(page, DEMO_PHONES.resident);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await seedToken(page, token);
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });
  });

  // Since I-36 the resident just picks a day and a slot — the operator records the
  // clothes, services and quantities at the door — so the laundry leg is choose →
  // date+slot → review, with no service or quantity step.
  test("positive: the wizard books a pickup end to end and the order reaches My Orders", async ({ page }) => {
    const before = await bucketCount(page, /^upcoming/i);
    // Book from Home. Booking while already standing on My Orders leaves a stale list
    // behind — see the test.fail below, which is that defect and not this journey.
    await page.getByRole("navigation").getByRole("button", { name: "Home" }).click();
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 10_000 });

    const wizard = await openWizard(page);
    await chooseTomorrowsFirstSlot(page, wizard);
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard.getByText(/step 3 of 3/i)).toBeVisible();
    await wizard.getByRole("button", { name: /confirm booking/i }).click();

    // The wizard turns into its own confirmation rather than stacking a second dialog.
    const confirmed = page.getByRole("dialog", { name: /booking confirmed/i });
    await expect(confirmed).toBeVisible({ timeout: 15_000 });
    await expect(confirmed.getByText("Laundry Pickup")).toBeVisible();
    const receipt = (await confirmed.textContent()) ?? "";
    const orderCode = receipt.match(/ORD-\d+/)?.[0];
    // A confirmation that cannot name the order it created is not a confirmation.
    expect(orderCode, `no order code on the confirmation screen: ${receipt}`).toBeTruthy();
    expect(receipt).toContain(tomorrowIso());

    await confirmed.getByRole("button", { name: /view my orders/i }).click();
    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeVisible({ timeout: 10_000 });

    // Booked, not merely acknowledged: it is one more order in Upcoming, listed under
    // the code the confirmation gave, and it is not sitting in History.
    const upcomingTab = page.getByRole("tab", { name: /^upcoming/i });
    await expect(upcomingTab).toContainText(String(before + 1));
    await upcomingTab.click();
    await expect(page.getByText(orderCode!).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("tab", { name: /^history/i }).click();
    await expect(page.getByText(orderCode!)).toBeHidden();
  });

  // DEFECT: booking from My Orders leaves My Orders showing the list as it was.
  //
  // The wizard's "View My Orders" runs setView("orders"), and the animated container in
  // app/app/page.tsx is keyed on the view name — so when the resident was already on
  // My Orders the key does not change, the Orders component is never remounted, and its
  // useAsync(() => api.orders(), []) never refetches. The order really was created; the
  // resident is looking at a list that predates it, with the Upcoming tab still counting
  // 0, until they navigate away and back or reload. Not a stale test: this is the exact
  // screen the confirmation button promises to take them to. Fix by reloading Orders on
  // a completed booking (or keying the container on a booking counter), then delete
  // test.fail.
  test("positive: booking while already on My Orders refreshes the list behind the wizard", async ({ page }) => {
    test.fail();
    const before = await bucketCount(page, /^upcoming/i);

    const wizard = await openWizard(page);
    await chooseTomorrowsFirstSlot(page, wizard);
    await wizard.getByRole("button", { name: "Continue" }).click();
    await wizard.getByRole("button", { name: /confirm booking/i }).click();
    const confirmed = page.getByRole("dialog", { name: /booking confirmed/i });
    await expect(confirmed).toBeVisible({ timeout: 15_000 });
    await confirmed.getByRole("button", { name: /view my orders/i }).click();

    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("tab", { name: /^upcoming/i })).toContainText(String(before + 1));
  });

  test("positive: the review step repeats back the day and slot that were chosen", async ({ page }) => {
    const wizard = await openWizard(page);
    const slot = await chooseTomorrowsFirstSlot(page, wizard);
    await wizard.getByRole("button", { name: "Continue" }).click();

    await expect(wizard.getByText(/booking summary/i)).toBeVisible();
    const summary = (await wizard.textContent()) ?? "";
    expect(summary).toContain(tomorrowIso());
    // The window and hours the resident actually picked are echoed back — a review step
    // that shows a different slot from the one selected is worse than none at all.
    expect(summary).toContain(slot.window);
    expect(summary).toContain(slot.time);
    // A laundry pickup has no price at booking: the operator counts the garments at
    // the door. Anything that looks like a total here would be a promise the product
    // cannot keep.
    await expect(wizard.getByText(/priced at collection/i)).toBeVisible();
    await expect(wizard.getByText(/total now/i)).toBeHidden();
  });

  test("negative: abandoning the wizard at the review step books nothing", async ({ page }) => {
    const before = await bucketCount(page, /^upcoming/i);

    const wizard = await openWizard(page);
    await chooseTomorrowsFirstSlot(page, wizard);
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard.getByText(/booking summary/i)).toBeVisible();
    await wizard.getByRole("button", { name: "Close" }).click();
    await expect(wizard).toBeHidden();

    // Nothing is written until Confirm Booking. A wizard that persisted as it went
    // would leave a phantom pickup behind every time somebody changed their mind.
    await page.reload();
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });
    expect(await bucketCount(page, /^upcoming/i)).toBe(before);
  });

  test("negative: Continue is refused until there is something to book, and then until a slot is picked", async ({ page }) => {
    const wizard = await openWizard(page);
    const laundry = wizard.getByRole("button", { name: /laundry pickup/i });
    const continueButton = wizard.getByRole("button", { name: "Continue" });

    // Laundry is pre-selected, so step 1 starts ready.
    await expect(continueButton).toBeEnabled();
    // Turn it off with no additional service chosen and there is nothing to book.
    await laundry.click();
    await expect(continueButton).toBeDisabled();
    await laundry.click();
    await expect(continueButton).toBeEnabled();

    await continueButton.click();
    await expect(wizard.getByText(/step 2 of 3/i)).toBeVisible();
    // A day is always pre-filled, a slot never is — so the day step starts blocked.
    await expect(continueButton).toBeDisabled();
    await pickCalendarDate(page, /choose a pickup day/i, tomorrowIso());
    await expect(continueButton).toBeDisabled();
    await wizard.getByRole("radiogroup", { name: /available pickup slots/i }).getByRole("radio").first().click();
    await expect(continueButton).toBeEnabled();
  });

  test("negative: the calendar refuses a day in the past and offers today onwards", async ({ page }) => {
    const wizard = await openWizard(page);
    await wizard.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /choose a pickup day/i }).first().click();

    const calendar = page.getByRole("dialog", { name: /choose a pickup day/i });
    await expect(calendar).toBeVisible();

    // Yesterday, stepping back a month first when today is the 1st.
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const lastMonth = yesterday.getMonth() !== today.getMonth();
    if (lastMonth) await calendar.getByRole("button", { name: "Previous month" }).click();
    // Slots close two hours before pickup, so a day that has already gone can never be
    // booked — the calendar must not let it be chosen at all.
    await expect(calendar.getByRole("button", { name: String(yesterday.getDate()), exact: true })).toBeDisabled();

    if (lastMonth) await calendar.getByRole("button", { name: "Next month" }).click();
    await expect(calendar.getByRole("button", { name: String(today.getDate()), exact: true })).toBeEnabled();
    await expect(calendar.getByRole("button", { name: /^today$/i })).toBeEnabled();
  });

  test("positive: the dashboard shows the booked pickup and opens its tracking view", async ({ page }) => {
    const wizard = await openWizard(page);
    await chooseTomorrowsFirstSlot(page, wizard);
    await wizard.getByRole("button", { name: "Continue" }).click();
    await wizard.getByRole("button", { name: /confirm booking/i }).click();
    const confirmed = page.getByRole("dialog", { name: /booking confirmed/i });
    await expect(confirmed).toBeVisible({ timeout: 15_000 });
    await confirmed.getByRole("button", { name: "Done" }).click();

    // Home is the screen the resident actually lands on, and "No active orders" is what
    // it said before I-80 wired the dashboard to the upcoming pickup.
    await page.getByRole("navigation").getByRole("button", { name: "Home" }).click();
    await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/no active orders/i)).toBeHidden();

    const card = page.getByRole("button", { name: /view order/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const cardCode = ((await card.textContent()) ?? "").match(/ORD-\d+/)?.[0];
    expect(cardCode, "the dashboard's current-order card does not name an order").toBeTruthy();

    // One tap from the dashboard into that order's own tracking view — not the Orders
    // list, which is one level shallower and would make the card a shortcut to nothing.
    await card.click();
    await expect(page.getByRole("heading", { name: cardCode!, exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Booking confirmed")).toBeVisible();
    await page.getByRole("button", { name: /^orders$/i }).first().click();
    await expect(page.getByRole("heading", { name: "My Orders", exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
