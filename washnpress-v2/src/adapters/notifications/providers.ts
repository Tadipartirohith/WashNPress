// Email joins the channels a message can go out on: a staff account is created
// against an address, and the address has to be proved before it is.
export interface NotificationMessage { channel: "sms" | "whatsapp" | "push" | "email"; to: string; title: string; body: string; }
export interface NotificationProvider { send(message: NotificationMessage): Promise<void>; }

// Mock provider used for local development and for any channel that is not yet
// configured. It records what would have been sent so tests and demos can inspect it.
export class LoggingNotificationProvider implements NotificationProvider {
  public readonly sent: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> { this.sent.push(message); }
}

// A generic HTTP SMS or WhatsApp gateway. The exact body shape varies by vendor, so
// this sends a simple JSON payload that most gateways accept or can be adapted to.
export class HttpMessageProvider implements NotificationProvider {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly sender: string) {}
  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ from: this.sender, to: message.to, text: `${message.title}: ${message.body}` }),
    });
    if (!res.ok) throw new Error(`Message gateway responded with status ${res.status}`);
  }
}

// Firebase Cloud Messaging legacy HTTP provider. Sends a notification payload to a
// device token. The server key comes from configuration.
export class FcmPushProvider implements NotificationProvider {
  constructor(private readonly baseUrl: string, private readonly serverKey: string) {}
  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `key=${this.serverKey}` },
      body: JSON.stringify({ to: message.to, notification: { title: message.title, body: message.body } }),
    });
    if (!res.ok) throw new Error(`FCM responded with status ${res.status}`);
  }
}
