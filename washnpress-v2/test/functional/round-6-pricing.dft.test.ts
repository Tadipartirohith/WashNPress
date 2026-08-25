import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, giveSubscription, openSlotNow, bearer, loginResident, loginOperator } from "./helpers";
import {
  servicePricePaise, billableUnits, basisOf, audienceFor, priceLine,
} from "../../src/domain/pricing";
import type { GarmentService } from "../../src/domain/models";

// #28 and the weight-based option from the sixth round: a subscriber and a
// passer-by are not the same customer, and not everything is counted in garments.
// Also #17: what the resident said and what the operator received are both kept.

const service = (over: Partial<GarmentService>): GarmentService => ({
  id: "svc", name: "Service", unitPricePaise: 5000, pricesPaise: {},
  requiresClean: true, cleanStage: "wash", requiresPress: true, isBase: false, isActive: true,
  ...over,
} as GarmentService);

describe("DFT a subscriber and a passer-by are not the same customer", () => {
  it("charges a subscriber the subscriber price where one is configured", () => {
    const svc = service({
      pricesPaise: { Shirts: 8000 },
      subscriberPricesPaise: { Shirts: 6000 },
    });
    expect(servicePricePaise(svc, "Shirts", "standard")).toBe(8000);
    expect(servicePricePaise(svc, "Shirts", "subscriber")).toBe(6000);
  });

  it("falls back to the ordinary price where no subscriber price is set", () => {
    // A service written before subscriber pricing existed keeps behaving as it did,
    // rather than suddenly costing a subscriber nothing.
    const svc = service({ pricesPaise: { Shirts: 8000 } });
    expect(servicePricePaise(svc, "Shirts", "subscriber")).toBe(8000);
  });

  it("uses the subscriber unit price for a category with no specific one", () => {
    const svc = service({ unitPricePaise: 9000, subscriberUnitPricePaise: 7000 });
    expect(servicePricePaise(svc, "Anything", "subscriber")).toBe(7000);
    expect(servicePricePaise(svc, "Anything", "standard")).toBe(9000);
  });

  it("decides the audience from the subscription rather than from the request", () => {
    expect(audienceFor(true)).toBe("subscriber");
    expect(audienceFor(false)).toBe("standard");
  });

  it("quotes a subscriber less than a non-subscriber for the same order", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-price-1", 5);
    const lines = [{ category: "Shirts", quantity: 4, serviceId: "dryclean_iron" }];
    const url = `/v1/pickups/preview?slotId=slot-price-1&lines=${encodeURIComponent(JSON.stringify(lines))}`;

    const plain = await app.inject({ method: "GET", url, headers: bearer(await loginResident(app)) });
    expect(plain.statusCode).toBe(200);
    const standardPaise = plain.json().servicesPaise as number;
    expect(plain.json().audience).toBe("standard");

    await giveSubscription(container, "res-demo", "plan-basic");
    const member = await app.inject({ method: "GET", url, headers: bearer(await loginResident(app)) });
    expect(member.json().audience).toBe("subscriber");
    // The plan is supposed to be worth having.
    expect(member.json().servicesPaise as number).toBeLessThan(standardPaise);
  });

  it("charges the standard price again once the plan lapses", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-price-2", 5);
    const subscription = await giveSubscription(container, "res-demo", "plan-basic");
    const lines = [{ category: "Shirts", quantity: 4, serviceId: "dryclean_iron" }];
    const url = `/v1/pickups/preview?slotId=slot-price-2&lines=${encodeURIComponent(JSON.stringify(lines))}`;

    const token = await loginResident(app);
    const member = await app.inject({ method: "GET", url, headers: bearer(token) });

    subscription.status = "expired";
    await container.store.subscriptions.put(subscription);

    const lapsed = await app.inject({ method: "GET", url, headers: bearer(token) });
    expect(lapsed.json().audience).toBe("standard");
    expect(lapsed.json().servicesPaise as number).toBeGreaterThan(member.json().servicesPaise as number);
  });

  it("never takes a price from the client", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-price-3", 5);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({
        slotId: "slot-price-3",
        lines: [{
          category: "Shirts", quantity: 2, serviceId: "dryclean_iron",
          // All ignored: pricing is the backend's.
          linePricePaise: 1, serviceUnitPricePaise: 1, audience: "subscriber",
        }],
      }),
    });
    expect(booked.statusCode).toBe(201);
    expect(booked.json().order.servicesPaise).toBeGreaterThan(100);
  });
});

