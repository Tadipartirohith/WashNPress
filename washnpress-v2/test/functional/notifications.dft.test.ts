import { describe, it, expect } from "vitest";
import { resetConfigCache, loadConfig } from "../../src/config";
import { buildContainer, type Container } from "../../src/container";
import { seedSlot } from "./helpers";
import { CompositeNotificationProvider } from "../../src/adapters/notifications/composite";

async function withPush(env: Record<string, string> = {}): Promise<Container> {
  resetConfigCache();
  const config = loadConfig({
    reload: true,
    env: { WNP_APP__ENV: "test", WNP_NOTIFICATIONS__PUSH__ENABLED: "true", ...env },
  });
  return buildContainer(config);
}

function sent(container: Container) {
  return (container.notificationProvider as CompositeNotificationProvider).mock.sent;
}

describe("DFT notifications outbox", () => {
  it("enqueues on booking and delivers to the handset the person registered", async () => {
    // What the outbox carries is a user id, because that is what the code raising
    // the notification knows. It is not something a push service can address —
    // Firebase was handed "user-res" and had nowhere to send it — so the worker
    // resolves the person into the handsets they are actually reachable on.
    const container = await withPush();
    await container.devices.register({
      userId: "user-res", token: "ExponentPushToken[res-phone]", platform: "android", app: "resident",
    });
    await seedSlot(container, "slot-note", 3);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-note" });

    expect((await container.store.outbox.listPending()).length).toBeGreaterThanOrEqual(1);

    const processed = await container.notifications.processOutboxOnce();
    expect(processed).toBeGreaterThanOrEqual(1);

    const pushes = sent(container).filter((m) => m.channel === "push");
    expect(pushes.length).toBeGreaterThanOrEqual(1);
    // The token, not the user id.
    expect(pushes[0].to).toBe("ExponentPushToken[res-phone]");
    expect((await container.store.outbox.listPending()).length).toBe(0);
  });

  it("reaches every handset one person has", async () => {
    // A phone and the tablet kept at the counter. This is the whole reason a
    // device is a record rather than a field on the user.
    const container = await withPush();
    for (const token of ["token-phone", "token-tablet"]) {
      await container.devices.register({ userId: "user-res", token, platform: "ios", app: "resident" });
    }
    await seedSlot(container, "slot-note-2", 3);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-note-2" });
    await container.notifications.processOutboxOnce();

    const to = sent(container).filter((m) => m.channel === "push").map((m) => m.to);
    expect(to).toEqual(expect.arrayContaining(["token-phone", "token-tablet"]));
  });

  it("sends the SMS to a phone number rather than to a user id", async () => {
    const container = await withPush({ WNP_NOTIFICATIONS__SMS__ENABLED: "true" });
    await seedSlot(container, "slot-note-3", 3);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-note-3" });
    await container.notifications.processOutboxOnce();

    const texts = sent(container).filter((m) => m.channel === "sms");
    expect(texts.length).toBeGreaterThanOrEqual(1);
    expect(texts.every((m) => /^[0-9]{10}$/.test(m.to))).toBe(true);
  });

  it("stops writing to a handset the push service says is finished", async () => {
    const container = await withPush();
    await container.devices.register({
      userId: "user-res", token: "dead-token", platform: "android", app: "resident",
    });
    // What a push service actually answers when the app has been uninstalled. It is
    // not a delivery to retry, it is a device to stop writing to — and the only
    // thing the service told us about it is the token.
    const provider = container.notificationProvider as CompositeNotificationProvider;
    const original = provider.mock.send.bind(provider.mock);
    provider.mock.send = async (message) => {
      if (message.to === "dead-token") throw new Error("NotRegistered");
      return original(message);
    };

    await seedSlot(container, "slot-note-4", 3);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-note-4" });
    await container.notifications.processOutboxOnce();

    const device = await container.store.deviceTokens.get("dead-token");
    expect(device?.active).toBe(false);
    expect(device?.revokedReason).toMatch(/push service/i);
  });

  it("does not keep retrying a notification for somebody with nowhere to receive it", async () => {
    // No handset registered and no SMS. There is nothing to deliver to and no
    // amount of retrying will produce one, so the event is done rather than
    // pending forever.
    const container = await withPush();
    await seedSlot(container, "slot-note-5", 3);
    await container.scheduling.book({ residentId: "res-demo", societyId: "soc-demo", slotId: "slot-note-5" });
    await container.notifications.processOutboxOnce();
    expect((await container.store.outbox.listPending()).length).toBe(0);
  });
});

describe("DFT registering a handset", () => {
  it("overwrites its own row rather than growing one per app start", async () => {
    // The app registers on every start, because an operating system rotates a push
    // token and an app that registered once would quietly stop being reachable.
    const container = await withPush();
    for (let i = 0; i < 3; i += 1) {
      await container.devices.register({ userId: "user-res", token: "same-handset", platform: "ios", app: "resident" });
    }
    expect((await container.devices.forUser("user-res")).length).toBe(1);
  });

  it("lets a handset change hands", async () => {
    // Which is what happens when the phone is passed to the operator covering the
    // shift. The device belongs to whoever is signed into it.
    const container = await withPush();
    await container.devices.register({ userId: "user-op", token: "shared-handset", platform: "android", app: "staff" });
    await container.devices.register({ userId: "user-op-3", token: "shared-handset", platform: "android", app: "staff" });
    expect(await container.devices.forUser("user-op")).toEqual([]);
    expect((await container.devices.forUser("user-op-3")).length).toBe(1);
  });

  it("keeps a stood-down handset on the record rather than erasing it", async () => {
    const container = await withPush();
    await container.devices.register({ userId: "user-res", token: "old-phone", platform: "ios", app: "resident" });
    await container.devices.revoke("old-phone");
    expect(await container.devices.forUser("user-res")).toEqual([]);
    const listed = await container.devices.listForUser("user-res");
    expect(listed.length).toBe(1);
    expect(listed[0].active).toBe(false);
    expect(listed[0].revokedAt).toBeTruthy();
  });
});
