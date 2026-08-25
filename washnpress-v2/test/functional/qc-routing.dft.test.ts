import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, bearer, loginOperator, loginResident, loginSupervisor, openSlotNow } from "./helpers";

// A QC failure used to mean one thing: redo the last step before the check. QC is a
// checkpoint, not a reason to restart the order — and an order does not become ready
// for delivery because one of its batches finished.

async function pickedUpOrder(slotId: string) {
  const { app, container } = await makeTestApp();
  await seedSlot(container, slotId, 5);
  const residentToken = await loginResident(app);
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
    payload: JSON.stringify({
      slotId,
      lines: [
        { category: "Shirts", quantity: 4, serviceId: "wash_iron", measuredQuantity: 3 },
        { category: "T-Shirts", quantity: 4, serviceId: "iron_only" },
      ],
    }),
  });
  expect(booked.statusCode).toBe(201);
  const orderId = booked.json().order.id as string;

  const operatorToken = await loginOperator(app);
  await openSlotNow(container, slotId);
  const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
  const lines = detail.json().order.lines as Array<{ id: string; quantity: number; serviceName: string }>;
  const picked = await app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
    payload: JSON.stringify({
      lines: lines.map((l) => ({
        lineId: l.id, acceptedQuantity: l.quantity,
        ...(l.serviceName === "Wash and Iron" ? { acceptedMeasuredQuantity: 3 } : {}),
      })),
    }),
  });
  expect(picked.statusCode).toBe(200);
  const batches = (await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}/batches`, headers: bearer(operatorToken) })).json().batches;
  return { app, container, orderId, operatorToken, residentToken, batches };
}

function advance(app: Awaited<ReturnType<typeof makeTestApp>>["app"], orderId: string, batchId: string, step: string, token: string) {
  return app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batchId}/advance`,
    headers: bearer(token), payload: JSON.stringify({ step }),
  });
}

