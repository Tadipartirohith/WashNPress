import { describe, it, expect } from "vitest";
import {
  makeTestApp, bearer, loginAdmin, loginSupervisor, loginOperator, loginResident,
} from "./helpers";

// An issue is one conversation between a resident, an operator, a supervisor and the
// system — not a list of cards, and not a fixed "Answer the Resident" box that
// anybody could type into however long ago the issue had left them.

async function raise(app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, description = "A shirt is missing") {
  const res = await app.inject({
    method: "POST", url: "/v1/support/tickets", headers: bearer(token),
    payload: JSON.stringify({ category: "missing_garment", description }),
  });
  expect(res.statusCode).toBe(201);
  return res.json().ticket.id as string;
}

function conversation(app: Awaited<ReturnType<typeof makeTestApp>>["app"], id: string, token: string) {
  return app.inject({ method: "GET", url: `/v1/support/tickets/${id}/conversation`, headers: bearer(token) });
}

describe("DFT an issue is a conversation", () => {
  it("puts every message and every system event in one thread, in order", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);

    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/reply`, headers: bearer(operatorToken),
      payload: JSON.stringify({ body: "Coming, wait for 10 minutes" }),
    });
    await app.inject({
      method: "POST", url: `/v1/support/tickets/${id}/reply`, headers: bearer(residentToken),
      payload: JSON.stringify({ body: "Okay, I am waiting" }),
    });
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/escalate`, headers: bearer(operatorToken),
      payload: JSON.stringify({ note: "I cannot settle this" }),
    });

    const res = await conversation(app, id, residentToken);
    expect(res.statusCode).toBe(200);
    const view = res.json().conversation;
    const bodies = (view.messages as Array<{ body: string; system: boolean }>).map((m) => m.body);
    expect(bodies).toEqual([
      "Coming, wait for 10 minutes",
      "Okay, I am waiting",
      "Escalated to supervisor.",
      "I cannot settle this",
    ]);
    // The system event is in the same thread and belongs to nobody.
    expect((view.messages as Array<{ system: boolean }>)[2].system).toBe(true);
    // In the order it happened, always.
    const times = (view.messages as Array<{ at: string }>).map((m) => m.at);
    expect(times).toEqual([...times].sort());
  });

  it("puts each person's own messages on their own side", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/reply`, headers: bearer(operatorToken),
      payload: JSON.stringify({ body: "Checking now" }),
    });
    await app.inject({
      method: "POST", url: `/v1/support/tickets/${id}/reply`, headers: bearer(residentToken),
      payload: JSON.stringify({ body: "Thank you" }),
    });

    const asResident = (await conversation(app, id, residentToken)).json().conversation;
    expect((asResident.messages as Array<{ side: string }>).map((m) => m.side)).toEqual(["theirs", "mine"]);
    const asOperator = (await conversation(app, id, operatorToken)).json().conversation;
    expect((asOperator.messages as Array<{ side: string }>).map((m) => m.side)).toEqual(["mine", "theirs"]);
  });
});

describe("DFT escalation makes the escalator read-only", () => {
  it("keeps the whole conversation and takes away the reply", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const operatorToken = await loginOperator(app);

    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/reply`, headers: bearer(operatorToken),
      payload: JSON.stringify({ body: "I have checked the pickup details" }),
    });
    // Before escalating, the operator may speak.
    expect((await conversation(app, id, operatorToken)).json().conversation.canReply).toBe(true);

    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/escalate`, headers: bearer(operatorToken),
      payload: JSON.stringify({ note: "Escalating this for review" }),
    });

    const after = (await conversation(app, id, operatorToken)).json().conversation;
    expect(after.canReply).toBe(false);
    expect(after.readOnlyReason).toMatch(/currently with the supervisor/);
    // Escalation hides nothing: every message is still there.
    expect((after.messages as unknown[]).length).toBe(3);

    // And the reply itself is refused, not merely hidden by the screen.
    const refused = await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/reply`, headers: bearer(operatorToken),
      payload: JSON.stringify({ body: "One more thing" }),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("conversation_read_only");
  });

  it("lets the supervisor carry on the same thread rather than starting a new one", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/escalate`, headers: bearer(operatorToken),
      payload: JSON.stringify({ note: "Escalating" }),
    });

    const supervisorToken = await loginSupervisor(app);
    const view = (await conversation(app, id, supervisorToken)).json().conversation;
    expect(view.canReply).toBe(true);
    // They see everything that came before.
    expect((view.messages as unknown[]).length).toBe(2);

    const replied = await app.inject({
      method: "POST", url: `/v1/supervisor/issues/${id}/reply`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ body: "I am reviewing the issue" }),
    });
    expect(replied.statusCode).toBe(200);
    // The same thread, one longer.
    expect((await conversation(app, id, residentToken)).json().conversation.messages).toHaveLength(3);
  });

  it("keeps the resident able to speak throughout", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/escalate`, headers: bearer(operatorToken),
      payload: JSON.stringify({ note: "Escalating" }),
    });

    const view = (await conversation(app, id, residentToken)).json().conversation;
    expect(view.canReply).toBe(true);
    // And they are writing to whoever holds it now.
    expect(view.replyLabel).toBe("Reply to Supervisor");
    const sent = await app.inject({
      method: "POST", url: `/v1/support/tickets/${id}/reply`, headers: bearer(residentToken),
      payload: JSON.stringify({ body: "Here is a photo" }),
    });
    expect(sent.statusCode).toBe(200);
  });
});

