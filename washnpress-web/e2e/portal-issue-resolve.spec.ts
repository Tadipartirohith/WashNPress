import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { DEMO_PHONES, clearAuth } from "./helpers";

// I-111: resolving a support ticket, in all three portals that can.
//
// It was broken three different ways. The operator's Resolved button returned early
// and in silence when the note beside it was empty, so pressing it did nothing at
// all and looked like a dead control. The supervisor resolved from a status dropdown
// that sent no note, so the backend filed the literal word "Resolved" as what had
// been done. The admin's dialog simply disabled its button, which says "broken"
// rather than "type the note". None of the three stopped a double click from sending
// two requests.
//
// Each test seeds its own ticket, because resolving is a one-way transition and a
// shared one would only work for whichever test ran first.

// The backend these specs seed data through. Defaults to the port e2e/README.md starts
// it on; set API_BASE_URL to point elsewhere. It used to default to 8200, a port
// that only ever existed on one throwaway test stack.
const API = process.env.API_BASE_URL ?? "http://localhost:8090";
const NOTE_REQUIRED = "Please enter a resolution note before resolving this issue.";

async function tokenFor(request: APIRequestContext, phone: string): Promise<string> {
  const sent = await request.post(`${API}/v1/auth/otp/send`, { data: { phone } });
  const { otpForTesting } = await sent.json();
  const verified = await request.post(`${API}/v1/auth/otp/verify`, { data: { phone, otp: otpForTesting } });
  return (await verified.json()).token;
}

/** Raises one ticket as the demo resident. Its description is unique to this run. */
async function seedTicket(request: APIRequestContext, category: string): Promise<{ id: string; description: string }> {
  const token = await tokenFor(request, DEMO_PHONES.resident);
  const description = `E2E resolve probe ${category} ${Date.now()}`;
  const created = await request.post(`${API}/v1/support/tickets`, {
    headers: { authorization: `Bearer ${token}` },
    data: { category, description, priority: "normal" },
  });
  expect(created.ok(), `could not seed a ticket: ${await created.text()}`).toBeTruthy();
  return { id: (await created.json()).ticket.id as string, description };
}

