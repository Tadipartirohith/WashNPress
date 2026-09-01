import { describe, it, expect } from "vitest";
import { loadConfig, resetConfigCache } from "../../src/config";
import { CompositeNotificationProvider } from "../../src/adapters/notifications/composite";

// Which provider a message is handed to.
//
// The router used to end with an unguarded `return this.push.send(message)`, so
// every channel it did not name explicitly went to the push provider. Email was
// already one of those channels — a staff account is created against an address and
// the address has to be proved — and push addresses a device token, so a verification
// email was posted to Expo with an email address where the token belongs. With push
// switched off, which is the default, it was instead recorded as delivered.
//
// These build the real router from the real configuration loader, because the bug
// was in how configuration is read into a decision rather than in the sending.

function routerWith(env: Record<string, string> = {}) {
  resetConfigCache();
  const config = loadConfig({ reload: true, env: { WNP_APP__ENV: "test", ...env } });
  return new CompositeNotificationProvider(config);
}

const message = (channel: "sms" | "whatsapp" | "push" | "email", to: string) =>
  ({ channel, to, title: "Verify your address", body: "Your code is 123456." });

describe("routing a message to a channel", () => {
  it("keeps an email away from the push provider", async () => {
    // The whole bug in one assertion: an email must not be addressed as a handset.
    const router = routerWith({
      WNP_NOTIFICATIONS__PUSH__ENABLED: "true",
      WNP_NOTIFICATIONS__PUSH__PROVIDER: "expo",
      WNP_NOTIFICATIONS__PUSH__BASEURL: "https://push.example.invalid/send",
    });
    // No email gateway is configured, so it lands on the recorder rather than being
    // posted to the push service — which is exactly what would happen if the router
    // still fell through, except it would be posted to a real endpoint instead.
    await router.send(message("email", "staff@example.com"));
    expect(router.mock.sent.map((m) => m.channel)).toEqual(["email"]);
    expect(router.mock.sent[0].to).toBe("staff@example.com");
  });

  it("records every channel while nothing at all is configured", async () => {
    const router = routerWith();
    for (const channel of ["sms", "whatsapp", "push", "email"] as const) {
      await router.send(message(channel, `${channel}@example.com`));
    }
    expect(router.mock.sent.map((m) => m.channel)).toEqual(["sms", "whatsapp", "push", "email"]);
  });

  it("sends an email through the email gateway once it has one", async () => {
    const router = routerWith({
      WNP_NOTIFICATIONS__EMAIL__ENABLED: "true",
      WNP_NOTIFICATIONS__EMAIL__BASEURL: "https://email.example.invalid/send",
      WNP_NOTIFICATIONS__EMAIL__APIKEY: "key",
      WNP_NOTIFICATIONS__EMAIL__FROMADDRESS: "noreply@washnpress.example",
    });
    // It leaves the recorder, so it is going somewhere real. The endpoint does not
    // exist, which is what a rejected fetch here proves.
    await expect(router.send(message("email", "staff@example.com"))).rejects.toThrow();
    expect(router.mock.sent).toEqual([]);
  });

  it("will not send an email with nobody to send it from", async () => {
    // A transactional email with no From is rejected by the gateway, or accepted and
    // dropped by the recipient's filter — which is worse, because it looks like it
    // worked. Recording it is the honest outcome.
    const router = routerWith({
      WNP_NOTIFICATIONS__EMAIL__ENABLED: "true",
      WNP_NOTIFICATIONS__EMAIL__BASEURL: "https://email.example.invalid/send",
      WNP_NOTIFICATIONS__EMAIL__APIKEY: "key",
    });
    await router.send(message("email", "staff@example.com"));
    expect(router.mock.sent).toHaveLength(1);
  });

  it("keeps the WhatsApp Cloud API off the generic gateway", async () => {
    // Meta addresses a phone number id it issues rather than a sender string, so a
    // cloud configuration missing that id has nothing to send to and is recorded
    // rather than posted somewhere it would be rejected.
    const router = routerWith({
      WNP_NOTIFICATIONS__WHATSAPP__ENABLED: "true",
      WNP_NOTIFICATIONS__WHATSAPP__PROVIDER: "cloud",
      WNP_NOTIFICATIONS__WHATSAPP__BASEURL: "https://graph.example.invalid/v20.0",
      WNP_NOTIFICATIONS__WHATSAPP__APIKEY: "token",
    });
    await router.send(message("whatsapp", "919876543210"));
    expect(router.mock.sent).toHaveLength(1);
  });

  it("uses the cloud provider once it has a phone number id", async () => {
    const router = routerWith({
      WNP_NOTIFICATIONS__WHATSAPP__ENABLED: "true",
      WNP_NOTIFICATIONS__WHATSAPP__PROVIDER: "cloud",
      WNP_NOTIFICATIONS__WHATSAPP__BASEURL: "https://graph.example.invalid/v20.0",
      WNP_NOTIFICATIONS__WHATSAPP__APIKEY: "token",
      WNP_NOTIFICATIONS__WHATSAPP__PHONENUMBERID: "123456",
    });
    await expect(router.send(message("whatsapp", "919876543210"))).rejects.toThrow();
    expect(router.mock.sent).toEqual([]);
  });
});

