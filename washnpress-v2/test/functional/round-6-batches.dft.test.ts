import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, bearer, loginResident, loginOperator, openSlotNow,
} from "./helpers";
import { sequenceFor, statusOf, nextStep } from "../../src/domain/batches";
import { lineUnitPricePaise, reconcileLines } from "../../src/domain/pricing";

// Garment + Service is the unit of work, not garment type. Two shirts sent for
// washing and two sent for dry cleaning are two batches: they go through different
// machines, take different times and cost different amounts. This is ISSUE-11,
// ISSUE-12 and ISSUE-23 from the sixth round.

const SPLIT = [
  { category: "Shirts", quantity: 2, serviceId: "wash_iron" },
  { category: "Shirts", quantity: 2, serviceId: "dryclean_iron" },
  { category: "Trousers", quantity: 2, serviceId: "iron_only" },
];

async function bookSplitOrder(slotId: string) {
  const { app, container } = await makeTestApp();
  await seedSlot(container, slotId, 5);
  const residentToken = await loginResident(app);
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
    payload: JSON.stringify({ slotId, lines: SPLIT }),
  });
  expect(booked.statusCode).toBe(201);
  const orderId = booked.json().order.id as string;
  const operatorToken = await loginOperator(app);
  // The slot is booked in the future; collection happens once it has started.
  await openSlotNow(container, slotId);
  const detail = await app.inject({
    method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken),
  });
  const lines = detail.json().order.lines as { id: string; category: string; serviceName: string; quantity: number }[];
  return { app, container, orderId, operatorToken, residentToken, lines };
}

describe("DFT a service decides what its batch goes through", () => {
  it("gives every service the sequence the requirements describe", () => {
    const seq = (requiresClean: boolean, cleanStage: "wash" | "dry_clean" | "premium", requiresPress: boolean) =>
      sequenceFor({ requiresClean, cleanStage, requiresPress });

    expect(seq(true, "wash", true)).toEqual(["wash", "iron", "qc"]);        // Wash & Iron
    expect(seq(true, "wash", false)).toEqual(["wash", "qc"]);               // Wash only
    expect(seq(false, "wash", true)).toEqual(["iron", "qc"]);               // Iron only
    expect(seq(true, "dry_clean", true)).toEqual(["dry_clean", "iron", "qc"]); // Dry Clean & Iron
    expect(seq(true, "premium", true)).toEqual(["premium", "iron", "qc"]);  // Premium Care
  });

  it("derives a batch's status from the steps actually recorded", () => {
    const batch = { sequence: ["wash", "iron", "qc"] as const, completedSteps: [] as string[], qcPassed: null };
    expect(statusOf({ ...batch, completedSteps: [] } as never)).toBe("pending");
    expect(statusOf({ ...batch, completedSteps: ["wash"] } as never)).toBe("in_progress");
    expect(statusOf({ ...batch, completedSteps: ["wash", "iron"] } as never)).toBe("awaiting_qc");
    expect(statusOf({ ...batch, completedSteps: ["wash", "iron", "qc"] } as never)).toBe("completed");
    expect(nextStep({ sequence: ["wash", "iron", "qc"], completedSteps: ["wash"] } as never)).toBe("iron");
  });
});

