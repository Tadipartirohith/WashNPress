import type { AppConfig } from "../../config";
import { HttpMessageProvider, ExpoPushProvider, FcmPushProvider, LoggingNotificationProvider, type NotificationMessage, type NotificationProvider } from "./providers";

// Routes each message to the configured provider for its channel. A channel whose
// credentials are not set falls back to the mock provider, so the platform runs and
// is testable before any live gateway is connected.
export class CompositeNotificationProvider implements NotificationProvider {
  public readonly mock = new LoggingNotificationProvider();
  private readonly sms: NotificationProvider;
  private readonly whatsapp: NotificationProvider;
  private readonly push: NotificationProvider;

  constructor(config: AppConfig) {
    const n = config.notifications;
    this.sms = n.sms.enabled && n.sms.baseUrl && n.sms.apiKey ? new HttpMessageProvider(n.sms.baseUrl, n.sms.apiKey, n.sms.sender) : this.mock;
    this.whatsapp = n.whatsapp.enabled && n.whatsapp.baseUrl && n.whatsapp.apiKey ? new HttpMessageProvider(n.whatsapp.baseUrl, n.whatsapp.apiKey, n.whatsapp.sender) : this.mock;
    // Expo's service needs no server key: the device token it is given is itself
    // the authorisation to send to that one handset. Firebase needs one, and only
    // covers Android without a second set of APNs credentials, so it is the
    // deliberate choice rather than the default.
    this.push = !n.push.enabled || !n.push.baseUrl
      ? this.mock
      : n.push.provider === "expo" ? new ExpoPushProvider(n.push.baseUrl)
      : n.push.serverKey ? new FcmPushProvider(n.push.baseUrl, n.push.serverKey)
      : this.mock;
  }

  async send(message: NotificationMessage): Promise<void> {
    if (message.channel === "sms") return this.sms.send(message);
    if (message.channel === "whatsapp") return this.whatsapp.send(message);
    return this.push.send(message);
  }
}
