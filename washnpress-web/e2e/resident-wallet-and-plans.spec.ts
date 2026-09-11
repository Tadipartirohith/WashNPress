import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { GREETING, seedToken } from "./helpers";

// The resident's money screens: what the wallet holds, what a top-up actually does,
// and what the plans on offer cost.
//
// This file used to assert that pressing "Add ₹1,000" made the balance go up. It did,
// and that was the defect: no gateway key is configured for this build, so the fake
// payment provider was answering "paid" to a reconciliation job that then minted
// spendable wallet balance out of a button press. The provider no longer settles
// anything by itself, and the app now opens a demonstration checkout that says plainly
// that it takes no payment. So a top-up must NOT move the balance — and the money must
// still be able to arrive when a real gateway settles the order, which is the second
// test below.
//
// Every test runs as a resident who signed up seconds ago, created through the same
// OTP and onboarding endpoints the app itself calls. That is what makes the money
// assertions exact rather than relative: a brand-new wallet holds ₹0.00, so "the
// balance did not change" can be written as "the balance is ₹0.00" and "not enough
// balance to subscribe" is true of every plan the operator offers, whatever they
// happen to be priced at today. It also keeps this file independent of whatever the
// subscription suite does to the shared demo resident.

/** The committed placeholder secret this disposable stack boots with; production
 *  refuses to start with it (config/production-readiness.ts). Override it if the
 *  stack under test was given a real one. */
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "change-me-in-config-local-or-env";
const SIGNATURE_HEADER = "x-razorpay-signature";

/** The API the build under test talks to, taken from the app's own first call rather
 *  than hardcoded, so this suite follows the app to whatever backend it is pointed at. */
let apiOrigin: string;

async function discoverApiOrigin(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  // Any token at all makes the shell call /v1/auth/me on boot; it does not have to be
  // a good one, and a rejected one just lands back on the sign-in screen.
  await page.addInitScript(() => { try { window.localStorage.setItem("wnp_token", "discovery"); } catch { /* ignore */ } });
  const pending = page.waitForRequest((r) => r.url().includes("/v1/"), { timeout: 20_000 });
  await page.goto("/app");
  const origin = new URL((await pending).url()).origin;
  await page.close();
  return origin;
}

interface Newcomer { token: string; residentId: string }

/**
 * A resident who has just signed up: new number, verified, onboarded into the demo
 * society, empty wallet, no plan. Built through the API because it is scaffolding for
 * the assertions rather than the thing under test — resident-auth.spec.ts is where
 * sign-up itself is exercised. A unique number each time also sidesteps the per-phone
 * OTP resend cooldown that a fixed demo number runs into.
 */
async function signUpNewResident(request: APIRequestContext): Promise<Newcomer> {
  const phone = `98${String(Date.now()).slice(-8)}`;
  const sent = await request.post(`${apiOrigin}/v1/auth/otp/send`, { data: { phone } });
  expect(sent.ok(), `OTP send failed for ${phone}`).toBeTruthy();
  const otp = (await sent.json()).otpForTesting as string;
  expect(otp, "The stack is not in demo OTP mode; this suite needs the returned code").toBeTruthy();

  const verified = await request.post(`${apiOrigin}/v1/auth/otp/verify`, { data: { phone, otp } });
  expect(verified.ok()).toBeTruthy();
  const firstToken = (await verified.json()).token as string;

  const options = await request.get(`${apiOrigin}/v1/resident/onboarding`, {
    headers: { authorization: `Bearer ${firstToken}` },
  });
  expect(options.ok()).toBeTruthy();
  const society = (await options.json()).societies[0];
  const block = society.blocks[0];
  const onboarded = await request.post(`${apiOrigin}/v1/auth/onboarding`, {
    headers: { authorization: `Bearer ${firstToken}` },
    data: { fullName: "E2E Newcomer", societyId: society.id, blockId: block.id, unitNumber: block.flats[0].number },
  });
  expect(onboarded.ok(), "Onboarding the throwaway resident failed").toBeTruthy();
  const body = await onboarded.json();
  // Onboarding reissues the session with the resident scope, exactly as the app does.
  return { token: (body.token as string) ?? firstToken, residentId: body.resident.id as string };
}

/**
 * Stands in for the payment gateway settling a top-up: the signed webhook the backend
 * credits wallets from. Nothing about the credit is taken from this call except which
 * order settled — the amount and the resident are checked against the intent the
 * top-up recorded — so this cannot invent balance the platform did not ask for.
 */