describe("DFT requested and received are compared per combination", () => {
  it("prices an extra garment at its own combination's rate, not one flat rate", () => {
    // The worked example from the requirements: shirts sent for dry cleaning are
    // charged at the dry cleaning rate, not at the rate a washed shirt costs.
    const lines = [
      { id: "l1", category: "Shirts", serviceId: "wash_iron", serviceName: "Wash & Iron", quantity: 2, serviceUnitPricePaise: 1000 },
      { id: "l2", category: "Shirts", serviceId: "dryclean_iron", serviceName: "Dry Clean & Iron", quantity: 2, serviceUnitPricePaise: 3000 },
    ] as never[];
    const prices = { Shirts: 2000 };

    expect(lineUnitPricePaise(lines[0], prices, 2000)).toBe(3000);
    expect(lineUnitPricePaise(lines[1], prices, 2000)).toBe(5000);

    const accepted = new Map([["l1", 1], ["l2", 3]]);
    const rows = reconcileLines(lines, (l) => accepted.get(l.id) ?? 0, prices, 2000);

    expect(rows[0]).toMatchObject({ requested: 2, actual: 1, difference: -1, status: "short", additionalPaise: 0 });
    expect(rows[1]).toMatchObject({ requested: 2, actual: 3, difference: 1, status: "additional" });
    // One extra dry cleaned shirt at the dry cleaning rate, not at the washing one.
    expect(rows[1].additionalPaise).toBe(5000);
  });

  it("reports each combination separately for the operator to confirm", async () => {
    const { app, orderId, operatorToken, lines } = await bookSplitOrder("slot-batch-1");
    const reconciliation = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/reconcile`, headers: bearer(operatorToken),
      payload: JSON.stringify({
        lines: [
          { lineId: lines[0].id, acceptedQuantity: 1 },
          { lineId: lines[1].id, acceptedQuantity: 3 },
          { lineId: lines[2].id, acceptedQuantity: 2 },
        ],
      }),
    });
    expect(reconciliation.statusCode).toBe(200);
    const rows = reconciliation.json().reconciliation.lines as { status: string; difference: number }[];
    // Three combinations, not two garment types.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.status)).toEqual(["short", "additional", "matched"]);
    expect(rows.map((r) => r.difference)).toEqual([-1, 1, 0]);
    expect(reconciliation.json().reconciliation.requestedTotal).toBe(6);
    expect(reconciliation.json().reconciliation.actualTotal).toBe(6);
  });
});

describe("DFT a pickup cannot be completed without confirming quantities", () => {
  it("refuses a bare category total when the category is split across services", async () => {
    const { app, orderId, operatorToken } = await bookSplitOrder("slot-batch-2");
    // Ten shirts says nothing about which were washed and which were dry cleaned,
    // and guessing is what produced the wrong price and the wrong machine.
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 4 }, { category: "Trousers", quantity: 2 }] }),
    });
    expect(picked.statusCode).toBe(400);
    expect(picked.json().error).toBe("quantity_confirmation_required");
    expect((picked.json().lineIds as string[]).length).toBe(2);
  });

  it("refuses a confirmation that misses a combination", async () => {
    const { app, orderId, operatorToken, lines } = await bookSplitOrder("slot-batch-3");
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ lines: [{ lineId: lines[0].id, acceptedQuantity: 2 }] }),
    });
    expect(picked.statusCode).toBe(400);
    expect(picked.json().error).toBe("quantity_confirmation_required");
  });

  it("refuses a line that is not on the order", async () => {
    const { app, orderId, operatorToken, lines } = await bookSplitOrder("slot-batch-4");
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({
        lines: [...lines.map((l) => ({ lineId: l.id, acceptedQuantity: l.quantity })), { lineId: "made-up", acceptedQuantity: 9 }],
      }),
    });
    expect(picked.statusCode).toBe(400);
    expect(picked.json().error).toBe("unknown_order_line");
  });

  it("keeps both the requested and the received quantity on the record", async () => {
    const { app, orderId, operatorToken, lines } = await bookSplitOrder("slot-batch-5");
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({
        lines: [
          { lineId: lines[0].id, acceptedQuantity: 1 },
          { lineId: lines[1].id, acceptedQuantity: 3 },
          { lineId: lines[2].id, acceptedQuantity: 2 },
        ],
      }),
    });
    const detail = await app.inject({
      method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken),
    });
    const shown = detail.json().order.processing.lines as { quantity: number; acceptedQuantity: number }[];
    // What was asked for is never overwritten by what turned up.
    expect(shown.map((l) => l.quantity)).toEqual([2, 2, 2]);
    expect(shown.map((l) => l.acceptedQuantity)).toEqual([1, 3, 2]);
  });
});

describe("DFT each combination becomes its own processing batch", () => {
  async function pickedUpOrder(slotId: string) {
    const ctx = await bookSplitOrder(slotId);
    await ctx.app.inject({
      method: "POST", url: `/v1/operations/orders/${ctx.orderId}/picked-up`, headers: bearer(ctx.operatorToken),
      payload: JSON.stringify({ lines: ctx.lines.map((l) => ({ lineId: l.id, acceptedQuantity: l.quantity })) }),
    });
    const listed = await ctx.app.inject({
      method: "GET", url: `/v1/operations/orders/${ctx.orderId}/batches`, headers: bearer(ctx.operatorToken),
    });
    return { ...ctx, batches: listed.json().batches as never[] };
  }

  it("creates one batch per combination with its own sequence", async () => {
    const { batches } = await pickedUpOrder("slot-batch-6");
    const rows = batches as { serviceName: string; quantity: number; sequence: string[]; status: string }[];
    expect(rows).toHaveLength(3);
    expect(rows.map((b) => b.sequence)).toEqual([
      ["wash", "iron", "qc"],
      ["dry_clean", "iron", "qc"],
      ["iron", "qc"],
    ]);
    // Never merged because the garment type matched.
    expect(rows.filter((b) => b.serviceName.includes("Dry Clean"))).toHaveLength(1);
    expect(rows.every((b) => b.status === "pending")).toBe(true);
  });

  it("keeps the steps inside a batch sequential", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-batch-7");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;

    // Ironing cannot be marked done on a batch that has not been washed.
    const tooSoon = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${washIron.id}/advance`,
      headers: bearer(operatorToken), payload: JSON.stringify({ step: "iron" }),
    });
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.json().error).toBe("step_out_of_order");

    const washed = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${washIron.id}/advance`,
      headers: bearer(operatorToken), payload: JSON.stringify({ step: "wash" }),
    });
    expect(washed.statusCode).toBe(200);
    const after = (washed.json().batches as { id: string; status: string; currentStep: string }[])
      .find((b) => b.id === washIron.id)!;
    expect(after.status).toBe("in_progress");
    expect(after.currentStep).toBe("iron");
  });

  it("lets batches run in parallel, so one can finish while another is still washing", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-batch-8");
    const rows = batches as { id: string; sequence: string[] }[];
    const ironOnly = rows.find((b) => b.sequence[0] === "iron")!;
    const washIron = rows.find((b) => b.sequence[0] === "wash")!;

    // Iron Only is finished and checked while the wash batch has not started.
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${ironOnly.id}/advance`,
      headers: bearer(operatorToken), payload: JSON.stringify({ step: "iron" }),
    });
    const checked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${ironOnly.id}/qc`,
      headers: bearer(operatorToken), payload: JSON.stringify({ passed: true }),
    });
    expect(checked.statusCode).toBe(200);

    const shown = checked.json().batches as { id: string; status: string }[];
    expect(shown.find((b) => b.id === ironOnly.id)!.status).toBe("completed");
    expect(shown.find((b) => b.id === washIron.id)!.status).toBe("pending");
    // And the order as a whole has not moved on, because two batches are unfinished.
    expect(checked.json().order.state).not.toBe("ready_for_delivery");
  });

  it("checks a batch only once that batch's own steps are done", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-batch-9");
    const washIron = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "wash")!;
    const early = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${washIron.id}/qc`,
      headers: bearer(operatorToken), payload: JSON.stringify({ passed: true }),
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("not_ready_for_qc");
  });

  it("sends only the failed batch back, and leaves the others alone", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-batch-10");
    const rows = batches as { id: string; sequence: string[] }[];
    const ironOnly = rows.find((b) => b.sequence[0] === "iron")!;
    const washIron = rows.find((b) => b.sequence[0] === "wash")!;

    for (const step of ["wash", "iron"]) {
      await app.inject({
        method: "POST", url: `/v1/operations/orders/${orderId}/batches/${washIron.id}/advance`,
        headers: bearer(operatorToken), payload: JSON.stringify({ step }),
      });
    }
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${ironOnly.id}/advance`,
      headers: bearer(operatorToken), payload: JSON.stringify({ step: "iron" }),
    });

    const failed = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${washIron.id}/qc`,
      headers: bearer(operatorToken), payload: JSON.stringify({ passed: false, reason: "stain_not_removed", remarks: "Collar still marked" }),
    });
    expect(failed.statusCode).toBe(200);
    const shown = failed.json().batches as { id: string; status: string; currentStep: string; qcReason: string }[];
    const redo = shown.find((b) => b.id === washIron.id)!;
    expect(redo.status).toBe("qc_failed");
    // The reason is on the record with what was said about it, not just one or the
    // other: "failed" tells the next person nothing.
    expect(redo.qcReason).toBe("Stain not removed: Collar still marked");
    // Back to the stage the failure actually points at. A stain that did not come out
    // is rewashed; it is not sent back to the iron because that happened to be the
    // last step before the check.
    expect(redo.currentStep).toBe("wash");
    // The other batch is untouched by its neighbour's failure.
    expect(shown.find((b) => b.id === ironOnly.id)!.status).toBe("awaiting_qc");
  });

  it("will not fail a batch without saying what was wrong", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-batch-11");
    const ironOnly = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "iron")!;
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${ironOnly.id}/advance`,
      headers: bearer(operatorToken), payload: JSON.stringify({ step: "iron" }),
    });
    const failed = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${ironOnly.id}/qc`,
      headers: bearer(operatorToken), payload: JSON.stringify({ passed: false }),
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error).toBe("qc_failure_incomplete");
  });

  it("moves the order on only when every batch has finished and passed", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-batch-12");
    const rows = batches as { id: string; sequence: string[] }[];
    let last: Awaited<ReturnType<typeof app.inject>> | null = null;

    for (const batch of rows) {
      for (const step of batch.sequence.filter((s) => s !== "qc")) {
        await app.inject({
          method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batch.id}/advance`,
          headers: bearer(operatorToken), payload: JSON.stringify({ step }),
        });
      }
      last = await app.inject({
        method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batch.id}/qc`,
        headers: bearer(operatorToken), payload: JSON.stringify({ passed: true }),
      });
    }

    expect((last!.json().batches as { status: string }[]).every((b) => b.status === "completed")).toBe(true);
    // Only now, with nothing left in a machine, is the order ready.
    expect(last!.json().order.state).toBe("ready_for_delivery");
  });

  it("holds the order while any batch has failed its check", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUpOrder("slot-batch-13");
    const ironOnly = (batches as { id: string; sequence: string[] }[]).find((b) => b.sequence[0] === "iron")!;
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${ironOnly.id}/advance`,
      headers: bearer(operatorToken), payload: JSON.stringify({ step: "iron" }),
    });
    const failed = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${ironOnly.id}/qc`,
      headers: bearer(operatorToken), payload: JSON.stringify({ passed: false, reason: "poor_ironing", remarks: "Creased" }),
    });
    expect(failed.json().order.state).toBe("qc_hold");
  });
});

describe("DFT an order booked before batches existed still works", () => {
  it("accepts a category total when the category was sent for one service only", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-batch-simple", 5);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({
        slotId: "slot-batch-simple",
        lines: [{ category: "Shirts", quantity: 3, serviceId: "wash_iron" }],
      }),
    });
    const orderId = booked.json().order.id as string;
    const operatorToken = await loginOperator(app);
    await openSlotNow(container, "slot-batch-simple");
    // Unambiguous: one category, one service, so the total can be attributed.
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 3 }] }),
    });
    expect(picked.statusCode).toBe(200);
    const listed = await app.inject({
      method: "GET", url: `/v1/operations/orders/${orderId}/batches`, headers: bearer(operatorToken),
    });
    expect((listed.json().batches as unknown[]).length).toBe(1);
  });
});
