import { describe, it, expect } from "vitest";
import { makeTestApp, seedSlot, giveSubscription, bearer, loginAdmin, loginResident, loginOperator } from "./helpers";

// Subscription is optional, and a single garment category can be split across
// different processing services within one order.
describe("DFT ordering without a subscription", () => {
  it("lets a resident with no plan book and pays the ordinary per garment rate", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-guest-1", 5);
    const token = await loginResident(app);

    // Nothing forces a plan: the dashboard simply says there is none.
    const dashboard = await app.inject({ method: "GET", url: "/v1/resident/dashboard", headers: bearer(token) });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().subscription).toBeNull();

    const preview = await app.inject({ method: "GET", url: "/v1/pickups/preview?slotId=slot-guest-1&estimatedCount=10", headers: bearer(token) });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().hasSubscription).toBe(false);
    const config = await container.systemConfig.get();
    expect(preview.json().perGarmentRatePaise).toBe(config.nonSubscriberGarmentRatePaise);

    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-guest-1", estimatedCount: 10 }),
    });
    expect(booked.statusCode).toBe(201);

    const operatorToken = await loginOperator(app);
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.json().order.id}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 10 }, { category: "Trousers", quantity: 5 }] }),
    });
    const order = picked.json().order;
    expect(order.payPerOrder).toBe(true);
    expect(order.subscriptionCoveredCount).toBe(0);
    expect(order.additionalCount).toBe(15);
    // Priced per garment category, not at one flat rate for everything: trousers
    // cost more to handle than shirts and are billed as such.
    const shirt = config.garmentPricesPaise.Shirts ?? config.nonSubscriberGarmentRatePaise;
    const trouser = config.garmentPricesPaise.Trousers ?? config.nonSubscriberGarmentRatePaise;
    expect(trouser).toBeGreaterThan(shirt);
    expect(order.additionalChargePaise).toBe(10 * shirt + 5 * trouser);
  });

  it("uses the plan rate once the resident subscribes", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-guest-2", 5);
    await giveSubscription(container, "res-demo", "plan-basic", 38);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-guest-2" });

    const operatorToken = await loginOperator(app);
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 6 }] }),
    });
    const order = picked.json().order;
    const config = await container.systemConfig.get();
    expect(order.payPerOrder).toBe(false);
    expect(order.subscriptionCoveredCount).toBe(2);
    expect(order.additionalCount).toBe(4);
    expect(order.additionalChargePaise).toBe(4 * config.additionalGarmentRatePaise);
  });
});

describe("DFT partial add-ons within one order", () => {
  it("splits a category across two services and prices each separately", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-lines-1", 5);
    const token = await loginResident(app);

    const lines = [
      { category: "Shirts", quantity: 4, serviceId: "dryclean_iron" },
      { category: "Shirts", quantity: 6, serviceId: "wash_iron" },
    ];

    const preview = await app.inject({
      method: "GET",
      url: `/v1/pickups/preview?slotId=slot-lines-1&lines=${encodeURIComponent(JSON.stringify(lines))}`,
      headers: bearer(token),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().estimatedCount).toBe(10);
    expect(preview.json().servicesPaise).toBe(4 * 8000);
    expect(preview.json().lines).toHaveLength(2);

    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-lines-1", lines }),
    });
    expect(booked.statusCode).toBe(201);
    expect(booked.json().order.servicesPaise).toBe(32000);
    const orderId = booked.json().order.id as string;

    // Operations sees the split so each garment is processed as the resident chose.
    const operatorToken = await loginOperator(app);
    const detail = await app.inject({ method: "GET", url: `/v1/operations/orders/${orderId}`, headers: bearer(operatorToken) });
    const detailLines = detail.json().order.lines as Array<{ serviceName: string; quantity: number }>;
    expect(detailLines.map((l) => `${l.serviceName} x${l.quantity}`).sort())
      .toEqual(["Dry Clean and Iron x4", "Wash and Iron x6"]);

    // The service charge is billed on top of whatever the plan covers.
    const picked = await app.inject({
      method: "POST", url: `/v1/operations/orders/${orderId}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 10 }] }),
    });
    const order = picked.json().order;
    const config = await container.systemConfig.get();
    expect(order.servicesPaise).toBe(32000);
    expect(order.additionalChargePaise).toBe(10 * config.nonSubscriberGarmentRatePaise + 32000);
  });

  it("refuses an unknown service without consuming slot capacity", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-lines-2", 3);
    const token = await loginResident(app);
    const res = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-lines-2", lines: [{ category: "Shirts", quantity: 2, serviceId: "gold_plating" }] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_service");
    // The slot still has all of its capacity.
    expect((await container.store.slots.get("slot-lines-2"))!.capacityRemaining).toBe(3);
  });

  it("publishes the service catalogue so a client never hard codes prices", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/services" });
    expect(res.statusCode).toBe(200);
    const services = res.json().services as Array<{ id: string; unitPricePaise: number; isBase: boolean }>;
    expect(services.find((s) => s.isBase)?.unitPricePaise).toBe(0);
    expect(services.some((s) => s.id === "dryclean_iron")).toBe(true);
  });

  it("lets an admin reprice a service per garment, and the next order uses the new price", async () => {
    const { app, container } = await makeTestApp();
    const adminToken = await loginAdmin(app);
    const current = await app.inject({ method: "GET", url: "/v1/admin/config", headers: bearer(adminToken) });
    // Prices are per garment category, so repricing dry cleaning for sarees is a
    // different act from changing the price the service falls back to.
    const services = (current.json().config.garmentServices as Array<{ id: string; unitPricePaise: number; pricesPaise?: Record<string, number> }>)
      .map((s) => (s.id === "dryclean_iron"
        ? { ...s, unitPricePaise: 9500, pricesPaise: { ...(s.pricesPaise ?? {}), Sarees: 9500 } }
        : s));
    const updated = await app.inject({
      method: "PATCH", url: "/v1/admin/config", headers: bearer(adminToken),
      payload: JSON.stringify({ garmentServices: services }),
    });
    expect(updated.statusCode).toBe(200);

    await seedSlot(container, "slot-lines-3", 5);
    const token = await loginResident(app);
    const booked = await app.inject({
      method: "POST", url: "/v1/pickups", headers: bearer(token),
      payload: JSON.stringify({ slotId: "slot-lines-3", lines: [{ category: "Sarees", quantity: 2, serviceId: "dryclean_iron" }] }),
    });
    expect(booked.json().order.servicesPaise).toBe(2 * 9500);
  });
});

describe("DFT order tracking freshness", () => {
  it("exposes a revision the client can poll instead of diffing the order", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-track-1", 5);
    const booked = await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-track-1" });
    const residentToken = await loginResident(app);

    const before = await app.inject({ method: "GET", url: `/v1/orders/${booked.order.id}/tracking`, headers: bearer(residentToken) });
    const firstRevision = before.json().revision as number;
    expect(before.json().state).toBe("scheduled");

    const operatorToken = await loginOperator(app);
    await app.inject({
      method: "POST", url: `/v1/operations/orders/${booked.order.id}/picked-up`, headers: bearer(operatorToken),
      payload: JSON.stringify({ items: [{ category: "Shirts", quantity: 2 }] }),
    });

    const after = await app.inject({ method: "GET", url: `/v1/orders/${booked.order.id}/tracking`, headers: bearer(residentToken) });
    expect(after.json().state).toBe("picked_up");
    expect(after.json().revision).toBeGreaterThan(firstRevision);
    expect(after.json().updatedAt >= before.json().updatedAt).toBe(true);
  });
});