async function settlePaymentOrder(
  request: APIRequestContext,
  input: { providerOrderId: string; residentId: string; amountPaise: number },
) {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { providerOrderId: input.providerOrderId, residentId: input.residentId, amountPaise: input.amountPaise, method: "upi" },
  });
  const res = await request.post(`${apiOrigin}/v1/payments/webhook`, {
    headers: { "content-type": "application/json", [SIGNATURE_HEADER]: createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex") },
    data: body,
  });
  expect(res.status(), `Gateway webhook refused: ${await res.text()}`).toBe(200);
  expect((await res.json()).status).toBe("processed");
}

/** The big number under the "Balance" label on the Wallet screen. */
const balanceAmount = (page: Page) =>
  page.getByText("Balance", { exact: true }).locator("xpath=following-sibling::p[1]");

async function signIn(page: Page, who: Newcomer) {
  await seedToken(page, who.token);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: GREETING })).toBeVisible({ timeout: 15_000 });
}

/** Wallet is not a tab. It is one of the three account services on Profile. */
async function openWallet(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: /^profile$/i })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /view wallet/i }).click();
  await expect(page.getByRole("heading", { name: /^wallet$/i })).toBeVisible({ timeout: 10_000 });
}

/** Likewise the plan screen — reached through Profile, and titled "Plan", singular. */
async function openPlan(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: /^profile$/i })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /view plan/i }).click();
  await expect(page.getByRole("heading", { name: /^plan$/i })).toBeVisible({ timeout: 10_000 });
}

test.beforeAll(async ({ browser }) => {
  apiOrigin = await discoverApiOrigin(browser);
});

test.describe("Resident web app — wallet", () => {
  test("positive: a top-up starts a real payment order and the demo checkout takes no money", async ({ page, request }) => {
    test.setTimeout(90_000);
    const who = await signUpNewResident(request);
    await signIn(page, who);
    await openWallet(page);

    await expect(balanceAmount(page)).toHaveText("₹0.00");
    // Said before the resident presses anything, not after. Somebody about to hand
    // over ₹500 is owed the fact that this build cannot take it.
    await expect(page.getByText(/demo mode/i)).toBeVisible();

    await page.getByRole("button", { name: /add ₹500/i }).click();
    const checkout = page.getByRole("dialog", { name: /not a real payment page/i });
    await expect(checkout).toBeVisible({ timeout: 15_000 });
    await expect(checkout.getByText(/demo checkout/i)).toBeVisible();
    await expect(checkout.getByText("₹500")).toBeVisible();

    // The payment order behind it is genuine — the backend created it and recorded a
    // pending intent against it — and the dialog shows which one, so the claim can be
    // checked rather than taken on trust. The next test settles this same order.
    const providerOrderId = ((await checkout.getByText("Payment order")
      .locator("xpath=following-sibling::dd[1]").textContent()) ?? "").trim();
    expect(providerOrderId).not.toBe("");

    // There is deliberately no way to pay here. A button that looked like it took ₹500
    // and credited nothing would be worse than no button at all, so the only control
    // in the dialog is the one that closes it.
    await expect(checkout.getByRole("button")).toHaveCount(1);
    await expect(checkout.getByRole("button", { name: /^close$/i })).toBeVisible();
    await expect(checkout.getByRole("button", { name: /pay|confirm|continue/i })).toHaveCount(0);

    await checkout.getByRole("button", { name: /^close$/i }).click();
    await expect(checkout).toHaveCount(0);
    await expect(page.getByText(/no payment was taken and your balance is unchanged/i)).toBeVisible();

    // The balance is what it was, and stays what it was once the screen has been read
    // back from the backend rather than from React state.
    await expect(balanceAmount(page)).toHaveText("₹0.00");
    await page.reload();
    await openWallet(page);
    await expect(balanceAmount(page)).toHaveText("₹0.00");
  });

  test("positive: the wallet is credited only once the gateway settles the payment order", async ({ page, request }) => {
    test.setTimeout(90_000);
    const who = await signUpNewResident(request);
    await signIn(page, who);
    await openWallet(page);
    await expect(balanceAmount(page)).toHaveText("₹0.00");

    await page.getByRole("button", { name: /add ₹1,000|add ₹1000/i }).click();
    const checkout = page.getByRole("dialog", { name: /not a real payment page/i });
    await expect(checkout).toBeVisible({ timeout: 15_000 });
    const providerOrderId = ((await checkout.getByText("Payment order")
      .locator("xpath=following-sibling::dd[1]").textContent()) ?? "").trim();
    await checkout.getByRole("button", { name: /^close$/i }).click();
    await expect(balanceAmount(page)).toHaveText("₹0.00");

    // The other half of the seam: the money arrives when the gateway says it did, and
    // only then. If this ever stops crediting, a resident who really paid is left with
    // an order the platform took and a balance that never moved.
    await settlePaymentOrder(request, { providerOrderId, residentId: who.residentId, amountPaise: 100000 });

    await page.reload();
    await openWallet(page);
    await expect(balanceAmount(page)).toHaveText("₹1000.00");
    // And the credit is on the statement, not just on the headline figure.
    await expect(page.getByText(providerOrderId)).toBeVisible();
    await expect(page.getByText("+₹1,000", { exact: true })).toBeVisible();

    // Replaying the same settlement must not pay the resident twice.
    const replayBody = JSON.stringify({
      event: "payment.captured",
      payload: { providerOrderId, residentId: who.residentId, amountPaise: 100000, method: "upi" },
    });
    const replay = await request.post(`${apiOrigin}/v1/payments/webhook`, {
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: createHmac("sha256", WEBHOOK_SECRET).update(replayBody).digest("hex") },
      data: replayBody,
    });
    expect((await replay.json()).status).toBe("duplicate_ignored");
    await page.reload();
    await openWallet(page);
    await expect(balanceAmount(page)).toHaveText("₹1000.00");
  });
});

