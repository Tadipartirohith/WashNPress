import type { AppConfig } from "../../config";
import {
  HttpMessageProvider, HttpEmailProvider, WhatsAppCloudProvider,
  ExpoPushProvider, FcmPushProvider, LoggingNotificationProvider,
  type NotificationMessage, type NotificationProvider,
} from "./providers";

// Routes each message to the configured provider for its channel. A channel whose
// credentials are not set falls back to the mock provider, so the platform runs and
// is testable before any live gateway is connected.
export class CompositeNotificationProvider implements NotificationProvider {
  public readonly mock = new LoggingNotificationProvider();
  private readonly sms: NotificationProvider;
  private readonly whatsapp: NotificationProvider;
  private readonly push: NotificationProvider;
  private readonly email: NotificationProvider;

  constructor(config: AppConfig) {
    const n = config.notifications;
    this.sms = n.sms.enabled && n.sms.baseUrl && n.sms.apiKey
      ? new HttpMessageProvider(n.sms.baseUrl, n.sms.apiKey, n.sms.sender, n.sms.templateId)
      : this.mock;
    // Meta's Cloud API addresses a phone number id it issues and will only carry an
    // approved template outside a live conversation, so it cannot be driven through
    // the generic gateway. Any other vendor fronting WhatsApp still can be.
    this.whatsapp = !n.whatsapp.enabled || !n.whatsapp.baseUrl || !n.whatsapp.apiKey
      ? this.mock
      : n.whatsapp.provider === "cloud"
        ? (n.whatsapp.phoneNumberId
          ? new WhatsAppCloudProvider(n.whatsapp.baseUrl, n.whatsapp.apiKey, n.whatsapp.phoneNumberId, n.whatsapp.templateName)
          : this.mock)
        : new HttpMessageProvider(n.whatsapp.baseUrl, n.whatsapp.apiKey, n.whatsapp.sender);
    // Expo's service needs no server key: the device token it is given is itself
    // the authorisation to send to that one handset. Firebase needs one, and only
    // covers Android without a second set of APNs credentials, so it is the
    // deliberate choice rather than the default.
    this.push = !n.push.enabled || !n.push.baseUrl
      ? this.mock
      : n.push.provider === "expo" ? new ExpoPushProvider(n.push.baseUrl)
      : n.push.serverKey ? new FcmPushProvider(n.push.baseUrl, n.push.serverKey)
      : this.mock;
    // An address is no use without something to send from it: a transactional email
    // with no From is rejected by the gateway, or accepted and dropped by the
    // recipient's spam filter, which is worse because it looks like it worked.
    this.email = n.email.enabled && n.email.baseUrl && n.email.apiKey && n.email.fromAddress
      ? new HttpEmailProvider(n.email.baseUrl, n.email.apiKey, n.email.fromAddress, n.email.fromName)
      : this.mock;
  }

  // Every channel is named. This used to end with an unguarded `return
  // this.push.send(message)`, so an email — a channel the message type has always
  // had, because a staff account is created against an address that has to be
  // proved — was handed to the push provider, which addresses a device token. It
  // was posted to Expo with an email address where the token belongs and failed
  // there, or in a deployment with push switched off, was recorded as delivered.
  async send(message: NotificationMessage): Promise<void> {
    if (message.channel === "sms") return this.sms.send(message);
    if (message.channel === "whatsapp") return this.whatsapp.send(message);
    if (message.channel === "email") return this.email.send(message);
    if (message.channel === "push") return this.push.send(message);
    // A channel nobody has written a route for is recorded rather than guessed at,
    // because guessing is what put email on the push provider.
    return this.mock.send(message);
  }
}