describe("DFT not everything is counted in garments", () => {
  it("knows what a service is measured in", () => {
    expect(basisOf(service({}))).toBe("per_garment");
    expect(basisOf(service({ pricingBasis: "per_kg" }))).toBe("per_kg");
    expect(basisOf(service({ pricingBasis: "per_job" }))).toBe("per_job");
  });

  it("bills a weighed service by the kilogram, to two decimal places", () => {
    const weighed = service({ pricingBasis: "per_kg" });
    expect(billableUnits(weighed, { quantity: 12, weightKg: 2.5 })).toBe(2.5);
    expect(billableUnits(weighed, { quantity: 12, weightKg: 2.456 })).toBe(2.46);
    // A 2.5 kg bag is not rounded up to three.
    expect(billableUnits(weighed, { quantity: 12, weightKg: 2.5 })).not.toBe(3);
  });

  it("bills a per-job service once however much of it there is", () => {
    const job = service({ pricingBasis: "per_job" });
    expect(billableUnits(job, { quantity: 1 })).toBe(1);
    expect(billableUnits(job, { quantity: 9 })).toBe(1);
    expect(billableUnits(job, { quantity: 0 })).toBe(0);
  });

  it("prices a weighed line by weight rather than by count", () => {
    const weighed = service({ pricingBasis: "per_kg", unitPricePaise: 8000 });
    const priced = priceLine({ category: "Mixed", quantity: 20, service: weighed, addons: [], weightKg: 3 });
    // Three kilos at eighty rupees, not twenty garments at eighty rupees.
    expect(priced.linePricePaise).toBe(24000);
  });

  it("books a weighed service end to end", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-weight-1", 5);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({
        slotId: "slot-weight-1",
        lines: [{ category: "Mixed", quantity: 15, serviceId: "bulk_wash", weightKg: 4.5 }],
      }),
    });
    expect(booked.statusCode).toBe(201);
    const line = booked.json().order.lines[0];
    expect(line.pricingBasis).toBe("per_kg");
    expect(line.weightKg).toBe(4.5);
    // 4.5 kg at the standard bulk rate.
    expect(booked.json().order.servicesPaise).toBe(Math.round(4.5 * 8000));
  });

  it("charges a subscriber the subscriber rate per kilogram too", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-weight-2", 5);
    await giveSubscription(container, "res-demo", "plan-basic");
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({
        slotId: "slot-weight-2",
        lines: [{ category: "Mixed", quantity: 15, serviceId: "bulk_wash", weightKg: 4 }],
      }),
    });
    expect(booked.json().order.servicesPaise).toBe(4 * 6000);
  });

  it("leaves a counted service alone when a weight is sent with it", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-weight-3", 5);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({
        slotId: "slot-weight-3",
        lines: [{ category: "Shirts", quantity: 3, serviceId: "dryclean_iron", weightKg: 99 }],
      }),
    });
    const line = booked.json().order.lines[0];
    expect(line.pricingBasis).toBe("per_garment");
    expect(line.weightKg).toBeNull();
    expect(booked.json().order.servicesPaise).toBe(3 * 8000);
  });
});

describe("DFT what the resident said and what the operator found are both kept", () => {
  it("records the declared count beside the confirmed one, and the difference", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-count-1", 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({
        slotId: "slot-count-1",
        lines: [{ category: "Shirts", quantity: 5, serviceId: "wash_iron" }],
      }),
    });
    const orderId = booked.json().order.id as string;
    const operatorToken = await loginOperator(app);
    await openSlotNow(container, "slot-count-1");

    const detail = await app.inject({
      method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken),
    });
    const lineId = detail.json().order.lines[0].id as string;

    // Four turned up where five were declared.
    const reconciliation = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/reconcile`, headers: bearer(operatorToken),
      payload: JSON.stringify({ lines: [{ lineId, acceptedQuantity: 4 }] }),
    });
    const row = reconciliation.json().reconciliation.lines[0];
    expect(row.requested).toBe(5);
    expect(row.actual).toBe(4);
    expect(row.difference).toBe(-1);
    expect(row.status).toBe("short");

    // Four where five were declared is a discrepancy, so the operator has to say why
    // before it can be confirmed.
    const bare = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ lines: [{ lineId, acceptedQuantity: 4 }] }),
    });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error).toBe("discrepancy_incomplete");

    await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({
        lines: [{ lineId, acceptedQuantity: 4 }],
        discrepancyReason: "not_handed_over",
        discrepancyRemarks: "Only four shirts were in the bag",
      }),
    });

    // Both numbers survive onto the record, which is what makes the discrepancy
    // answerable later rather than a matter of recollection.
    const after = await app.inject({
      method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken),
    });
    const stored = after.json().order.processing.lines[0];
    expect(stored.quantity).toBe(5);
    expect(stored.acceptedQuantity).toBe(4);
    expect(after.json().order.estimatedCount).toBe(5);
    expect(after.json().order.acceptedCount).toBe(4);
  });

  it("prices the extra at the rate of the combination it belongs to", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-count-2", 5);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(await loginResident(app)),
      payload: JSON.stringify({
        slotId: "slot-count-2",
        lines: [{ category: "Shirts", quantity: 2, serviceId: "dryclean_iron" }],
      }),
    });
    const orderId = booked.json().order.id as string;
    const operatorToken = await loginOperator(app);
    await openSlotNow(container, "slot-count-2");
    const detail = await app.inject({
      method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken),
    });
    const lineId = detail.json().order.lines[0].id as string;

    const reconciliation = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/reconcile`, headers: bearer(operatorToken),
      payload: JSON.stringify({ lines: [{ lineId, acceptedQuantity: 3 }] }),
    });
    const row = reconciliation.json().reconciliation.lines[0];
    expect(row.status).toBe("additional");
    // The dry cleaning rate for a shirt, not a flat additional rate.
    expect(row.additionalPaise).toBe(row.unitPricePaise);
    expect(row.unitPricePaise).toBeGreaterThan(8000);
  });
});