async function ticketStatus(request: APIRequestContext, id: string): Promise<string> {
  const token = await tokenFor(request, DEMO_PHONES.admin);
  const res = await request.get(`${API}/v1/admin/issues/${id}`, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()).issue.status as string;
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

/** Counts the resolve requests the page actually sends, for the double-click test. */
function countStatusPatches(page: Page): () => number {
  let n = 0;
  page.on("request", (r) => { if (r.method() === "PATCH" && /\/issues\/[^/]+\/status$/.test(r.url())) n += 1; });
  return () => n;
}

test.describe("I-111 · admin", () => {
  test("an empty note is refused in words, and the API is never called", async ({ page, request }) => {
    const ticket = await seedTicket(request, "general_query");
    await loginStaff(page, "admin", DEMO_PHONES.admin);
    await page.getByRole("navigation").getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByPlaceholder(/search by id/i).fill(ticket.description);

    const row = page.getByRole("button", { name: new RegExp(ticket.description.slice(0, 30)) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const patches = countStatusPatches(page);
    await page.getByRole("button", { name: /^resolve$/i }).click();
    const dialog = page.getByRole("dialog", { name: /resolve issue/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // The button is pressable — the refusal is a sentence, not a control that cannot
    // be operated and never says why.
    await dialog.getByRole("button", { name: /^resolve$/i }).click();
    await expect(dialog.getByText(NOTE_REQUIRED)).toBeVisible();
    expect(patches(), "an empty note must not reach the API").toBe(0);
    expect(await ticketStatus(request, ticket.id)).toBe("open");
  });

  test("a note resolves it, the list updates, and it is still resolved after a reload", async ({ page, request }) => {
    const ticket = await seedTicket(request, "general_query");
    await loginStaff(page, "admin", DEMO_PHONES.admin);
    await page.getByRole("navigation").getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByPlaceholder(/search by id/i).fill(ticket.description);

    const row = page.getByRole("button", { name: new RegExp(ticket.description.slice(0, 30)) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const patches = countStatusPatches(page);
    await page.getByRole("button", { name: /^resolve$/i }).click();
    const dialog = page.getByRole("dialog", { name: /resolve issue/i });
    await dialog.getByLabel(/resolution note/i).fill("Replaced the missing shirt and confirmed with the resident.");
    // Twice, fast. `busy` is state, so before this both clicks read it as false and
    // both sent a PATCH — the second against a ticket the first had already moved.
    await dialog.getByRole("button", { name: /^resolve$/i }).dblclick();

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    expect(patches(), "a double click must send one request").toBe(1);

    // The badge in the list, immediately.
    await expect(row).toContainText(/resolved/i, { timeout: 15_000 });

    // And it stuck: the ticket itself says so, and so does the list after a reload.
    expect(await ticketStatus(request, ticket.id)).toBe("resolved");
    await page.reload();
    await page.getByRole("navigation").getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByPlaceholder(/search by id/i).fill(ticket.description);
    await expect(page.getByRole("button", { name: new RegExp(ticket.description.slice(0, 30)) }))
      .toContainText(/resolved/i, { timeout: 15_000 });
  });

  test("a refusal from the server is shown in the server's own words", async ({ page, request }) => {
    const ticket = await seedTicket(request, "general_query");
    await loginStaff(page, "admin", DEMO_PHONES.admin);
    await page.getByRole("navigation").getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByPlaceholder(/search by id/i).fill(ticket.description);
    const row = page.getByRole("button", { name: new RegExp(ticket.description.slice(0, 30)) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // A conflict the backend really can return — a ticket somebody else closed while
    // this drawer was open. The admin must be told that, not "Invalid request".
    await page.route(/\/issues\/[^/]+\/status$/, (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "illegal_ticket_transition", message: "This ticket is already closed." }),
    }));

    await page.getByRole("button", { name: /^resolve$/i }).click();
    const dialog = page.getByRole("dialog", { name: /resolve issue/i });
    await dialog.getByLabel(/resolution note/i).fill("Spoke to the resident.");
    await dialog.getByRole("button", { name: /^resolve$/i }).click();

    await expect(dialog.getByText("This ticket is already closed.")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/invalid request/i)).toHaveCount(0);
  });
});

test.describe("I-111 · supervisor", () => {
  test("resolving from the status dropdown asks for a note and saves it", async ({ page, request }) => {
    const ticket = await seedTicket(request, "equipment_issue");
    await loginStaff(page, "supervisor", DEMO_PHONES.supervisor);
    await page.getByRole("button", { name: "Issues", exact: true }).click();

    // The supervisor's list shows the category, not the description, and equal
    // priorities come back oldest first — so the ticket just seeded is the last row
    // of its kind. The drawer's own description is checked below, which is what
    // actually proves the row handed over the right id.
    const rows = page.getByRole("button", { name: /equipment issue/i });
    await expect(rows.last()).toBeVisible({ timeout: 15_000 });
    await rows.last().click();

    const drawer = page.getByRole("dialog", { name: /equipment issue/i });
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText(ticket.description)).toBeVisible();

    const patches = countStatusPatches(page);
    await drawer.getByLabel(/^status/i).selectOption("resolved");

    const dialog = page.getByRole("dialog", { name: /resolve issue/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // The dropdown used to PATCH straight through with no note at all.
    await dialog.getByRole("button", { name: /^resolve$/i }).click();
    await expect(dialog.getByText(NOTE_REQUIRED)).toBeVisible();
    expect(patches()).toBe(0);

    await dialog.getByLabel(/resolution note/i).fill("Machine repaired; the batch was rewashed.");
    await dialog.getByRole("button", { name: /^resolve$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    expect(await ticketStatus(request, ticket.id)).toBe("resolved");
    // The note is what was typed, not the word the backend falls back to.
    const token = await tokenFor(request, DEMO_PHONES.admin);
    const after = await request.get(`${API}/v1/admin/issues/${ticket.id}`, { headers: { authorization: `Bearer ${token}` } });
    const issue = (await after.json()).issue;
    expect(issue.resolution).toContain("Machine repaired");
    expect(issue.resolvedAt).toBeTruthy();
  });
});

test.describe("I-111 · operations", () => {
  test("the Resolved button opens a dialog instead of doing nothing", async ({ page, request }) => {
    const ticket = await seedTicket(request, "slot_issue");
    await loginStaff(page, "operations", DEMO_PHONES.operations);
    await page.getByRole("navigation").getByRole("button", { name: /^Issues( \d+)?$/ }).click();

    const rows = page.getByRole("row").filter({ hasText: /slot issue/i });
    await expect(rows.last()).toBeVisible({ timeout: 15_000 });
    await rows.last().getByRole("button", { name: /^open$/i }).click();

    const drawer = page.getByRole("dialog", { name: /slot issue/i });
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText(ticket.description)).toBeVisible();

    const patches = countStatusPatches(page);
    await drawer.getByRole("button", { name: /^resolved$/i }).click();
    const dialog = page.getByRole("dialog", { name: /resolve issue/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole("button", { name: /^resolve$/i }).click();
    await expect(dialog.getByText(NOTE_REQUIRED)).toBeVisible();
    expect(patches()).toBe(0);

    await dialog.getByLabel(/resolution note/i).fill("Rebooked the resident into the afternoon slot.");
    await dialog.getByRole("button", { name: /^resolve$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    expect(await ticketStatus(request, ticket.id)).toBe("resolved");
  });
});