describe("DFT who a reply is addressed to", () => {
  it("says Reply to Resident for the person answering them", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const operatorToken = await loginOperator(app);
    expect((await conversation(app, id, operatorToken)).json().conversation.replyLabel).toBe("Reply to Resident");
  });

  it("says Reply to Operator when the supervisor is waiting on them", async () => {
    const { app, container } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const ticket = (await container.store.tickets.get(id))!;
    ticket.responsibleRole = "supervisor";
    ticket.status = "waiting_operator";
    await container.store.tickets.put(ticket);

    const supervisorToken = await loginSupervisor(app);
    // "Answer the Resident" was written into the screen, so a supervisor asking their
    // operator for information was told they were answering the resident.
    expect((await conversation(app, id, supervisorToken)).json().conversation.replyLabel).toBe("Reply to Operator");
  });
});

describe("DFT what a list row shows", () => {
  it("shows the last thing said and how much this person has not seen", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/issues/${id}/reply`, headers: bearer(operatorToken),
      payload: JSON.stringify({ body: "Coming, wait for 10 minutes" }),
    });

    const mine = await app.inject({ method: "GET", url: "/v1/support/tickets", headers: bearer(residentToken) });
    const row = (mine.json().tickets as Array<{ id: string; conversation: { preview: string; unreadCount: number } }>)
      .find((t) => t.id === id)!;
    // Not the description they typed when they opened it.
    expect(row.conversation.preview).toBe("Operator: Coming, wait for 10 minutes");
    expect(row.conversation.unreadCount).toBe(1);

    // Reading it clears the count, for that person only.
    await conversation(app, id, residentToken);
    const after = await app.inject({ method: "GET", url: "/v1/support/tickets", headers: bearer(residentToken) });
    const cleared = (after.json().tickets as Array<{ id: string; conversation: { unreadCount: number } }>).find((t) => t.id === id)!;
    expect(cleared.conversation.unreadCount).toBe(0);

    const supervisorToken = await loginSupervisor(app);
    const theirs = await app.inject({ method: "GET", url: "/v1/supervisor/issues", headers: bearer(supervisorToken) });
    const forThem = (theirs.json().issues as Array<{ id: string; conversation: { unreadCount: number } }>).find((t) => t.id === id)!;
    // The resident having read it says nothing about whether the supervisor has.
    expect(forThem.conversation.unreadCount).toBeGreaterThan(0);
  });
});

describe("DFT a resolved issue is read-only history", () => {
  it("stops staff adding to it but lets the resident dispute it", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const supervisorToken = await loginSupervisor(app);
    await app.inject({
      method: "PATCH", url: `/v1/supervisor/issues/${id}/status`, headers: bearer(supervisorToken),
      payload: JSON.stringify({ status: "resolved", resolution: "Found in the next batch" }),
    });

    const staffView = (await conversation(app, id, supervisorToken)).json().conversation;
    expect(staffView.canReply).toBe(false);
    expect(staffView.readOnlyReason).toMatch(/read-only unless the resident reopens it/);

    // The resident disputing it is how it gets reopened.
    const residentView = (await conversation(app, id, residentToken)).json().conversation;
    expect(residentView.canReply).toBe(true);
    const disputed = await app.inject({
      method: "POST", url: `/v1/support/tickets/${id}/reply`, headers: bearer(residentToken),
      payload: JSON.stringify({ body: "It still has not arrived" }),
    });
    expect(disputed.statusCode).toBe(200);
    expect(disputed.json().ticket.status).toBe("in_progress");
  });

  it("closes the conversation to everybody once the issue is closed", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    await app.inject({ method: "POST", url: `/v1/support/tickets/${id}/close`, headers: bearer(residentToken) });

    expect((await conversation(app, id, residentToken)).json().conversation.canReply).toBe(false);
    const adminToken = await loginAdmin(app);
    expect((await conversation(app, id, adminToken)).json().conversation.canReply).toBe(false);
  });
});

describe("DFT the conversation is bound by scope", () => {
  it("refuses somebody the issue has nothing to do with", async () => {
    const { app } = await makeTestApp();
    const residentToken = await loginResident(app);
    const id = await raise(app, residentToken);
    const other = await loginResident(app, "9876543211");
    const res = await conversation(app, id, other);
    expect(res.statusCode).toBe(403);
  });
});
