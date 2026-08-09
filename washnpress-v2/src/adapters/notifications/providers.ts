export interface NotificationMessage { channel: "sms" | "whatsapp" | "push"; to: string; title: string; body: string; }
export interface NotificationProvider { send(message: NotificationMessage): Promise<void>; }

// Records what would have been sent. In production each channel has a real provider
// behind this same interface (an SMS gateway, WhatsApp Business API, FCM).
export class LoggingNotificationProvider implements NotificationProvider {
  public readonly sent: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> { this.sent.push(message); }
}