function qc(app: Awaited<ReturnType<typeof makeTestApp>>["app"], orderId: string, batchId: string, body: unknown, token: string) {
  return app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batchId}/qc`,
    headers: bearer(token), payload: JSON.stringify(body),
  });
}

describe("DFT a QC failure says why, and the why decides where the work goes", () => {
  it("offers the reasons rather than making the client keep a list", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/operations/qc-reasons", headers: bearer(await loginOperator(app)) });
    expect(res.statusCode).toBe(200);
    const reasons = res.json().reasons as Array<{ key: string; label: string; evidenceRequired: boolean; serious: boolean }>;
    expect(reasons.length).toBeGreaterThan(5);
    expect(reasons.find((r) => r.key === "garment_damage")).toMatchObject({ evidenceRequired: true, serious: true });
    expect(reasons.find((r) => r.key === "poor_ironing")).toMatchObject({ evidenceRequired: false, serious: false });
  });

  it("refuses a failure that does not say what went wrong", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-qc-1");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);

    const noReason = await qc(app, orderId, washIron.id, { passed: false }, operatorToken);
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().error).toBe("qc_failure_incomplete");

    const noRemarks = await qc(app, orderId, washIron.id, { passed: false, reason: "poor_ironing" }, operatorToken);
    expect(noRemarks.statusCode).toBe(400);
    expect((noRemarks.json().problems as string[]).join(" ")).toMatch(/what went wrong/);
  });

  it("insists on a photograph where the failure is a claim about the garment", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-qc-2");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);

    const noPhoto = await qc(app, orderId, washIron.id, {
      passed: false, reason: "garment_damage", remarks: "Small tear at the cuff",
    }, operatorToken);
    expect(noPhoto.statusCode).toBe(400);
    expect((noPhoto.json().problems as string[]).join(" ")).toMatch(/photograph/);

    const withPhoto = await qc(app, orderId, washIron.id, {
      passed: false, reason: "garment_damage", remarks: "Small tear at the cuff", evidenceUrl: "photo.jpg",
    }, operatorToken);
    expect(withPhoto.statusCode).toBe(200);
  });

  it("sends a washing fault back to the wash and an ironing fault back to the iron", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-qc-3");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);

    const stained = await qc(app, orderId, washIron.id, {
      passed: false, reason: "stain_not_removed", remarks: "Collar still marked",
    }, operatorToken);
    let shown = (stained.json().batches as Array<{ id: string; currentStep: string }>).find((b) => b.id === washIron.id)!;
    // Back to the wash, not to the iron merely because ironing came last.
    expect(shown.currentStep).toBe("wash");

    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);
    const creased = await qc(app, orderId, washIron.id, {
      passed: false, reason: "poor_ironing", remarks: "Still creased at the collar",
    }, operatorToken);
    shown = (creased.json().batches as Array<{ id: string; currentStep: string }>).find((b) => b.id === washIron.id)!;
    // This one does not go through the wash again.
    expect(shown.currentStep).toBe("iron");
  });

  it("holds a missing garment rather than sending it back to a machine", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-qc-4");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);

    const res = await qc(app, orderId, washIron.id, {
      passed: false, reason: "missing_garment", remarks: "Only 3 of the 4 shirts are in the bag", evidenceUrl: "photo.jpg",
    }, operatorToken);
    expect(res.statusCode).toBe(200);
    const shown = (res.json().batches as Array<{ id: string; status: string; heldFor: string | null; currentStep: string }>)
      .find((b) => b.id === washIron.id)!;
    expect(shown.status).toBe("held");
    expect(shown.heldFor).toBe("investigation");
    // Nothing was undone, because nothing in a machine will produce a garment that is
    // not there.
    expect(shown.currentStep).toBe("qc");
    // And the order is on hold rather than carrying on around it.
    expect(res.json().order.state).toBe("qc_hold");
  });

  it("keeps every failed attempt rather than overwriting the last", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-qc-5");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);
    await qc(app, orderId, washIron.id, { passed: false, reason: "stain_not_removed", remarks: "Marked" }, operatorToken);
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    const second = await qc(app, orderId, washIron.id, { passed: false, reason: "stain_not_removed", remarks: "Still marked" }, operatorToken);

    const shown = (second.json().batches as Array<{ id: string; qcFailures: Array<{ attempt: number; remarks: string }> }>)
      .find((b) => b.id === washIron.id)!;
    // "Failed twice" is a different fact from "failed", and the second one is the one
    // a supervisor needs.
    expect(shown.qcFailures).toHaveLength(2);
    expect(shown.qcFailures.map((f) => f.remarks)).toEqual(["Marked", "Still marked"]);
  });

  it("tells the resident about a serious failure and not about a minor one", async () => {
    const { app, orderId, operatorToken, residentToken, batches } = await pickedUpOrder("slot-qc-6");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);

    // A shirt needing another pass of the iron is not news.
    await qc(app, orderId, washIron.id, { passed: false, reason: "poor_ironing", remarks: "Creased" }, operatorToken);
    let alerts = await app.inject({ method: "GET", url: "/v1/resident/notifications", headers: bearer(residentToken) });
    expect((alerts.json().notifications as Array<{ type: string }>).some((n) => n.type === "qc.failed")).toBe(false);

    await advance(app, orderId, washIron.id, "iron", operatorToken);
    await qc(app, orderId, washIron.id, {
      passed: false, reason: "garment_damage", remarks: "Small tear at the cuff", evidenceUrl: "photo.jpg",
    }, operatorToken);
    alerts = await app.inject({ method: "GET", url: "/v1/resident/notifications", headers: bearer(residentToken) });
    expect((alerts.json().notifications as Array<{ type: string }>).some((n) => n.type === "qc.failed")).toBe(true);
  });

  it("tells a supervisor when a batch keeps failing", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-qc-7");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);
    await qc(app, orderId, washIron.id, { passed: false, reason: "poor_ironing", remarks: "Creased" }, operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);
    await qc(app, orderId, washIron.id, { passed: false, reason: "poor_ironing", remarks: "Still creased" }, operatorToken);

    const supervisorToken = await loginSupervisor(app);
    const alerts = await app.inject({ method: "GET", url: "/v1/resident/notifications", headers: bearer(supervisorToken) });
    const qcAlerts = (alerts.json().notifications as Array<{ type: string; title: string }>).filter((n) => n.type === "qc.failed");
    // Repeated failures are a different problem from a first one.
    expect(qcAlerts.some((n) => n.title.includes("2 times"))).toBe(true);
  });
});

describe("DFT the order advances when every batch is done, and not before", () => {
  it("stays in processing while one batch is still going", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-auto-1");
    const list = batches as { id: string; sequence: string[] }[];
    const washIron = list.find((b) => b.sequence[0] === "wash")!;
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);
    const res = await qc(app, orderId, washIron.id, { passed: true }, operatorToken);
    // One batch finishing is not an order finishing.
    expect(res.json().order.state).not.toBe("ready_for_delivery");
  });

  it("moves to ready for delivery the moment the last batch passes, without being asked", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-auto-2");
    const list = batches as { id: string; sequence: string[] }[];
    for (const batch of list) {
      for (const step of batch.sequence.filter((s) => s !== "qc")) {
        await advance(app, orderId, batch.id, step, operatorToken);
      }
    }
    let last;
    for (const batch of list) {
      last = await qc(app, orderId, batch.id, { passed: true }, operatorToken);
    }
    expect(last!.json().order.state).toBe("ready_for_delivery");
    // And says so in its own words rather than leaving somebody to work it out.
    const timeline = last!.json().order.timeline as Array<{ state: string; note: string }>;
    expect(timeline[timeline.length - 1].note).toMatch(/all \d+ batches completed/);
  });

  it("keeps the order on hold while a batch is held for a person", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-auto-3");
    const list = batches as { id: string; sequence: string[] }[];
    const ironOnly = list.find((b) => b.sequence[0] === "iron")!;
    const washIron = list.find((b) => b.sequence[0] === "wash")!;

    // Finish one batch entirely.
    await advance(app, orderId, ironOnly.id, "iron", operatorToken);
    await qc(app, orderId, ironOnly.id, { passed: true }, operatorToken);

    // And hold the other.
    await advance(app, orderId, washIron.id, "wash", operatorToken);
    await advance(app, orderId, washIron.id, "iron", operatorToken);
    const res = await qc(app, orderId, washIron.id, {
      passed: false, reason: "wrong_garment", remarks: "These are not the resident's shirts", evidenceUrl: "photo.jpg",
    }, operatorToken);
    expect(res.json().order.state).toBe("qc_hold");
  });
});

describe("DFT an order that is worked as batches says so", () => {
  it("publishes its batch count, so reopening it shows the same processing view", async () => {
    const { app, orderId, operatorToken } = await pickedUpOrder("slot-view-1");
    const active = await app.inject({ method: "GET", url: "/v1/operations/active", headers: bearer(operatorToken) });
    const rows = [
      ...(active.json().pickedUp as Array<{ id: string; batchCount: number }>),
      ...(active.json().processing as Array<{ id: string; batchCount: number }> ?? []),
    ];
    const row = rows.find((o) => o.id === orderId)!;
    // An order that has batches is a batch-wise order for good: a screen cannot know
    // that without being told, which is how reopening one showed a generic timeline.
    expect(row.batchCount).toBe(2);
    expect(row).toHaveProperty("batchesCompleted", 0);
  });
});