describe("reading the new configuration from the environment", () => {
  it("maps the camelCase keys the deployment will actually set", async () => {
    // The env reader lower-cases each path segment and looks it up in a hand
    // maintained table. A key missing from that table is silently written to a
    // different field, so this is checking the table and not the schema.
    resetConfigCache();
    const config = loadConfig({
      reload: true,
      env: {
        WNP_APP__ENV: "test",
        WNP_NOTIFICATIONS__SMS__TEMPLATEID: "1307161234567890123",
        WNP_NOTIFICATIONS__WHATSAPP__PHONENUMBERID: "123456",
        WNP_NOTIFICATIONS__WHATSAPP__TEMPLATENAME: "order_update",
        WNP_NOTIFICATIONS__EMAIL__FROMADDRESS: "noreply@washnpress.example",
        WNP_NOTIFICATIONS__EMAIL__FROMNAME: "Wash N Press",
      },
    });
    expect(config.notifications.sms.templateId).toBe("1307161234567890123");
    expect(config.notifications.whatsapp.phoneNumberId).toBe("123456");
    expect(config.notifications.whatsapp.templateName).toBe("order_update");
    expect(config.notifications.email.fromAddress).toBe("noreply@washnpress.example");
    expect(config.notifications.email.fromName).toBe("Wash N Press");
  });

  it("carries a long numeric id without rounding it off", async () => {
    // An Indian DLT template id is nineteen digits, which is past the largest
    // integer a double can hold exactly. Read as a number it comes back as
    // 1307161234567890200 — still a valid number, so nothing complains, and every
    // SMS is then rejected for quoting a template that was never registered.
    resetConfigCache();
    const config = loadConfig({
      reload: true,
      env: { WNP_APP__ENV: "test", WNP_NOTIFICATIONS__SMS__TEMPLATEID: "1307161234567890123" },
    });
    expect(config.notifications.sms.templateId).toBe("1307161234567890123");
  });

  it("keeps a leading zero on an identifier that has one", async () => {
    resetConfigCache();
    const config = loadConfig({
      reload: true,
      env: { WNP_APP__ENV: "test", WNP_SUPPORT__PHONE: "04012345678" },
    });
    expect(config.support.phone).toBe("04012345678");
  });

  it("still reads a genuine number as a number", async () => {
    // The round trip rule has to leave the settings that were always numbers alone.
    resetConfigCache();
    const config = loadConfig({
      reload: true,
      env: { WNP_APP__ENV: "test", WNP_APP__PORT: "8099", WNP_STORAGE__POSTGRES__POOLMAX: "25" },
    });
    expect(config.app.port).toBe(8099);
    expect(config.storage.postgres.poolMax).toBe(25);
  });

  it("switches a payment method on from the environment", async () => {
    resetConfigCache();
    const config = loadConfig({
      reload: true,
      env: { WNP_APP__ENV: "test", WNP_PAYMENTS__METHODS__CASH: "true" },
    });
    expect(config.payments.methods.cash).toBe(true);
    expect(config.payments.methods.card).toBe(false);
  });

  it("ships with every integration switched off", async () => {
    // The state the platform is in until somebody configures it, asserted so that
    // switching one on is a deliberate act recorded in a diff.
    resetConfigCache();
    const config = loadConfig({ reload: true, env: { WNP_APP__ENV: "test" } });
    expect(config.notifications.sms.enabled).toBe(false);
    expect(config.notifications.whatsapp.enabled).toBe(false);
    expect(config.notifications.email.enabled).toBe(false);
    expect(config.notifications.push.enabled).toBe(false);
    expect(Object.values(config.payments.methods)).toEqual([false, false, false, false]);
    expect(config.support).toEqual({ email: "", phone: "", whatsapp: "", hours: "" });
  });
});