test.describe("Resident web app — plans", () => {
  test("positive: the plans on offer are the ones the backend serves, at the prices it serves them", async ({ page, request }) => {
    test.setTimeout(90_000);
    const who = await signUpNewResident(request);
    await signIn(page, who);
    await openPlan(page);

    // Compared against the API rather than against prices typed into this file. The
    // marketing site once carried invented tiers that no backend plan matched, and a
    // spec that hardcodes a number is how that survives: it agrees with the guess.
    const res = await request.get(`${apiOrigin}/v1/resident/subscription`, {
      headers: { authorization: `Bearer ${who.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const plans = (await res.json()).availablePlans as { name: string; monthlyPaise: number; garmentCap: number }[];
    expect(plans.length, "No plans configured — the plan screen has nothing to show").toBeGreaterThan(0);

    for (const plan of plans) {
      const card = page.locator("div").filter({ hasText: new RegExp(`^${plan.name}`) }).last();
      await expect(card).toBeVisible();
      await expect(card.getByText(`${plan.garmentCap} garments / month`)).toBeVisible();
      // The digits, not the formatting: this asserts the card shows the backend's own
      // price rather than that Intl grouped it a particular way.
      const shown = (await card.getByText(/^₹[\d,.]+\s*\/\s*month$/).first().textContent()) ?? "";
      expect(Number(shown.replace(/[^0-9.]/g, "")), `${plan.name} is priced wrongly on screen`)
        .toBeCloseTo(plan.monthlyPaise / 100, 2);
    }
    // Every plan is offered to a resident who has none, and none is marked current.
    await expect(page.getByRole("button", { name: /^choose plan$/i })).toHaveCount(plans.length);
    await expect(page.getByText(/^current plan$/i)).toHaveCount(0);
  });

  test("negative: subscribing with an empty wallet surfaces a clear top-up message, not a raw error", async ({ page, request }) => {
    test.setTimeout(90_000);
    const who = await signUpNewResident(request);
    await signIn(page, who);
    await openPlan(page);

    const choose = page.getByRole("button", { name: /^choose plan$/i });
    await expect(choose.first()).toBeVisible({ timeout: 10_000 });
    await choose.first().click();

    // A resident who cannot afford a plan is being asked for money, not shown a fault.
    // The 402 the backend returns has to arrive as a sentence that says what to do
    // next; "Request failed (402)" or an exception dump is the failure this guards.
    const note = page.locator("p[role=status], p[role=alert]").filter({ hasText: /wallet|balance|top ?up|add money/i }).first();
    await expect(note).toBeVisible({ timeout: 10_000 });
    const text = (await note.textContent()) ?? "";
    expect(text).toMatch(/not enough wallet balance/i);
    expect(text).not.toMatch(/\[object|undefined|NaN|Error:|failed \(\d+\)/i);

    // And nothing was bought on credit: no plan, and the wallet is untouched.
    await expect(page.getByText(/^current plan$/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^choose plan$/i }).first()).toBeVisible();
    await openWallet(page);
    await expect(balanceAmount(page)).toHaveText("₹0.00");
  });
});
