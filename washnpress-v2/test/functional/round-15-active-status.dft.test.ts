import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, bearer, loginResident, loginOperator, openSlotNow } from "./helpers";

// An order being worked through its batches has to show in the operator's Active list
// at the stage it is actually at. The list groups by the order's own state, and that
// state used to sit at Picked Up all the way through washing and ironing, only jumping
// to Ready or QC Failed at the very end — so an operator part-way through an order
// could not find it under Ironing or QC. The order state now follows the least-advanced
// batch, so each stage is reflected as the work reaches it, and the same state is what
// every other portal reads.

async function pickedUp(slotId: string, lines: { category: string; quantity: number; serviceId: string }[]) {
  const { app, container } = await makeTestApp();
  await seedSlot(container, slotId, 5);
  const residentToken = await loginResident(app);
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(residentToken),
    payload: JSON.stringify({ slotId, lines }),
  });
  expect(booked.statusCode).toBe(201);
  const orderId = booked.json().order.id as string;
  const operatorToken = await loginOperator(app);
  await openSlotNow(container, slotId);
  const orderLines = (await app.inject({
    method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken),
  })).json().order.lines as { id: string; quantity: number }[];
  await app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
    payload: JSON.stringify({ lines: orderLines.map((l) => ({ lineId: l.id, acceptedQuantity: l.quantity })) }),
  });
  const batches = (await app.inject({
    method: "GET", url: `/v1/operations/orders/${orderId}/batches`, headers: bearer(operatorToken),
  })).json().batches as { id: string; sequence: string[] }[];
  return { app, orderId, operatorToken, batches };
}

async function groupOf(app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, orderId: string) {
  const groups = (await app.inject({ method: "GET", url: "/v1/operations/active", headers: bearer(token) }))
    .json() as Record<string, { id: string }[]>;
  for (const [key, orders] of Object.entries(groups)) {
    if (Array.isArray(orders) && orders.some((o) => o.id === orderId)) return key;
  }
  return null;
}
const advance = (app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, orderId: string, batchId: string, step: string) =>
  app.inject({
    method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batchId}/advance`,
    headers: bearer(token), payload: JSON.stringify({ step }),
  });

describe("DFT the operator Active list reflects the stage an order is at", () => {
  it("moves a single order from Picked Up through Ironing Pending and QC to Ready", async () => {
    const { app, orderId, operatorToken, batches } = await pickedUp(
      "slot-active-1", [{ category: "Shirts", quantity: 2, serviceId: "wash_iron" }]);
    const batchId = batches[0].id;

    // Collected, nothing worked yet.
    expect(await groupOf(app, operatorToken, orderId)).toBe("pickedUp");

    // Washing done — only the iron is left before the checks, so the order is now
    // waiting to be ironed. Before the fix it was still under Picked Up here.
    expect((await advance(app, operatorToken, orderId, batchId, "wash")).statusCode).toBe(200);
    expect(await groupOf(app, operatorToken, orderId)).toBe("ironingPending");

    // Ironing done — everything is washed and ironed, only the check remains.
    expect((await advance(app, operatorToken, orderId, batchId, "iron")).statusCode).toBe(200);
    expect(await groupOf(app, operatorToken, orderId)).toBe("qc");

    // The check passes on the last batch and the order is ready to go out.
    expect((await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/batches/${batchId}/qc`,
      headers: bearer(operatorToken), payload: JSON.stringify({ passed: true }),
    })).statusCode).toBe(200);
    expect(await groupOf(app, operatorToken, orderId)).toBe("readyForDelivery");
  });

  it("shows an order under Washing while any of its batches still needs washing", async () => {
    // Two wash-and-iron batches. Washing one while the other is still to be washed
    // means the order as a whole is still in washing.
    const { app, orderId, operatorToken, batches } = await pickedUp("slot-active-2", [
      { category: "Shirts", quantity: 2, serviceId: "wash_iron" },
      { category: "Trousers", quantity: 2, serviceId: "wash_iron" },
    ]);
    expect(batches).toHaveLength(2);

    expect((await advance(app, operatorToken, orderId, batches[0].id, "wash")).statusCode).toBe(200);
    // First batch washed, second not — still washing.
    expect(await groupOf(app, operatorToken, orderId)).toBe("washing");

    // Second batch washed too — both now wait on the iron.
    expect((await advance(app, operatorToken, orderId, batches[1].id, "wash")).statusCode).toBe(200);
    expect(await groupOf(app, operatorToken, orderId)).toBe("ironingPending");
  });
});
