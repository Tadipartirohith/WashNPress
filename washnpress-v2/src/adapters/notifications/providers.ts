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

// Expo's push service, which is what the two applications actually register
// against.
//
// Firebase alone would only cover Android: reaching an iPhone through FCM means
// uploading an APNs authentication key to Firebase and keeping it current, which is
// a second set of credentials to hold and rotate for the same job. Expo's service
// fronts both, takes the token the app already has, and needs no server key — the
// token itself is the authorisation to send to that one device.
//
// Sending goes device by device rather than as a batch. A notification is raised
// because something happened to one person's order, so a batch would nearly always
// be a batch of one, and one failing token would be indistinguishable from all of
// them failing.
export class ExpoPushProvider implements NotificationProvider {
  constructor(private readonly baseUrl: string) {}
  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ to: message.to, title: message.title, body: message.body, sound: "default" }),
    });
    if (!res.ok) throw new Error(`Expo push responded with status ${res.status}`);
    // A 200 is not a delivery. Expo answers with a per-message ticket, and a token
    // that no longer exists comes back as an error inside that ticket — which is
    // exactly the case the caller needs to hear about, because it means the handset
    // should be stood down rather than retried.
    const payload = await res.json().catch(() => null) as { data?: { status?: string; message?: string; details?: { error?: string } } } | null;
    const ticket = payload?.data;
    if (ticket?.status === "error") {
      throw new Error(ticket.details?.error ?? ticket.message ?? "Expo push rejected the message");
    }
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
