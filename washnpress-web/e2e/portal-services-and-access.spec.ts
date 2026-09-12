import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

// The backend these specs seed data through. Defaults to the port e2e/README.md starts
// it on; set API_BASE_URL to point elsewhere. It used to default to 8200, a port
// that only ever existed on one throwaway test stack.
const API = process.env.API_BASE_URL ?? "http://localhost:8090";

/** A bearer token for a demo number, straight from the OTP endpoints. */
async function tokenFor(request: APIRequestContext, phone: string): Promise<string> {
  const sent = await request.post(`${API}/v1/auth/otp/send`, { data: { phone } });
  const { otpForTesting } = await sent.json();
  const verified = await request.post(`${API}/v1/auth/otp/verify`, { data: { phone, otp: otpForTesting } });
  return (await verified.json()).token;
}

// I-107 (no Duplicate on a service) and I-108 (no verification gate in front of a
// staff portal). Both are about something that must NOT be on the screen, which is
// exactly the kind of fix that quietly comes back, so both are pinned here.

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

test.describe("I-107 · Services have no Duplicate action", () => {
  test("a service row offers Edit and Deactivate, and nothing that copies it", async ({ page }) => {
    await loginStaff(page, "admin", DEMO_PHONES.admin);
    await page.getByRole("navigation").getByRole("button", { name: "Catalogue", exact: true }).click();
    await page.getByRole("button", { name: "Services", exact: true }).click();

    // Wait for real rows rather than the empty/loading card, so "no Duplicate button"
    // cannot pass simply because nothing had rendered yet.
    const edit = page.getByRole("button", { name: "Edit", exact: true }).first();
    await expect(edit).toBeVisible({ timeout: 15_000 });

    // The two actions a service still has. Duplicate created a second, inactive copy
    // of a priced service — a near-identical row an operator could charge against by
    // accident — and is gone from every service record.
    await expect(page.getByRole("button", { name: /^(deactivate|activate)$/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /duplicate/i })).toHaveCount(0);
  });
});

test.describe("I-108 · no verification gate in front of a staff portal", () => {
  // A newly created supervisor or operator used to authenticate successfully and
  // then be held on a "Pending verification" screen with a Check again button until
  // somebody approved them. Signing in now lands in the portal itself.
  for (const [portal, phone, navLabel] of [
    ["admin", DEMO_PHONES.admin, "Admin"],
    ["supervisor", DEMO_PHONES.supervisor, "Supervisor"],
    ["operations", DEMO_PHONES.operations, "Operations"],
  ] as const) {
    test(`${portal}: a successful sign-in goes straight to the portal`, async ({ page }) => {
      await loginStaff(page, portal, phone);

      // The portal shell's own left nav — it exists only once the authed screen has
      // rendered, so this is "you are in", not merely "you are not on the login page".
      await expect(page.getByRole("navigation", { name: navLabel })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/pending verification/i)).toHaveCount(0);
      await expect(page.getByText(/access not approved/i)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /check again/i })).toHaveCount(0);
    });
  }

  test("a brand new operator is not held on a gate screen", async ({ page, request }) => {
    // The case the issue is actually about. An operator a supervisor created minutes
    // ago has never been approved by anybody, and that is precisely who used to hit
    // the wall: a full-screen "Pending verification" with a Check again button and no
    // way past it. They now reach the portal itself.
    //
    // What they can *do* there is still the backend's call — GET /v1/operations/*
    // continues to refuse an unapproved operator, so panels inside will report that —
    // but the gate in front of the portal is gone.
    const supervisorToken = await tokenFor(request, DEMO_PHONES.supervisor);
    const phone = `9${String(Date.now()).slice(-9)}`;
    const created = await request.post(`${API}/v1/supervisor/operators`, {
      headers: { authorization: `Bearer ${supervisorToken}` },
      data: { firstName: "Gate", lastName: "Probe", phone, email: `gate.probe.${Date.now()}@example.com` },
    });
    expect(created.ok(), `could not create a pending operator: ${await created.text()}`).toBeTruthy();

    await loginStaff(page, "operations", phone);

    await expect(page.getByRole("navigation", { name: "Operations" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /check again/i })).toHaveCount(0);
    await expect(page.getByText(/access not approved/i)).toHaveCount(0);
  });

  test("role still decides which portal a number may open", async ({ page }) => {
    // The gate that went is the verification one. This is the other gate, and it has
    // to be exactly as it was: an operations number is not an admin number, and the
    // admin console must still refuse it.
    await loginStaff(page, "admin", DEMO_PHONES.operations);
    await expect(page.getByText(/wrong account for this portal/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  });
});
