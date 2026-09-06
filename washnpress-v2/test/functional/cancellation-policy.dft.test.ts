import { describe, it, expect } from "vitest";
import { makeTestApp, bearer, loginResident, seedSlot, openSlotNow } from "./helpers";
import { Account } from "../../src/domain/accounts";
import { walletAccount } from "../../src/domain/ledger-accounts";
import { buildTransaction } from "../../src/domain/ledger";
import { SYSTEM_CONFIG_ID } from "../../src/services/system-config-service";

// Free to cancel or reschedule for a short window after booking, then a flat fee —
// always inside the existing hard cutoff, which this never touches. A resident is
// never trapped in a booking they can't afford to get out of: the action always
// proceeds, and an uncollectable fee is just noted rather than blocking anything.

async function fundWallet(container: Awaited<ReturnType<typeof makeTestApp>>["container"], residentId: string, paise: number) {
  await container.store.ledger.post(buildTransaction({
    id: `fund-${residentId}-${Date.now()}-${Math.random()}`,
    reference: `fund-${residentId}`,
    entries: [
      { account: Account.GatewayClearing, direction: "debit", amount: paise },
      { account: walletAccount(residentId), direction: "credit", amount: paise },
    ],
    at: new Date(),
  }));
}

async function closeFreeWindow(container: Awaited<ReturnType<typeof makeTestApp>>["container"]) {
  const config = await container.systemConfig.get();
  await container.store.systemConfig.put({ ...config, id: SYSTEM_CONFIG_ID, cancellationFreeWindowMinutes: 0 });
}

async function bookPickup(app: Awaited<ReturnType<typeof makeTestApp>>["app"], token: string, slotId: string) {
  const booked = await app.inject({
    method: "POST", url: "/v1/pickups", headers: bearer(token),
    payload: JSON.stringify({ slotId, estimatedCount: 2 }),
  });
  expect(booked.statusCode).toBe(201);
  return booked.json().pickup.id as string;
}

describe("DFT free cancellation window, then a fee", () => {
  it("charges nothing within the free window", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-free-cancel", 5);
    const token = await loginResident(app);
    const pickupId = await bookPickup(app, token, "slot-free-cancel");

    const before = await container.wallet.balancePaise("res-demo");
    const cancelled = await app.inject({
      method: "POST", url: "/v1/pickups/cancel", headers: bearer(token),
      payload: JSON.stringify({ pickupId }),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().feeChargedPaise).toBe(0);
    expect(cancelled.json().feePending).toBe(false);
    expect(await container.wallet.balancePaise("res-demo")).toBe(before);
  });

  it("charges the configured fee once the free window has closed, from a funded wallet", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-fee-cancel", 5);
    const token = await loginResident(app);
    const pickupId = await bookPickup(app, token, "slot-fee-cancel");
    await fundWallet(container, "res-demo", 100000);
    await closeFreeWindow(container);

    const before = await container.wallet.balancePaise("res-demo");
    const cancelled = await app.inject({
      method: "POST", url: "/v1/pickups/cancel", headers: bearer(token),
      payload: JSON.stringify({ pickupId }),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().pickup.status).toBe("cancelled");
    expect(cancelled.json().feeChargedPaise).toBe(9900);
    expect(cancelled.json().feePending).toBe(false);
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - 9900);
  });

  it("still cancels even when the wallet can't cover the fee, and says so instead of blocking", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-pending-cancel", 5);
    const token = await loginResident(app);
    const pickupId = await bookPickup(app, token, "slot-pending-cancel");
    await closeFreeWindow(container);
    // No funding — wallet starts at 0 and can't cover the fee.

    const cancelled = await app.inject({
      method: "POST", url: "/v1/pickups/cancel", headers: bearer(token),
      payload: JSON.stringify({ pickupId }),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().pickup.status).toBe("cancelled");
    expect(cancelled.json().feeChargedPaise).toBe(0);
    expect(cancelled.json().feePending).toBe(true);
    expect(await container.wallet.balancePaise("res-demo")).toBe(0);
  });

  it("charges nothing to reschedule within the free window", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-free-res-from", 5);
    await seedSlot(container, "slot-free-res-to", 5);
    const token = await loginResident(app);
    const pickupId = await bookPickup(app, token, "slot-free-res-from");

    const before = await container.wallet.balancePaise("res-demo");
    const rescheduled = await app.inject({
      method: "POST", url: "/v1/pickups/reschedule", headers: bearer(token),
      payload: JSON.stringify({ pickupId, slotId: "slot-free-res-to" }),
    });
    expect(rescheduled.statusCode).toBe(200);
    expect(rescheduled.json().feeChargedPaise).toBe(0);
    expect(await container.wallet.balancePaise("res-demo")).toBe(before);
  });

  it("charges the (lower) reschedule fee once the free window has closed", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-fee-res-from", 5);
    await seedSlot(container, "slot-fee-res-to", 5);
    const token = await loginResident(app);
    const pickupId = await bookPickup(app, token, "slot-fee-res-from");
    await fundWallet(container, "res-demo", 100000);
    await closeFreeWindow(container);

    const before = await container.wallet.balancePaise("res-demo");
    const rescheduled = await app.inject({
      method: "POST", url: "/v1/pickups/reschedule", headers: bearer(token),
      payload: JSON.stringify({ pickupId, slotId: "slot-fee-res-to" }),
    });
    expect(rescheduled.statusCode).toBe(200);
    expect(rescheduled.json().pickup.slotId).toBe("slot-fee-res-to");
    expect(rescheduled.json().feeChargedPaise).toBe(4900);
    expect(await container.wallet.balancePaise("res-demo")).toBe(before - 4900);
  });

  it("still refuses entirely past the hard cutoff, free window or not — cancel", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-cutoff-cancel", 5);
    const token = await loginResident(app);
    const pickupId = await bookPickup(app, token, "slot-cutoff-cancel");
    await openSlotNow(container, "slot-cutoff-cancel"); // pushes scheduledFor an hour into the past
    await fundWallet(container, "res-demo", 100000); // funded — the block isn't about affording the fee

    const cancelled = await app.inject({
      method: "POST", url: "/v1/pickups/cancel", headers: bearer(token),
      payload: JSON.stringify({ pickupId }),
    });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().error).toBe("cutoff_passed");
  });

  it("still refuses entirely past the hard cutoff, free window or not — reschedule", async () => {
    const { app, container } = await makeTestApp();
    await seedSlot(container, "slot-cutoff-res-from", 5);
    await seedSlot(container, "slot-cutoff-res-to", 5);
    const token = await loginResident(app);
    const pickupId = await bookPickup(app, token, "slot-cutoff-res-from");
    await openSlotNow(container, "slot-cutoff-res-from");

    const rescheduled = await app.inject({
      method: "POST", url: "/v1/pickups/reschedule", headers: bearer(token),
      payload: JSON.stringify({ pickupId, slotId: "slot-cutoff-res-to" }),
    });
    expect(rescheduled.statusCode).toBe(409);
    expect(rescheduled.json().error).toBe("cutoff_passed");
  });
});
