import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, bearer, loginResident, loginSupervisor, loginOperator } from "./helpers";
import { MAX_BYTES, MAX_PER_TICKET } from "../../src/domain/attachments";

// A photograph on a support ticket, and who is allowed to look at it.
//
// The second half is the part worth testing hardest. A photograph of somebody's
// laundry is exactly as private as the complaint it belongs to, so it is held to the
// ticket's own visibility rule and served through a route that asks who you are —
// rather than from a path that anybody holding the link could read.

const photo = (bytes = 64) => Buffer.alloc(bytes, 7).toString("base64");

describe("attaching a photograph to a ticket", () => {
  let app: Awaited<ReturnType<typeof makeTestApp>>["app"];
  let container: Awaited<ReturnType<typeof makeTestApp>>["container"];
  let resident: string;
  let ticketId: string;

  beforeEach(async () => {
    ({ app, container } = await makeTestApp());
    resident = await loginResident(app);
    const made = await app.inject({
      method: "POST", url: "/v1/support/tickets", headers: bearer(resident),
      payload: JSON.stringify({ category: "damaged_garment", description: "Tear in the sleeve" }),
    });
    ticketId = made.json().ticket.id;
  });

  const attach = (body: Record<string, unknown>, token = resident) => app.inject({
    method: "POST", url: `/v1/support/tickets/${ticketId}/attachments`, headers: bearer(token),
    payload: JSON.stringify(body),
  });

  it("takes a photograph and says what it kept", async () => {
    const res = await attach({ filename: "sleeve.jpg", contentType: "image/jpeg", data: photo() });
    expect(res.statusCode).toBe(201);
    expect(res.json().attachment).toMatchObject({ filename: "sleeve.jpg", contentType: "image/jpeg", sizeBytes: 64 });
  });

  it("never sends the bytes back in the metadata", async () => {
    // Five photographs in a list should not weigh five photographs.
    const res = await attach({ data: photo() });
    expect(res.json().attachment.data).toBeUndefined();
  });

  it("takes the type from a data URL, because that is what a browser sends", async () => {
    const res = await attach({ data: `data:image/png;base64,${photo()}`, contentType: "image/jpeg" });
    expect(res.statusCode).toBe(201);
    expect(res.json().attachment.contentType).toBe("image/png");
  });

  it("stores the bytes without the data URL prefix", async () => {
    // Keeping the prefix would corrupt every file by exactly its own length.
    await attach({ data: `data:image/png;base64,${photo()}` });
    const held = (await container.store.attachments.all())[0];
    expect(held.data.startsWith("data:")).toBe(false);
    expect(Buffer.from(held.data, "base64")).toHaveLength(64);
  });

  it("refuses a file that is not a photograph", async () => {
    const res = await attach({ contentType: "application/pdf", data: photo() });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("attachment_refused");
  });

  it("refuses one over the size cap, measured rather than declared", async () => {
    // The size is worked out from the data, so a client under-reporting it does not
    // get past the cap.
    const res = await attach({ data: photo(MAX_BYTES + 1) });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/2 MB/);
  });

  it("refuses something that is not base64 at all", async () => {
    // Characters base64 cannot contain. A string of plain letters happens to be
    // decodable and is refused later, on its size or its type, rather than here.
    expect((await attach({ data: "not a photo!! ***" })).statusCode).toBe(400);
  });

  it("stops at five to a ticket", async () => {
    for (let i = 0; i < MAX_PER_TICKET; i += 1) {
      expect((await attach({ data: photo() })).statusCode, `photo ${i + 1}`).toBe(201);
    }
    expect((await attach({ data: photo() })).statusCode).toBe(422);
  });

  it("lists them oldest first, without the bytes", async () => {
    await attach({ filename: "one.jpg", data: photo() });
    await attach({ filename: "two.jpg", data: photo() });
    const listed = await app.inject({
      method: "GET", url: `/v1/support/tickets/${ticketId}/attachments`, headers: bearer(resident),
    });
    const names = (listed.json().attachments as { filename: string; data?: string }[]);
    expect(names.map((a) => a.filename)).toEqual(["one.jpg", "two.jpg"]);
    expect(names.every((a) => a.data === undefined)).toBe(true);
  });

  it("serves the bytes back with the right content type", async () => {
    const made = await attach({ contentType: "image/png", data: photo() });
    const id = made.json().attachment.id;
    const served = await app.inject({
      method: "GET", url: `/v1/support/attachments/${id}`, headers: bearer(resident),
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(served.rawPayload).toHaveLength(64);
  });

  it("refuses to serve a photograph to somebody with no session", async () => {
    const made = await attach({ data: photo() });
    const served = await app.inject({ method: "GET", url: `/v1/support/attachments/${made.json().attachment.id}` });
    expect(served.statusCode).toBe(401);
  });

  it("refuses to serve one to a person the ticket is not open to", async () => {
    // The heart of it. An operator from another society holds a perfectly good
    // session, and the photograph is still not theirs to look at.
    const made = await attach({ data: photo() });
    const outsider = await loginOperator(app, "9876500003");
    const served = await app.inject({
      method: "GET", url: `/v1/support/attachments/${made.json().attachment.id}`,
      headers: bearer(outsider),
    });
    expect([403, 404]).toContain(served.statusCode);
  });

  it("lets the supervisor who works the ticket see it", async () => {
    const made = await attach({ data: photo() });
    const supervisor = await loginSupervisor(app);
    const served = await app.inject({
      method: "GET", url: `/v1/support/attachments/${made.json().attachment.id}`,
      headers: bearer(supervisor),
    });
    expect(served.statusCode).toBe(200);
  });

  it("lets the person who attached it take it back down", async () => {
    const made = await attach({ data: photo() });
    const id = made.json().attachment.id;
    expect((await app.inject({
      method: "DELETE", url: `/v1/support/attachments/${id}`, headers: bearer(resident),
    })).statusCode).toBe(204);
    expect(await container.store.attachments.get(id)).toBeNull();
  });

  it("actually removes the bytes rather than hiding the row", async () => {
    // Almost nothing here is deleted, because a record is history. A photograph
    // somebody asked to remove has no history in it worth keeping, and leaving the
    // bytes behind is the wrong answer to a privacy question.
    const made = await attach({ data: photo() });
    await app.inject({
      method: "DELETE", url: `/v1/support/attachments/${made.json().attachment.id}`, headers: bearer(resident),
    });
    expect(await container.store.attachments.all()).toHaveLength(0);
  });

  it("frees a place when one is removed", async () => {
    for (let i = 0; i < MAX_PER_TICKET; i += 1) await attach({ data: photo() });
    const listed = await app.inject({
      method: "GET", url: `/v1/support/tickets/${ticketId}/attachments`, headers: bearer(resident),
    });
    const first = listed.json().attachments[0].id;
    await app.inject({ method: "DELETE", url: `/v1/support/attachments/${first}`, headers: bearer(resident) });
    expect((await attach({ data: photo() })).statusCode).toBe(201);
  });

  it("will not let one resident attach to another's ticket", async () => {
    const outsider = await loginOperator(app, "9876500003");
    expect((await attach({ data: photo() }, outsider)).statusCode).toBe(403);
  });
});
