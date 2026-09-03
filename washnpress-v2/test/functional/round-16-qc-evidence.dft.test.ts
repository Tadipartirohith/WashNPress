import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, bearer, loginOperator, loginResident, openSlotNow } from "./helpers";

// A QC failure that is a claim about the garment — it is torn, it is the wrong shirt —
// has to be backed by a photograph. The operator takes it on the spot rather than
// pasting a link: the picture is uploaded with the failure, stored as evidence against
// the order and batch it belongs to, and the failure record points at it so the next
// person sees the reason, the remarks and the photo together.

// A 1x1 PNG, enough to be a real image the store accepts.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function batchAtQc(slotId: string) {
  const { app, container } = await makeTestApp();
  await seedSlot(container, slotId, 5);
  const residentToken = await loginResident(app);
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
    payload: JSON.stringify({ slotId, lines: [{ category: "Shirts", quantity: 2, serviceId: "wash_iron" }] }),
  });
  const orderId = booked.json().order.id as string;
  const operatorToken = await loginOperator(app);
  await openSlotNow(container, slotId);
  const lines = (await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) }))
    .json().order.lines as { id: string; quantity: number }[];
  await app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
    payload: JSON.stringify({ lines: lines.map((l) => ({ lineId: l.id, acceptedQuantity: l.quantity })) }),
  });
  const batchId = (await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}/batches`, headers: bearer(operatorToken) }))
    .json().batches[0].id as string;
  const advance = (step: string) => app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batchId}/advance`,
    headers: bearer(operatorToken), payload: JSON.stringify({ step }),
  });
  await advance("wash");
  await advance("iron");
  return { app, orderId, operatorToken, batchId };
}

const qc = (app: Awaited<ReturnType<typeof makeTestApp>>["app"], orderId: string, batchId: string, body: unknown, token: string) =>
  app.inject({ method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batchId}/qc`, headers: bearer(token), payload: JSON.stringify(body) });

describe("DFT a QC failure carries the photo it needs", () => {
  it("stores an uploaded photo for garment damage and points the failure at it", async () => {
    const { app, orderId, operatorToken, batchId } = await batchAtQc("slot-qcev-1");
    const failed = await qc(app, orderId, batchId, {
      passed: false, reason: "garment_damage", remarks: "Tear at the left cuff",
      evidencePhoto: { filename: "cuff.png", contentType: "image/png", data: PNG },
    }, operatorToken);
    expect(failed.statusCode).toBe(200);
    const batches = failed.json().batches as { id: string; qcFailures?: { remarks: string; evidenceUrl: string | null }[] }[];
    const failure = batches.find((b) => b.id === batchId)!.qcFailures!.at(-1)!;
    expect(failure.remarks).toBe("Tear at the left cuff");
    expect(failure.evidenceUrl).toMatch(/^\/v1\/operations\/qc-evidence\//);

    // The stored photo is served back with an image content type, to the operator on
    // the order, and to nobody without the session.
    const served = await app.inject({ method: "GET", url: failure.evidenceUrl!, headers: bearer(operatorToken) });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/");
    const anon = await app.inject({ method: "GET", url: failure.evidenceUrl! });
    expect(anon.statusCode).toBe(401);
  });

  it("refuses garment damage with neither a photo nor a link", async () => {
    const { app, orderId, operatorToken, batchId } = await batchAtQc("slot-qcev-2");
    const failed = await qc(app, orderId, batchId, {
      passed: false, reason: "garment_damage", remarks: "Tear at the cuff",
    }, operatorToken);
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error).toBe("qc_failure_incomplete");
    expect(failed.json().message).toMatch(/photo/i);
  });

  it("takes remarks alone where the reason is about the work, not the garment", async () => {
    const { app, orderId, operatorToken, batchId } = await batchAtQc("slot-qcev-3");
    const failed = await qc(app, orderId, batchId, {
      passed: false, reason: "stain_not_removed", remarks: "Collar still marked",
    }, operatorToken);
    expect(failed.statusCode).toBe(200);
    const batches = failed.json().batches as { id: string; qcFailures?: { remarks: string; evidenceUrl: string | null }[] }[];
    const failure = batches.find((b) => b.id === batchId)!.qcFailures!.at(-1)!;
    expect(failure.remarks).toBe("Collar still marked");
    expect(failure.evidenceUrl).toBeNull();
  });
});
