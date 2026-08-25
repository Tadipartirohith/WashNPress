import { describe, it, expect } from "vitest";
import {
  makeTestApp, seedSlot, giveSubscription, bearer, loginResident, loginOperator, openSlotNow,
} from "./helpers";

// Services are measured in their own units and each has its own allowance inside a
// plan. The Standard plan seeds 40 kg of washing, 20 kg of wash-only and 30 pieces
// of ironing, and none of those three may spend another's.

async function bookLines(
  app: Awaited<ReturnType<typeof makeTestApp>>["app"],
  token: string,
  slotId: string,
  lines: unknown[],
) {
  return app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(token),
    payload: JSON.stringify({ slotId, lines }),
  });
}

describe("DFT allowances held per service", () => {
  it("tells the resident what each service has left, in that service's own unit", async () => {
    const { app, container } = await makeTestApp();
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);

    const res = await app.inject({ method: "GET", url: "/v1/subscription", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const services = res.json().usage.services as Array<{ serviceId: string; unit: string; remaining: number; remainingLabel: string }>;
    expect(services.map((s) => s.serviceId)).toEqual(["wash_iron", "wash_only", "iron_only"]);
    // Washing is weighed and ironing is counted, and the screen is told which is which.
    expect(services.find((s) => s.serviceId === "wash_iron")).toMatchObject({ unit: "kg", remaining: 40 });
    expect(services.find((s) => s.serviceId === "iron_only")).toMatchObject({ unit: "piece", remaining: 30 });
    expect(services[0].remainingLabel).toBe("40 kg of 40 kg remaining");
  });

  it("does not let ironing eat the kilograms meant for washing", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-allow-1", 5);
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);
    const operatorToken = await loginOperator(app);

    // Thirty shirts ironed: the whole ironing allowance, in pieces.
    const booked = await bookLines(app, token, "slot-allow-1", [
      { category: "Shirts", quantity: 30, serviceId: "iron_only" },
    ]);
    expect(booked.statusCode).toBe(201);
    // Entirely within the plan, so nothing is charged for it.
    expect(booked.json().order.servicesPaise).toBe(0);

    await openSlotNow(container, "slot-allow-1");
    const orderId = booked.json().order.id as string;
    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    const lines = detail.json().order.lines as Array<{ id: string; quantity: number }>;
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ lines: lines.map((l) => ({ lineId: l.id, acceptedQuantity: l.quantity })) }),
    });

    const after = await app.inject({ method: "GET", url: "/v1/subscription", headers: bearer(token) });
    const services = after.json().usage.services as Array<{ serviceId: string; used: number; remaining: number }>;
    // Ironing is spent; washing is exactly where it was.
    expect(services.find((s) => s.serviceId === "iron_only")).toMatchObject({ used: 30, remaining: 0 });
    expect(services.find((s) => s.serviceId === "wash_iron")).toMatchObject({ used: 0, remaining: 40 });
  });

  it("bills what goes beyond an allowance at that service's own rate", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-allow-2", 5);
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);

    // 45 kg of washing against a 40 kg allowance, and 10 shirts ironed within theirs.
    const preview = await app.inject({
      method: "GET",
      url: `/v1/pickups/preview?slotId=slot-allow-2&lines=${encodeURIComponent(JSON.stringify([
        { category: "Mixed", quantity: 40, serviceId: "wash_iron", measuredQuantity: 45 },
        { category: "Shirts", quantity: 10, serviceId: "iron_only" },
      ]))}`,
      headers: bearer(token),
    });
    expect(preview.statusCode).toBe(200);
    // Five kilograms over, at washing's own 60.00 per kg. The ironing costs nothing,
    // and its rate is never applied to the washing.
    expect(preview.json().servicesPaise).toBe(5 * 6000);
    const quoted = preview.json().lines as Array<{ serviceId: string; coveredQuantity: number; additionalQuantity: number; additionalRatePaise: number; linePricePaise: number }>;
    expect(quoted.find((l) => l.serviceId === "wash_iron")).toMatchObject({
      coveredQuantity: 40, additionalQuantity: 5, additionalRatePaise: 6000, linePricePaise: 30000,
    });
    expect(quoted.find((l) => l.serviceId === "iron_only")).toMatchObject({
      coveredQuantity: 10, additionalQuantity: 0, linePricePaise: 0,
    });
  });

  it("draws one balance down across two lines of the same service", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-allow-3", 5);
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);

    // Shirts and bedsheets, both washed, in one order: 30 kg and 15 kg against a
    // single 40 kg allowance, not 40 kg each.
    const booked = await bookLines(app, token, "slot-allow-3", [
      { category: "Shirts", quantity: 20, serviceId: "wash_iron", measuredQuantity: 30 },
      { category: "Bedsheets", quantity: 4, serviceId: "wash_iron", measuredQuantity: 15 },
    ]);
    expect(booked.statusCode).toBe(201);
    // Forty covered, five over.
    expect(booked.json().order.servicesPaise).toBe(5 * 6000);
    const lines = booked.json().order.lines as Array<{ category: string; coveredQuantity: number; additionalQuantity: number }>;
    expect(lines.find((l) => l.category === "Shirts")).toMatchObject({ coveredQuantity: 30, additionalQuantity: 0 });
    expect(lines.find((l) => l.category === "Bedsheets")).toMatchObject({ coveredQuantity: 10, additionalQuantity: 5 });
  });

  it("bills a service the plan does not name in full, however much is left elsewhere", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-allow-4", 5);
    // Standard covers washing and ironing but not dry cleaning.
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);

    const booked = await bookLines(app, token, "slot-allow-4", [
      { category: "Sarees", quantity: 2, serviceId: "dryclean_iron" },
    ]);
    expect(booked.statusCode).toBe(201);
    const line = booked.json().order.lines[0] as { coveredByPlan: boolean; coveredQuantity: number; linePricePaise: number };
    expect(line.coveredByPlan).toBe(false);
    expect(line.coveredQuantity).toBe(0);
    expect(line.linePricePaise).toBeGreaterThan(0);
  });

  it("bills from the scale rather than from the estimate", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-allow-5", 5);
    await giveSubscription(container, "res-demo", "plan-standard");
    const token = await loginResident(app);
    const operatorToken = await loginOperator(app);

    // The resident guesses 38 kg, which is inside the 40 kg allowance.
    const booked = await bookLines(app, token, "slot-allow-5", [
      { category: "Mixed", quantity: 30, serviceId: "wash_iron", measuredQuantity: 38 },
    ]);
    expect(booked.json().order.servicesPaise).toBe(0);
    const orderId = booked.json().order.id as string;

    await openSlotNow(container, "slot-allow-5");
    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    const lineId = (detail.json().order.lines as Array<{ id: string }>)[0].id;
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ lines: [{ lineId, acceptedQuantity: 30, acceptedMeasuredQuantity: 43.5 }] }),
    });
    expect(picked.statusCode).toBe(200);
    // The bag actually weighs 43.5 kg, so 3.5 kg fall outside the allowance.
    expect(picked.json().order.servicesPaise).toBe(Math.round(3.5 * 6000));

    const after = await app.inject({ method: "GET", url: "/v1/subscription", headers: bearer(token) });
    const services = after.json().usage.services as Array<{ serviceId: string; used: number; remaining: number }>;
    expect(services.find((s) => s.serviceId === "wash_iron")).toMatchObject({ used: 43.5, remaining: 0 });
  });
});
