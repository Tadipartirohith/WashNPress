import { describe, it, expect } from "vitest";
import { resetConfigCache, loadConfig } from "../../src/config";
import { buildContainer } from "../../src/container";
import { seedSlot } from "./helpers";
import { CompositeNotificationProvider } from "../../src/adapters/notifications/composite";

describe("DFT notifications outbox", () => {
  it("enqueues on booking and the worker delivers when a channel is enabled", async () => {
    resetConfigCache();
    const config = loadConfig({ reload: true, env: { WNP_APP__ENV: "test", WNP_NOTIFICATIONS__PUSH__ENABLED: "true" } });
    const container = await buildContainer(config);
    await seedSlot(container, "slot-note", 3);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-note" });

    const pendingBefore = await container.store.outbox.listPending();
    expect(pendingBefore.length).toBeGreaterThanOrEqual(1);

    const processed = await container.notifications.processOutboxOnce();
    expect(processed).toBeGreaterThanOrEqual(1);
    const provider = container.notificationProvider as CompositeNotificationProvider;
    expect(provider.mock.sent.length).toBeGreaterThanOrEqual(1);
    expect((await container.store.outbox.listPending()).length).toBe(0);
  });
});
